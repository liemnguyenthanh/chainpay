import type { Pool } from '@chainpay/database';
import type { TransferEvidence } from '@chainpay/shared';

/** The lease/version fence and both unique constraints are the settlement authority. */
export async function settle(
  pool: Pool,
  attemptId: string,
  expectedVersion: number,
  evidence: TransferEvidence,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lookup = await client.query(
      'SELECT payment_id FROM payment_attempts WHERE id=$1',
      [attemptId],
    );
    if (!lookup.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    const paymentId: string = lookup.rows[0].payment_id;
    const payment = (
      await client.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [
        paymentId,
      ])
    ).rows[0];
    const attempt = (
      await client.query(
        "SELECT * FROM payment_attempts WHERE id=$1 AND version=$2 AND status='VERIFYING' AND lease_until>clock_timestamp() FOR UPDATE",
        [attemptId, expectedVersion],
      )
    ).rows[0];
    if (!attempt || payment.status === 'CONFIRMED') {
      await client.query('ROLLBACK');
      return false;
    }
    const inserted = await client.query(
      'INSERT INTO settlements(payment_id,chain_id,tx_hash,block_number,block_hash,log_index) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING payment_id',
      [
        paymentId,
        attempt.chain_id,
        attempt.tx_hash,
        evidence.blockNumber,
        evidence.blockHash,
        evidence.logIndex,
      ],
    );
    if (!inserted.rowCount) {
      // Valid evidence already allocated elsewhere: preserve uncertainty for operator inspection.
      await client.query(
        "UPDATE payment_attempts SET status='NEEDS_REVIEW',error_code='TRANSACTION_ALREADY_SETTLED',version=version+1,lease_until=NULL,updated_at=now() WHERE id=$1",
        [attemptId],
      );
      await client.query(
        'UPDATE payments SET version=version+1,updated_at=now() WHERE id=$1',
        [paymentId],
      );
    } else {
      await client.query(
        "UPDATE payment_attempts SET status='VERIFIED',version=version+1,block_number=$2,block_hash=$3,log_index=$4,error_code=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
        [
          attemptId,
          evidence.blockNumber,
          evidence.blockHash,
          evidence.logIndex,
        ],
      );
      await client.query(
        "UPDATE payments SET status='CONFIRMED',confirmed_at=now(),version=version+1,updated_at=now() WHERE id=$1",
        [paymentId],
      );
      await client.query(
        'UPDATE payer_bindings SET allocation_key=NULL WHERE payment_id=$1',
        [paymentId],
      );
    }
    await client.query(
      "INSERT INTO outbox(event_type,aggregate_id,payload) SELECT 'PAYMENT_UPDATED',id,jsonb_build_object('paymentId',id,'status',status,'version',version) FROM payments WHERE id=$1",
      [paymentId],
    );
    await client.query('COMMIT');
    return Boolean(inserted.rowCount);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
