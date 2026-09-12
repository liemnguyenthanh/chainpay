import type { Pool } from '@chainpay/database';
export interface JobQueue {
  add(
    name: string,
    data: { attemptId: string },
    options: {
      jobId: string;
      removeOnComplete: boolean;
      removeOnFail: boolean;
    },
  ): Promise<unknown>;
}
export interface Publisher {
  publish(channel: string, payload: string): Promise<unknown>;
}
export class OutboxDispatcher {
  constructor(
    private readonly pool: Pool,
    private readonly queue: JobQueue,
    private readonly publisher: Publisher,
  ) {}
  async dispatch() {
    const { rows } = await this.pool.query(
      `WITH candidates AS (SELECT id FROM outbox WHERE delivered_at IS NULL AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at LIMIT 100 FOR UPDATE SKIP LOCKED) UPDATE outbox o SET lease_until=now()+interval '30 seconds',attempts=attempts+1 FROM candidates c WHERE o.id=c.id RETURNING o.*`,
    );
    for (const event of rows) {
      if (event.event_type === 'VERIFY_ATTEMPT')
        await this.queue.add(
          'verify',
          { attemptId: event.aggregate_id },
          {
            jobId: `outbox-${event.id}`,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      else
        await this.publisher.publish(
          'chainpay:payments',
          JSON.stringify(event.payload),
        );
      await this.pool.query(
        'UPDATE outbox SET delivered_at=now(),lease_until=NULL WHERE id=$1 AND attempts=$2 AND delivered_at IS NULL AND lease_until>now()',
        [event.id, event.attempts],
      );
    }
    return rows.length;
  }
  async recover() {
    const { rows } = await this.pool.query(
      "SELECT id,version FROM payment_attempts WHERE status IN ('SUBMITTED','VERIFYING','PENDING_CHAIN','CONFIRMING') AND next_check_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_check_at LIMIT 100",
    );
    for (const attempt of rows)
      await this.queue.add(
        'verify',
        { attemptId: attempt.id },
        {
          jobId: `recovery-${attempt.id}-${attempt.version}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    return rows.length;
  }
}
