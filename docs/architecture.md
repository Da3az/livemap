# livemap — architecture

**Status:** Phase 1. Core engine and renderer are built and verified; the API,
editor and viewer are scaffolded. See `claude-plans/chat-livemap-foundation/task_plan.md`
for what is and is not done.

Every decision below traces to an entry in `claude-plans/decisions.md`, most of
them backed by measurement rather than preference. Where a choice looks odd,
check there before changing it.

---

## 1. The shape of the system

```
                    EDIT PATH                          READ PATH
                    (authenticated, slow, stateful)    (anonymous, fast, cached)

  ┌──────────┐                                   ┌──────────────┐
  │  Editor  │──── REST ────┐                    │   Embedded   │
  │   SPA    │              │                    │    viewer    │
  └──────────┘              ▼                    └──────┬───────┘
                      ┌──────────┐                      │
                      │   API    │                      │ GET (ETag)
                      │ Fastify  │                      ▼
                      └────┬─────┘               ┌──────────────┐
                           │                     │     CDN      │
                    ┌──────┴──────┐              └──────┬───────┘
                    ▼             ▼                     │
             ┌────────────┐  ┌─────────┐                │
             │  Postgres  │  │ Object  │◄───── publish ─┘
             │  + PostGIS │  │ storage │
             └────────────┘  └─────────┘
```

**The single most important property: the read path never touches the
database.** Editors write to Postgres. Publishing renders an immutable
versioned artifact to object storage behind a CDN. Readers only ever fetch
from the CDN.

This is not premature optimisation — it is the thing that makes a news traffic
spike survivable. A map embedded in a story that goes viral serves from cache
at zero marginal database cost, and an auto-refreshing reader surface polls a
tiny pointer object with `If-None-Match` and collects 304s.

## 2. Liveness: there is no realtime transport layer

Measured, not assumed (`decisions.md`, 2026-11-06):

- **AP's shared election data layer polls** — `setInterval(…, 12e4)` for the
  default lane and `setInterval(…, 1e4)` for the opt-in fast lane, ETag-gated,
  paused on `visibilitychange`. Zero WebSocket/EventSource. This is the layer
  behind the BBC's and most US newsrooms' election maps.
