# ChainPay Mini
## Mainnet-ready Multi-chain Web3 Payment — Vibe Coding & Interview Guide

> **Purpose:** Đây là project portfolio được thiết kế để chứng minh năng lực cho một Fullstack React/Node.js + Web3 role.
>
> Project **không cố làm nhiều feature**. Chỉ có 3 feature chính, nhưng mỗi feature phải có engineering depth đủ để nói sâu trong interview.
>
> **Stack bắt buộc:** pnpm + Turborepo monorepo, Next.js, NestJS, PostgreSQL, Redis/BullMQ, viem/wagmi.
>
> **Blockchain:** EVM mainnet thật. Multi-chain theo configuration. Không viết custom smart contract.

---

# 1. Project Goal

ChainPay Mini giải quyết một flow duy nhất:

```text
Merchant creates Payment
          ↓
Customer opens Checkout
          ↓
Connect Wallet
          ↓
Transfer USDC directly to Merchant
          ↓
Frontend sends txHash
          ↓
NestJS verifies transaction on-chain
          ↓
Worker waits / retries when necessary
          ↓
Payment = CONFIRMED
          ↓
Next.js Dashboard updates
```

ChainPay **không giữ tiền**.

```text
Customer Wallet
      │
      │ USDC transfer
      ▼
Merchant Wallet
```

Backend chỉ làm:

```text
coordinate
verify
persist
display
```

Không custody private key.

---

# 2. Scope Rule

Project chỉ giữ feature nếu feature đó chứng minh một requirement quan trọng.

Rule:

> **One feature should demonstrate multiple engineering capabilities.**

Không build feature chỉ để portfolio trông lớn.

Target:

```text
small product
+
deep implementation
+
clear engineering reasoning
```

---

# 3. Only 3 Product Features

## Feature 1 — Create Payment

Merchant tạo một payment request.

```text
POST /payments
```

Chứng minh:

- NestJS;
- REST API design;
- validation;
- PostgreSQL;
- money representation;
- idempotency;
- concurrency;
- database constraints;
- security fundamentals.

---

## Feature 2 — Web3 Checkout + Transaction Verification

Customer:

```text
Connect Wallet
→ Select / switch network
→ Transfer USDC
→ Submit txHash
```

Backend:

```text
txHash
→ queue
→ RPC
→ receipt
→ verify Transfer
→ confirmations
→ CONFIRMED
```

Chứng minh:

- Next.js / React;
- Web3 frontend;
- viem / wagmi;
- Node blockchain integration;
- Redis;
- BullMQ;
- async processing;
- retry;
- external service failures;
- security;
- multi-chain abstraction.

---

## Feature 3 — Payment Dashboard

Merchant xem:

```text
payment list
payment status
network
amount
tx hash
created time
```

Dashboard nhận status update realtime.

Chứng minh:

- React;
- TanStack Query;
- SSE;
- server state;
- cursor pagination;
- PostgreSQL indexing;
- frontend performance;
- scalable list design.

---

# 4. Explicit Non-Goals

Không build:

```text
❌ custom Solidity contract
❌ NFT
❌ DEX
❌ swap
❌ bridge
❌ cross-chain settlement
❌ staking
❌ refunds
❌ disputes
❌ fiat conversion
❌ KYC
❌ merchant API-key platform
❌ webhook platform
❌ reconciliation subsystem
❌ Kafka
❌ Kubernetes
❌ microservices
❌ Grafana stack
❌ complex DevOps
```

Nếu một interviewer hỏi tại sao:

> The project intentionally keeps product breadth small so I can demonstrate application-layer Web3 reliability, backend correctness, database performance and React architecture in depth.

---

# 5. Mainnet Strategy

ChainPay được thiết kế để chạy EVM mainnet thật.

Suggested networks:

```text
Base
Arbitrum
Ethereum
```

Có thể bắt đầu với Base để demo phí thấp.

Multi-chain **không phải cross-chain**.

Mỗi payment thuộc đúng một chain:

```text
Payment A → Base
Payment B → Arbitrum
Payment C → Ethereum
```

Không chuyển tài sản giữa chain.

---

# 6. Mainnet Safety Rule

Mainnet means real assets.

Dù demo bằng ví của chính mình:

- verify chain trước khi gửi;
- verify token contract;
- verify receiver;
- dùng amount nhỏ;
- không hard-code private key;
- không để backend custody wallet;
- không log secret;
- không assume txHash = payment success.

Development có thể dùng testnet trước.

Final demo có thể dùng mainnet với giá trị nhỏ.

---

# 7. Why No Custom Smart Contract?

USDC đã là ERC-20 contract.

Customer chỉ cần gọi:

```text
USDC.transfer(merchant, amount)
```

