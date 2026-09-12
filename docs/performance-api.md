# Local API performance — synthetic dataset

Measured 2026-09-11T08:44:32.319Z. Node v22.23.2; darwin arm64; Apple M2; 8 logical CPUs.

100,000 isolated synthetic payments: 50% Base Sepolia USDC, 50% native BERA; 1% PROCESSING, 99% CONFIRMED; timestamps tied in groups of ten. Synthetic statuses are list fixtures, not verified settlements. Fresh schema; disabled merchant password; ephemeral session still exercises real authorization queries. No worker/RPC or real payment rows involved.

HTTP loopback directly to a separate Nest app on an ephemeral port. Load generator and app share this Node process/event loop; PostgreSQL runs in local Docker shared with the development app. Warm cache, 30 warm-up requests per scenario. Closed-loop bounded concurrency, 500 requests per row. Latency includes response JSON parsing. No TLS, Next proxy, browser rendering, SSE, writes or sustained-production capacity claim. Error responses/timeouts excluded from latency percentiles and counted separately.

| Scenario                     | Concurrency | Requests | Errors | Seconds | Requests/s | p50 ms | p95 ms | p99 ms |
| ---------------------------- | ----------: | -------: | -----: | ------: | ---------: | -----: | -----: | -----: |
| First page                   |           1 |      500 |      0 |    1.56 |      321.0 |   2.90 |   4.17 |   6.12 |
| First page                   |          10 |      500 |      0 |    0.40 |     1251.6 |   7.16 |  11.41 |  26.91 |
| First page                   |          25 |      500 |      0 |    0.37 |     1348.4 |  17.02 |  27.36 |  50.65 |
| Deep cursor, after row 90000 |           1 |      500 |      0 |    1.90 |      263.3 |   3.61 |   5.79 |   6.68 |
| Deep cursor, after row 90000 |          10 |      500 |      0 |    0.69 |      725.8 |  11.36 |  27.98 |  55.81 |
| Deep cursor, after row 90000 |          25 |      500 |      0 |    0.49 |     1018.9 |  23.62 |  34.58 |  41.52 |
| Rare PROCESSING filter (1%)  |           1 |      500 |      0 |    2.24 |      223.4 |   4.32 |   6.52 |   8.19 |
| Rare PROCESSING filter (1%)  |          10 |      500 |      0 |    0.36 |     1402.1 |   6.51 |  11.33 |  16.94 |
| Rare PROCESSING filter (1%)  |          25 |      500 |      0 |    0.32 |     1579.5 |  15.20 |  22.65 |  27.55 |

Temporary schema and API were removed after the run.
