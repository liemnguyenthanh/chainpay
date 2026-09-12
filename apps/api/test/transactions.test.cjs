/* eslint-disable @typescript-eslint/no-require-imports -- Integration harness loads compiled modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
require('reflect-metadata');
const { connectDatabase } = require('@chainpay/database');
const { migrate } = require('../../../packages/database/dist/migrate');
const {
  TransactionService,
} = require('../dist/modules/transactions/transaction.service');
test(
  'atomic submission and protected recovery PostgreSQL invariants',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const admin = connectDatabase(process.env.TEST_DATABASE_URL),
      schema = 'submission_' + randomBytes(8).toString('hex');
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    await migrate(url.toString());
    const { pool } = connectDatabase(url.toString());
    try {
      const merchant = (
        await pool.query(
          "INSERT INTO merchants(name,receiver_address,password_hash) VALUES($1,$2,'unused') RETURNING id",
          [schema, '0x' + '1'.repeat(40)],
        )
      ).rows[0].id;
      const p = (
        await pool.query(
          "INSERT INTO payments(merchant_id,idempotency_key,normalized_request,chain_id,token_address,token_decimals,amount_base_units,receiver_address,checkout_token_hash) VALUES($1,$2,'84532:USDC:1000000',84532,'0x036cbd53842c5426634e7929541ec2318f3dcf7e',6,1000000,$3,$4) RETURNING id",
          [
            merchant,
            randomUUID(),
            '0x' + '1'.repeat(40),
            randomBytes(32).toString('hex'),
          ],
        )
      ).rows[0].id;
      await pool.query(
        'INSERT INTO payer_bindings(payment_id,payer_address,start_block) VALUES($1,$2,100)',
        [p, '0x' + '2'.repeat(40)],
      );
      const service = new TransactionService({ pool }),
        hash = '0x' + 'a'.repeat(64);
      const results = await Promise.all(
        Array.from({ length: 12 }, () => service.submit(p, hash)),
      );
      assert.equal(new Set(results.map((x) => x.attempt.id)).size, 1);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM outbox WHERE event_type='VERIFY_ATTEMPT'",
          )
        ).rows[0].count,
        '1',
      );
      assert.equal(
        (await pool.query('SELECT status FROM payments WHERE id=$1', [p]))
          .rows[0].status,
        'PROCESSING',
      );
      await assert.rejects(
        service.submit(p, '0x' + 'b'.repeat(64)),
        (e) => e.getStatus() === 409,
      );
      const a = results[0].attempt.id;
      await pool.query(
        "UPDATE payment_attempts SET status='NEEDS_REVIEW',retry_count=5 WHERE id=$1",
        [a],
      );
      await assert.rejects(
        service.retry(p, a, randomUUID()),
        (e) => e.getStatus() === 404,
      );
      const retry = await service.retry(p, a, merchant);
      assert.equal(retry.attempt.status, 'SUBMITTED');
      assert.equal(retry.attempt.retry_count, 0);
      await assert.rejects(
        service.retry(p, a, merchant),
        (e) => e.getStatus() === 409,
      );
      await pool.query(
        "UPDATE payment_attempts SET status='REJECTED' WHERE id=$1",
        [a],
      );
      const replacement = await service.submit(p, '0x' + 'b'.repeat(64));
      assert.notEqual(replacement.attempt.id, a);
      // A failed outbox write must roll back attempt and payment mutation together.
      await pool.query(
        "UPDATE payment_attempts SET status='REJECTED' WHERE id=$1",
        [replacement.attempt.id],
      );
      await pool.query(
        "UPDATE payments SET status='AWAITING_PAYMENT' WHERE id=$1",
        [p],
      );
      await pool.query(
        "ALTER TABLE outbox ADD CONSTRAINT test_crash CHECK (event_type <> 'VERIFY_ATTEMPT') NOT VALID",
      );
      await assert.rejects(service.submit(p, '0x' + 'c'.repeat(64)));
      assert.equal(
        (
          await pool.query(
            'SELECT count(*) FROM payment_attempts WHERE tx_hash=$1',
            ['0x' + 'c'.repeat(64)],
          )
        ).rows[0].count,
        '0',
      );
      assert.equal(
        (await pool.query('SELECT status FROM payments WHERE id=$1', [p]))
          .rows[0].status,
        'AWAITING_PAYMENT',
      );
    } finally {
      await pool.end();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.pool.end();
    }
  },
);
