# Load test results

Measured 2026-11-16. Reproduce with `npm run loadtest` (~8 min).

Methodology, scenario definitions and caveats: **[README.md](README.md)**.
Read those caveats before quoting any number here — in particular, everything
runs over loopback on a single machine, so the ratios between scenarios are the
result and the absolute figures are not a capacity plan.

**Rig:** Node 26.13.1, PostGIS 18-3.7 in Docker, k6 2.4.0.
Client, server and database share one host. Pool size 10 unless stated.

The four scenarios, over identical data:

- **A** — read from Postgres on every request (the rejected design)
- **B** — prebuilt immutable artifact, full `200` every time
- **C** — the same artifact with `If-None-Match`, so repeat readers get `304`
- **D** — WebSocket fan-out (the rejected live-delivery design)

A and B return byte-identical payloads, verified with `cmp`.

---

## 1. Reader count — 250 features, 55 KB artifact

| Readers | Scenario | req/s | p95 ms | p99 ms | Transferred | DB connections |
|--:|---|--:|--:|--:|--:|--:|
| 50 | A. Postgres per request | 381 | 148.6 | 237.0 | 407 MB | **10** |
| 50 | B. Artifact, full 200 | 19,350 | 4.5 | 5.6 | 20,601 MB | **0** |
| 50 | C. Artifact + `If-None-Match` | **63,160** | **1.4** | 2.4 | **253 MB** | **0** |
| 200 | A. Postgres per request | 396 | 521.4 | 529.1 | 431 MB | **10** |
| 200 | B. Artifact, full 200 | 17,800 | 15.3 | 20.7 | 18,957 MB | **0** |
| 200 | C. Artifact + `If-None-Match` | **50,842** | **6.0** | 7.9 | **212 MB** | **0** |
| 500 | A. Postgres per request | 408 | 1,271.5 | 1,449.4 | 459 MB | **10** |
| 500 | B. Artifact, full 200 | 18,395 | 30.6 | 34.1 | 19,606 MB | **0** |
| 500 | C. Artifact + `If-None-Match` | **57,676** | **12.8** | 16.6 | **255 MB** | **0** |

Zero failed requests in every run.

**At 500 concurrent readers, C versus A: 141× the throughput and 99× lower
p95.** C also moves 77× less data than B for the same reader count, because a
`304` carries no body.

The mechanism is visible in the last column. Scenario A pins all ten pool
connections; B and C open **zero** — the read path genuinely never reaches the
database. CI asserts exactly this, so it cannot regress unnoticed.

Note A's shape: throughput is **flat** at 381 → 396 → 408 req/s while p95 scales
almost linearly, 149 → 521 → 1,272 ms. That is saturation. Ten times the readers
buys no extra work, it just queues.

## 2. Map size — 1000 features, 222 KB artifact, 200 readers

| Scenario | req/s | p95 ms | p99 ms | Transferred |
|---|--:|--:|--:|--:|
| A. Postgres per request | 114 | 1,788.4 | 1,825.3 | 524 MB |
| B. Artifact, full 200 | 4,267 | 52.5 | 82.1 | 18,117 MB |
| C. Artifact + `If-None-Match` | **64,930** | **4.5** | 6.5 | 300 MB |

Against the 250-feature run at the same reader count, a 4× bigger map costs:

| Scenario | req/s change | p95 change |
|---|---|---|
| A | 396 → 114 (**3.5× worse**) | 521 → 1,788 ms (**3.4× worse**) |
| B | 17,800 → 4,267 (**4.2× worse**) | 15.3 → 52.5 ms (**3.4× worse**) |
| C | 50,842 → 64,930 (**flat**) | 6.0 → 4.5 ms (**flat**) |

**This is the most useful result in the set.** Scenario C is *independent of map
size*, because a `304` never carries the body — the cost is a hash comparison
either way. A degrades with the row count it must query and decode; B degrades
with the bytes it must push. Only C is flat.

C's apparent *improvement* at the larger map is run-to-run variance, not a real
gain. Treat it as unchanged.

## 3. "Just raise the connection pool"

The obvious objection to scenario A, tested rather than assumed. 1000 features,
200 readers, pool 10 versus 50:

| Pool | req/s | p95 ms | p99 ms |
|--:|--:|--:|--:|
| 10 | 114 | 1,788.4 | 1,825.3 |
| 50 | 118 | 2,053.7 | **7,928.9** |

**Five times the connections bought 3.5% throughput and made latency worse** —
p95 up 15%, p99 up **4.3×**.

The pool was never the bottleneck. The work is: one query for the map, one for
its features, decode 1000 rows through the geometry codec, sort, hash, serialise.
More connections just let more of that contend for the same CPU, and the tail
pays for it. A connection pool cannot cache a result that was never cacheable.

## 4. WebSocket fan-out

| Readers | Connected | Failed | Frames delivered | Notify p95 ms |
|--:|--:|--:|--:|--:|
| 50 | 50 | 0 | 150 | 1.0 |
| 200 | 200 | 0 | 600 | 3.0 |
| 500 | 500 | 0 | 1,500 | 7.0 |

**Stated plainly: the WebSocket path is fast and it worked.** 500 concurrent
subscribers, zero connection failures, and a publish reaches every one of them
with a p95 of 7 ms. Polling cannot match that latency — a reader on a 10-second
lane learns about a change up to 10 seconds late.

So the case against it is **not** latency, and this repo should not pretend
otherwise. It is that the origin holds every reader for the entire session, so
capacity scales with concurrent readers rather than with the rate of change, and
**a CDN can absorb none of it**. Scenario C's 304s are cacheable, stateless, and
can be served by an edge the origin never hears from. That is an operational and
cost argument, not a performance one.

**What this rig does not prove:** server RSS across the WebSocket runs
(180 / 112 / 172 MB at 50 / 200 / 500 connections) was dominated by GC noise, so
these measurements do **not** isolate a per-connection memory cost. 500
connections on one box is far below where fan-out actually hurts. The structural
argument above stands on its own; the memory claim would need a much larger test
and is not made here.

---

## What the numbers change

Nothing — they confirm a decision already made on
[researched evidence](../docs/architecture.md) about how AP, the BBC and
Al Jazeera actually ship live maps. The value is that the claim is now falsifiable
and wired into CI: serving the artifact path must open zero database
connections, or the build fails.

The one genuine surprise was §3. "Raise the pool" is the reflex fix for a
saturated database read path, and here it degraded the tail by 4.3×.
