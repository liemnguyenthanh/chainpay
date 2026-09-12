import type { Pool } from '@chainpay/database';
import type { Verifier, VerificationResult } from '@chainpay/shared';
import { settle } from './settlement';
export class VerificationProcessor {
  constructor(
    private readonly pool: Pool,
    private readonly verifier: Verifier,
    private readonly options: {
      leaseMs?: number;
      retryBudget?: number;
      delayMs?: number;
    } = {},
  ) {}
  async process(attemptId: string) {
    const claimed = await this.pool.query(
      `UPDATE payment_attempts SET status='VERIFYING',version=version+1,lease_until=now()+($2::int * interval '1 millisecond'),updated_at=now() WHERE id=$1 AND status IN ('SUBMITTED','VERIFYING','PENDING_CHAIN','CONFIRMING') AND next_check_at<=now() AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,
      [attemptId, this.options.leaseMs ?? 120000],
    );
    const attempt = claimed.rows[0];
    if (!attempt) return false;
    const {
      rows: [payment],
    } = await this.pool.query(
      'SELECT p.*,b.payer_address,b.start_block FROM payments p JOIN payer_bindings b ON b.payment_id=p.id WHERE p.id=$1',
      [attempt.payment_id],
    );
    if (!payment) throw new Error('Missing payer binding');
    let result: VerificationResult;
    try {
      result = await this.verifier.verify({
        chainId: payment.chain_id,
        txHash: attempt.tx_hash,
        tokenAddress: payment.token_address,
        payerAddress: payment.payer_address,
        receiverAddress: payment.receiver_address,
        amountBaseUnits: payment.amount_base_units,
        startBlock: payment.start_block,
        previousBlockHash: attempt.block_hash,
      });
    } catch {
      result = { status: 'RETRY', code: 'RPC_UNAVAILABLE' };
    }
    if (result.status === 'VERIFIED')
      return settle(this.pool, attemptId, attempt.version, result.evidence);
    const retries = attempt.retry_count + (result.status === 'RETRY' ? 1 : 0);
    const status =
      result.status === 'RETRY'
        ? retries >= (this.options.retryBudget ?? 5)
          ? 'NEEDS_REVIEW'
          : 'PENDING_CHAIN'
        : result.status;
    const delay =
      this.options.delayMs ??
      Math.min(60000, 1000 * 2 ** Math.min(retries, 6)) +
        Math.floor(Math.random() * 500);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM payments WHERE id=$1 FOR UPDATE', [
        attempt.payment_id,
      ]);
      const updated = await c.query(
        `UPDATE payment_attempts SET status=$3,version=version+1,retry_count=$4,error_code=$5,block_number=$6,block_hash=$7,log_index=$8,lease_until=NULL,next_check_at=now()+($9::int * interval '1 millisecond'),updated_at=now() WHERE id=$1 AND version=$2 AND status='VERIFYING' AND lease_until>clock_timestamp() RETURNING id`,
        [
          attemptId,
          attempt.version,
          status,
          retries,
          'code' in result ? result.code : null,
          'evidence' in result ? result.evidence.blockNumber : null,
          'evidence' in result ? result.evidence.blockHash : null,
          'evidence' in result ? result.evidence.logIndex : null,
          delay,
        ],
      );
      if (!updated.rowCount) {
        await c.query('ROLLBACK');
        return false;
      }
      const {
        rows: [state],
      } = await c.query(
        "UPDATE payments SET status=$2,version=version+1,updated_at=now() WHERE id=$1 AND status<>'CONFIRMED' RETURNING status,version",
        [
          attempt.payment_id,
          status === 'REJECTED' ? 'AWAITING_PAYMENT' : 'PROCESSING',
        ],
      );
      if (state)
        await c.query(
          "INSERT INTO outbox(event_type,aggregate_id,payload) VALUES('PAYMENT_UPDATED',$1::uuid,jsonb_build_object('paymentId',$1::text,'status',$2::text,'version',$3::int))",
          [attempt.payment_id, state.status, state.version],
        );
      if (status === 'PENDING_CHAIN' || status === 'CONFIRMING')
        await c.query(
          "INSERT INTO outbox(event_type,aggregate_id,payload,available_at) VALUES('VERIFY_ATTEMPT',$1::uuid,jsonb_build_object('attemptId',$1::text),now()+($2::int * interval '1 millisecond'))",
          [attemptId, delay],
        );
      await c.query('COMMIT');
      return true;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
}
