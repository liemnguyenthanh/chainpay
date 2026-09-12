/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS integration harness matches compiled Nest modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const {
  connectDatabase,
  merchants,
  sessions,
  hashPassword,
} = require('@chainpay/database');
const { migrate } = require('../../../packages/database/dist/migrate');
const { seed } = require('../../../packages/database/dist/seed');
const { AppModule } = require('../dist/app.module');
const {
  DatabaseService,
} = require('../dist/infrastructure/database/database.service');
const {
  PaymentsService,
} = require('../dist/modules/payments/payments.service');
const {
  CheckoutAuthService,
} = require('../dist/modules/checkout/checkout-auth.service');
const { configureHttp } = require('../dist/http');
const { normalize } = require('../dist/modules/payments/payment-normalization');
const password = 'test-only-password-with-entropy';
const receiver = '0x1111111111111111111111111111111111111111';
const origin = 'http://localhost:3000';

test('money rejects unsafe representations and preserves uint256 boundary', () => {
  for (const amount of [
    0,
    1,
    null,
    '',
    '0',
    '-1',
    '+1',
    '1e2',
    ' 1',
    '1 ',
    '.1',
    '1.',
    '1.0000000',
    'NaN',
    'Infinity',
  ])
    assert.throws(() => normalize({ amount, token: 'USDC', chainId: 84532 }));
  const max = (1n << 256n) - 1n;
  const decimal = (n) =>
    `${n / 1000000n}.${String(n % 1000000n).padStart(6, '0')}`;
  assert.equal(
    normalize({ amount: decimal(max), token: 'USDC', chainId: 84532 }).amount,
    String(max),
  );
  assert.throws(() =>
    normalize({ amount: decimal(max + 1n), token: 'USDC', chainId: 84532 }),
  );
});

test('BERA normalization uses 18 decimals and preserves Base fingerprints', () => {
  const input = {
    amount: '0.000000000000000001',
    token: 'BERA',
    chainId: 80094,
  };
  assert.equal(normalize(input).amount, '1');
  assert.equal(
    normalize({ ...input, amount: '1.25' }).amount,
    '1250000000000000000',
  );
  assert.equal(
    normalize({ ...input, amount: '01.000' }).fingerprint,
    '80094:BERA:1000000000000000000',
  );
  assert.equal(
    normalize({ amount: '1', token: 'USDC', chainId: 84532 }).fingerprint,
    '84532:USDC:1000000',
  );
  for (const invalid of [
    { ...input, token: 'USDC' },
    { ...input, chainId: 84532 },
    { ...input, chainId: 1 },
    { ...input, chainId: '80094' },
    { ...input, amount: '0.0000000000000000001' },
  ])
    assert.throws(() => normalize(invalid));
  const max = (1n << 256n) - 1n;
  const scale = 10n ** 18n;
  const decimal = (n) => `${n / scale}.${String(n % scale).padStart(18, '0')}`;
  assert.equal(
    normalize({ ...input, amount: decimal(max) }).amount,
    String(max),
  );
  assert.throws(() => normalize({ ...input, amount: decimal(max + 1n) }));
});

