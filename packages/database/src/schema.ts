import {
  pgTable,
  jsonb,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
} from 'drizzle-orm/pg-core';
const created = () =>
  timestamp('created_at', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow();
export const merchants = pgTable('merchants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  receiverAddress: text('receiver_address').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: created(),
});
export const sessions = pgTable('merchant_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
});
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id),
  idempotencyKey: text('idempotency_key').notNull(),
  normalizedRequest: text('normalized_request').notNull(),
  chainId: integer('chain_id').notNull(),
  tokenAddress: text('token_address').notNull(),
  tokenDecimals: integer('token_decimals').notNull(),
  amountBaseUnits: numeric('amount_base_units').notNull(),
  receiverAddress: text('receiver_address').notNull(),
  checkoutTokenHash: text('checkout_token_hash').notNull(),
  status: text('status').notNull().default('AWAITING_PAYMENT'),
  version: integer('version').notNull().default(0),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true, precision: 3 }),
});
export const payerChallenges = pgTable('payer_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id),
  payerAddress: text('payer_address').notNull(),
  domain: text('domain').notNull(),
  chainId: integer('chain_id').notNull(),
  nonce: text('nonce').notNull(),
  message: text('message').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: created(),
});
export const payerBindings = pgTable('payer_bindings', {
  paymentId: uuid('payment_id')
    .primaryKey()
    .references(() => payments.id),
  payerAddress: text('payer_address').notNull(),
  startBlock: numeric('start_block').notNull(),
  allocationKey: text('allocation_key'),
  createdAt: created(),
});
export const checkoutSessions = pgTable('checkout_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payerBindings.paymentId),
  payerAddress: text('payer_address').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
});
export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id),
  chainId: integer('chain_id').notNull(),
  txHash: text('tx_hash').notNull(),
  status: text('status').notNull().default('SUBMITTED'),
  version: integer('version').notNull().default(0),
  blockNumber: numeric('block_number'),
  blockHash: text('block_hash'),
  logIndex: integer('log_index'),
  errorCode: text('error_code'),
  retryCount: integer('retry_count').notNull().default(0),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const settlements = pgTable('settlements', {
  paymentId: uuid('payment_id')
    .primaryKey()
    .references(() => payments.id),
  chainId: integer('chain_id').notNull(),
  txHash: text('tx_hash').notNull(),
  blockNumber: numeric('block_number').notNull(),
  blockHash: text('block_hash').notNull(),
  logIndex: integer('log_index').notNull(),
  createdAt: created(),
});
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: text('event_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
});
