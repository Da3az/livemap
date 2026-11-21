# livemap

A multi-tenant backend and rendering engine for **interactive live-event maps** —
the kind a newsroom publishes during an unfolding story. Colour regions, drop
event icons, draw movement arrows and front lines, annotate with leader lines,
publish an immutable version, embed it.

Built Arabic-first: every text-bearing type carries an explicit direction, and
the RTL handling is engineering rather than a stylesheet afterthought.

```bash
npm install
npm run db:up && npm run migrate   # postgis on 127.0.0.1:5460
npm test                           # 249 tests
npm run loadtest                   # reproduces the numbers below (~8 min)
```

---

## The claim this repo is built to prove

> **The read path never touches the database.** Editors write to Postgres.
> Readers fetch immutable, content-hashed artifacts with ETags. There is no
> WebSocket fan-out, by design.

That is easy to assert and easy to get wrong, so it is measured rather than
argued. The same map is served four ways over identical data — byte-identical
payloads where applicable — and compared across reader count, map size and
connection-pool size.

**[→ Full results and methodology](loadtest/RESULTS.md)**

**500 concurrent readers, 250-feature map, identical payloads:**

| Scenario | req/s | p95 | Data moved | DB connections |
|---|--:|--:|--:|--:|
| Read from Postgres per request | 408 | 1,272 ms | 459 MB | **10** |
| Immutable artifact, full `200` | 18,395 | 31 ms | 19,606 MB | **0** |
| Artifact + `If-None-Match` → `304` | **57,676** | **13 ms** | **255 MB** | **0** |

141× the throughput and 99× lower p95, moving 77× less data — and the artifact
paths open **zero** database connections. CI asserts that last column, so it
cannot regress quietly.

Two findings worth more than the ratios:

- **The conditional path is independent of map size.** Quadruple the map to 1000
  features and the database path degrades 3.5× while `304`s stay flat — a `304`
  never carries the body, so the cost is a hash comparison either way.
- **"Just raise the connection pool" does not work.** 5× the connections bought
  3.5% throughput and made the tail *worse*: p99 went from 1,825 ms to 7,929 ms.
  The pool was never the bottleneck; the per-request work was.

And the honest counterpoint: **the WebSocket fan-out was fast** — 500
subscribers, zero failures, 7 ms p95 notification. Polling cannot match that
latency. The case against it is that the origin holds every reader for the whole
session and a CDN can absorb none of it, which is an operational argument, not a
performance one.

---

## Why it is shaped this way

Thirteen decisions are recorded with their evidence. The ones that shaped the
system most:

**Feature-per-row, never a blob per map.** uMap has a documented
object-count performance issue and a user report of lost maps; Placemark stores
one blob per map with no size guard and re-sorts the whole collection on every
edit. Both failure modes come from the same choice. Here a reorder is a
single-row write against a fractional index.

**Polling, not sockets.** Measured, not assumed: AP polls at 10s/120s with
ETags and pauses on hidden tabs, the BBC serves `max-age=5`, and Al Jazeera's
"Live Tracker" is a 24-hour cache over static JPEGs. Nobody at that scale holds
a socket per reader. The load tests show what it would cost if we did.

**Published artifacts are immutable and live outside Postgres.** The database
holds editor state and a version ledger; the bytes readers fetch are versioned
objects behind a CDN. Rollback publishes a new version whose body is an old
one, so the ledger stays append-only and the audit trail survives.

**Tenant isolation lives in the database.** Every tenant-scoped table carries
`tenant_id` and is covered by row-level security keyed on a per-request
`app.tenant_id`. Application bugs are inevitable; a missing `WHERE tenant_id`
should return nothing rather than another newsroom's embargoed map.

**No AGPL/GPL/SSPL anywhere in the shipped tree.** This ruled out uMap and
Mapforge, the closest open-source lookalikes.

---

## What is actually interesting in here

| | Where |
|---|---|
| **Curved arrows** — Catmull-Rom through stored control points, arrowhead tangent to the *smoothed* curve, shaft trimmed so the line does not show through the head, optional mid-shaft chevrons | [`core/src/arrow.ts`](packages/core/src/arrow.ts) |
| **Front-line symbology** — toothed, ticked and semicircle lines with a facing side, generated as real geometry because no permissively-licensed icon set contains the symbol | [`core/src/frontline.ts`](packages/core/src/frontline.ts) |
| **Label de-confliction** — iterative relaxation with a deviation budget and priority-based suppression; hides what it cannot place rather than overlapping text | [`core/src/collision.ts`](packages/core/src/collision.ts) |
| **Leader lines that survive zoom** — label offsets stored in *screen pixels*, not degrees | [`core/src/leader.ts`](packages/core/src/leader.ts) |
| **Content-hashed versions** — the hash excludes `publishedAt`/`publishedBy`, so republishing an unchanged map returns the same ETag and keeps reader caches warm | [`core/src/version.ts`](packages/core/src/version.ts) |
| **Publish ordering under partial failure** — pointer written last, always; a version row with no object is invisible and reconcilable, a pointer naming a missing object is a broken map | [`api/src/publish.ts`](packages/api/src/publish.ts) |
| **Row-level security that the app cannot switch off** — app role is not the table owner, `FORCE ROW LEVEL SECURITY` on every tenant table, `set_config(..., local => true)` so a pooled connection cannot leak scope | [`migrations/0001_init.sql`](migrations/0001_init.sql), [`api/src/postgres.ts`](packages/api/src/postgres.ts) |
| **Optimistic concurrency** — the revision guard and the bump are one statement, so a stale writer loses instead of clobbering an edit it never saw | [`api/src/postgres.ts`](packages/api/src/postgres.ts) |
| **Arabic/RTL** — native MapLibre shaping, `coalesce(name:ar, name:nonlatin, name)` label resolution, and a halo-width floor that dodges a MapLibre bug which cuts Arabic glyph joins | [`core/src/types.ts`](packages/core/src/types.ts) |
| **Headless visual verification** — renders a realistic scene across five views and asserts both structure and pixels | [`spikes/`](spikes/) |