test(
  'PostgreSQL HTTP domain invariants',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    // Use an isolated schema; never truncate a developer database.
    const admin = connectDatabase(process.env.TEST_DATABASE_URL);
    const schema = `phase1_${randomBytes(8).toString('hex')}`;
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.MERCHANT_ORIGIN = origin;
    let app;
    let connection;
    try {
      await migrate(url.toString());
      await migrate(url.toString());
      await seed(url.toString(), password, receiver);
      await seed(url.toString(), password, receiver);
      connection = connectDatabase(url.toString());
      assert.equal(
        (await connection.pool.query('SELECT count(*) FROM merchants')).rows[0]
          .count,
        '1',
      );
      app = await NestFactory.create(AppModule, { logger: false });
      // All feature modules must share the same pool and its lifecycle owner.
      const databases = app.get(DatabaseService, { each: true });
      assert.equal(databases.length, 1);
      assert.equal(app.get(PaymentsService).database, databases[0]);
      assert.equal(app.get(CheckoutAuthService).database, databases[0]);
      configureHttp(app);
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(
        path,
        { method = 'GET', body, cookie, key, requestOrigin = origin } = {},
      ) {
        const res = await fetch(`${base}/v1/${path}`, {
          method,
          headers: {
            Origin: requestOrigin,
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return {
          status: res.status,
          body: await res.json(),
          cookie: res.headers.get('set-cookie'),
        };
      }
      const login = await request('merchant/session', {
        method: 'POST',
        body: { password },
      });
      assert.equal(login.status, 201);
      const cookie = login.cookie.split(';')[0];
      assert.match(login.cookie, /HttpOnly/);
      assert.match(login.cookie, /SameSite=Strict/i);
      const input = { amount: '1', token: 'USDC', chainId: 84532 };
      let payment;
      await t.test(
        '20 concurrent normalized identical keys: one 201, nineteen 200, one row',
        async () => {
          const results = await Promise.all(
            Array.from({ length: 20 }, (_, i) =>
              request('payments', {
                method: 'POST',
                cookie,
                key: 'same-key',
                body: { ...input, amount: i % 2 ? '01.000000' : '1.0' },
              }),
            ),
          );
          assert.equal(results.filter((r) => r.status === 201).length, 1);
          assert.equal(results.filter((r) => r.status === 200).length, 19);
          assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
          payment = results[0].body;
          assert.equal(payment.amountBaseUnits, '1000000');
          assert.equal(payment.amount, '1.000000');
          assert.equal(
            (await connection.pool.query('SELECT count(*) FROM payments'))
              .rows[0].count,
            '1',
          );
          assert.equal(
            JSON.stringify(payment).includes('checkoutTokenHash'),
            false,
          );
        },
      );
      await t.test('conflicting requests and invalid inputs', async () => {
        assert.equal(
          (
            await request('payments', {
              method: 'POST',
              cookie,
              key: 'same-key',
              body: { ...input, amount: '2' },
            })
          ).status,
          409,
        );
        const race = await Promise.all(
          ['2', '3'].map((amount) =>
            request('payments', {
              method: 'POST',
              cookie,
              key: 'conflict-race',
              body: { ...input, amount },
            }),
          ),
        );
        assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
        for (const amount of [
          0,
          '0',
          '-1',
          '1.0000001',
          '1e6',
          ' 1',
          '9'.repeat(79),
        ]) {
          const result = await request('payments', {
            method: 'POST',
            cookie,
            key: randomUUID(),
            body: { ...input, amount },
          });
          assert.equal(result.status, 400);
          assert.ok(result.body.requestId);
          assert.ok(result.body.code);
        }
        for (const body of [
          { ...input, chainId: 1 },
          { ...input, token: 'ETH' },
          { ...input, receiverAddress: receiver },
        ])
          assert.equal(
            (
              await request('payments', {
                method: 'POST',
                cookie,
                key: randomUUID(),
                body,
              })
            ).status,
            400,
          );
        assert.equal(
          (await request('payments', { method: 'POST', cookie, body: input }))
            .status,
          400,
        );
      });
      await t.test(
        'unauthorized, cross-merchant, expired, revoked sessions and CSRF',
        async () => {
          for (const path of ['payments', `payments/${payment.id}`])
            assert.equal((await request(path)).status, 401);
          assert.equal(
            (
              await request('payments', {
                method: 'POST',
                key: 'unauth',
                body: input,
              })
            ).status,
            401,
          );
          assert.equal(
            (
              await request('payments', {
                method: 'POST',
                cookie,
                key: 'csrf',
                body: input,
                requestOrigin: 'https://evil.example',
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request('merchant/session', {
                method: 'POST',
                body: { password: 'wrong' },
              })
            ).status,
            401,
          );
          const [other] = await connection.db
            .insert(merchants)
            .values({
              name: 'other',
              receiverAddress: receiver,
              passwordHash: await hashPassword(password),
            })
            .returning();
          const token = randomBytes(32).toString('base64url');
          const tokenHash = createHash('sha256').update(token).digest('hex');
          await connection.db.insert(sessions).values({
            merchantId: other.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 60000),
          });
          const otherCookie = `chainpay_merchant=${token}`;
          assert.equal(
            (await request(`payments/${payment.id}`, { cookie: otherCookie }))
              .status,
            404,
          );
          assert.deepEqual(
            (await request('payments', { cookie: otherCookie })).body.data,
            [],
          );
          assert.equal(
            (
              await request('payments', {
                method: 'POST',
                cookie: otherCookie,
                key: 'same-key',
                body: input,
              })
            ).status,
            201,
          );
          await connection.pool.query(
            "UPDATE merchant_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
            [tokenHash],
          );
          assert.equal(
            (await request('payments', { cookie: otherCookie })).status,
            401,
          );
          const second = await request('merchant/session', {
            method: 'POST',
            body: { password },
          });
          const revoked = second.cookie.split(';')[0];
          assert.equal(
            (
              await request('merchant/session', {
                method: 'DELETE',
                cookie: revoked,
              })
            ).status,
            200,
          );
          assert.equal(
            (await request('payments', { cookie: revoked })).status,
            401,
          );
        },
      );
      await t.test(
        'compound pagination survives timestamp ties and validates bounds',
        async () => {
          for (let i = 0; i < 5; i++)
            assert.equal(
              (
                await request('payments', {
                  method: 'POST',
                  cookie,
                  key: `page-${i}`,
                  body: input,
                })
              ).status,
              201,
            );
          await connection.pool.query(
            "UPDATE payments SET created_at='2026-09-10T00:00:00.123Z'",
          );
          let cursor;
          const ids = [];
          do {
            const result = await request(
              `payments?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
              { cookie },
            );
            assert.equal(result.status, 200);
            ids.push(...result.body.data.map((p) => p.id));
            cursor = result.body.nextCursor;
          } while (cursor);
          assert.equal(ids.length, 7);
          assert.equal(new Set(ids).size, 7);
          assert.equal(
            (await request(`payments/${payment.id}`, { cookie })).status,
            200,
          );
          for (const q of [
            'limit=0',
            'limit=101',
            'limit=1.5',
            'cursor=xxx',
            'cursor=%25',
            'limit=1&limit=2',
          ])
            assert.equal(
              (await request(`payments?${q}`, { cookie })).status,
              400,
            );
        },
      );
      await t.test(
        'BERA creation, idempotency, checkout snapshot and challenge stay on Berachain',
        async () => {
          const body = {
            amount: '0.012345678901234567',
            token: 'BERA',
            chainId: 80094,
          };
          const created = await request('payments', {
            method: 'POST',
            cookie,
            key: 'bera-payment',
            body,
          });
          assert.equal(created.status, 201);
          assert.equal(created.body.chainId, 80094);
          assert.equal(created.body.token, 'BERA');
          assert.equal(created.body.tokenDecimals, 18);
          assert.equal(
            created.body.tokenAddress,
            '0x0000000000000000000000000000000000000000',
          );
          assert.equal(created.body.amountBaseUnits, '12345678901234567');
          assert.equal(created.body.amount, body.amount);
          const replay = await request('payments', {
            method: 'POST',
            cookie,
            key: 'bera-payment',
            body: { ...body, amount: '00.012345678901234567' },
          });
          assert.equal(replay.status, 200);
          assert.equal(replay.body.id, created.body.id);
          assert.equal(
            (
              await request('payments', {
                method: 'POST',
                cookie,
                key: 'bera-payment',
                body: input,
              })
            ).status,
            409,
          );
          for (const invalid of [
            { ...body, token: 'USDC' },
            { ...body, chainId: 84532 },
          ]) {
            assert.equal(
              (
                await request('payments', {
                  method: 'POST',
                  cookie,
                  key: randomUUID(),
                  body: invalid,
                })
              ).status,
              400,
            );
          }
          const issued = await request(
            `payments/${created.body.id}/checkout-token`,
            { method: 'POST', cookie },
          );
          assert.equal(issued.status, 201);
          const token = issued.body.checkoutToken;
          const snapshot = await request(`checkout/${token}`);
          assert.equal(snapshot.status, 200);
          assert.equal(snapshot.body.chainId, 80094);
          assert.equal(snapshot.body.token, 'BERA');
          assert.equal(snapshot.body.tokenDecimals, 18);
          assert.equal(snapshot.body.amountBaseUnits, '12345678901234567');
          const challenge = await request(`checkout/${token}/challenge`, {
            method: 'POST',
            body: { payerAddress: receiver },
          });
          assert.equal(challenge.status, 201);
          assert.match(challenge.body.message, /Chain ID: 80094/);
          assert.doesNotMatch(challenge.body.message, /Chain ID: 84532/);
          assert.equal(
            (
              await connection.pool.query(
                'SELECT chain_id FROM payer_challenges WHERE id=$1',
                [challenge.body.challengeId],
              )
            ).rows[0].chain_id,
            80094,
          );
        },
      );
      await t.test(
        'database rejects bypasses of domain constraints',
        async () => {
          for (const expression of [
            'amount_base_units=0',
            'amount_base_units=-1',
            'amount_base_units=1.1',
            'amount_base_units=power(2::numeric,256)',
            'token_decimals=18',
            'chain_id=1',
            "receiver_address='0xABC'",
            "status='CONFIRMED'",
            'version=-1',
          ]) {
            await assert.rejects(
              connection.pool.query(
                `UPDATE payments SET ${expression} WHERE id=$1`,
                [payment.id],
              ),
              (error) => error.code === '23514',
            );
          }
          await assert.rejects(
            connection.pool.query(
              'UPDATE payments SET idempotency_key=$1 WHERE id<>$2 AND merchant_id=$3',
              ['same-key', payment.id, login.body.id],
            ),
            (error) => error.code === '23505',
          );
          await assert.rejects(
            connection.pool.query(
              'UPDATE payments SET merchant_id=$1 WHERE id=$2',
              [randomUUID(), payment.id],
            ),
            (error) => error.code === '23503',
          );
        },
      );
    } finally {
      if (app) await app.close();
      if (connection) await connection.pool.end();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.pool.end();
    }
  },
);
