# Phase 2 contracts

The Phase 1 domain and merchant session remain the baseline. Migration `0002_verification.sql` only adds tables and indexes; the migration runner discovers ordered, checksummed SQL files. SQL constraints are authoritative; Drizzle maps their columns.

## Ownership and interfaces

The integrator owns migrations, database mappings, shared types, package manifests/lockfile, settlement and cross-module integration. Authentication owns checkout access; processing owns submission, dispatch and recovery; blockchain owns the RPC adapter and deterministic fixtures.

`Verifier.verify(VerificationInput)` returns `VERIFIED` or `CONFIRMING` with block number/hash/log index, `PENDING_CHAIN` or `REJECTED` with a structured reason, or `RETRY` for technical uncertainty. Amounts and block numbers cross this boundary as integer decimal strings. The input includes immutable payment terms and the authenticated binding's start block. `BindingChainReader.getStartBlock(chainId, payerAddress)` verifies chain identity and EOA eligibility before observing the start block.

## State and persistence rules

Submission locks the payment, requires the scoped payer session, inserts an immutable hash attempt and verification outbox intent, and changes payment to PROCESSING in one transaction. A unique partial index allows one nonterminal attempt; NEEDS_REVIEW continues to occupy that slot. Duplicate submissions return the existing attempt. Rejected attempts never consume settlement uniqueness.

A worker claims a due attempt with a lease and incremented version. Every result is fenced by the claimed version and unexpired lease. PENDING_CHAIN and CONFIRMING are scheduled through persisted next_check_at. Temporary failures use bounded retry backoff; exhaustion becomes NEEDS_REVIEW with payment still PROCESSING. Protected merchant recovery resumes that same attempt. Unknown/dropped transactions never justify another transfer.

Settlement locks payment then attempt and checks version and live lease. It inserts the globally unique chain/hash settlement, records evidence, confirms payment, increments version and writes PAYMENT_UPDATED in one transaction. A competing global transaction claim becomes NEEDS_REVIEW. Confirmation releases the allocation key. CONFIRMED is terminal under the configured confirmation policy.

Outbox delivery uses leased claims and deterministic job identifiers. Enqueue before acknowledgement may duplicate delivery. Independently, due-attempt scans recreate queue work even after delivered outbox rows or Redis job loss. Database state remains authoritative.

## Access and demo limits

Merchant-authorized token issuance makes Phase 1 payments usable without changing create-payment idempotency. Tokens may rotate only before binding; pending challenges must be invalidated. Signed challenges bind origin/domain, payment, chain, payer and nonce and are consumed atomically. Checkout cookies are payment scoped. Exact Origin checks protect writes.

Binding does not expire with the session and cannot switch payer. Reauthentication by the same payer preserves the original start block. The allocation key serializes merchant/payer/chain/token/receiver/amount across unconfirmed payments; even an expired session cannot silently release a potentially paid claim. Only settlement releases it in this phase. Abandoned allocations require future explicit reconciliation tooling.

Only direct EOA ERC-20 transfer calls are supported. Routers, batches, smart accounts and wallet replacement automation are deferred. Direct transfers carry no invoice reference, so allocation constraints reduce ambiguity without proving commercial intent. No post-confirmation reorg reconciliation, frontend, SSE subscriptions, deployment or live money test belongs to this phase.