ChainPay không cần deploy contract riêng.

Architecture:

```text
Customer
   │
   │ ERC20 transfer
   ▼
Existing USDC Contract
   │
   ▼
Merchant Wallet
```

ChainPay reads blockchain state afterward.

Điều project muốn chứng minh là:

```text
Web3 application engineering
```

không phải:

```text
smart-contract engineering
```

---

# 8. JD → Evidence Mapping

| Capability | Evidence |
|---|---|
| React | Next.js Checkout + Dashboard |
| Node.js | NestJS API + worker |
| Fullstack | End-to-end payment lifecycle |
| Web3 | Wallet + ERC20 + RPC verification |
| Blockchain | Receipts, logs, confirmations |
| Database | PostgreSQL schema + constraints + indexes |
| Networking | HTTP + RPC + SSE |
| Security | server-side verification, validation, no custody |
| Performance | cursor pagination + indexed queries |
| Scale | stateless API + async worker |
| Redis | BullMQ + async processing |
| Docker | local reproducible environment |
| CI/CD | lint/test/build pipeline |
| Documentation | architecture + tradeoffs |
| Distributed systems | retry, duplicate processing, external failures |

---

# 9. Monorepo

Use:

```text
pnpm
Turborepo
```

Structure:

```text
chainpay/
│
├── apps/
│   ├── web/                  # Next.js
│   ├── api/                  # NestJS HTTP
│   └── worker/               # NestJS worker
│
├── packages/
│   ├── database/             # DB schema/client
│   ├── blockchain/           # chain configs + RPC abstraction
│   ├── shared/               # shared types/schemas
│   └── config/               # environment validation
│
├── docs/
│   ├── architecture.md
│   ├── payment-lifecycle.md
│   ├── database.md
│   ├── reliability.md
│   ├── performance.md
│   ├── security.md
│   ├── tradeoffs.md
│   └── interview.md
│
├── infra/
│   └── compose.yaml
│
├── .github/workflows/ci.yml
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

Do not create more packages without a concrete reason.

---

# 10. System Architecture

```text
                  ┌────────────────────────┐
                  │        Next.js         │
                  │                        │
                  │ Checkout     Dashboard │
                  └───────────┬────────────┘
                              │
                        HTTPS │ SSE
                              │
                              ▼
                  ┌────────────────────────┐
                  │        NestJS API      │
                  │                        │
                  │ Payments               │
                  │ Transaction Submission │
                  │ Payment Queries        │
                  │ SSE                    │
                  └──────┬────────┬────────┘
                         │        │
                         ▼        ▼
                   PostgreSQL   Redis
                                  │
                                BullMQ
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ NestJS Worker   │
                         │                 │
                         │ Verify TX       │
                         │ Confirm TX      │
                         └────────┬────────┘
                                  │
                                  ▼
                        Blockchain Provider
                           │      │      │
                         Base Arbitrum Ethereum
```

---

# 11. Why Separate API and Worker?

API handles short-lived request/response operations.

Worker handles external blockchain work.

Bad:

```text
POST /transaction
       ↓
wait RPC
       ↓
wait confirmations
       ↓
30 seconds
       ↓
HTTP response
```

Better:

```text
POST /transaction
       ↓
persist
       ↓
enqueue
       ↓
202 Accepted

Worker
  ↓
RPC
  ↓
verify
```

This separation demonstrates asynchronous system design without introducing microservices unnecessarily.

---

# 12. Payment Domain

Minimal state machine:

```text
AWAITING_PAYMENT
       ↓
SUBMITTED
       ↓
VERIFYING
       ↓
CONFIRMING
       ↓
CONFIRMED
```

Permanent invalid transaction:

```text
FAILED
```

Important:

```text
RPC timeout != FAILED
```

A technical dependency failure should not automatically become a business failure.

---

# 13. Core Invariants

These matter more than controller code.

## Invariant 1

Same merchant + same idempotency key must represent one logical payment.

## Invariant 2

A blockchain transaction can settle at most one ChainPay payment.

## Invariant 3

Frontend cannot mark payment as confirmed.

## Invariant 4

Backend verifies chain, token, receiver and amount.

## Invariant 5

A worker processing the same job twice must remain safe.

## Invariant 6

CONFIRMED is terminal for this demo.

---

# 14. Database Schema

Keep database small.

## merchants

```text
id
name
wallet_address
created_at
```

For portfolio scope, seed one demo merchant.

Do not build merchant administration.

---

## payments

```text
id

merchant_id
idempotency_key

chain_id

token_address
token_symbol
token_decimals

amount_base_units
receiver_address

status

transaction_hash
payer_address
block_number

