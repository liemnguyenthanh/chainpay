/* eslint-disable @typescript-eslint/no-require-imports -- Integration harness loads compiled modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { privateKeyToAccount } = require('viem/accounts');
const { connectDatabase } = require('@chainpay/database');
const { migrate } = require('../../../packages/database/dist/migrate');
const { seed } = require('../../../packages/database/dist/seed');
const {
  CheckoutAuthService,
} = require('../dist/modules/checkout/checkout-auth.service');
const { digest } = require('../dist/common/crypto/digest');
const origin = 'http://localhost:3000';
const req = { headers: { origin }, ip: '127.0.0.1' };
const account = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const fails = (code) => (e) => e.getStatus() === code;
test(
  'checkout authentication with PostgreSQL atomic binding',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const admin = connectDatabase(process.env.TEST_DATABASE_URL);
    const schema = `auth_${randomBytes(8).toString('hex')}`;
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    let db;
    try {
      await migrate(url.toString());
      await seed(
        url.toString(),
        'test-only-password-long',
        '0x1111111111111111111111111111111111111111',
      );
      db = connectDatabase(url.toString());
      const merchant = (await db.pool.query('SELECT * FROM merchants')).rows[0];
      const access = {
        origin,
        checkOrigin(r) {
          if (r.headers.origin !== origin) {
            const { fail } = require('../dist/common/http/errors');
            fail(403, 'INVALID_ORIGIN', 'Origin rejected');
          }
        },
        async merchant() {
          return { id: merchant.id };
        },
      };
      let block = '100';
      const auth = new CheckoutAuthService(db, access, {
        async getStartBlock() {
          return block;
        },
      });
      async function payment(amount = '1000000') {
        const token = randomBytes(32).toString('base64url');
        const p = (
          await db.pool.query(
            `INSERT INTO payments(merchant_id,idempotency_key,normalized_request,chain_id,token_address,token_decimals,amount_base_units,receiver_address,checkout_token_hash) VALUES($1,$2,$3,84532,'0x036cbd53842c5426634e7929541ec2318f3dcf7e',6,$4,$5,$6) RETURNING id`,
            [
              merchant.id,
              randomUUID(),
              `84532:USDC:${amount}`,
              amount,
              merchant.receiver_address,
              digest(token),
            ],
          )
        ).rows[0];
        return { id: p.id, token };
      }
      async function challenge(p, signer = account) {
        return auth.challenge(p.token, { payerAddress: signer.address }, req);
      }
      async function verify(p, c, signer = account, message = c.message) {
        const signature = await signer.signMessage({ message });
        let cookie;
        const result = await auth.verify(
          p.token,
          { challengeId: c.challengeId, signature },
          req,
          {
            cookie(...args) {
              cookie = args;
            },
          },
        );
        return { result, cookie };
      }
      await t.test(
        'single-use, signer/domain/chain tampering, expiry, scope, secure cookie',
        async () => {
          const p = await payment();
          const c = await challenge(p);
          await assert.rejects(verify(p, c, other), fails(401));
          await assert.rejects(
            verify(
              p,
              c,
              account,
              c.message.replace(origin, 'https://evil.example'),
            ),
            fails(401),
          );
          await assert.rejects(
            verify(
              p,
              c,
              account,
              c.message.replace('Chain ID: 84532', 'Chain ID: 1'),
            ),
            fails(401),
          );
          const race = await Promise.allSettled([verify(p, c), verify(p, c)]);
          assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
          assert.equal(
            race.find((x) => x.status === 'rejected').reason.getStatus(),
            401,
          );
          const successful = race.find((x) => x.status === 'fulfilled').value;
          assert.equal(successful.cookie[2].secure, true);
          assert.equal(successful.cookie[2].httpOnly, true);
          assert.equal(successful.cookie[2].sameSite, 'strict');
          const cookie = `${successful.cookie[0]}=${successful.cookie[1]}`;
          assert.equal(
            (await auth.authorize({ headers: { cookie } }, p.token)).paymentId,
            p.id,
          );
          const second = await payment('2000000');
          await assert.rejects(
            auth.authorize({ headers: { cookie } }, second.token),
            fails(401),
          );
          const expired = await challenge(second);
          await db.pool.query(
            "UPDATE payer_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
            [expired.challengeId],
          );
          await assert.rejects(verify(second, expired), fails(401));
          await assert.rejects(
            auth.challenge(
              second.token,
              { payerAddress: account.address },
              { ...req, headers: { origin: 'https://evil.example' } },
            ),
            fails(403),
          );
          await db.pool.query(
            "UPDATE checkout_sessions SET expires_at=now()-interval '1 second' WHERE payment_id=$1",
            [p.id],
          );
          await assert.rejects(
            auth.authorize({ headers: { cookie } }, p.token),
            fails(401),
          );
          block = '200';
          await verify(p, await challenge(p));
          assert.equal(
            (
              await db.pool.query(
                'SELECT start_block FROM payer_bindings WHERE payment_id=$1',
                [p.id],
              )
            ).rows[0].start_block,
            '100',
          );
          await assert.rejects(
            verify(p, await challenge(p, other), other),
            fails(409),
          );
          await assert.rejects(auth.issue(p.id, req), fails(409));
        },
      );
      await t.test(
        'competing identical allocations serialize and token rotation invalidates challenge',
        async () => {
          const a = await payment('3000000'),
            b = await payment('3000000');
          const ca = await challenge(a),
            cb = await challenge(b);
          const results = await Promise.allSettled([
            verify(a, ca),
            verify(b, cb),
          ]);
          assert.equal(
            results.filter((x) => x.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            results.find((x) => x.status === 'rejected').reason.getStatus(),
            409,
          );
          const p = await payment('4000000'),
            c = await challenge(p);
          const rotation = await auth.issue(p.id, req);
          await assert.rejects(auth.snapshot(p.token), fails(404));
          await assert.rejects(
            verify({ ...p, token: rotation.checkoutToken }, c),
            fails(401),
          );
        },
      );
      await t.test(
        'concurrent different payers cannot rebind one payment',
        async () => {
          const p = await payment('6000000');
          const first = await challenge(p);
          const second = await challenge(p, other);
          const results = await Promise.allSettled([
            verify(p, first),
            verify(p, second, other),
          ]);
          assert.equal(
            results.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            results.find((r) => r.status === 'rejected').reason.getStatus(),
            409,
          );
          assert.equal(
            (
              await db.pool.query(
                'SELECT count(*) FROM payer_bindings WHERE payment_id=$1',
                [p.id],
              )
            ).rows[0].count,
            '1',
          );
        },
      );
      await t.test(
        'chain eligibility outage does not bind payment or consume challenge',
        async () => {
          const p = await payment('5000000'),
            c = await challenge(p);
          const unavailable = new CheckoutAuthService(db, access, {
            async getStartBlock() {
              throw new Error('RPC timeout');
            },
          });
          await assert.rejects(
            unavailable.verify(
              p.token,
              {
                challengeId: c.challengeId,
                signature: await account.signMessage({ message: c.message }),
              },
              req,
              { cookie() {} },
            ),
            fails(503),
          );
          assert.equal(
            (
              await db.pool.query(
                'SELECT consumed_at FROM payer_challenges WHERE id=$1',
                [c.challengeId],
              )
            ).rows[0].consumed_at,
            null,
          );
          await verify(p, c);
        },
      );
    } finally {
      if (db) await db.pool.end();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.pool.end();
    }
  },
);
