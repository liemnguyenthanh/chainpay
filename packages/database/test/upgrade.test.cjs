/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { connectDatabase } = require('../dist');
const { migrate } = require('../dist/migrate');
test(
  'Phase 1 populated database upgrades twice without changing payment/session data',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const admin = connectDatabase(process.env.TEST_DATABASE_URL);
    const schema = `upgrade_${randomBytes(8).toString('hex')}`;
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    const db = connectDatabase(url.toString());
    try {
      const source = readFileSync(
        require('node:path').join(__dirname, '../migrations/0001_domain.sql'),
        'utf8',
      );
      await db.pool.query(source);
      await db.pool.query(
        'CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL)',
      );
      await db.pool.query('INSERT INTO schema_migrations VALUES($1,$2)', [
        '0001_domain.sql',
        createHash('sha256').update(source).digest('hex'),
      ]);
      const merchant = (
        await db.pool.query(
          "INSERT INTO merchants(name,receiver_address,password_hash) VALUES('upgrade','0x1111111111111111111111111111111111111111','test') RETURNING id",
        )
      ).rows[0].id;
      await db.pool.query(
        "INSERT INTO merchant_sessions(token_hash,merchant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        ['a'.repeat(64), merchant],
      );
      await db.pool.query(
        "INSERT INTO payments(merchant_id,idempotency_key,normalized_request,chain_id,token_address,token_decimals,amount_base_units,receiver_address,checkout_token_hash) VALUES($1,'original','84532:USDC:1000000',84532,'0x036cbd53842c5426634e7929541ec2318f3dcf7e',6,1000000,'0x1111111111111111111111111111111111111111',$2)",
        [merchant, 'b'.repeat(64)],
      );
      const before = (await db.pool.query('SELECT * FROM payments')).rows;
      await migrate(url.toString());
      await migrate(url.toString());
      assert.deepEqual(
        (await db.pool.query('SELECT * FROM payments')).rows,
        before,
      );
      assert.equal(
        (await db.pool.query('SELECT count(*) FROM merchant_sessions')).rows[0]
          .count,
        '1',
      );
      assert.equal(
        (await db.pool.query('SELECT count(*) FROM schema_migrations')).rows[0]
          .count,
        '3',
      );
      assert.equal(
        (await db.pool.query('SELECT count(*) FROM payment_attempts')).rows[0]
          .count,
        '0',
      );
      const insertNative = (key, decimals, address, fingerprint, hash) =>
        db.pool.query(
          'INSERT INTO payments(merchant_id,idempotency_key,normalized_request,chain_id,token_address,token_decimals,amount_base_units,receiver_address,checkout_token_hash) VALUES($1,$2,$3,80094,$4,$5,1000000000000000,$6,$7)',
          [
            merchant,
            key,
            fingerprint,
            address,
            decimals,
            '0x1111111111111111111111111111111111111111',
            hash.repeat(64),
          ],
        );
      await insertNative(
        'bera',
        18,
        '0x0000000000000000000000000000000000000000',
        '80094:BERA:1000000000000000',
        'c',
      );
      await assert.rejects(
        insertNative(
          'wrong-decimals',
          6,
          '0x0000000000000000000000000000000000000000',
          '80094:BERA:1000000000000000',
          'd',
        ),
        { code: '23514' },
      );
      await assert.rejects(
        insertNative(
          'wrong-token',
          18,
          '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
          '80094:BERA:1000000000000000',
          'e',
        ),
        { code: '23514' },
      );
      await assert.rejects(
        insertNative(
          'wrong-fingerprint',
          18,
          '0x0000000000000000000000000000000000000000',
          '80094:USDC:1000000000000000',
          'f',
        ),
        { code: '23514' },
      );
    } finally {
      await db.pool.end();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.pool.end();
    }
  },
);
