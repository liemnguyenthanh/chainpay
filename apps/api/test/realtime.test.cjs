/* eslint-disable @typescript-eslint/no-require-imports -- Compiled Nest integration harness. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const Redis = require('ioredis');
const { connectDatabase } = require('@chainpay/database');
const { migrate } = require('../../../packages/database/dist/migrate');
const { seed } = require('../../../packages/database/dist/seed');
const { AppModule } = require('../dist/app.module');
const { configureHttp } = require('../dist/http');
const { OutboxDispatcher } = require('../../worker/dist/dispatcher');

test(
  'merchant SSE scopes, create outbox, reconnect and stable filtered cursors',
  {
    skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL,
    timeout: 30000,
  },
  async (t) => {
    const admin = connectDatabase(process.env.TEST_DATABASE_URL);
    const schema = `realtime_${randomBytes(8).toString('hex')}`;
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.MERCHANT_ORIGIN = 'http://localhost:3000';
    const publisher = new Redis(process.env.TEST_REDIS_URL);
    let app, connection;
    const streams = [];
    try {
      await migrate(url.toString());
      await seed(
        url.toString(),
        'fixture-password-strong',
        '0x1111111111111111111111111111111111111111',
      );
      connection = connectDatabase(url.toString());
      app = await NestFactory.create(AppModule, { logger: false });
      configureHttp(app);
      await app.listen(0, '127.0.0.1');
      const base = `${await app.getUrl()}/v1`;
      const login = await fetch(`${base}/merchant/session`, {
        method: 'POST',
        headers: {
          Origin: process.env.MERCHANT_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'fixture-password-strong' }),
      });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const merchant = await login.json();
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const other = (
        await connection.pool.query(
          "INSERT INTO merchants(name,receiver_address,password_hash) SELECT 'other',receiver_address,password_hash FROM merchants LIMIT 1 RETURNING id",
        )
      ).rows[0];
      await connection.pool.query(
        "INSERT INTO merchant_sessions(token_hash,merchant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [tokenHash, other.id],
      );
      const otherCookie = `chainpay_merchant=${token}`;
      async function open(session) {
        const abort = new AbortController();
        const response = await fetch(
          `${base}/merchant/events?merchantId=${other.id}`,
          {
            headers: {
              Cookie: session,
              'Last-Event-ID': 'not-a-durable-cursor',
            },
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
          },
        );
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /no-transform/);
        const reader = response.body.getReader();
        let buffer = '';
        const stream = {
          abort,
          async next() {
            while (!buffer.includes('\n\n')) {
              const read = await reader.read();
              if (read.done) return null;
              buffer += new TextDecoder().decode(read.value);
            }
            const end = buffer.indexOf('\n\n');
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            return event;
          },
        };
        streams.push(stream);
        assert.match(await stream.next(), /event: ready/);
        return stream;
      }
      async function create(key, session = cookie) {
        const response = await fetch(`${base}/payments`, {
          method: 'POST',
          headers: {
            Cookie: session,
            Origin: process.env.MERCHANT_ORIGIN,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({ amount: '1', token: 'USDC', chainId: 84532 }),
        });
        assert.ok([200, 201].includes(response.status));
        return response.json();
      }
      async function list(query = '') {
        const response = await fetch(`${base}/payments${query}`, {
          headers: { Cookie: cookie },
        });
        return { status: response.status, ...(await response.json()) };
      }
      await t.test(
        'unauthorized and expired subscriptions are rejected',
        async () => {
          assert.equal((await fetch(`${base}/merchant/events`)).status, 401);
          await connection.pool.query(
            "UPDATE merchant_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
            [tokenHash],
          );
          assert.equal(
            (
              await fetch(`${base}/merchant/events`, {
                headers: { Cookie: otherCookie },
              })
            ).status,
            401,
          );
          await connection.pool.query(
            "UPDATE merchant_sessions SET expires_at=now()+interval '1 hour' WHERE token_hash=$1",
            [tokenHash],
          );
        },
      );
      const stream = await open(cookie);
      const otherStream = await open(otherCookie);
      const payment = await create('created');
      const second = await create('second', otherCookie);
      await create('created');
      await t.test(
        'atomic creation produces one event per new payment, scoped by database ownership',
        async () => {
          const outbox = await connection.pool.query(
            "SELECT * FROM outbox WHERE event_type='PAYMENT_UPDATED'",
          );
          assert.equal(outbox.rows.length, 2);
          const dispatcher = new OutboxDispatcher(
            connection.pool,
            { add: async () => {} },
            publisher,
          );
          await dispatcher.dispatch();
          assert.ok((await stream.next()).includes(payment.id));
          assert.ok((await otherStream.next()).includes(second.id));
          // If either subscription leaked the previous event, this next read sees it.
          await publisher.publish(
            'chainpay:payments',
            JSON.stringify({
              paymentId: payment.id,
              status: 'PROCESSING',
              version: 2,
              merchantId: other.id,
            }),
          );
          assert.ok((await stream.next()).includes('"version":2'));
          await publisher.publish(
            'chainpay:payments',
            JSON.stringify({
              paymentId: second.id,
              status: 'PROCESSING',
              version: 2,
              merchantId: merchant.id,
            }),
          );
          assert.ok((await otherStream.next()).includes('"version":2'));
        },
      );
      await t.test(
        'duplicate/out-of-order hints preserve versions; reconnect starts ready and HTTP recovers missed insert',
        async () => {
          for (const version of [4, 4, 3]) {
            await publisher.publish(
              'chainpay:payments',
              JSON.stringify({
                paymentId: payment.id,
                status: 'PROCESSING',
                version,
              }),
            );
            assert.ok((await stream.next()).includes(`"version":${version}`));
          }
          stream.abort.abort();
          const missed = await create('missed');
          const reconnected = await open(cookie);
          assert.ok((await list()).data.some((row) => row.id === missed.id));
          reconnected.abort.abort();
        },
      );
      await t.test(
        'revoked live session closes before next event',
        async () => {
          await connection.pool.query(
            'DELETE FROM merchant_sessions WHERE token_hash=$1',
            [tokenHash],
          );
          await publisher.publish(
            'chainpay:payments',
            JSON.stringify({
              paymentId: second.id,
              status: 'PROCESSING',
              version: 3,
            }),
          );
          assert.equal(await otherStream.next(), null);
        },
      );
      await t.test(
        'exclusive compound cursor survives newer insert, validates status and page bounds',
        async () => {
          for (let i = 0; i < 5; i++) await create(`page-${i}`);
          await connection.pool.query(
            "UPDATE payments SET created_at='2026-01-01T00:00:00.123Z'",
          );
          const first = await list('?limit=2&status=AWAITING_PAYMENT');
          const inserted = await create('after-page');
          const ids = first.data.map((row) => row.id);
          let cursor = first.nextCursor;
          while (cursor) {
            const page = await list(
              `?limit=2&status=AWAITING_PAYMENT&cursor=${cursor}`,
            );
            ids.push(...page.data.map((row) => row.id));
            cursor = page.nextCursor;
          }
          assert.equal(ids.length, 7);
          assert.equal(new Set(ids).size, 7);
          assert.ok(!ids.includes(inserted.id));
          assert.equal((await list('?status=PROCESSING')).data.length, 0);
          for (const query of [
            '?status=INVALID',
            '?status=PROCESSING&status=CONFIRMED',
            '?limit=101',
          ])
            assert.equal((await list(query)).status, 400);
        },
      );
      await t.test(
        'create rolls back payment when durable event insertion fails',
        async () => {
          await connection.pool.query(
            "CREATE FUNCTION reject_update_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture outbox failure'; END $$",
          );
          await connection.pool.query(
            'CREATE TRIGGER fixture_reject_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION reject_update_event()',
          );
          const response = await fetch(`${base}/payments`, {
            method: 'POST',
            headers: {
              Cookie: cookie,
              Origin: process.env.MERCHANT_ORIGIN,
              'Content-Type': 'application/json',
              'Idempotency-Key': 'rollback',
            },
            body: JSON.stringify({
              amount: '1',
              token: 'USDC',
              chainId: 84532,
            }),
          });
          assert.equal(response.status, 500);
          assert.equal(
            (
              await connection.pool.query(
                "SELECT count(*) FROM payments WHERE idempotency_key='rollback'",
              )
            ).rows[0].count,
            '0',
          );
          await connection.pool.query(
            'DROP TRIGGER fixture_reject_outbox ON outbox',
          );
          await create('rollback');
        },
      );
    } finally {
      for (const stream of streams) stream.abort.abort();
      if (app) await app.close();
      publisher.disconnect();
      if (connection) await connection.pool.end();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.pool.end();
    }
  },
);
