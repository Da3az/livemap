# livemap — working notes for Claude

Read this before touching anything. It exists so a fresh session is oriented
without needing the original chat transcript.

## What this is

A **product**, not a library: the engine, backend, viewer and editor of a
multi-tenant SaaS for authoring interactive live-event maps (colour regions,
drop event icons, draw movement arrows and front lines, annotate, publish,
embed).

**Licence changed 2026-11-16.** This was closed-source and `UNLICENSED` by
intent, and that constraint drove most of the early technical decisions. It is
now **public on GitHub under MIT** as a portfolio piece. Packages keep
`private: true` to prevent accidental npm publishing.

The **no-AGPL/GPL/SSPL rule still stands** — the reason shifted rather than
disappeared. Vendoring AGPL code into an MIT project is a licence conflict, not
a commercial inconvenience.

## Where the thinking lives

| File | What's in it |
|---|---|
| `claude-plans/decisions.md` | **13 decisions with rationale and evidence.** Read before changing architecture. Do not re-litigate; append. |
| `claude-plans/chat-livemap-foundation/findings.md` | All research, tagged MEASURED / PRIMARY / SECONDARY-UNVERIFIED. **Respect the tags.** |
| `claude-plans/chat-livemap-foundation/task_plan.md` | Phase status, open questions, session handoff |
| `claude-plans/project-brief.md` | What the product is and who it's for |
| `docs/architecture.md` | How it fits together, and §6 lists every known gap |
| `docs/data-model.md` | Schema **design only** — no migration written or run |

`claude-plans/` is private working material, globally gitignored. Never commit it.

## Layout

```
packages/core      domain model + annotation geometry. ZERO dependencies. 129 tests.
packages/renderer  MapLibre overlay, shared unchanged by editor and viewer. 26 tests.
packages/api       Fastify routes, publish pipeline, PostgresRepo, auth, WS hub. 73 tests.
packages/viewer    embeddable read-only viewer + ETag polling + iframe protocol. 20 tests.
packages/editor    the authoring application.
migrations/        0001_init.sql — applied. Schema + RLS policies.
scripts/           migrate.mjs, serve.mjs (production entrypoint).
bench/             load-test harness: seed + a server exposing 3 read paths.
loadtest/          k6 scripts, sweep runner, generated REPORT.md.
spikes/            headless visual verification. `npm run spike`.
demo/              local harness that boots all of it. `npm run demo`.
```

```bash
npm run build      # all packages
npm test           # 248 tests (DB integration tests skip without DATABASE_URL)
npm run spike      # headless render + 18 assertions + screenshots
npm run demo       # http://127.0.0.1:8800/

npm run db:up      # postgis on 127.0.0.1:5460 (other ports here are taken)
npm run migrate
npm run serve      # the real server, needs APP_DATABASE_URL + SESSION_SECRET
npm run loadtest   # full three-axis sweep, ~8 min, writes loadtest/results/
```

## Hard constraints — do not violate without saying so

- **No AGPL/GPL/SSPL in anything shipped.** This already ruled out uMap and
  Mapforge, which were the closest open-source lookalikes.
- **Feature-per-row, never blob-per-map.** uMap lost user data this way and
  Placemark re-sorts its whole collection on every edit.
- **The read path never touches the database.** Editors write to Postgres;
  readers fetch immutable versioned artifacts from a CDN.
- **No WebSocket reader fan-out, ever.** Measured: AP polls at 10s/120s with
  ETags and pauses on hidden tabs; the BBC serves `max-age=5`; Al Jazeera's
  "Live Tracker" is a 24-hour cache over static JPEGs. Polling is the answer.
- **RTL from the first commit.** Every text-bearing type carries an explicit
  `dir`; the editor shell mirrors from CSS logical properties alone.
- **Halo width never below 1.01.** MapLibre issue #8949 cuts Arabic glyph
  joins at 1px or less. `normaliseHaloWidth()` enforces it; there's a test.

## MapLibre 6 gotchas that each cost a debugging cycle

- **No default export.** `import { Map } from "maplibre-gl"`. No `setWorkerUrl`
  in 6.16 despite third-party docs claiming otherwise.
- **The worker is a separate file.** `maplibre-gl-worker.mjs` must sit next to
  the output bundle; bundling does not inline it. Missing → the map renders
  **nothing**, with only a 404 as the clue.
