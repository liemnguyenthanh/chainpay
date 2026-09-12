# ChainPay Mini — implementation spec

User-requested extension (2026-09-11): [native BERA on Berachain mainnet](berachain.md) adds a second explicitly selectable asset alongside Base Sepolia USDC. Its native-transfer rules supersede ERC20-only statements below for that chain only. Existing session, recovery and settlement invariants remain in force.

Status: implementation contract; Phase 1 domain, Phase 2 verification backend, Phase 3 checkout and Phase 4 dashboard/realtime implemented; real wallet/testnet smoke remains user-run. See docs/plan.md for executed checks and remaining phases.

## 1. Outcome and scope

Three features: idempotent payment creation, non-custodial USDC checkout with server verification, and a paginated merchant dashboard. Demonstrate React/Node, database correctness, queues, testing and clear design decisions. Start with one EVM testnet; add Base mainnet and a second chain only after correctness checks. The application does not custody assets. Direct transfers cannot encode an invoice ID; the constrained allocation policy below is a documented demo limitation.

## 2. Trust and access

- Seed one merchant; receiver comes from server configuration and is snapshotted on payment creation.
- Merchant write/list/SSE routes require a server-validated merchant session. Demo access must be explicit; never expose merchant credentials in a public JS bundle. Choose a minimal password/session implementation when delivering this phase, not an auth platform.
- Public checkout uses an opaque random checkout token and returns only checkout-required fields. Rate-limit challenge and transaction endpoints.
- Initial wallet scope: EOA wallets only. Smart-account signature validation is deferred and must not be silently accepted.
- Before paying, issue an expiring, single-use signed challenge bound to domain, payment ID, chain ID, payer address and nonce. Verify server-side and establish a scoped checkout session using a secure cookie. Apply origin/CSRF checks to cookie-authenticated writes.
- Record the server-observed start block when payer binding is established. Accept only transfers included after that block. Rebinding must not erase an active attempt or invalidate a potentially paid transfer silently.
- Serialize active payment claims with the same merchant, payer, chain, token, receiver and amount. Reject a competing binding with a clear conflict. This reduces ambiguous allocation but does not prove commercial intent: direct ERC-20 transfers contain no payment reference. Do not advertise full invoice attribution.

## 3. Data and invariants

Use PostgreSQL migrations and a typed database client; choose one ORM during the domain phase.

`merchants`: id, name, receiver address, created_at.

`payments`: id, merchant_id, idempotency_key, normalized_request fingerprint/data, chain_id, token_address, token_decimals, amount_base_units, receiver_address, checkout_token_hash, status, version, created_at, updated_at, confirmed_at.

`payer_bindings`: payment_id, payer_address, start_block, active allocation key, expiry/session metadata. Nonce challenges are single-use and consumed atomically.

`payment_attempts`: id, payment_id, chain_id, tx_hash, status, version, block_number, block_hash, log_index, error_code, retry_count, next_check_at, lease_until, created_at, updated_at. Store each hash separately; never overwrite evidence with a replacement hash.

`settlements`: payment_id UNIQUE, chain_id, tx_hash, matched log metadata; UNIQUE(chain_id, tx_hash). Only validated settlement consumes the final global uniqueness constraint. Untrusted submissions must not permanently reserve another payment's valid transaction.

`outbox`: id, event_type, aggregate_id, payload, available_at, lease_until, delivered_at, attempts. Index pending delivery scans.

Constraints: UNIQUE(merchant_id, idempotency_key); UNIQUE(payment_id, tx_hash); at most one active verification attempt per payment except explicitly tracked replacement candidates. Normalize hex addresses/hashes before comparisons and storage. Use positive integer base units (`numeric(78,0)` with an explicit uint256 upper bound, or equivalent safe representation); reject excess decimal precision, zero, negatives and unsupported chains/tokens. Index payment listing by (merchant_id, created_at DESC, id DESC).

## 4. States

Payment: `AWAITING_PAYMENT -> PROCESSING -> CONFIRMED`.

- Rejected attempt returns an unconfirmed payment to AWAITING_PAYMENT.
- Technical uncertainty leaves payment PROCESSING with visible attempt status.
- CONFIRMED is terminal under the configured demo finality policy; disclose residual risk. No automatic refunds or post-confirmation reconciliation.

Attempt: `SUBMITTED -> VERIFYING -> PENDING_CHAIN | CONFIRMING | REJECTED | NEEDS_REVIEW`.