created_at
updated_at
confirmed_at
```

---

# 15. Database Constraints

Important constraints:

```text
UNIQUE (merchant_id, idempotency_key)
```

and:

```text
UNIQUE (chain_id, transaction_hash)
WHERE transaction_hash IS NOT NULL
```

Why?

Application code alone is insufficient under concurrency.

Example:

```text
Request A: SELECT → not found
Request B: SELECT → not found

A INSERT
B INSERT
```

Without DB uniqueness:

```text
duplicate payment
```

Database constraint is the final concurrency boundary.

---

# 16. Money

Never use floating point as settlement truth.

Example:

```text
1.25 USDC
```

USDC uses token decimals.

Normalize:

```text
1.25
↓
1250000 base units
```

Persist:

```text
amount_base_units
```

Prefer bigint-compatible representation.

At API boundary, monetary values can be strings.

---

# 17. Multi-chain Configuration

Do NOT sprinkle:

```ts
if (chainId === ...)
```

through the application.

Centralize config conceptually:

```ts
type ChainConfig = {
  chainId: number;
  name: string;
  rpcUrl: string;
  usdcAddress: `0x${string}`;
  confirmations: number;
};
```

Example:

```text
chains
├── Base
├── Arbitrum
└── Ethereum
```

Important:

**Never invent production token addresses.**

Use verified official deployment addresses when configuring mainnet.

---

# 18. Blockchain Module

`packages/blockchain`

Responsibilities:

```text
chain configuration
RPC client creation
transaction lookup
receipt lookup
ERC20 transfer decoding
confirmation calculation
```

Application code should ask:

```text
verifyPaymentTransaction(...)
```

instead of directly knowing every viem detail.

Avoid over-abstraction.

We support EVM only, so there is no need for a generic “all blockchain” framework.

---

# 19. Feature 1 — Create Payment

API:

```http
POST /v1/payments
Idempotency-Key: order-123
```

Body:

```json
{
  "amount": "1.00",
  "token": "USDC",
  "chainId": 8453
}
```

Response concept:

```json
{
  "id": "pay_xxx",
  "status": "AWAITING_PAYMENT",
  "amount": "1.00",
  "token": "USDC",
  "chainId": 8453,
  "receiver": "0x...",
  "checkoutUrl": "/checkout/pay_xxx"
}
```

---

# 20. Why Idempotency?

Scenario:

```text
client
 ↓
POST /payments

server creates payment
 ↓

network timeout
 ↓

client doesn't know response
 ↓

retry POST /payments
```

Without idempotency:

```text
Payment A
Payment B
```

With:

```text
Idempotency-Key: order-123
```

both requests resolve to one logical payment.

---

# 21. Feature 1 Must Demonstrate

Do not consider Create Payment complete merely because it returns HTTP 201.

It must demonstrate:

```text
DTO validation
money normalization
supported chain validation
supported token validation
idempotency
concurrent request safety
DB constraint
consistent error handling
structured logging
```

---

# 22. Feature 2 — Checkout

Route:

```text
/checkout/:paymentId
```

Minimal UI:

```text
ChainPay

Pay
1.00 USDC

Network
Base

To
0x12...89AB

[ Connect Wallet ]

[ Pay 1.00 USDC ]
```

After submit:

```text
Transaction submitted

0xabc...

VERIFYING
```

then:

```text
CONFIRMING
```

then:

```text
✓ CONFIRMED
```

---

# 23. Checkout Responsibilities

Frontend may:

```text
connect wallet
read wallet address
check selected chain
request network switch
check token balance
call ERC20 transfer
receive txHash
submit txHash to API
display status
```

Frontend may NOT decide:

```text
payment is valid
payment is confirmed
amount received correctly
```

Those belong to backend verification.

---

# 24. Transaction Submission API

```http
POST /v1/payments/:paymentId/transaction
```

Body:

```json
{
  "transactionHash": "0x..."
}
```

Server:

```text
validate format
↓
attach hash safely
↓
status = SUBMITTED
↓
enqueue verification
↓
202 Accepted
```

Do not perform long blockchain verification inside controller.

---

# 25. Backend Transaction Verification

Worker loads:

```text
Payment
```

and retrieves:

```text
transaction
receipt
```

Then checks:

```text
correct chain?
receipt successful?
correct USDC contract?
Transfer event exists?
receiver == expected receiver?
amount == expected amount?
tx hash unused by another payment?
```

Only backend verification can advance settlement state.

---

# 26. ERC-20 Verification

A successful transaction receipt alone is insufficient.

A transaction could succeed while doing something unrelated.

For token settlement, inspect the receipt logs for the expected ERC-20 `Transfer` event.

Conceptually:

```text
Transfer(
  from,
  to,
  value
)
```

Validate:

```text
log.address == configured USDC contract
to == payment.receiver
value == payment.amount_base_units
```

Also record payer if useful.

---

# 27. Why Queue?

Blockchain RPC is an external dependency.

It can be:

```text
slow
rate limited
temporarily unavailable
```

Verification is asynchronous.

Therefore:

```text
HTTP request
   ↓