### RTL is a correctness problem, not a stylesheet

`name:ar` is present on roughly 12% of Riyadh's features while the plain `name`
is Arabic on about 99% of its roads, so keying labels on `name:ar` alone
produces a mostly-unlabelled map. Resolution goes
`name:<lang>` → `name:nonlatin` → `name`.

MapLibre draws a text halo per-glyph when `text-halo-width <= 1`, which cuts the
joins of connected scripts — Arabic, Persian, Urdu
([maplibre-gl-js#8949](https://github.com/maplibre/maplibre-gl-js/issues/8949)).
`normaliseHaloWidth()` floors it at 1.01 and there is a test pinning it.

---

## Layout

```
packages/core       domain model + annotation geometry. ZERO dependencies. 129 tests.
packages/renderer   MapLibre overlay, shared unchanged by editor and viewer. 26 tests.
packages/api        routes, publish pipeline, PostgresRepo, auth, WS hub. 74 tests.
packages/viewer     embeddable read-only viewer + ETag polling. 20 tests.
packages/editor     the map editor: tools, inspector, undo, save, publish.
packages/app        the application shell: sign-in, workspace, versions, embed.

migrations/         0001_init.sql, 0002_role_aware_rls.sql — schema, RLS, roles.
scripts/            migrate.mjs, serve.mjs (production entrypoint),
                    reap-guests.mjs, mint-token.mjs.
bench/              load-test harness: seeder + a server exposing 3 read paths.
loadtest/           k6 scripts, sweep runner, published results.
spikes/             headless visual verification + screenshots.
demo/               the whole application on one port, no database.
```

`core` has zero dependencies and runs in plain Node, which is why the geometry
is unit-testable without a browser or a GPU. `renderer` is consumed unchanged by
both the editor and the viewer. Persistence sits behind a `MapRepo` port, so the
entire pipeline is exercised against an in-memory implementation in tests and
against Postgres in integration tests — same interface.

```
editor ──┐
         ├──► renderer ──► MapLibre
viewer ──┘

app ──► editor ──► api ──► MapRepo ──► Postgres          (write path)
                            │
                            └──► ArtifactStore ──► CDN ──► viewer   (read path)
```

---

## Running it

```bash
cp .env.example .env

npm run build
npm test                 # 249 tests; DB integration tests skip without DATABASE_URL
npm run spike            # headless render + 18 assertions → spikes/shots/
npm run demo             # http://127.0.0.1:8800/ — the application, no database

npm run db:up            # postgis 18-3.7 on 127.0.0.1:5460
npm run migrate
npm run migrate:status
npm run serve            # needs APP_DATABASE_URL + SESSION_SECRET
npm run mint-token -- <tenant-slug> <user-email>   # a token to sign in with
npm run reap-guests -- --dry-run                   # expired guest workspaces
```

`npm run serve` serves the application at `/`, the JSON API under `/api/v1` and
its generated reference at `/docs`. Guest signup is off until `GUEST_SIGNUP=on`;
`.env.example` documents the rate limits, quotas and bot check that go with it.

Requires Node ≥ 18 and Docker for the database. The toolchain is **esbuild, not
Vite** — Vite 8 needs Node ≥ 20.19 and this was built against 20.18.

Build ESM, not IIFE: MapLibre 6 resolves its worker through `import.meta.url`,
and `maplibre-gl-worker.mjs` must sit beside the output bundle. Miss it and the
map renders nothing, with a 404 as the only clue.

---

## Status, honestly

**Built and tested:** the annotation engine, the renderer, the publish pipeline,
the HTTP surface, the embeddable viewer, Postgres persistence with row-level
security, HMAC session auth, rate limiting and readiness probes, and the load
tests above.

**Built:** the application around them — guest workspaces, map lifecycle,
per-tenant quotas, request validation with a generated API reference, and an
R2 artifact store. The R2 store has not yet been run against a real bucket.

**Not built:**

- **An identity provider.** `TokenAuth` is real and tested, but a token comes
  from guest signup or is minted by a script. No accounts, no OIDC, no password
  storage. A half-written auth system is worse than an honest seam.
- **A scheduler.** Expired guest workspaces are removed by
  `scripts/reap-guests.mjs`, which something outside the server has to run.
- **Vertex editing.** You can draw, restyle, reorder and delete; reshaping an
  existing shape means redrawing it.
- Billing. Icon de-confliction at low zoom. Labels avoiding geometry.
- `publish_requests` and `feeds` exist in the schema but nothing reads them yet.

`docs/architecture.md` §6 lists every known gap.

## Docs

| | |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | How it fits together, and §6: every known gap |
| [`docs/data-model.md`](docs/data-model.md) | Schema design and rationale |
| [`loadtest/README.md`](loadtest/README.md) | Load-test methodology and caveats |
| [`loadtest/RESULTS.md`](loadtest/RESULTS.md) | Measured numbers |

## Licence

MIT — see [LICENSE](LICENSE).