- PENDING_CHAIN and CONFIRMING schedule later checks without sleeping a worker.
- CONFIRMING -> VERIFIED atomically with settlement and payment confirmation.
- Receipt disappearance or changed block hash returns the attempt to PENDING_CHAIN for full re-verification.
- Temporary RPC failures retry with bounded exponential backoff and jitter. Budget exhaustion -> NEEDS_REVIEW, never business rejection.
- Dropped/unknown transactions are uncertain, not proven failures. Recovery requeues the same attempt. Replacement/cancellation requires a separately verified candidate and transaction relationship; defer wallet replacement automation until explicitly implemented.
- Every state mutation checks the expected version/state. Leases allow recovery after worker death; stale workers cannot overwrite newer outcomes.

## 5. HTTP contract

- `POST /v1/payments`, merchant session + Idempotency-Key; body amount string, token USDC, chainId. New -> 201; identical replay -> 200; conflicting replay -> 409.
- `GET /v1/payments?cursor=&limit=30`, merchant scoped; max 100, compound created_at/id cursor, nextCursor. Validate cursor input.
- `GET /v1/payments/:id`, merchant scoped.
- `GET /v1/checkout/:token`, limited public snapshot.
- Checkout challenge/verify endpoints create the payer session.
- `POST /v1/checkout/:token/transactions`, payer session + hash; persist attempt, payment state and outbox in one transaction, then 202. Same hash is idempotent; competing active attempt -> 409. Confirmed payment returns current settlement without accepting new work.
- Merchant and checkout SSE routes enforce their respective scope; emit payment ID, state and monotonically increasing version.
- Error envelope: stable code, safe message, requestId. Do not return provider credentials or raw internal exceptions.

## 6. Verification and delivery

Dispatcher claims pending outbox records, enqueues deterministic job IDs, then marks delivery. Crash between enqueue and acknowledgement may duplicate work. Durable pending attempt scans also recover work lost from Redis; outbox alone cannot recover a job lost after delivery acknowledgement. Queue IDs are an optimization, DB invariants provide correctness.

Worker selects the RPC from payment.chain_id, verifies configured RPC chain identity and reads transaction/receipt. Require successful canonical receipt, Transfer emitted by the configured token, exact recipient and amount, matching authenticated payer and block eligibility. Initial checkout supports a direct EOA token transfer only; enforce that scope consistently rather than accidentally accepting routers/batches.

Persist block hash/number/log index. Before settlement, re-read receipt and canonical block and apply a chain-specific policy (confirmations or supported safe/finalized tags). Recheck all evidence if inclusion changes. Under a DB transaction, lock/check payment and attempt version, insert unique settlement, confirm payment, increment version, write update outbox. Competing settlement conflicts must be handled safely.

Treat no receipt, rate limits, reverts, invalid logs and exhausted technical retries distinctly. Store structured reasons and allow protected operator recovery of uncertain attempts; never expose an unrestricted public retry loop.

## 7. Frontend and realtime

Visual implementation follows [UI design direction](ui-design.md): Scalar-inspired dark neutral surfaces, Inter, thin borders and white primary actions. This presentation contract does not alter payment state or authorization rules.

Show exact chain, token, receiver and amount before wallet approval. Check USDC and native gas balance for usability; server verification remains authoritative. Disable duplicate send while wallet interaction is active. Persist the returned hash locally before submission, retry submission safely after reconnect, and offer hash recovery from wallet history. If broadcast outcome is uncertain, tell the user to check wallet activity before another send.

Use TanStack Query for server data and local React state for UI. Cursor pagination loads bounded pages; 100k seeded DB rows never means rendering 100k DOM nodes. SSE is propagated worker -> outbox dispatcher -> Redis Pub/Sub -> API -> authorized subscriber. Apply only newer versions; refetch visible data on reconnect/focus and periodically while pending to recover missed events. Refetch affected visible queries when filter membership changes.

## 8. Acceptance and non-goals

Required tests: concurrent same-key creation; conflicting body; wrong sender/token/receiver/amount; stale transfer; duplicate settlement; same job twice; crash after DB commit before enqueue; crash after enqueue before delivery mark; lost queued work recovery; stale worker version; RPC budget exhaustion; pre-confirmation reorg; missed SSE recovery. E2E uses deterministic local/mock chain data; manual testnet smoke verifies real wallet integration. Mainnet smoke is optional and user-authorized.

No custom smart contracts, bridge, swap, refunds, webhook platform, Kafka, Kubernetes, full reconciliation or claims of legal compliance. Document data minimization, access boundaries and deployment limitations. Cloud deployment is a later explicit task.