- **Build ESM, not IIFE** — IIFE breaks `import.meta.url` worker resolution.
- **`*-sort-key` is a LAYOUT property**, not paint. In paint, MapLibre rejects
  the whole layer.
- **`map.loaded()` and the `load` event are not sufficient guards.**
  `isStyleLoaded()` is. A style can report loaded while sources resolve, and
  `addSource` then throws "Style is not done loading".
- **One-shot events may already have fired** by the time you subscribe. `idle`
  is the reliable retry hook because it fires again whenever rendering settles.
- **`getCanvas().width` is DEVICE pixels**; `clientWidth` is CSS pixels. Label
  layout works in CSS pixels.

## Blocked on the user

1. **Buyer segment** — Arabic/MENA newsrooms, Western broadcast, or adjacent
   non-news. Architecturally this reduces to one question: *do we build the
   video exporter or not?* Broadcast needs MP4/MOV/After-Effects/CMYK output,
   which is a separate headless render service. The other two segments differ
   in roadmap, not system shape. **Not answerable from research** — the next
   evidence is conversations with graphics editors.

Resolved 2026-11-16: migration approved, written and applied (see
`migrations/0001_init.sql`).

## Not built

- **Object storage.** Artifacts live in `MemoryArtifactStore`. Production wants
  S3/R2 behind a CDN — one `ArtifactStore` implementation, nothing above it
  changes.
- **An identity provider.** `TokenAuth` verifies HMAC-signed bearer tokens and
  is real, but tokens are minted out of band by `bench/seed.mjs`. No login
  flow, no OIDC, no password storage.
- Billing
- Vertex editing of existing shapes (you can draw, restyle, reorder, delete;
  reshaping means redrawing)
- Icon de-confliction at low zoom; labels avoiding geometry
- `publish_requests` and `feeds` tables exist in the schema but nothing reads
  them yet — the approval workflow and live ingest are schema-only.

## Backend gotchas that each cost a debugging cycle

- **Postgres 18+ Docker images moved the data directory.** Mount the volume at
  `/var/lib/postgresql`, NOT `/var/lib/postgresql/data`. The old path makes the
  entrypoint refuse to start, and the container reports `unhealthy` with the
  explanation buried in `docker logs`.
- **`features` is keyed `(map_id, id)`, not `id`.** Feature ids are generated
  client-side, so they collide across tenants. With a global primary key the
  upsert's `ON CONFLICT` path hits another tenant's row and fails the RLS check
  with `new row violates row-level security policy (USING expression)` — which
  reads like a policy bug and is actually a key-scoping bug.
- **`set_config('app.tenant_id', $1, true)` — the `true` is load-bearing.** It
  scopes the setting to the transaction. A plain `SET` persists on the pooled
  connection after release, so the next request to borrow it inherits the
  previous tenant's scope. There is a test pinning this with `max: 1`.
- **A table owner bypasses RLS.** The app connects as `livemap_app`, which does
  not own the tables; `FORCE ROW LEVEL SECURITY` is belt-and-braces on top.
  `livemap_migrator` has `BYPASSRLS` because provisioning a tenant is
  inherently cross-tenant.
- **`@fastify/rate-limit` needs the routes declared after it has run.** Because
  `buildServer` is synchronous, `app.register()` only queues the plugin, so
  routes declared straight onto `app` never reach its `onRoute` hook and
  `config.rateLimit` is silently inert. The routes live in an
  `app.register(async (scope) => …)` child scope for this reason. Per-route
  config also does **not** inherit the plugin's `max`/`timeWindow` — pass them
  explicitly.
- **k6: the WebSocket module is `k6/websockets`.** The
  `k6/experimental/websockets` path was removed in k6 v2. Current is v2.4.0.

## Working habits that paid off here

- **Verify against the installed artifact, not memory or docs.** Every
  contract bug above was found by grepping `node_modules`. Three claims in
  this project had to be corrected because an undated source was read as
  current.
- **Read your own screenshots.** The spike's 18 structural assertions went
  green while three real defects were visible in the images.
- **When a test fails, decide whether the code or the expectation is wrong**
  before editing either. Two test expectations in this project were written
  from assumed numbers and were themselves the bug.