save
   ↓
enqueue
   ↓
return quickly
```

Worker handles unreliable external work.

This is the main reason Redis/BullMQ exists in the project.

---

# 28. Retry

Transient:

```text
timeout
429
temporary 5xx
connection reset
```

→ retry.

Permanent verification failure:

```text
wrong receiver
wrong token
wrong amount
reverted transaction
```

→ FAILED.

Use bounded exponential backoff.

Optional jitter is good.

Do not build a complex retry framework.

---

# 29. Worker Idempotency

Assume:

```text
same BullMQ job may execute twice
```

Worker must safely handle:

```text
already CONFIRMED
already FAILED
another worker already moved state
```

Prefer conditional updates.

Concept:

```sql
UPDATE payments
SET status = 'VERIFYING'
WHERE id = ?
AND status = 'SUBMITTED';
```

If no row updated, inspect current state instead of blindly continuing.

---

# 30. Confirmations

After transaction is valid:

```text
VERIFYING
    ↓
CONFIRMING
```

Check:

```text
latest block
-
transaction block
+
1
```

against configured confirmation threshold.

Do not hold one worker process sleeping for a long period.

Reschedule/check later.

---

# 31. Feature 2 Must Demonstrate

The feature is complete only if you can demonstrate:

```text
real wallet
real ERC20 transfer
real RPC
server-side verification
Redis queue
retry
idempotent worker
confirmation tracking
multi-chain config
security boundary between browser/backend
```

That is enough Web3/backend depth.

No smart contract needed.

---

# 32. Feature 3 — Dashboard

Minimal dashboard:

```text
ChainPay

Payments

┌─────────┬────────┬──────────┬────────────┐
│ Payment │ Amount │ Network  │ Status     │
├─────────┼────────┼──────────┼────────────┤
│ #102    │ 1 USDC │ Base     │ CONFIRMED  │
│ #101    │ 2 USDC │ Arbitrum │ VERIFYING  │
│ #100    │ 1 USDC │ Base     │ CONFIRMED  │
└─────────┴────────┴──────────┴────────────┘

