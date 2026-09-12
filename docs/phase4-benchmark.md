# Phase 4 synthetic pagination measurement

Measured 2026-09-10T13:26:41.996Z on local PostgreSQL.

PostgreSQL 16.15 on aarch64-unknown-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit

Exactly 100000 synthetic payments; one disabled-login merchant; timestamps deliberately tied in groups of ten; status evenly distributed. Fresh random schema, forced search_path, no real application rows read/written. Schema dropped in finally. No network/HTTP latency included. Single EXPLAIN run per query after ANALYZE; warm local cache, not a production benchmark or throughput claim.

## First page (31 rows for limit 30)

```sql
SELECT * FROM payments WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 31
```

```text
Limit  (cost=0.42..5.28 rows=31 width=270) (actual time=0.010..0.027 rows=31 loops=1)
  Buffers: shared hit=13
  ->  Index Scan using payment_merchant_listing on payments  (cost=0.42..15700.29 rows=100000 width=270) (actual time=0.009..0.024 rows=31 loops=1)
        Index Cond: (merchant_id = '04cea966-b255-43e1-8384-3136b50cf744'::uuid)
        Buffers: shared hit=13
Planning:
  Buffers: shared hit=33
Planning Time: 0.119 ms
Execution Time: 0.041 ms
```

## Deep compound cursor (after row 90000)

```sql
SELECT * FROM payments WHERE merchant_id=$1 AND (created_at,id)<($2::timestamptz,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 31
```

```text
Limit  (cost=0.42..23.45 rows=31 width=270) (actual time=0.007..0.012 rows=31 loops=1)
  Buffers: shared hit=11
  ->  Index Scan using payment_merchant_listing on payments  (cost=0.42..7689.75 rows=10348 width=270) (actual time=0.007..0.010 rows=31 loops=1)
        Index Cond: ((merchant_id = '04cea966-b255-43e1-8384-3136b50cf744'::uuid) AND (ROW(created_at, id) < ROW('2026-01-01 00:00:01+00'::timestamp with time zone, '2f5da274-8488-4de1-ab67-4aa0835ea8cc'::uuid)))
        Buffers: shared hit=11
Planning Time: 0.035 ms
Execution Time: 0.036 ms
```

## Status filter + deep cursor

```sql
SELECT * FROM payments WHERE merchant_id=$1 AND status=$4 AND (created_at,id)<($2::timestamptz,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 31
```

```text
Limit  (cost=0.42..69.78 rows=31 width=270) (actual time=0.008..0.023 rows=31 loops=1)
  Buffers: shared hit=18
  ->  Index Scan using payment_merchant_listing on payments  (cost=0.42..7715.62 rows=3448 width=270) (actual time=0.008..0.021 rows=31 loops=1)
        Index Cond: ((merchant_id = '04cea966-b255-43e1-8384-3136b50cf744'::uuid) AND (ROW(created_at, id) < ROW('2026-01-01 00:00:01+00'::timestamp with time zone, '2f5da274-8488-4de1-ab67-4aa0835ea8cc'::uuid)))
        Filter: (status = 'PROCESSING'::text)
        Rows Removed by Filter: 59
        Buffers: shared hit=18
Planning Time: 0.031 ms
Execution Time: 0.030 ms
```

## OFFSET comparison (measurement only; API never uses OFFSET)

```sql
SELECT * FROM payments WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC OFFSET 90000 LIMIT 31
```

```text
Limit  (cost=14130.31..14135.17 rows=31 width=270) (actual time=11.243..11.247 rows=31 loops=1)
  Buffers: shared hit=16407
  ->  Index Scan using payment_merchant_listing on payments  (cost=0.42..15700.29 rows=100000 width=270) (actual time=0.014..8.846 rows=90031 loops=1)
        Index Cond: (merchant_id = '04cea966-b255-43e1-8384-3136b50cf744'::uuid)
        Buffers: shared hit=16407
Planning Time: 0.026 ms
Execution Time: 11.259 ms
```
