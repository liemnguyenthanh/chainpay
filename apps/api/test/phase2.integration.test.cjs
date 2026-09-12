/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { privateKeyToAccount } = require('viem/accounts');
const { encodeFunctionData, erc20Abi } = require('viem');
const { connectDatabase } = require('@chainpay/database');
const { RpcVerifier } = require('@chainpay/blockchain');
const { TOKEN_ADDRESS } = require('@chainpay/shared');
const { migrate } = require('../../../packages/database/dist/migrate');
const { seed } = require('../../../packages/database/dist/seed');
const { AppModule } = require('../dist/app.module');
const { configureHttp } = require('../dist/http');
const {
  BINDING_CHAIN_READER,
} = require('../dist/modules/checkout/checkout-auth.service');
const { OutboxDispatcher } = require('../../worker/dist/dispatcher');
const { VerificationProcessor } = require('../../worker/dist/processor');
test(
  'HTTP signature → submission → durable outbox → real BullMQ → fixture verification → settlement',
  { skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL },
  async () => {
    const admin = connectDatabase(process.env.TEST_DATABASE_URL);
    const schema = `e2e_${randomBytes(8).toString('hex')}`;
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.MERCHANT_ORIGIN = 'http://localhost:3000';
    const db = connectDatabase(url.toString());
    const redis = new Redis(process.env.TEST_REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue(schema, { connection: redis });
    let app, worker;
    try {
      await migrate(url.toString());
      const receiver = '0x1111111111111111111111111111111111111111';
      await seed(url.toString(), 'integration-password-private', receiver);
      app = await NestFactory.create(AppModule, { logger: false });
      app.get(BINDING_CHAIN_READER).getStartBlock = async () => '100';
      configureHttp(app);
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, body, cookie, key) {
        const r = await fetch(`${base}/v1/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Origin: process.env.MERCHANT_ORIGIN,
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return {
          status: r.status,
          body: await r.json(),
          cookie: r.headers.get('set-cookie')?.split(';')[0],
        };
      }
      const login = await request('merchant/session', {
        password: 'integration-password-private',
      });
      assert.equal(login.status, 201);
      const payment = await request(
        'payments',
        { amount: '1', token: 'USDC', chainId: 84532 },
        login.cookie,
        'e2e',
      );
      assert.equal(payment.status, 201);
      const issuance = await request(
        `payments/${payment.body.id}/checkout-token`,
        {},
        login.cookie,
      );
      assert.equal(issuance.status, 201);
      const token = issuance.body.checkoutToken;
      const path = `checkout/${token}`;
      const account = privateKeyToAccount(`0x${'01'.repeat(32)}`);
      const challenge = await request(`${path}/challenge`, {
        payerAddress: account.address,
      });
      assert.equal(challenge.status, 201);
      const signed = await request(`${path}/verify`, {
        challengeId: challenge.body.challengeId,
        signature: await account.signMessage({
          message: challenge.body.message,
        }),
      });
      assert.equal(signed.status, 201);
      const txHash = `0x${'ab'.repeat(32)}`;
      assert.equal(
        (await request(`${path}/transactions`, { txHash })).status,
        401,
      );
      const submissions = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(`${path}/transactions`, { txHash }, signed.cookie),
        ),
      );
      for (const r of submissions) assert.equal(r.status, 202);
      assert.equal(new Set(submissions.map((r) => r.body.attempt.id)).size, 1);
      assert.equal(
        (await db.pool.query('SELECT count(*) FROM payment_attempts')).rows[0]
          .count,
        '1',
      );
      assert.equal(
        (
          await request(
            `${path}/transactions`,
            { txHash: `0x${'cd'.repeat(32)}` },
            signed.cookie,
          )
        ).status,
        409,
      );
      // Commit before any enqueue: durable intent survives this crash boundary.
      assert.equal(await queue.getWaitingCount(), 0);
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*) FROM outbox WHERE event_type='VERIFY_ATTEMPT' AND delivered_at IS NULL",
          )
        ).rows[0].count,
        '1',
      );
      const blockHash = `0x${'bb'.repeat(32)}`;
      const tx = {
        hash: txHash,
        from: account.address,
        to: TOKEN_ADDRESS,
        value: 0n,
        input: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [receiver, 1000000n],
        }),
      };
      const receipt = {
        transactionHash: txHash,
        from: account.address,
        to: TOKEN_ADDRESS,
        status: 'success',
        blockNumber: 101n,
        blockHash,
        logs: [
          {
            address: TOKEN_ADDRESS,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              `0x${account.address.slice(2).toLowerCase().padStart(64, '0')}`,
              `0x${receiver.slice(2).padStart(64, '0')}`,
            ],
            data: `0x${1000000n.toString(16).padStart(64, '0')}`,
            logIndex: 0,
          },
        ],
      };
      const rpc = {
        getChainId: async () => 84532,
        getBlockNumber: async () => 103n,
        getCode: async () => '0x',
        getTransaction: async () => tx,
        getReceipt: async () => receipt,
        getBlockHash: async () => blockHash,
      };
      const processor = new VerificationProcessor(
        db.pool,
        new RpcVerifier({ rpc }),
      );
      const dispatcher = new OutboxDispatcher(db.pool, queue, redis);
      await dispatcher.dispatch();
      const completion = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('worker timeout')),
          10000,
        );
        worker = new Worker(
          schema,
          (job) => processor.process(job.data.attemptId),
          { connection: redis },
        );
        worker.on('completed', () => {
          clearTimeout(timer);
          resolve();
        });
        worker.on('failed', (_job, error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      await completion;
      const state = (
        await db.pool.query('SELECT * FROM payments WHERE id=$1', [
          payment.body.id,
        ])
      ).rows[0];
      assert.equal(state.status, 'CONFIRMED');
      assert.equal(
        (await db.pool.query('SELECT count(*) FROM settlements')).rows[0].count,
        '1',
      );
      assert.equal(
        (await db.pool.query('SELECT allocation_key FROM payer_bindings'))
          .rows[0].allocation_key,
        null,
      );
      assert.equal((await request(path)).body.status, 'CONFIRMED');
      const repeat = await request(
        `${path}/transactions`,
        { txHash },
        signed.cookie,
      );
      assert.equal(repeat.body.settlement.tx_hash, txHash);
      await dispatcher.dispatch();
      assert.equal(
        (
          await db.pool.query(
            'SELECT count(*) FROM outbox WHERE delivered_at IS NULL',
          )
        ).rows[0].count,
        '0',
      );
    } finally {
      await worker?.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.quit();
      await app?.close();
      await db.pool.end();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.pool.end();
    }
  },
);
