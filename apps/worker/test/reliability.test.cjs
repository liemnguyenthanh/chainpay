/* eslint-disable @typescript-eslint/no-require-imports -- Integration harness loads compiled modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { connectDatabase } = require('@chainpay/database');
const { migrate } = require('../../../packages/database/dist/migrate');
const { VerificationProcessor } = require('../dist/processor');
const { OutboxDispatcher } = require('../dist/dispatcher');
const { settle } = require('../dist/settlement');
const { RpcVerifier } = require('@chainpay/blockchain');
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const evidence = {
  blockNumber: '101',
  blockHash: '0x' + 'a'.repeat(64),
  logIndex: 0,
};
test(
  'durable verification on real PostgreSQL and Redis',
  { skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL },
  async (t) => {
    const admin = connectDatabase(process.env.TEST_DATABASE_URL),
      schema = 'jobs_' + randomBytes(8).toString('hex');
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    await migrate(url.toString());
    const { pool } = connectDatabase(url.toString());
    const redis = new Redis(process.env.TEST_REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue('test-' + schema, { connection: redis });
    let worker;
    try {
      const merchant = (
        await pool.query(
          "INSERT INTO merchants(name,receiver_address,password_hash) VALUES($1,$2,'unused') RETURNING id",
          [schema, '0x' + '1'.repeat(40)],
        )
      ).rows[0].id;
      async function fixture(hash = '0x' + randomBytes(32).toString('hex')) {
        const p = (
          await pool.query(
            "INSERT INTO payments(merchant_id,idempotency_key,normalized_request,chain_id,token_address,token_decimals,amount_base_units,receiver_address,checkout_token_hash,status) VALUES($1,$2,'84532:USDC:1000000',84532,'0x036cbd53842c5426634e7929541ec2318f3dcf7e',6,1000000,$3,$4,'PROCESSING') RETURNING id",
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
        const a = (
          await pool.query(
            'INSERT INTO payment_attempts(payment_id,chain_id,tx_hash) VALUES($1,84532,$2) RETURNING id',
            [p, hash],
          )
        ).rows[0].id;
        return { p, a };
      }
      const state = async (id) =>
        (await pool.query('SELECT * FROM payment_attempts WHERE id=$1', [id]))
          .rows[0];
      await t.test(
        'native BERA fixture settles through verifier and PostgreSQL without a token log',
        async () => {
          const hash = '0x' + randomBytes(32).toString('hex');
          const payer = '0x' + '2'.repeat(40),
            receiver = '0x' + '1'.repeat(40);
          const {
            rows: [payment],
          } = await pool.query(
            "INSERT INTO payments(merchant_id,idempotency_key,normalized_request,chain_id,token_address,token_decimals,amount_base_units,receiver_address,checkout_token_hash,status) VALUES($1,$2,'80094:BERA:1000000000000000',80094,'0x0000000000000000000000000000000000000000',18,1000000000000000,$3,$4,'PROCESSING') RETURNING id",
            [merchant, randomUUID(), receiver, randomBytes(32).toString('hex')],
          );
          await pool.query(
            'INSERT INTO payer_bindings(payment_id,payer_address,start_block) VALUES($1,$2,100)',
            [payment.id, payer],
          );
          const {
            rows: [attempt],
          } = await pool.query(
            'INSERT INTO payment_attempts(payment_id,chain_id,tx_hash) VALUES($1,80094,$2) RETURNING id',
            [payment.id, hash],
          );
          const rpc = {
            getChainId: async () => 80094,
            getBlockNumber: async () => 105n,
            getCode: async () => '0x',
            getTransaction: async () => ({
              hash,
              from: payer,
              to: receiver,
              input: '0x',
              value: 1000000000000000n,
            }),
            getReceipt: async () => ({
              transactionHash: hash,
              from: payer,
              to: receiver,
              status: 'success',
              blockNumber: 101n,
              blockHash: evidence.blockHash,
              logs: [],
            }),
            getBlockHash: async () => evidence.blockHash,
          };
          const processor = new VerificationProcessor(
            pool,
            new RpcVerifier({ rpc, confirmations: 3 }),
          );
          await processor.process(attempt.id);
          await processor.process(attempt.id);
          assert.equal((await state(attempt.id)).status, 'VERIFIED');
          const {
            rows: [settled],
          } = await pool.query(
            'SELECT chain_id,log_index FROM settlements WHERE payment_id=$1',
            [payment.id],
          );
          assert.equal(settled.chain_id, 80094);
          assert.equal(settled.log_index, -1);
          assert.equal(
            (
              await pool.query('SELECT status FROM payments WHERE id=$1', [
                payment.id,
              ])
            ).rows[0].status,
            'CONFIRMED',
          );
        },
      );
      await t.test(
        'duplicate jobs settle once; one chain/hash cannot settle two payments',
        async () => {
          const hash = '0x' + randomBytes(32).toString('hex'),
            first = await fixture(hash),
            second = await fixture(hash);
          const processor = new VerificationProcessor(pool, {
            verify: async () => ({ status: 'VERIFIED', evidence }),
          });
          await Promise.all([
            processor.process(first.a),
            processor.process(first.a),
          ]);
          assert.equal((await state(first.a)).status, 'VERIFIED');
          await processor.process(second.a);
          assert.equal((await state(second.a)).status, 'NEEDS_REVIEW');
          assert.equal(
            (
              await pool.query(
                'SELECT count(*) FROM settlements WHERE tx_hash=$1',
                [hash],
              )
            ).rows[0].count,
            '1',
          );
        },
      );
      await t.test(
        'concurrent settlements for one chain/hash have exactly one winner',
        async () => {
          const hash = '0x' + randomBytes(32).toString('hex');
          const first = await fixture(hash),
            second = await fixture(hash);
          const processor = new VerificationProcessor(pool, {
            verify: async () => ({ status: 'VERIFIED', evidence }),
          });
          await Promise.all([
            processor.process(first.a),
            processor.process(second.a),
          ]);
          assert.deepEqual(
            [
              (await state(first.a)).status,
              (await state(second.a)).status,
            ].sort(),
            ['NEEDS_REVIEW', 'VERIFIED'],
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*) FROM settlements WHERE tx_hash=$1',
                [hash],
              )
            ).rows[0].count,
            '1',
          );
        },
      );
      await t.test(
        'invalid attempt restores awaiting and does not reserve global hash',
        async () => {
          const hash = '0x' + randomBytes(32).toString('hex'),
            bad = await fixture(hash),
            good = await fixture(hash);
          await new VerificationProcessor(pool, {
            verify: async () => ({ status: 'REJECTED', code: 'WRONG_SENDER' }),
          }).process(bad.a);
          assert.equal(
            (
              await pool.query('SELECT status FROM payments WHERE id=$1', [
                bad.p,
              ])
            ).rows[0].status,
            'AWAITING_PAYMENT',
          );
          await new VerificationProcessor(pool, {
            verify: async () => ({ status: 'VERIFIED', evidence }),
          }).process(good.a);
          assert.equal((await state(good.a)).status, 'VERIFIED');
        },
      );
      await t.test(
        'timeout budget is reviewable uncertainty and stale worker cannot settle',
        async () => {
          const { p, a } = await fixture();
          const processor = new VerificationProcessor(
            pool,
            {
              verify: async () => {
                throw Error('429');
              },
            },
            { retryBudget: 2, delayMs: 0 },
          );
          await processor.process(a);
          assert.equal((await state(a)).status, 'PENDING_CHAIN');
          await processor.process(a);
          assert.equal((await state(a)).status, 'NEEDS_REVIEW');
          assert.equal(
            (await pool.query('SELECT status FROM payments WHERE id=$1', [p]))
              .rows[0].status,
            'PROCESSING',
          );
          const stale = await fixture();
          await pool.query(
            "UPDATE payment_attempts SET status='VERIFYING',version=2,lease_until=now()+interval '30 seconds' WHERE id=$1",
            [stale.a],
          );
          assert.equal(await settle(pool, stale.a, 1, evidence), false);
          await pool.query(
            "UPDATE payment_attempts SET lease_until=now()-interval '1 second' WHERE id=$1",
            [stale.a],
          );
          assert.equal(await settle(pool, stale.a, 2, evidence), false);
          await new VerificationProcessor(pool, {
            verify: async () => ({ status: 'VERIFIED', evidence }),
          }).process(stale.a);
          assert.equal((await state(stale.a)).status, 'VERIFIED');
        },
      );
      await t.test(
        'stale in-flight verifier cannot overwrite recovered settlement',
        async () => {
          const { a } = await fixture();
          let release, started;
          const ready = new Promise((resolve) => {
            started = resolve;
          });
          const blocked = new Promise((resolve) => {
            release = resolve;
          });
          const old = new VerificationProcessor(pool, {
            verify: async () => {
              started();
              await blocked;
              return { status: 'REJECTED', code: 'STALE' };
            },
          });
          const pending = old.process(a);
          await ready;
          await pool.query(
            "UPDATE payment_attempts SET lease_until=now()-interval '1 second' WHERE id=$1",
            [a],
          );
          await new VerificationProcessor(pool, {
            verify: async () => ({ status: 'VERIFIED', evidence }),
          }).process(a);
          release();
          assert.equal(await pending, false);
          assert.equal((await state(a)).status, 'VERIFIED');
        },
      );
      await t.test(
        'confirmation then reorg clears stale inclusion and schedules another check',
        async () => {
          const { a } = await fixture();
          await new VerificationProcessor(
            pool,
            { verify: async () => ({ status: 'CONFIRMING', evidence }) },
            { delayMs: 0 },
          ).process(a);
          assert.equal((await state(a)).block_hash, evidence.blockHash);
          await new VerificationProcessor(
            pool,
            {
              verify: async (input) => {
                assert.equal(input.previousBlockHash, evidence.blockHash);
                return { status: 'PENDING_CHAIN', code: 'REORG_DETECTED' };
              },
            },
            { delayMs: 0 },
          ).process(a);
          assert.equal((await state(a)).block_hash, null);
          assert.equal((await state(a)).status, 'PENDING_CHAIN');
          await new VerificationProcessor(pool, {
            verify: async () => ({
              status: 'VERIFIED',
              evidence: { ...evidence, blockHash: '0x' + 'b'.repeat(64) },
            }),
          }).process(a);
          assert.equal((await state(a)).status, 'VERIFIED');
        },
      );
      await t.test(
        'DB commit before enqueue; crash after enqueue; delivered job lost from Redis',
        async () => {
          const { a } = await fixture();
          const event = (
            await pool.query(
              "INSERT INTO outbox(event_type,aggregate_id,payload) VALUES('VERIFY_ATTEMPT',$1,'{}') RETURNING id",
              [a],
            )
          ).rows[0].id;
          const dispatcher = new OutboxDispatcher(pool, queue, redis);
          // A durable committed outbox exists without any Redis operation.
          const crashQueue = {
            add: async (...args) => {
              await queue.add(...args);
              throw Error('simulated crash after enqueue');
            },
          };
          await assert.rejects(
            new OutboxDispatcher(pool, crashQueue, redis).dispatch(),
          );
          await pool.query(
            "UPDATE outbox SET lease_until=now()-interval '1 second' WHERE delivered_at IS NULL",
          );
          await dispatcher.dispatch();
          assert.ok(
            (
              await pool.query('SELECT delivered_at FROM outbox WHERE id=$1', [
                event,
              ])
            ).rows[0].delivered_at,
          );
          await queue.obliterate({ force: true }); // Delivered work lost completely from Redis.
          await dispatcher.recover();
          const processor = new VerificationProcessor(pool, {
            verify: async () => ({ status: 'VERIFIED', evidence }),
          });
          worker = new Worker(
            queue.name,
            (job) => processor.process(job.data.attemptId),
            { connection: redis },
          );
          const deadline = Date.now() + 5000;
          while (
            (await state(a)).status !== 'VERIFIED' &&
            Date.now() < deadline
          )
            await new Promise((r) => setTimeout(r, 20));
          assert.equal((await state(a)).status, 'VERIFIED');
          await worker.close();
          worker = undefined;
        },
      );
    } finally {
      await worker?.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.quit();
      await pool.end();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.pool.end();
    }
  },
);
