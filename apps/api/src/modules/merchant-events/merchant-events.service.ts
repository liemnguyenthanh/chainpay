import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { and, eq, payments } from '@chainpay/database';
import type { Request, Response } from 'express';
import Redis from 'ioredis';
import type { PaymentUpdateEvent } from '@chainpay/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { SessionService } from '../merchant-session/session.service';
import { fail } from '../../common/http/errors';
import { uuidPattern } from '../../common/validation/uuid';

interface Subscriber {
  req: Request;
  res: Response;
  merchantId: string;
  close(): void;
}
@Injectable()
export class MerchantEventsService implements OnModuleDestroy {
  private redis?: Redis;
  private subscribed?: Promise<void>;
  private readonly clients = new Set<Subscriber>();
  constructor(
    private readonly database: DatabaseService,
    private readonly access: SessionService,
  ) {}
  private connect() {
    if (!this.redis) {
      this.redis = new Redis(
        process.env.REDIS_URL ?? 'redis://localhost:6379',
        {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        },
      );
      this.redis.on('error', () => {
        /* Reconnect/refetch is the recovery contract. */
      });
      this.redis.on('close', () => {
        this.subscribed = undefined;
        for (const client of this.clients) client.close();
      });
      this.redis.on('message', (_channel, payload) => {
        void this.deliver(payload).catch(() => {
          for (const client of this.clients) client.close();
        });
      });
    }
    const redis = this.redis;
    this.subscribed ??= (async () => {
      if (redis.status === 'wait') await redis.connect();
      if (redis.status !== 'ready') throw new Error('Realtime unavailable');
      await redis.subscribe('chainpay:payments');
    })().catch((error: unknown) => {
      this.subscribed = undefined;
      throw error;
    });
    return this.subscribed;
  }
  async open(req: Request, res: Response) {
    const merchant = await this.access.merchant(req);
    try {
      await this.connect();
    } catch {
      return fail(
        503,
        'REALTIME_UNAVAILABLE',
        'Realtime unavailable; refresh to recover updates',
      );
    }
    // Recheck after asynchronous Redis connection; a revoked session must not open.
    await this.access.merchant(req);
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const client: Subscriber = {
      req,
      res,
      merchantId: merchant.id,
      close: () => {
        clearInterval(heartbeat);
        this.clients.delete(client);
        res.end();
      },
    };
    const heartbeat = setInterval(() => {
      void this.access
        .merchant(req)
        .then(() => {
          if (!res.write(': heartbeat\n\n')) client.close();
        })
        .catch(() => client.close());
    }, 15000);
    this.clients.add(client);
    res.on('close', client.close);
    res.write('event: ready\ndata: {}\n\n');
  }
  // Pub/Sub is an invalidation hint, never authority for ownership or settlement.
  async deliver(payload: string) {
    if (payload.length > 1024) return;
    let event: PaymentUpdateEvent;
    try {
      event = JSON.parse(payload) as typeof event;
      if (
        !event ||
        !uuidPattern.test(event.paymentId) ||
        !Number.isSafeInteger(event.version) ||
        event.version < 0 ||
        !['AWAITING_PAYMENT', 'PROCESSING', 'CONFIRMED'].includes(event.status)
      )
        return;
    } catch {
      return;
    }
    await Promise.all(
      [...this.clients].map(async (client) => {
        try {
          const merchant = await this.access.merchant(client.req);
          if (merchant.id !== client.merchantId) return client.close();
          const [row] = await this.database.db
            .select({ id: payments.id })
            .from(payments)
            .where(
              and(
                eq(payments.id, event.paymentId),
                eq(payments.merchantId, merchant.id),
              ),
            );
          if (
            row &&
            !client.res.write(
              `event: payment\ndata: ${JSON.stringify({ paymentId: event.paymentId, status: event.status, version: event.version })}\n\n`,
            )
          )
            client.close();
        } catch {
          client.close();
        }
      }),
    );
  }
  onModuleDestroy() {
    for (const client of this.clients) client.close();
    this.redis?.disconnect();
  }
}
