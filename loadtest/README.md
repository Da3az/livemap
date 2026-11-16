# Load tests

This repository makes one load-bearing architectural claim:

> The read path never touches the database. Editors write to Postgres; readers
> fetch immutable versioned artifacts with ETags. No WebSocket fan-out.

That claim is cheap to assert and easy to get wrong, so it is measured here
rather than argued. Published numbers: **[RESULTS.md](../loadtest/RESULTS.md)**.

## What is compared

The same map is served four ways, over identical data, returning byte-identical
payloads where applicable:

| | Scenario | What it represents |
|---|---|---|
| **A** | `GET /bench/db/:id` | Read from Postgres on every request: query the map, query its features, decode, build the version, serialise. The design this project rejected. |
| **B** | `GET /bench/artifact/:id` | The prebuilt immutable artifact, full `200` every time. What a cold CDN edge does. |
| **C** | `GET /bench/artifact/:id` + `If-None-Match` | The same artifact with conditional requests, so a returning reader gets `304`. What a real polling reader does. |
| **D** | `WS /live?map=:id` | WebSocket fan-out: every reader holds a connection and the server pushes on publish. The rejected live-delivery design. |

A and B are verified to return the same bytes, so the comparison is not
smuggling in a payload-size difference:

```
$ curl -s .../bench/db/$MAP     -o a.json
$ curl -s .../bench/artifact/$MAP -o b.json
$ cmp a.json b.json && echo identical
```

## Three axes

1. **Reader count** — 50, 200, 500 concurrent readers.
2. **Map size** — 250 features (~55 KB artifact) vs 1000 (~222 KB).
3. **Connection pool** — 10 vs 50. This one exists to test the obvious
   objection, *"just raise the pool"*, instead of assuming the answer.

## Running it

Everything, from a cold start, about 8 minutes:

```bash
cp .env.example .env
npm run loadtest          # == bash loadtest/sweep-all.sh
```

It brings up Postgres, migrates, seeds, starts the bench server, runs every
combination, and regenerates the report. Individual pieces:

```bash
npm run db:up && npm run migrate
npm run bench:seed 250            # seed N features
npm run bench:serve               # prints the mapId on stdout
DURATION=20s VUS_LIST="50 500" bash loadtest/run.sh
node loadtest/report.mjs loadtest/results
```

k6 runs from its official container, so nothing is installed on the host:

```bash
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -v "$PWD/loadtest:/scripts:ro" -v "$PWD/loadtest/results:/results" \
  -e BASE_URL=http://127.0.0.1:8801 -e MAP_ID=... -e MODE=conditional \
  -e VUS=200 -e DURATION=20s -e SUMMARY_OUT=/results/x.json \
  grafana/k6:2.4.0 run /scripts/read-path.js
```

Prefer it native? `grafana/k6` publishes a static binary per release; the
scripts are plain k6 and care about neither. The WebSocket script imports
`k6/websockets` (the stable module — `k6/experimental/websockets` was removed
in k6 v2), so it needs k6 ≥ 1.6.

## Reading the output honestly

A few caveats that matter more than the headline ratios:

- **Everything runs over loopback on one machine.** Client, server and database
  share a CPU. Scenario B saturates loopback bandwidth at roughly 1 GB/s, so
  its ceiling here is the test rig, not the design. In production that path is
  served by a CDN and never reaches the origin at all.
- **The absolute numbers are not a capacity plan.** The ratios between
  scenarios on identical hardware are the result; a p95 measured on a developer
  laptop does not transfer to a VPS.
- **Scenario A is not a strawman.** It uses the same pooled, RLS-scoped
  `PostgresRepo` the product uses, with indexes in place, on a small map. It is
  slow because the work is genuinely per-request, not because it is written
  badly.
- **Nor is D.** The hub serialises each payload once per broadcast rather than
  per subscriber, reaps dead sockets by heartbeat, and drops subscribers whose
  send buffer runs away. Its cost is structural: the origin holds every reader
  for the whole session and a CDN can absorb none of it.
- **CI runs a 5-second smoke of these scripts**, not the sweep. Shared runners
  are too noisy to compare latency on. CI does assert the architectural
  invariant directly: after serving the artifact path, the Postgres pool must
  still show zero connections.
