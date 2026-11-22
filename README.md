# livemap

A multi-tenant product for authoring **interactive live-event maps** — the kind
a newsroom publishes during an unfolding story. Colour regions, drop event
icons, draw movement arrows and front lines, annotate with leader lines, play
them on a timeline, publish an immutable version, embed it in an article.

Built Arabic-first: every text-bearing type carries an explicit direction, and
the RTL handling is engineering rather than a stylesheet afterthought.

```bash
npm install                        # Node 24
npm run demo                       # the product on http://127.0.0.1:8800/, no database
npm run db:up && npm run migrate   # postgis on 127.0.0.1:5460
npm run serve                      # the real server, serving the built front end
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
| **One ordered WebGL pass** — every feature, its text included, drawn in the author's order across kinds, inside MapLibre; panning is a uniform update; text shaped by the browser in the interface typefaces | [`web/src/render/`](web/src/render/) |
| **Everything view-dependent recomputed per view** — arrowheads, tapers, front-line teeth and dashes sized in screen pixels, so they hold at every zoom | [`web/src/render/shapes.ts`](web/src/render/shapes.ts) |
| **Label de-confliction** — labels move out of each other's way and from under the map's furniture, or are left out rather than overlapping | [`web/src/render/labels.ts`](web/src/render/labels.ts) |
| **Content-hashed versions** — the hash is over the artifact readers receive, so republishing what they already have answers `unchanged` and keeps their caches warm | [`core/src/version.ts`](packages/core/src/version.ts) |
| **Publish ordering under partial failure** — artifact first, pointer last and under the per-map lock, so neither a crash nor a slower concurrent publish can point readers backwards | [`api/src/publish.ts`](packages/api/src/publish.ts) |
| **Row-level security that the app cannot switch off** — app role is not the table owner, `FORCE ROW LEVEL SECURITY` on every tenant table, `set_config(..., local => true)` so a pooled connection cannot leak scope | [`migrations/`](migrations/), [`api/src/postgres.ts`](packages/api/src/postgres.ts) |
| **Optimistic concurrency** — the revision guard and the bump are one statement; settings save as a patch, so "keep mine" overwrites only what you changed | [`api/src/postgres.ts`](packages/api/src/postgres.ts), [`core/src/settings.ts`](packages/core/src/settings.ts) |
| **A sandboxed embed that updates in place** — polls a tiny pointer with ETags, pauses in hidden tabs, backs off when the host fails; validates every resize message it is sent | [`web/src/screens/embed/`](web/src/screens/embed/), [`web/src/embed/`](web/src/embed/) |

### RTL is a correctness problem, not a stylesheet

`name:ar` is present on roughly 12% of Riyadh's features while the plain `name`
is Arabic on about 99% of its roads, so keying labels on `name:ar` alone
produces a mostly-unlabelled map. Resolution goes
`name:<lang>` → `name:nonlatin` → `name`.

Feature text is shaped by the browser, not by MapLibre's glyph atlas, so Arabic
joins and bidirectional text are the browser's own. (MapLibre draws a text halo
per-glyph when `text-halo-width <= 1`, which cuts the joins of connected scripts
— [maplibre-gl-js#8949](https://github.com/maplibre/maplibre-gl-js/issues/8949);
the editor's interface is mirrored for right-to-left maps from logical CSS
properties alone.)

---

## Layout

```
web/                the front end: sign-in, workspace, editor, versions, the embed.
                    React, Vite, MapLibre 6.19.
packages/core       the one domain model, API shapes, settings patch, publish builder
                    and hash, order keys, templates, gazetteer. Zero dependencies.
packages/api        routes, schemas, publish pipeline, PostgresRepo, authz, auth,
                    guests, limits, place search, R2 store.

migrations/         0001–0004 — schema, RLS, roles, document model, version origin.
scripts/            migrate.mjs, serve.mjs (production entrypoint), dev-workspace.mjs,
                    reap-guests.mjs, mint-token.mjs.
bench/              load-test harness: seeder + a server exposing 3 read paths.
loadtest/           k6 scripts, sweep runner, published results.
demo/               the whole product on one port, no database.
```

The front end and the server compile against one model in `core`, and build the
published artifact with the same function, so the editor's preview cannot
disagree with a publish. Persistence sits behind a `MapRepo` port, implemented in
memory for the demo and by Postgres for real.

```
web (editor) ──► api ──► MapRepo ──► Postgres                       (write path)
                  │
                  └──► ArtifactStore ──► CDN ──► web (embed)           (read path)
```

---

## Running it

```bash
cp .env.example .env

npm run build            # core, api, and web/dist
npm run demo             # http://127.0.0.1:8800/ — the product, no database
node demo/app-check.mjs  # drives the running demo headless and leaves screenshots

npm run db:up            # postgis 18-3.7 on 127.0.0.1:5460
npm run migrate
npm run migrate:status
npm run serve            # needs APP_DATABASE_URL + SESSION_SECRET
npm run dev-workspace    # local only: a workspace with every role, and their tokens
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

**Built and run end to end:** the front end against the real API — sign-in
(member tokens, and guest workspaces through Cloudflare Turnstile), the
workspace, the editor with saving, conflicts and forced saves, publishing,
versions and rollback, and the embed in a sandboxed iframe on another origin
picking up a new version by polling. Postgres persistence with row-level
security, HMAC session auth, rate limiting, readiness probes, per-tenant quotas,
request validation with a generated API reference, and the load tests above.

**Built, not yet run against the real thing:** the R2 artifact store (no bucket
exists yet). Place search answers from a built-in list of about 270 places until
a geocoder is chosen.

**Tests:** the API's test suite was written against the previous contract and
has not been brought forward; essential tests are to be written once the work
settles.

**Not built:**

- **An identity provider.** `TokenAuth` is real and tested, but a token comes
  from guest signup or is minted by a script. No accounts, no OIDC, no password
  storage. A half-written auth system is worse than an honest seam.
- **A scheduler.** Expired guest workspaces are removed by
  `scripts/reap-guests.mjs`, which something outside the server has to run.
- Billing. A Content-Security-Policy beyond framing rules.
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
