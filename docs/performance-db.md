# Phase 4 synthetic pagination measurement

Measured 2026-09-11T08:44:43.873Z on local PostgreSQL.

PostgreSQL 16.15 on aarch64-unknown-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit

Exactly 100000 synthetic payments; one disabled-login merchant; timestamps deliberately tied in groups of ten; status evenly distributed. Fresh random schema, forced search_path, no real application rows read/written. Schema dropped in finally. No network/HTTP latency included. Single EXPLAIN run per query after ANALYZE; warm local cache, not a production benchmark or throughput claim.

## First page (31 rows for limit 30)

```sql
SELECT * FROM payments WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 31
```

```text
Limit  (cost=0.42..5.28 rows=31 width=270) (actual time=0.008..0.013 rows=31 loops=1)
  Buffers: shared hit=11
  ->  Index Scan using payment_merchant_listing on payments  (cost=0.42..15700.29 rows=100000 width=270) (actual time=0.007..0.011 rows=31 loops=1)
        Index Cond: (merchant_id = '2fc42e09-363d-4bba-bcc8-5d2552e39db4'::uuid)
        Buffers: shared hit=11
Planning:
  Buffers: shared hit=33
Planning Time: 0.130 ms
Execution Time: 0.022 ms
```

## Deep compound cursor (after row 90000)

```sql
SELECT * FROM payments WHERE merchant_id=$1 AND (created_at,id)<($2::timestamptz,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 31
```

```text
Limit  (cost=0.42..23.89 rows=31 width=270) (actual time=0.007..0.012 rows=31 loops=1)
  Buffers: shared hit=11
  ->  Index Scan using payment_merchant_listing on payments  (cost=0.42..7668.31 rows=10129 width=270) (actual time=0.006..0.010 rows=31 loops=1)
        Index Cond: ((merchant_id = '2fc42e09-363d-4bba-bcc8-5d2552e39db4'::uuid) AND (ROW(created_at, id) < ROW('2026-01-01 00:00:01+00'::timestamp with time zone, '4e210bee-984f-4d33-be2f-e1daae982a22'::uuid)))
        Buffers: shared hit=11
Planning Time: 0.030 ms
Execution Time: 0.034 ms
```

## Status filter + deep cursor

```sql
SELECT * FROM payments WHERE merchant_id=$1 AND status=$4 AND (created_at,id)<($2::timestamptz,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 31
```

```text
Limit  (cost=0.42..71.42 rows=31 width=270) (actual time=0.007..0.022 rows=31 loops=1)
  Buffers: shared hit=24
  ->  Index Scan using payment_merchant_listing on payments  (cost=0.42..7693.63 rows=3359 width=270) (actual time=0.007..0.020 rows=31 loops=1)
        Index Cond: ((merchant_id = '2fc42e09-363d-4bba-bcc8-5d2552e39db4'::uuid) AND (ROW(created_at, id) < ROW('2026-01-01 00:00:01+00'::timestamp with time zone, '4e210bee-984f-4d33-be2f-e1daae982a22'::uuid)))
        Filter: (status = 'PROCESSING'::text)
        Rows Removed by Filter: 65
        Buffers: shared hit=24
Planning Time: 0.025 ms
Execution Time: 0.028 ms
```

## OFFSET comparison (measurement only; API never uses OFFSET)

```sql
SELECT * FROM payments WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC OFFSET 90000 LIMIT 31
```

```text
Limit  (cost=14130.31..14135.17 rows=31 width=270) (actual time=11.141..11.145 rows=31 loops=1)
  Buffers: shared hit=16319
  ->  Index Scan using payment_merchant_listing on payments  (cost=0.42..15700.29 rows=100000 width=270) (actual time=0.012..8.860 rows=90031 loops=1)
        Index Cond: (merchant_id = '2fc42e09-363d-4bba-bcc8-5d2552e39db4'::uuid)
        Buffers: shared hit=16319
Planning Time: 0.020 ms
Execution Time: 11.155 ms
```