[ Load more ]
```

Clicking payment can show:

```text
amount
network
receiver
payer
tx hash
block
status
timestamps
```

No analytics dashboard needed.

---

# 33. Cursor Pagination

API:

```http
GET /v1/payments?cursor=...&limit=30
```

Sort:

```text
created_at DESC
id DESC
```

Cursor contains both.

Query concept:

```sql
WHERE merchant_id = ?
AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 30
```

Why both?

Because timestamps may collide.

---

# 34. Why Not OFFSET?

This is an interview topic, not ideology.

OFFSET is fine for many small datasets.

But this project intentionally demonstrates scalable listing.

Deep:

```sql
OFFSET 90000 LIMIT 30
```

requires the DB to walk past many rows.

Cursor uses the last known ordering key to continue.

Also reason about inserts between page requests.

---

# 35. Database Index

Query pattern drives index.

Example conceptual index:

```text
merchant_id
created_at DESC
id DESC
```

If filtering status frequently, evaluate a second index rather than adding indexes blindly.

Use:

```text
EXPLAIN ANALYZE
```

to verify.

Do not claim performance improvement without measurement.

---

# 36. Dataset

Seed:

```text
100,000 payments
```

This is enough to demonstrate:

```text
pagination
indexing
frontend list behavior
```

No need for 1 million unless you personally want to experiment.

---

# 37. TanStack Query

Payments are server state.

Use TanStack Query for:

```text
fetch
cache
loading
error
pagination
refetch
cache mutation
```

Do not duplicate payments into Zustand.

Zustand/local state only if genuinely useful for UI state.

---

# 38. SSE

Use SSE for:

```text
server → dashboard
```

event:

```text
payment.updated
```

When worker changes:

```text
VERIFYING
→ CONFIRMING
→ CONFIRMED
```

dashboard receives update.

Then patch TanStack Query cache.

Avoid refetching every payment on every event.

---

# 39. Why SSE?

Requirements are mostly one-way:

```text
server → browser
```

SSE gives:

```text
simple HTTP transport
automatic browser reconnect semantics
good fit for status events
```

WebSocket would work, but adds unnecessary bidirectional connection complexity for this demo.

Document this as a tradeoff, not as “SSE is always better”.

---

# 40. Feature 3 Must Demonstrate

```text
Next.js architecture
React rendering
TanStack Query
cursor pagination
PostgreSQL index
SSE
cache update
responsive UI
loading/error states
```

This is where the project should show your frontend strength.

---

# 41. Security — Keep It Focused

No security feature page.

Security exists inside the 3 flows.

Required:

```text
input validation
supported chain allowlist
supported token allowlist
server-side tx verification
unique tx constraint
rate limit basic public endpoints if needed
no private key storage
environment secrets
safe logging
CORS configuration
security headers
```

Do not add an entire auth platform.

A seeded/demo merchant is acceptable for portfolio scope.

---

# 42. Privacy

Store only what the product needs.

Public blockchain addresses are public data, but that does not mean application data should be collected without reason.

Do not store:

```text
private keys
seed phrases
wallet signatures unrelated to required flow
```

---

# 43. Logging

Use structured logs.

Minimum useful context:

```text
requestId
paymentId
chainId
transactionHash
jobId
status
duration
```

Example concept:

```json
{
  "event": "payment.verification.completed",
  "paymentId": "pay_123",
  "chainId": 8453,
  "transactionHash": "0x...",
  "durationMs": 730
}
```

---

# 44. Docker

Local environment:

```text
PostgreSQL
Redis
API
Worker
Web
```

Goal:

```bash
docker compose up
```

or a similarly simple documented setup.

Do not Dockerize everything prematurely if it slows development; final repo should be reproducible.

---

# 45. CI

Minimal CI:

```text
pnpm install
↓
lint
↓
typecheck
↓
test
↓
build
```

Enough.

No complex deployment pipeline required.

---

# 46. Testing

Testing should focus on engineering claims.

## Unit

```text
money normalization
state transitions
ERC20 log verification
cursor encode/decode
```

## Integration

```text
payment idempotency
concurrent duplicate requests
duplicate tx hash
pagination
worker state updates
```

## E2E

One golden path:

```text
create payment
→ checkout
→ submit transaction
→ verify
→ confirm
→ dashboard update
```

---

# 47. Vibe Coding Philosophy

This is a **full AI-assisted build**.

AI may:

```text
scaffold
write implementation
write migrations
write tests
review code
generate seed data
refactor
write docs
```

But:

> AI writes code. You own the reasoning.

Never merge code you cannot explain.

---

# 48. Vibe Coding Loop

Every phase:

```text
1. UNDERSTAND
       ↓
2. DESIGN
       ↓
3. ASK AI TO IMPLEMENT
       ↓
4. REVIEW DIFF
       ↓
5. RUN
       ↓
6. BREAK
       ↓
7. TEST
       ↓
8. DOCUMENT WHY
       ↓
9. INTERVIEW CHECK
```

Do not skip from step 3 to the next feature because “it works”.

---

# 49. Universal Coding Prompt

Use:

```text
You are implementing one focused feature in ChainPay Mini.

Context:
[describe current architecture]

Goal:
[one task only]

Before writing code:
1. explain the proposed design,
2. identify invariants,
3. identify race conditions,
4. identify failure cases,
5. identify security concerns,
6. propose tests.

Constraints:
- keep scope minimal,
- do not introduce technologies unless necessary,
- prefer database guarantees for concurrency correctness,
- blockchain client data is untrusted,
- workers must tolerate duplicate execution,
- explain every new dependency.

After implementation:
1. summarize changed files,
2. explain important decisions,
3. provide verification commands,
4. list remaining risks/tradeoffs.
```

---

# 50. Phase 1 — Bootstrap

## Build

```text
pnpm workspace
Turborepo
Next.js
NestJS API
NestJS worker
PostgreSQL
Redis
shared packages
```

Nothing else.

## Prompt

```text
Bootstrap ChainPay Mini as a pnpm + Turborepo monorepo.

apps:
- web: Next.js App Router
- api: NestJS HTTP API
- worker: NestJS standalone worker

packages:
- database
- blockchain
- shared
- config

Infrastructure:
- PostgreSQL
- Redis

Do not implement business features.
Keep configuration minimal.
Explain every dependency.
```

## Verify

```text
pnpm install
pnpm typecheck
pnpm build
API boots
worker boots
web boots
Postgres connects
Redis connects
```

## Must understand

```text
Why monorepo?
Why separate worker?
Why NestJS?
Why Next.js?
Why not microservices?
```

---

# 51. Phase 2 — Payment Domain + Create API

## Build

```text
merchant seed
payments table
payment states
POST /payments
GET /payments/:id
idempotency
```

## Before AI

You personally define:

```text
states
invariants
money representation
unique constraints
```

## Prompt

```text
Implement the minimal ChainPay Payment domain and Create Payment API.

