/* eslint-disable @typescript-eslint/no-require-imports */
// Test-only real Nest/PostgreSQL backend. Never imported by the application.
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');
const apiRequire = createRequire(require.resolve('../../api/package.json'));
apiRequire('reflect-metadata');
const { NestFactory } = apiRequire('@nestjs/core');
const { connectDatabase } = apiRequire('@chainpay/database');
const { RpcVerifier } = apiRequire('@chainpay/blockchain');
const { encodeFunctionData, erc20Abi } = apiRequire('viem');
const { AppModule } = require('../../api/dist/app.module');
const { configureHttp } = require('../../api/dist/http');
const {
  BINDING_CHAIN_READER,
} = require('../../api/dist/modules/checkout/checkout-auth.service');
const { migrate } = require('../../../packages/database/dist/migrate');
const { seed } = require('../../../packages/database/dist/seed');
const { VerificationProcessor } = require('../../worker/dist/processor');
const origin = 'https://localhost:13100';
module.exports.start = async function () {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error('TEST_DATABASE_URL is required for browser E2E');
  const admin = connectDatabase(process.env.TEST_DATABASE_URL);
  const schema = `browser_${randomBytes(8).toString('hex')}`;
  await admin.pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.MERCHANT_ORIGIN = origin;
  process.env.REDIS_URL =
    process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:16379';
  const db = connectDatabase(url.toString());
  await migrate(url.toString());
  await seed(
    url.toString(),
    'browser-fixture-password',
    '0x1111111111111111111111111111111111111111',
  );
  const app = await NestFactory.create(AppModule, { logger: false });
  app.get(BINDING_CHAIN_READER).getStartBlock = async () => '100';
  configureHttp(app);
  await app.listen(13101, '127.0.0.1');
  const Redis = apiRequire('ioredis');
  const publisher = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  publisher.on('error', () => {});
  const { OutboxDispatcher } = require('../../worker/dist/dispatcher');
  const dispatcher = new OutboxDispatcher(
    db.pool,
    { add: async () => {} },
    publisher,
  );
  return {
    // Test-only state fixtures for event-loss/filter-membership tests; not settlement evidence.
    async fixtureState(id, status) {
      const result = await db.pool.query(
        'UPDATE payments SET status=$2,version=version+1,updated_at=now(),confirmed_at=CASE WHEN $2=\'CONFIRMED\' THEN now() ELSE NULL END WHERE id=$1 RETURNING id AS "paymentId",status,version',
        [id, status],
      );
      return result.rows[0];
    },
    async dispatch() {
      await dispatcher.dispatch();
    },
    async publish(event) {
      await publisher.publish('chainpay:payments', JSON.stringify(event));
    },
    async snapshot(id) {
      return (
        await db.pool.query(
          'SELECT id,status,version FROM payments WHERE id=$1',
          [id],
        )
      ).rows[0];
    },
    async settle(id) {
      const p = (
        await db.pool.query('SELECT * FROM payments WHERE id=$1', [id])
      ).rows[0];
      const a = (
        await db.pool.query(
          'SELECT * FROM payment_attempts WHERE payment_id=$1',
          [id],
        )
      ).rows[0];
      const b = (
        await db.pool.query(
          'SELECT * FROM payer_bindings WHERE payment_id=$1',
          [id],
        )
      ).rows[0];
      const blockHash = `0x${'bb'.repeat(32)}`;
      const tx = {
        hash: a.tx_hash,
        from: b.payer_address,
        to: p.token_address,
        value: 0n,
        input: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [p.receiver_address, BigInt(p.amount_base_units)],
        }),
      };
      const receipt = {
        transactionHash: a.tx_hash,
        from: b.payer_address,
        to: p.token_address,
        status: 'success',
        blockNumber: 101n,
        blockHash,
        logs: [
          {
            address: p.token_address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              `0x${b.payer_address.slice(2).padStart(64, '0')}`,
              `0x${p.receiver_address.slice(2).padStart(64, '0')}`,
            ],
            data: `0x${BigInt(p.amount_base_units).toString(16).padStart(64, '0')}`,
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
      await new VerificationProcessor(
        db.pool,
        new RpcVerifier({ rpc }),
      ).process(a.id);
    },
    async review(id) {
      await db.pool.query(
        "UPDATE payment_attempts SET status='NEEDS_REVIEW',error_code='RPC_UNAVAILABLE' WHERE payment_id=$1",
        [id],
      );
    },
    async count(id) {
      return Number(
        (
          await db.pool.query(
            'SELECT count(*) FROM payment_attempts WHERE payment_id=$1',
            [id],
          )
        ).rows[0].count,
      );
    },
    async stop() {
      publisher.disconnect();
      await app.close();
      await db.pool.end();
      await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.pool.end();
    },
  };
};
