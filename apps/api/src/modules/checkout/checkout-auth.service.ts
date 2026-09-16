import { getPaymentAsset } from '@chainpay/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { BindingChainReader } from '@chainpay/shared';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { SessionService } from '../merchant-session/session.service';
import { digest } from '../../common/crypto/digest';
import { fail } from '../../common/http/errors';
import { uuidPattern } from '../../common/validation/uuid';

export const BINDING_CHAIN_READER = 'BINDING_CHAIN_READER';
@Injectable()
export class CheckoutAuthService {
  private readonly limits = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly database: DatabaseService,
    private readonly merchant: SessionService,
    @Inject(BINDING_CHAIN_READER) private readonly chain: BindingChainReader,
  ) {}
  checkOrigin(req: Request) {
    this.merchant.checkOrigin(req);
  }
  throttle(req: Request, scope: string) {
    const now = Date.now();
    for (const [key, value] of this.limits)
      if (value.until <= now) this.limits.delete(key);
    const key = `${scope}:${req.ip}`;
    const value = this.limits.get(key) ?? { count: 0, until: now + 60000 };
    if (++value.count > 60) fail(429, 'RATE_LIMITED', 'Try again later');
    this.limits.set(key, value);
  }
  async payment(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      return fail(404, 'NOT_FOUND', 'Checkout not found');
    const result = await this.database.pool.query(
      'SELECT * FROM payments WHERE checkout_token_hash=$1',
      [digest(token)],
    );
    if (!result.rows[0]) return fail(404, 'NOT_FOUND', 'Checkout not found');
    const payment = result.rows[0];
    const asset = getPaymentAsset(payment.chain_id);
    if (
      !asset ||
      payment.token_address !== asset.tokenAddress ||
      payment.token_decimals !== asset.decimals
    )
      return fail(409, 'UNSUPPORTED_PAYMENT', 'Payment asset is unavailable');
    return payment;
  }
  async snapshot(token: string) {
    const p = await this.payment(token);
    const attempt = await this.database.pool.query(
      'SELECT status,error_code FROM payment_attempts WHERE payment_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [p.id],
    );
    return {
      id: p.id,
      chainId: p.chain_id,
      token: getPaymentAsset(p.chain_id)!.token,
      tokenAddress: p.token_address,
      tokenDecimals: p.token_decimals,
      amountBaseUnits: p.amount_base_units,
      receiverAddress: p.receiver_address,
      status: p.status,
      version: p.version,
      attempt: attempt.rows[0]
        ? { status: attempt.rows[0].status, code: attempt.rows[0].error_code }
        : null,
    };
  }
  async issue(id: string, req: Request) {
    this.checkOrigin(req);
    const merchant = await this.merchant.merchant(req);
    if (!uuidPattern.test(id))
      return fail(400, 'INVALID_ID', 'Invalid payment ID');
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const p = (
        await client.query(
          'SELECT * FROM payments WHERE id=$1 AND merchant_id=$2 FOR UPDATE',
          [id, merchant.id],
        )
      ).rows[0];
      if (!p) return fail(404, 'NOT_FOUND', 'Payment not found');
      if (
        p.status !== 'AWAITING_PAYMENT' ||
        (
          await client.query(
            'SELECT 1 FROM payer_bindings WHERE payment_id=$1',
            [id],
          )
        ).rowCount
      )
        return fail(409, 'CHECKOUT_BOUND', 'Cannot rotate a bound checkout');
      const token = randomBytes(32).toString('base64url');
      await client.query(
        'UPDATE payments SET checkout_token_hash=$2 WHERE id=$1',
        [id, digest(token)],
      );
      await client.query(
        'UPDATE payer_challenges SET consumed_at=now() WHERE payment_id=$1 AND consumed_at IS NULL',
        [id],
      );
      await client.query('COMMIT');
      return { checkoutToken: token };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async challenge(token: string, body: unknown, req: Request) {
    this.checkOrigin(req);
    this.throttle(req, 'challenge');
    const payer = (body as { payerAddress?: unknown } | null)?.payerAddress;
    if (typeof payer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(payer))
      return fail(400, 'INVALID_PAYER', 'Valid payer address required');
    const p = await this.payment(token);
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 300000);
    const domain = this.merchant.origin;
    const message = `ChainPay checkout authentication\nDomain: ${domain}\nPayment: ${p.id}\nChain ID: ${p.chain_id}\nPayer: ${payer.toLowerCase()}\nNonce: ${nonce}\nExpires: ${expiresAt.toISOString()}`;
    // Serialize issuance with token rotation, so an old token cannot mint a new usable challenge.
    const result = await this.database.pool.query(
      `INSERT INTO payer_challenges(payment_id,payer_address,domain,chain_id,nonce,message,expires_at)
      SELECT id,$2,$3,chain_id,$4,$5,$6 FROM payments WHERE id=$1 AND checkout_token_hash=$7 FOR UPDATE RETURNING id`,
      [
        p.id,
        payer.toLowerCase(),
        domain,
        nonce,
        message,
        expiresAt,
        digest(token),
      ],
    );
    if (!result.rows[0]) return fail(404, 'NOT_FOUND', 'Checkout not found');
    return {
      challengeId: result.rows[0].id,
      message,
      expiresAt: expiresAt.toISOString(),
    };
  }
  async verify(token: string, body: unknown, req: Request, res: Response) {
    this.checkOrigin(req);
    this.throttle(req, 'verify');
    const value = body as { challengeId?: unknown; signature?: unknown } | null;
    if (
      typeof value?.challengeId !== 'string' ||
      !uuidPattern.test(value.challengeId) ||
      typeof value.signature !== 'string' ||
      !/^0x[0-9a-fA-F]{130}$/.test(value.signature)
    )
      return fail(
        400,
        'INVALID_SIGNATURE',
        'Challenge and EOA signature required',
      );
    const p = await this.payment(token);
    const challenge = (
      await this.database.pool.query(
        'SELECT * FROM payer_challenges WHERE id=$1 AND payment_id=$2',
        [value.challengeId, p.id],
      )
    ).rows[0];
    if (
      !challenge ||
      challenge.consumed_at ||
      challenge.expires_at <= new Date() ||
      challenge.domain !== this.merchant.origin ||
      challenge.chain_id !== p.chain_id
    )
      return fail(
        401,
        'INVALID_CHALLENGE',
        'Challenge is expired or unavailable',
      );
    let valid = false;
    try {
      valid = await verifyMessage({
        address: challenge.payer_address,
        message: challenge.message,
        signature: value.signature as `0x${string}`,
      });
    } catch {
      /* malformed signature */
    }
    if (!valid)
      return fail(401, 'INVALID_SIGNATURE', 'Signature does not match payer');
    let startBlock: string;
    try {
      startBlock = await this.chain.getStartBlock(
        p.chain_id,
        challenge.payer_address,
      );
    } catch {
      return fail(
        503,
        'BINDING_UNAVAILABLE',
        'Wallet eligibility could not be verified; retry authentication',
      );
    }
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = (
        await client.query(
          'SELECT * FROM payments WHERE id=$1 AND checkout_token_hash=$2 FOR UPDATE',
          [p.id, digest(token)],
        )
      ).rows[0];
      if (!locked) return fail(401, 'INVALID_CHALLENGE', 'Checkout changed');
      const consumed = await client.query(
        'UPDATE payer_challenges SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING id',
        [challenge.id],
      );
      if (!consumed.rowCount)
        return fail(
          401,
          'INVALID_CHALLENGE',
          'Challenge is expired or already used',
        );
      const binding = (
        await client.query('SELECT * FROM payer_bindings WHERE payment_id=$1', [
          p.id,
        ])
      ).rows[0];
      if (binding && binding.payer_address !== challenge.payer_address)
        return fail(
          409,
          'PAYER_BOUND',
          'Payment is already bound to another payer',
        );
      if (!binding) {
        if (locked.status !== 'AWAITING_PAYMENT')
          return fail(409, 'PAYMENT_NOT_BINDABLE', 'Payment cannot be bound');
        const allocation = digest(
          JSON.stringify([
            p.merchant_id,
            challenge.payer_address,
            p.chain_id,
            p.token_address,
            p.receiver_address,
            p.amount_base_units,
          ]),
        );
        await client.query(
          'INSERT INTO payer_bindings(payment_id,payer_address,start_block,allocation_key) VALUES($1,$2,$3,$4)',
          [p.id, challenge.payer_address, startBlock, allocation],
        );
      }
      const session = randomBytes(32).toString('base64url');
      await client.query(
        "INSERT INTO checkout_sessions(token_hash,payment_id,payer_address,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [digest(session), p.id, challenge.payer_address],
      );
      await client.query('COMMIT');
      res.cookie(`chainpay_checkout_${p.id}`, session, {
        httpOnly: true,
        secure: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        path: `/v1/checkout/${token}`,
        maxAge: 3600000,
      });
      return { paymentId: p.id, payerAddress: challenge.payer_address };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505')
        return fail(
          409,
          'ALLOCATION_CONFLICT',
          'Another payment already claims this payer, token, receiver and amount',
        );
      throw error;
    } finally {
      client.release();
    }
  }
  async authorize(
    req: Request,
    token: string,
  ): Promise<{ paymentId: string; payerAddress: string }> {
    const p = await this.payment(token);
    const name = `chainpay_checkout_${p.id}=`;
    const values = (req.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(name));
    const session = values.length === 1 ? values[0]!.slice(name.length) : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(session))
      return fail(401, 'UNAUTHORIZED', 'Checkout session required');
    const row = (
      await this.database.pool.query(
        'SELECT payer_address FROM checkout_sessions WHERE token_hash=$1 AND payment_id=$2 AND expires_at>now()',
        [digest(session), p.id],
      )
    ).rows[0];
    if (!row) return fail(401, 'UNAUTHORIZED', 'Checkout session required');
    return { paymentId: p.id, payerAddress: row.payer_address };
  }
}
