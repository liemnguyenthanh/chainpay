import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { fail } from '../../common/http/errors';
@Injectable()
export class TransactionService {
  constructor(private readonly database: DatabaseService) {}
  async submit(paymentId: string, hash: unknown) {
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash))
      return fail(400, 'INVALID_HASH', 'Transaction hash required');
    const txHash = hash.toLowerCase();
    const c = await this.database.pool.connect();
    try {
      await c.query('BEGIN');
      const {
        rows: [payment],
      } = await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [
        paymentId,
      ]);
      if (!payment) return fail(404, 'NOT_FOUND', 'Payment not found');
      if (payment.status === 'CONFIRMED') {
        const {
          rows: [settlement],
        } = await c.query('SELECT * FROM settlements WHERE payment_id=$1', [
          paymentId,
        ]);
        await c.query('COMMIT');
        return { paymentId, status: payment.status, settlement };
      }
      const {
        rows: [existing],
      } = await c.query(
        'SELECT * FROM payment_attempts WHERE payment_id=$1 AND tx_hash=$2',
        [paymentId, txHash],
      );
      if (existing) {
        await c.query('COMMIT');
        return { paymentId, attempt: existing };
      }
      const active = await c.query(
        "SELECT id FROM payment_attempts WHERE payment_id=$1 AND status NOT IN ('REJECTED','VERIFIED')",
        [paymentId],
      );
      if (active.rowCount)
        return fail(
          409,
          'ACTIVE_ATTEMPT',
          'An existing transaction is still being verified',
        );
      const {
        rows: [attempt],
      } = await c.query(
        'INSERT INTO payment_attempts(payment_id,chain_id,tx_hash) VALUES($1,$2,$3) RETURNING *',
        [paymentId, payment.chain_id, txHash],
      );
      await c.query(
        "UPDATE payments SET status='PROCESSING',version=version+1,updated_at=now() WHERE id=$1",
        [paymentId],
      );
      await c.query(
        "INSERT INTO outbox(event_type,aggregate_id,payload) VALUES('VERIFY_ATTEMPT',$1::uuid,jsonb_build_object('attemptId',$1::text)),('PAYMENT_UPDATED',$2::uuid,jsonb_build_object('paymentId',$2::text,'status','PROCESSING','version',$3::int))",
        [attempt.id, paymentId, payment.version + 1],
      );
      await c.query('COMMIT');
      return { paymentId, attempt };
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
  async retry(paymentId: string, attemptId: string, merchantId: string) {
    const c = await this.database.pool.connect();
    try {
      await c.query('BEGIN');
      const payment = await c.query(
        'SELECT id FROM payments WHERE id=$1 AND merchant_id=$2 FOR UPDATE',
        [paymentId, merchantId],
      );
      if (!payment.rowCount) return fail(404, 'NOT_FOUND', 'Payment not found');
      const result = await c.query(
        "UPDATE payment_attempts SET status='SUBMITTED',version=version+1,retry_count=0,error_code=NULL,lease_until=NULL,next_check_at=now(),updated_at=now() WHERE id=$1 AND payment_id=$2 AND status='NEEDS_REVIEW' RETURNING *",
        [attemptId, paymentId],
      );
      if (!result.rowCount)
        return fail(409, 'NOT_REVIEWABLE', 'Attempt is not awaiting review');
      await c.query(
        "INSERT INTO outbox(event_type,aggregate_id,payload) VALUES('VERIFY_ATTEMPT',$1::uuid,jsonb_build_object('attemptId',$1::text))",
        [attemptId],
      );
      await c.query(
        'UPDATE payments SET version=version+1,updated_at=now() WHERE id=$1',
        [paymentId],
      );
      await c.query(
        "INSERT INTO outbox(event_type,aggregate_id,payload) SELECT 'PAYMENT_UPDATED',id,jsonb_build_object('paymentId',id,'status',status,'version',version) FROM payments WHERE id=$1",
        [paymentId],
      );
      await c.query('COMMIT');
      return { attempt: result.rows[0] };
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
}
