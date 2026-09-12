import {
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { connectDatabase } from '@chainpay/database';
import { RpcVerifier } from '@chainpay/blockchain';
import { VERIFICATION_QUEUE } from '@chainpay/shared';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { VerificationProcessor } from './processor';
import { OutboxDispatcher } from './dispatcher';
@Injectable()
class WorkerLifecycle implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private queue?: Queue;
  private worker?: Worker;
  private redis?: Redis;
  private connection?: ReturnType<typeof connectDatabase>;
  private tick?: Promise<void>;
  async onModuleInit() {
    if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
      throw new Error('DATABASE_URL and REDIS_URL required');
    this.connection = connectDatabase(process.env.DATABASE_URL);
    this.redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    const url = new URL(process.env.REDIS_URL);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: Number(url.pathname.slice(1) || 0),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    };
    this.queue = new Queue(VERIFICATION_QUEUE, { connection });
    const processor = new VerificationProcessor(
      this.connection.pool,
      new RpcVerifier(),
    );
    this.worker = new Worker(
      VERIFICATION_QUEUE,
      async (job) => {
        await processor.process(job.data.attemptId);
      },
      { connection, concurrency: 5 },
    );
    this.worker.on('error', () =>
      Logger.error('Verification queue unavailable', 'Worker'),
    );
    const dispatcher = new OutboxDispatcher(
      this.connection.pool,
      this.queue,
      this.redis,
    );
    const run = () => {
      if (this.tick) return;
      this.tick = (async () => {
        try {
          await dispatcher.dispatch();
          await dispatcher.recover();
        } catch {
          Logger.warn(
            'Dispatch/recovery deferred; durable work retained',
            'Worker',
          );
        }
      })().finally(() => {
        this.tick = undefined;
      });
    };
    run();
    this.timer = setInterval(run, 1000);
  }
  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.tick;
    await this.worker?.close();
    await this.queue?.close();
    await this.redis?.quit();
    await this.connection?.pool.end();
  }
}
@Module({ providers: [WorkerLifecycle] })
export class AppModule {}