Requirements:
- PostgreSQL
- amount in token base units
- merchant + idempotency key uniqueness
- supported chain validation
- configured USDC only
- database-safe concurrent idempotency
- consistent NestJS validation/errors

Before coding, show the proposed schema and explain each constraint/index.

Add an integration test that sends concurrent requests with the same
Idempotency-Key and proves they resolve to one logical payment.
```

## Break it

```text
20 concurrent same-key requests
unsupported chain
invalid amount
missing key
duplicate key with conflicting body
```

Important design question:

If same idempotency key is reused with a different request body, decide whether to:

```text
reject conflict
```

and document it.

## Must understand

```text
idempotency
DB uniqueness
race conditions
bigint/base units
transaction boundaries
validation
```

---

# 52. Phase 3 — Dashboard + Pagination

## Build

```text
payment list
payment detail
cursor pagination
TanStack Query
100k seed
DB index
```

## Prompt

```text
Implement the ChainPay payment dashboard and scalable payment listing.

Backend:
- stable compound cursor using created_at + id
- limit max
- merchant scoped query
- appropriate PostgreSQL index

Frontend:
- Next.js
- TanStack Query
- load-more/infinite pagination
- loading/error/empty states
- responsive table/list

Seed 100,000 payments.

Do not use offset pagination.
Explain the query and index relationship.
```

## Verify

Use:

```text
EXPLAIN ANALYZE
```

Test pagination while new rows are inserted.

## Must understand

```text
cursor vs offset
compound ordering
indexes
server state
React Query cache
React rendering
```

---

# 53. Phase 4 — Mainnet Web3 Checkout

## Build

```text
checkout page
wallet connect
chain switch
USDC transfer
txHash
```

Start on one chain first.

Recommended:

```text
Base
```

Only add another chain after Base flow works.

## Prompt

```text
Implement ChainPay checkout using wagmi + viem.

Requirements:
- connect browser wallet
- ensure payment chain is selected
- read configured USDC contract
- check balance
- execute standard ERC20 transfer directly to merchant receiver
- obtain txHash
- submit txHash to NestJS
- display clear transaction states

Security:
- never handle private keys
- frontend success is not settlement truth
- production chain/token configuration must be explicit
```

## Mainnet check

Before sending real funds manually verify:

```text
chain
USDC address
receiver
amount
wallet
gas
```

## Must understand

```text
wallet signing
ERC20 transfer
chain ID
token decimals
transaction hash
non-custodial architecture
```

---

# 54. Phase 5 — Verification Worker

## Build

```text
POST transaction
BullMQ
RPC verification
receipt/log decode
retry
confirmations
```

This is the deepest backend phase.

## Prompt

```text
Implement ChainPay transaction submission and verification.

API:
- accept txHash
- safely attach it to payment
- enforce unique chainId + txHash
- enqueue BullMQ job
- return 202

Worker:
- idempotent execution
- fetch transaction receipt using viem
- verify receipt success
- verify configured USDC Transfer event
- verify receiver
- verify amount
- classify transient vs permanent errors
- bounded retry/backoff
- track confirmations without sleeping a worker for long periods
- use safe conditional state transitions

Before implementation, explicitly describe every failure scenario.
```

## Break it

Test:

```text
valid tx
wrong receiver
wrong amount
wrong token
reverted tx
duplicate tx
duplicate worker execution
RPC timeout
RPC 429
```

## Must understand

This phase is not done until you can explain:

```text
Why queue?
Why 202?
Why not verify in controller?
What does receipt prove?
Why inspect logs?
What happens if job runs twice?
What is transient failure?
Why retry?
What are confirmations?
What is a reorg?
```

---

# 55. Phase 6 — Multi-chain

Only now add:

```text
Arbitrum
Ethereum
```

No new business flow.

Same code path:

```text
payment.chainId
       ↓
chain config
       ↓
correct RPC
       ↓
correct USDC contract
```

## Prompt

```text
Extend the existing EVM payment flow to support multiple configured chains.

Do not redesign the system.

Requirements:
- centralized chain config
- per-chain RPC
- per-chain official token address
- per-chain confirmation policy
- same verification service
- no scattered chain-specific conditionals
- unsupported chains rejected

Keep this EVM-specific.
Do not create an unnecessary universal blockchain abstraction.
```

## Must understand

```text
configuration vs abstraction
chain-specific data
RPC isolation
why multi-chain != cross-chain
```

---

# 56. Phase 7 — SSE + Final Polish

## Build

```text
SSE
query cache patch
structured logs
Docker
CI
focused tests
docs
```

## Prompt

```text
Finish ChainPay Mini for portfolio review.

Add:
- authenticated/demo-scoped SSE payment updates
- TanStack Query cache patching
- structured logs
- Docker Compose
- minimal GitHub Actions CI
- focused unit/integration tests