- **The BBC's live results page** serves `max-age=5,
  stale-while-revalidate=30, stale-if-error=90`.
- **Al Jazeera's "Live Tracker"** serves `max-age=86400` with static JPEGs.
- **NICAR 2026, all 233 sessions:** zero mentions of websocket, SSE, live maps
  or auto-refresh.

So: **snapshot publish first, live-ingest-then-approve as the paid tier, and
no WebSocket fan-out, ever.** If an auto-updating reader surface is needed, it
polls the pointer. That removes most of the projected build complexity.

### Two objects, two cache policies

| Object | Path | Cache-Control | Why |
|---|---|---|---|
| Version artifact | `…/v/{n}.json` | `public, max-age=31536000, immutable` | Can never change under a reader |
| Latest pointer | `…/latest.json` | `public, max-age=5, stale-while-revalidate=30, stale-if-error=90` | Tiny; this is what makes publishing visible |

`buildVersion()` computes a content hash over the features, viewport, basemap,
title and direction — **deliberately excluding `publishedAt` and
`publishedBy`**, so republishing an unchanged map returns the same ETag and
readers keep their cached copy.

## 3. Packages

| Package | Depends on | Purpose |
|---|---|---|
| `@livemap/core` | **nothing** | Domain model + annotation geometry. Pure, Node-testable. **6.6 KiB min+gzip.** |
| `@livemap/renderer` | core, (MapLibre structurally) | Builds MapLibre sources/layers. Shared *unchanged* by editor and viewer. |
| `@livemap/api` | core | Fastify + Postgres + publish pipeline. |
| `@livemap/editor` | core, renderer | The map editor: tools, inspector, undo, save, publish. Mounted by a host. |
| `@livemap/app` | core, renderer, editor, viewer | The application shell: sign-in, workspace, editor chrome, version ledger, embed page. |
| `@livemap/viewer` | core, renderer | The embeddable read-only viewer. |

**`core` has zero dependencies on purpose.** The geodesy, spline and
de-confliction code is ~700 lines; pulling in Turf would have added a
dependency tree for functions we can write and test exactly. It also keeps the
engine runnable in Node, which is what let 129 unit tests cover the geometry
without a browser.

**The editor and viewer share one renderer.** That is the only way to
guarantee what an author sees is what a reader gets. The viewer differs solely
in never calling `setFeatures`.

## 4. The annotation engine

This is the differentiator, and nothing off-the-shelf provides it. terra-draw,
mapbox-gl-draw, maplibre-gl-terradraw, leaflet-geoman **and** maplibre-geoman
were all source-grepped for `arrow|bezier|curve|lineOffset|leader|callout`.
All five have nothing.

### Everything view-dependent is recomputed per view

The failure that shaped this design: the first prototype sized arrowheads and
front-line teeth in **metres**, which looks correct at the authoring zoom and
falls apart everywhere else — at z6.2 arrowheads were nearly the radius of the
shrunken curves.

So sizes are denominated in **pixels** and converted to metres for the current
zoom on every rebuild:

```
arrowHeadPx(strokeWidth) ──► arrowHeadMetres(strokeWidth, lat, zoom) ──► trim length
toothSpacingPx(width)    ──► toothSpacingMetres(width, lat, zoom)    ──► tooth count
```

Verified: tooth count goes 1 → 4 → 37 → 259 across z4.5 → z6.2 → z9.2 → z12,
while the arrowhead stays visually constant.

### Arrows

Stored as **control points plus a curvature scalar**, not as rendered
geometry. The curve is derived by a Catmull-Rom spline computed in Mercator
world space (splining in raw lng/lat skews at high latitude), then unprojected.

`curvature` scales the spline tangents, so **0 traces the straight polyline
through the controls and 1 is full smoothing** — one continuous editor handle
from straight to curved, with no mode switch.

Two details that are easy to get wrong and both are tested:
- The head bearing comes from the **smoothed** geometry. Taking it from the
  control points puts the arrowhead visibly off-tangent on a curve.
- The shaft is **trimmed back** by the head length, or the line shows through
  a filled head. Trim is capped at 40% of the arrow so a low-zoom conversion
  cannot annihilate the shaft.

MapLibre wiring: `icon-rotate: bearing − 90` (the sprite points east),
`icon-rotation-alignment: "map"` so camera rotation is free, and
**`icon-ignore-placement: true`** — without it the collision engine silently
drops arrowheads, and an arrow with no head is just a line.

### Front lines

No front-line symbol exists in any of ~10,000 permissively-licensed icons
surveyed — correctly, because it is **line symbology with a facing side**, not
a point icon. So it is generated: a base line plus one closed ring per tooth
(triangle, tick or semicircle), emitted as real geometry that takes the
feature's own colour and needs no sprite build.

### Leader-lined annotations

`AnnotationFeature.offset` is in **screen pixels**, not a geographic delta. A
geographic offset changes its apparent distance at every zoom, which is why
naive leader lines collapse when you zoom out.

MapLibre's style spec cannot express a line between a geographic anchor and a
screen-offset label, so the leader is emitted as a small GeoJSON source
rebuilt per view. The alternative — a DOM/SVG overlay — desyncs during inertia
and loses z-ordering against map layers.

### Label de-confliction

Having set `icon-ignore-placement` and `text-allow-overlap` so MapLibre never
drops our authored marks, **we owe the user our own collision engine.**

`deconflict()` is iterative relaxation with a deviation budget: labels are
pushed apart along their minimum translation vector weighted by priority, but
tethered to where the editor put them. Anything still colliding when the
budget is exhausted is **suppressed rather than drawn as mush** — hiding a
label is honest, overlapping text is not. It is deterministic (stable sort by
priority then id) so labels do not jitter between frames.

## 5. Arabic / RTL

**The renderer problem is solved upstream.** MapLibre 6.9.0+ does native
Arabic shaping and bidi; measured pixel-identical to the old ICU plugin (0 of
336,000 pixels differ). We ship no RTL plugin.

What we still own:
- **Halo width is clamped to ≥ 1.01.** MapLibre issue #8949: a halo of 1px or
  less is drawn per-glyph and cuts the joins of connected scripts, mangling
  Arabic. `normaliseHaloWidth()` enforces it and there is a test.
- **Labels resolve as `coalesce(name:ar, name:nonlatin, name)`.** Measured
  coverage: Riyadh has `name:ar` on only 12% of features but Arabic `name` on
  99% of roads. Dubai is the genuine problem case at ~20% by any route.
- **Direction is explicit per text, with `auto` resolved by first-strong
  character.** An editor may deliberately want Arabic laid out LTR beside a
  latinised name, so an explicit `dir` always wins.
- **The editor UI must be RTL from the first commit.** Retrofitting RTL into
  an editor with no i18n is the single largest avoidable cost identified in
  research — uMap's Arabic is 7% real despite looking 100% complete.

## 6. Known gaps

Stated plainly rather than discovered later:

1. **Icons do not de-conflict.** Only labels do. At low zoom, event icons pile
   up — visible in `spikes/shots/z6.2-zoomed-out.png`. Needs clustering or an
   icon collision pass.
2. **Labels do not avoid geometry**, only other labels and declared obstacles.
   An annotation can sit on top of an arrow.
3. **Area labels use the ring centroid**, which can fall outside a concave
   region. Needs a pole-of-inaccessibility algorithm.
4. **`zoomEpsilon` is accepted but not wired up.** A label-only fast path is
   the obvious next optimisation; the option is reserved, and deliberately not
   faked.
5. **Offsets rotate with the camera.** Screen offsets are applied in unrotated
   Mercator pixel space, so a rotated map rotates the label offset with it.
   Correct for a map-anchored annotation, and news maps are near-always
   north-up, but it is a choice rather than an accident.
6. **No tile-performance measurement yet.** The PMTiles cold-start figure in
   `findings.md` is still someone else's number.
7. **`AdminDb` has one caller and no operator surface.** Guest signup reaches
   it through `GuestProvisioner`, two operations that take no caller input
   (§9). There is still no identity provider, so there is no way to
   authenticate a platform operator and no honest place to put a general check
   above it. Scripts hold their own provisioning SQL; §8 has the role split.
8. **No approval workflow.** `publish_requests` has policies — a contributor may
   insert, a publishing role may decide — but nothing reads the table. The
   `publish:request` capability is granted and currently leads nowhere.
9. **Guest workspaces are reaped by a script nothing schedules.**
   `scripts/reap-guests.mjs` has to be run from outside. Until it is, expired
   guests count against `MAX_GUESTS`, and at that ceiling signup answers 503 —
   a bound on the damage, not a substitute for the schedule.
10. **The R2 store has not met a real bucket.** Its requests are tested against
    a stub and its contract suite skips without credentials. The bucket also
    needs a CORS rule the code cannot set: `GET` from any origin, request
    headers `cache-control` and `if-none-match`, `etag` exposed.
11. **Rate limits are per process.** The limiter's store is in memory, which is
    right for one instance and wrong for two.
12. **No Content-Security-Policy on the application shell.** It needs writing
    against a running browser: MapLibre's worker, the tile host and the bot
    check each need an allowance, and a wrong one fails silently.

## 7. Build requirements worth knowing

- **MapLibre 6.x ships its worker as a separate file.** `maplibre-gl-worker.mjs`
  must be copied next to the output bundle; bundling does not inline it. If it
  is missing the map renders **nothing**, and the only clue is a 404 plus
  "Worker failed to load". Cost us a debugging cycle; now explicit in
  `spikes/run.mjs`.
- **MapLibre 6.x has no default export.** `import { Map } from "maplibre-gl"`.
  There is also **no `setWorkerUrl`** in 6.16, despite third-party docs saying
  v6 requires it.
- **`*-sort-key` is a LAYOUT property**, not paint, for fill/line/symbol.
  Putting it in `paint` makes MapLibre reject the entire layer.
- Build with **ESM, not IIFE** — an IIFE build breaks MapLibre's
  `import.meta.url` worker resolution.
- `getCanvas().width` is **device** pixels; `clientWidth` is CSS pixels. Label
  layout works in CSS pixels, so using the former makes the viewport 2× too
  large at dpr 2.

## 8. Tenant isolation and the role model

Two layers, deliberately. The application layer produces good error messages;
the database layer is what actually holds.

### The actor context

Every repo call takes a `RepoCtx` — `{ tenantId, userId, role }` — and
`PostgresRepo.withCtx()` turns it into three transaction-local GUCs that the
policies read:

| GUC | Read by | Purpose |
|---|---|---|
| `app.tenant_id` | `livemap_current_tenant()` | Tenant isolation |
| `app.user_id` | `livemap_current_user()` | Row ownership |
| `app.role` | `livemap_current_role()` | Role claim from the session token |

`set_config(..., local => true)` on all three. A plain `SET` persists on the
pooled connection after release, which would hand the next request the previous
caller's tenant **and** permissions.

An unset or malformed GUC yields NULL, so every comparison against it is NULL
and the row is excluded. **The failure mode is an empty result or a denied
write, never a widened one.**

### The role claim is not trusted on its own

`app.role` comes from an HMAC-signed token, so a client cannot forge it — but a
token outlives the membership it was minted from. A user demoted from `editor`
to `viewer` keeps a valid editor token until it expires.

So `livemap_granted_role()` returns the role only where a `memberships` row in
this tenant still grants exactly that role. The effective role is the
intersection of what the token says and what the database records, and is never
wider than either.

### Where authorisation lives

| Layer | File | What it decides |
|---|---|---|
| Capability grid | `packages/api/src/authz.ts` | Which role holds which verb, and the clean 403 with a reason |
| Policies | `migrations/0002_role_aware_rls.sql` | The same grid, as the backstop that holds when a route forgets to ask |

The duplication is intentional and one-directional: `authz.ts` is a mirror, the
policies are the authority. `test/authz.test.ts` pins the grid as literal data;
`test/postgres.test.ts` proves the policies agree with it by going **around**
the repo with raw SQL — driven through `applyEdit`, those tests would pass with
every policy dropped, because `authz.ts` would have refused first.

`map_versions` has a `select` and an `insert` policy and deliberately no
`update` or `delete`: the ledger is append-only in the database, because readers
hold immutable artifacts keyed by those rows.

### Three roles in the cluster

| Role | RLS | Owns tables | Used by |
|---|---|---|---|
| `livemap_app` | **applies** | no | the request path |
| `livemap_admin` | BYPASSRLS | no | cross-tenant platform work (`AdminDb`) |
| `livemap_migrator` | BYPASSRLS | yes | migrations only |

Separating the middle one from the bottom one means a support query cannot run
DDL, and revoking platform access does not revoke the ability to migrate.

`PostgresRepo.assertRlsActive()` runs in `scripts/serve.mjs` before
`listen()` and refuses to start unless, for every table, RLS is enabled, FORCE
is set, at least one policy is attached, the connecting role does not own the
table, and the connecting role does not have BYPASSRLS. Each of those
misconfigurations otherwise starts cleanly and then serves other tenants' rows.

### A publish is three transactions

Not five, and not one:

1. `loadForPublish` — doc, features and newest version from **one** snapshot,
   so the ETag comparison cannot straddle a concurrent edit.
2. `recordNextVersion` — allocates the version number and inserts the ledger row
   together, serialised by `pg_advisory_xact_lock` on the map id. These were two
   transactions, so two publishers could read the same `max(version)` and the
   second collided on the primary key only *after* uploading its artifact.
3. `setPublishedVersion` — must come after the artifact exists, or the `maps`
   row points at bytes nobody can fetch.

One transaction is impossible: step 3 waits on an object store that cannot join
a Postgres transaction.

The lock is an advisory lock rather than `select ... for update` on the maps row
because, per the Postgres docs, `SELECT ... FOR UPDATE` applies the **UPDATE**
policy's `USING` clause as well as the SELECT policy's — and a publishing role
need not satisfy the maps update policy, since publishing writes the ledger, not
the map. The same rule is why `applyEdit` reads the map with a plain `select`:
under `FOR UPDATE`, a row an ownership policy refuses would come back empty and
be reported as "no such map" instead of as forbidden.

## 9. The application surface

### One origin, three kinds of URL

```
/  /maps  /maps/:id  /maps/:id/versions     pages — the shell's client router
/embed.html                                 the read-only page inside an iframe
/api/v1/*                                   the JSON API
/auth/guest  /config  /health  /ready       public, outside the API
/docs                                       reference, generated from the routes
/public/*                                   artifacts — local development only
```

The API is a Fastify child scope with the auth hook attached to the scope, not
to the server. Everything under the prefix is denied by default, unknown paths
included; nothing outside it needs an allowlist entry to be reachable. The
earlier arrangement was one global hook and a set of exempt paths, which
refused `/health?t=1` because it compared the raw URL.

A page request that matches no file gets `index.html`; a miss under `/api/v1`
is always JSON; a missing asset is a 404 rather than the shell with the wrong
content type.

### The role comes from the database on every request

The token says who is calling. `memberships` says what they may do, and whether
they are still anyone: one primary-key lookup per API request. A token that
outlives a demotion gets the demoted role's answers, and a guest's token that
outlives its reaped workspace gets a 401 although its signature still verifies.
This is the application-side twin of `livemap_granted_role()` in §8.

### Guest workspaces

A guest is a real tenant: a row in `tenants` with a `guest-` slug, a user, and
an `owner` membership, created in one transaction by the `livemap_admin` role.
That is the only thing done across the tenant boundary. The map a guest then
creates goes through `PostgresRepo` and the `maps` insert policy like anyone
else's.

The slug prefix is the marker, not a column: `tenants.created_at` already gives
the reaper its cutoff.

### What stands in front of a public write

In the order a signup meets them:

1. A rate limit per address.
2. A human check (Cloudflare Turnstile), redeemed server-side. It fails closed:
   no token, a rejected token, a timeout and an outage all refuse.
3. A ceiling on how many guest tenants may exist, expired ones included.

And after it, for as long as the workspace lives: quotas on maps, on features
per map, on published versions per map and on request size, each enforced
inside the transaction that would exceed it, plus a rate tier per kind of cost
(publish, write, read, rejected credentials).

An edit past the feature limit is refused whole. The count is taken after the
write, because only the table knows whether a put replaced a row or added one,
and the transaction is abandoned if it is over.

### Validation and the reference are one thing

Request shapes are JSON Schema in `packages/api/src/schemas.ts`. Fastify
validates against them, and `/docs` is generated from them, so the reference
cannot describe a request the server would refuse.

The validator is configured to refuse rather than repair. Fastify's defaults
remove properties a schema does not name and coerce `"5"` to `5`; both are off.

The feature schema is a second copy of `core`'s TypeScript types, which have no
runtime form. A test runs every template feature through it.

### Artifacts on R2

`R2ArtifactStore` is the `ArtifactStore` for production. Two things differ from
the in-memory store, both deliberate:

- **The served ETag is R2's, not ours.** Ours is a hash of the map's content
  and is kept as object metadata. The viewer echoes whatever validator it was
  given and decides whether to re-render from the pointer's version number, so
  it does not need them to match.
- **The server stops serving artifacts.** With R2 configured `/public/*` is not
  registered: it would be an unauthenticated proxy onto the bucket, on the
  process that holds the database pool. The read path not touching the
  database is then a property of the deployment, not a convention.
