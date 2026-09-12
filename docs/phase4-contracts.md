# Phase 4 integration contract

Existing checkout, merchant auth, state and token rotation contracts remain unchanged.

- GET /v1/payments: existing compound cursor and limit (default 30, max 100); optional status AWAITING_PAYMENT | PROCESSING | CONFIRMED, invalid values 400. Cursor is exclusive createdAt/id descending. New inserts cannot shift subsequent cursor pages.
- GET /v1/payments/:id: existing fields plus payerAddress (nullable), attempt (nullable: id, txHash, status, code), settlement (nullable: txHash, blockNumber, blockHash, logIndex). All merchant scoped.
- GET /v1/merchant/events: cookie-authenticated SSE; event `payment`, data PaymentUpdateEvent {paymentId,status,version}. No merchant selector. Resolve payment ownership in PostgreSQL, validate active session before sending; close revoked/expired connections. Event `ready` on subscribe/resubscribe signals mandatory HTTP refetch. Heartbeat comments keep transport alive. Cache-Control includes no-transform to prevent proxy compression buffering; client retries even HTTP failures with backoff capped at 30 seconds. Redis channel chainpay:payments. No replay guarantee; Last-Event-ID is not a durable cursor.
- Create writes PAYMENT_UPDATED outbox atomically with insertion; idempotent replays create no new event. Existing worker events retain their payload; API checks authoritative ownership.
- UI uses events as invalidation hints, ignores versions <= known version; newer events invalidate all visible payment lists (including filter membership) and matching detail. Refetch on initial stream ready/reconnect/focus/online, including when no visible pending rows. Bounded foreground polling for pending rows: 5 seconds, 60 requests, manual refresh renews budget. Never splice an event into a cursor page.
- Browser create retains idempotency key across uncertain retries, then calls existing POST /payments/:id/checkout-token. Keep returned URL in memory; never silently rotate an existing link. Explicit issuance follows existing unbound-only policy.
- Fixture and performance data live only in random isolated schemas and are removed afterward; never seed synthetic rows into the configured application schema.