Do not add new product features.

Then review the entire repository for:
- correctness
- race conditions
- unnecessary abstractions
- security mistakes
- React performance problems
- undocumented tradeoffs.
```

---

# 57. Code Review Prompt

After every phase:

```text
Act as a senior Fullstack/Web3 engineer reviewing this diff.

Do not rewrite code first.

Find:
- correctness bugs
- race conditions
- missing DB guarantees
- blockchain verification mistakes
- security issues
- async failure cases
- performance issues
- React state/rendering problems
- unnecessary abstractions
- missing tests

Rank findings by severity.

For every issue explain:
1. concrete failure scenario,
2. why the current code fails,
3. smallest correct fix.
```

---

# 58. Break-It Prompt

```text
Try to break this implementation.

Assume:
- client retries,
- two requests arrive concurrently,
- the same job runs twice,
- RPC times out,
- RPC returns 429,
- user submits another person's tx hash,
- user submits a valid tx with wrong amount,
- user submits a valid tx on wrong chain,
- frontend lies about success.

Give concrete reproducible test cases.
```

---

# 59. Interview Learning Prompt

After each phase:

```text
Interview me about the feature I just built.

Ask Middle-to-Senior Fullstack questions focused on:
- design decisions
- concurrency
- database
- failure modes
- networking
- security
- performance
- scaling
- React architecture
- Web3

Ask one question at a time.

After my answer:
- score it,
- identify gaps,
- give the stronger answer,
- ask a deeper follow-up.

Avoid trivia.
```

---

# 60. README Story

README should communicate depth immediately.

Opening:

```text
# ChainPay Mini

A mainnet-ready multi-chain Web3 payment demo built with
Next.js, NestJS, PostgreSQL, Redis/BullMQ and viem.

ChainPay intentionally implements only three product features:

1. Idempotent payment creation
2. Non-custodial USDC checkout + server-side blockchain verification
3. Realtime scalable payment dashboard

Engineering topics demonstrated:

✓ React / Next.js
✓ NestJS
✓ PostgreSQL
✓ Redis / BullMQ
✓ Web3 RPC
✓ Multi-chain EVM
✓ Idempotency
✓ Concurrency
✓ Async processing
✓ Retry
✓ Cursor pagination
✓ Database indexing
✓ SSE
✓ Security
✓ Docker / CI
```

---

# 61. Demo Flow

Target demo: 5–7 minutes.

## 0:00–1:00

Show architecture.

Explain:

```text
3 features only
no custom contract
non-custodial
mainnet
```

## 1:00–2:00

Create $1 USDC payment.

Show duplicate idempotency request returning same logical payment.

## 2:00–3:30

Open checkout.

Connect wallet.

Send real small-value USDC payment.

## 3:30–4:30

Show:

```text
SUBMITTED
→ VERIFYING
→ CONFIRMING
→ CONFIRMED
```

Open explorer transaction if useful.

## 4:30–5:30

Show dashboard realtime update.

## 5:30–6:30

Show 100k seeded payments + cursor query/index.

## 6:30–7:00

Explain:

```text
what happens if RPC fails
what happens if worker runs twice
how API/worker would scale
```

Done.

---

# 62. Interview Story Per Feature

## Feature 1

Do not say:

> I created a payment API.

Say:

> Payment creation is idempotent and concurrency-safe. I use the database as the final uniqueness boundary so retries hitting different API instances still resolve to one logical payment.

Shows:

```text
backend correctness
```

---

## Feature 2

Do not say:

> I integrated wagmi.

Say:

> The browser only submits a transaction hash. The backend independently verifies settlement against chain data because the client is untrusted. RPC work is asynchronous because providers can be slow, rate-limited or temporarily unavailable.

Shows:

```text
Web3 + backend reliability
```

---

## Feature 3

Do not say:

> I made a React table.

Say:

> Payment history uses stable cursor pagination backed by an index matching the query order. TanStack Query manages server state and SSE patches affected cached payments instead of polling or refetching the entire dataset.

Shows:

```text
strong frontend + performance
```

---

# 63. Scaling Discussion

Do not implement scale infrastructure.

Be able to explain it.

Current:

```text
1 API
1 worker
1 PostgreSQL
1 Redis
```

Scale API:

```text
Load Balancer
├── API
├── API
└── API
```

API is stateless.

Scale worker:

```text
BullMQ
├── Worker
├── Worker
└── Worker
```

Correctness depends on idempotent processing.

Likely bottlenecks:

```text
RPC limits
DB query/index quality
queue backlog
SSE connections
```

For multiple API instances and SSE, discuss shared event propagation such as Redis Pub/Sub if it becomes necessary.

Do not implement it unless needed.

---

# 64. Tradeoffs Document

`docs/tradeoffs.md` must answer:

```text
Why PostgreSQL?
Why Redis/BullMQ?
Why separate worker?
Why cursor instead of offset?
Why SSE instead of WebSocket?
Why TanStack Query?
Why no custom smart contract?
Why direct ERC20 transfer?
Why mainnet?
Why multi-chain config but not cross-chain?
Why not microservices?
Why not Kafka?
Why no reconciliation system?
```

This file is interview gold.

---

# 65. Definition of Done

## Feature 1

- [ ] Payment can be created.
- [ ] Amount stored safely.
- [ ] Supported chain validated.
- [ ] Idempotency works.
- [ ] Concurrent duplicate request test passes.

## Feature 2

- [ ] Wallet connects.
- [ ] Network switch works.
- [ ] Real ERC20 transfer works.
- [ ] txHash submitted.
- [ ] BullMQ processes verification.
- [ ] Receipt/log verified server-side.
- [ ] Wrong receiver rejected.
- [ ] Wrong amount rejected.
- [ ] Duplicate tx rejected.
- [ ] RPC transient failure retries.
- [ ] Confirmation state works.
- [ ] At least two EVM chains supported using same flow.

## Feature 3

- [ ] Dashboard lists payments.
- [ ] Cursor pagination works.
- [ ] 100k seed available.
- [ ] Relevant DB query inspected with EXPLAIN ANALYZE.
- [ ] TanStack Query used for server state.
- [ ] SSE updates status.
- [ ] Responsive/error/loading states implemented.

## Engineering

- [ ] Structured logs.
- [ ] Important unit tests.
- [ ] Important integration tests.
- [ ] One E2E golden path.
- [ ] Docker setup.
- [ ] CI.
- [ ] README.
- [ ] Architecture doc.
- [ ] Tradeoffs doc.
- [ ] Interview notes.

---

# 66. Final Build Order

Do exactly this:

```text
PHASE 1
Monorepo bootstrap

    ↓

