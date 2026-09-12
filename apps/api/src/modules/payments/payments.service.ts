import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  and,
  desc,
  eq,
  payments,
  sql,
  outbox,
  payerBindings,
  paymentAttempts,
  settlements,
} from '@chainpay/database';
import type {
  MerchantPaymentDetail,
  PaymentPage,
  PaymentStatus,
  AttemptStatus,
} from '@chainpay/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { digest } from '../../common/crypto/digest';
import { fail } from '../../common/http/errors';
import { uuidPattern } from '../../common/validation/uuid';
import { normalize } from './payment-normalization';
import { present } from './payment-presenter';
@Injectable()
export class PaymentsService {
  constructor(private readonly database: DatabaseService) {}
  async create(
    merchant: { id: string; receiverAddress: string },
    key: string,
    body: unknown,
  ) {
    const input = normalize(body);
    const created = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(payments)
        .values({
          merchantId: merchant.id,
          idempotencyKey: key,
          normalizedRequest: input.fingerprint,
          chainId: input.asset.chainId,
          tokenAddress: input.asset.tokenAddress,
          tokenDecimals: input.asset.decimals,
          amountBaseUnits: input.amount,
          receiverAddress: merchant.receiverAddress,
          checkoutTokenHash: digest(randomBytes(32).toString('base64url')),
        })
        .onConflictDoNothing({
          target: [payments.merchantId, payments.idempotencyKey],
        })
        .returning();
      if (row)
        await tx.insert(outbox).values({
          eventType: 'PAYMENT_UPDATED',
          aggregateId: row.id,
          payload: {
            paymentId: row.id,
            status: row.status as PaymentStatus,
            version: row.version,
          },
        });
      return row;
    });
    if (created) {
      return { payment: present(created), created: true };
    }
    // Separate READ COMMITTED statement sees the committed winner after unique-index waiting.
    const [existing] = await this.database.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.merchantId, merchant.id),
          eq(payments.idempotencyKey, key),
        ),
      );
    if (!existing)
      return fail(503, 'RETRY_REQUEST', 'Retry with the same idempotency key');
    if (existing.normalizedRequest !== input.fingerprint)
      return fail(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Key already used for a different payment',
      );
    return { payment: present(existing), created: false };
  }
  async detail(merchantId: string, id: string): Promise<MerchantPaymentDetail> {
    return this.database.db.transaction(
      async (tx) => {
        const [row] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.id, id), eq(payments.merchantId, merchantId)));
        if (!row) return fail(404, 'NOT_FOUND', 'Payment not found');
        const bindings = await tx
          .select()
          .from(payerBindings)
          .where(eq(payerBindings.paymentId, id))
          .limit(1);
        const attempts = await tx
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.paymentId, id))
          .orderBy(desc(paymentAttempts.createdAt), desc(paymentAttempts.id))
          .limit(1);
        const settled = await tx
          .select()
          .from(settlements)
          .where(eq(settlements.paymentId, id))
          .limit(1);
        const attempt = attempts[0];
        const settlement = settled[0];
        return {
          ...present(row),
          payerAddress: bindings[0]?.payerAddress ?? null,
          attempt: attempt
            ? {
                id: attempt.id,
                txHash: attempt.txHash,
                status: attempt.status as AttemptStatus,
                code: attempt.errorCode,
              }
            : null,
          settlement: settlement
            ? {
                txHash: settlement.txHash,
                blockNumber: settlement.blockNumber,
                blockHash: settlement.blockHash,
                logIndex: settlement.logIndex,
              }
            : null,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async list(
    merchantId: string,
    query: Record<string, unknown>,
  ): Promise<PaymentPage> {
    const status = query.status;
    if (
      status !== undefined &&
      (typeof status !== 'string' ||
        !['AWAITING_PAYMENT', 'PROCESSING', 'CONFIRMED'].includes(status))
    )
      return fail(400, 'INVALID_STATUS', 'Invalid payment status');
    const limitText = query.limit ?? '30';
    if (
      typeof limitText !== 'string' ||
      !/^[1-9]\d{0,2}$/.test(limitText) ||
      Number(limitText) > 100
    )
      return fail(400, 'INVALID_LIMIT', 'Limit must be 1–100');
    let boundary;
    if (query.cursor !== undefined) {
      try {
        if (
          typeof query.cursor !== 'string' ||
          query.cursor.length > 200 ||
          !/^[A-Za-z0-9_-]+$/.test(query.cursor)
        )
          throw new Error();
        const decoded: unknown = JSON.parse(
          Buffer.from(query.cursor, 'base64url').toString(),
        );
        if (
          !Array.isArray(decoded) ||
          decoded.length !== 2 ||
          typeof decoded[0] !== 'string' ||
          typeof decoded[1] !== 'string' ||
          !uuidPattern.test(decoded[1]) ||
          new Date(decoded[0]).toISOString() !== decoded[0]
        )
          throw new Error();
        boundary = sql`(${payments.createdAt}, ${payments.id}) < (${decoded[0]}::timestamptz, ${decoded[1]}::uuid)`;
      } catch {
        return fail(400, 'INVALID_CURSOR', 'Invalid cursor');
      }
    }
    const limit = Number(limitText);
    const rows = await this.database.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.merchantId, merchantId),
          boundary,
          typeof status === 'string' ? eq(payments.status, status) : undefined,
        ),
      )
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(present),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify([last.createdAt.toISOString(), last.id]),
            ).toString('base64url')
          : null,
    };
  }
}