PHASE 2
Payment domain
PostgreSQL
Create Payment
Idempotency

    ↓

PHASE 3
Dashboard
Cursor pagination
100k dataset
DB index

    ↓

PHASE 4
Web3 Checkout
One chain
Real ERC20 transfer

    ↓

PHASE 5
BullMQ verification worker
RPC
retry
confirmations

    ↓

PHASE 6
Add 1–2 more EVM chains
same code path

    ↓

PHASE 7
SSE
tests
Docker
CI
docs
polish
```

Do not add features between phases because an AI agent suggests them.

---

# 67. Stop Conditions

A major danger in vibe coding is endless expansion.

If AI says:

```text
“You may also want Kafka...”
“You could add Kubernetes...”
“You could add webhook support...”
“You could introduce event sourcing...”
“You could add a smart contract...”
```

Default answer:

```text
NO
```

unless the feature fixes an actual problem in the current requirements.

---

# 68. Final Interview Readiness Test

Before applying, answer these without AI:

### Payment

1. What problem does idempotency solve?
2. What happens with 20 concurrent identical requests?
3. Why is DB uniqueness necessary?
4. Why base units instead of JS number?

### Web3

5. Why doesn't txHash prove payment?
6. What exactly does backend verify?
7. Why inspect ERC20 Transfer logs?
8. What if RPC times out?
9. Why use queue?
10. What if a job executes twice?
11. What are confirmations?
12. What is a reorg?
13. Why no private key on backend?
14. How does multi-chain support work?

### Database

15. Why cursor pagination?
16. Why `(created_at, id)`?
17. Why that index?
18. How would you prove the index helps?

### React

19. Why TanStack Query?
20. Why not Zustand for payment server state?
21. How does SSE update the cache?
22. What happens with 100k payments?
23. What actually gets rendered in the browser?

### Scale

24. How do you scale API?
25. How do you scale workers?
26. What happens to SSE with multiple API instances?
27. What is likely to bottleneck first?
28. When would you introduce more infrastructure?

### Tradeoffs

29. Why NestJS?
30. Why Next.js?
31. Why BullMQ instead of Kafka?
32. Why SSE instead of WebSocket?
33. Why no custom smart contract?
34. What would you build next if this became a real product?

If you can answer all 34 clearly, the project has achieved its purpose.

---

# 69. Success Criterion

The goal is NOT:

> “I vibe-coded a Web3 payment application.”

The goal is:

> “I built a deliberately small production-minded payment flow and I understand every important decision from React rendering and PostgreSQL indexes to blockchain verification, retries, concurrency and scaling.”

AI can produce most of the code.

**You must own every engineering decision.**
