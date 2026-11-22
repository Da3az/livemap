# livemap — architecture

**Status:** the front end (`web/`) runs against the API end to end: sign-in,
workspace, editing, publishing, versions and rollback, and the embed reading
published artifacts. §6 lists what is not built.

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

`buildArtifact()` builds what readers receive — hidden features, features in
hidden groups, unused groups and presets, hidden legend entries and who changed
each feature are all left out — and `publishHash()` hashes **that artifact**,
without its version number and publish time. So the hash covers exactly what a
reader sees: republishing a map whose readers would see nothing new answers
`unchanged`, mints nothing, and readers keep their cached copy. The pointer's
body is `{ version, url, etag, cacheControl, updatedAt }`.

## 3. Packages

| Package | Depends on | Purpose |
|---|---|---|
| `@livemap/core` | **nothing** | The one domain model, the API's request and response shapes, the settings patch, the publish builder and hash, fractional order keys, templates. Pure, Node- and browser-safe. |
| `@livemap/api` | core | Fastify routes, JSON Schemas, the publish pipeline, `PostgresRepo`, authz, auth, guests, limits, the R2 store. |
| `@livemap/web` (`web/`) | core | The front end: sign-in, workspace, editor, versions, the embed. React, Vite, MapLibre 6.19. |

**One model, compiled from source by both sides.** `web/src/model/types.ts`
re-exports `@livemap/core`; the server's JSON Schemas (`schemas.ts`) restate the
same shapes for validation and for `/docs`. The front end and the server build
the published artifact with the same function (`buildArtifact`), so the editor's
"what readers will see" preview cannot disagree with a publish.

The workspace resolves `@livemap/core` to its TypeScript source through the
`livemap-source` export condition (TypeScript `customConditions`, Vite
`resolve.conditions`, `node --conditions=livemap-source`). Without it Node would
load the package's last build.

## 4. Rendering

Readers, authors and image export share one renderer in `web/src/render`.
`web/DECISIONS.md` P0.1, P0.2b and R.1–R.2 record how it was chosen; the short
version:

- **Free draw order across kinds.** Every feature, text included, is drawn in
  one ordered pass, so an area can sit above a note or below a line as the
  author orders it. MapLibre's own layers cannot do this: `*-sort-key` orders
  only within a layer.
- **Text is shaped by the browser** in the interface typefaces (Noto Naskh
  Arabic, Newsreader, Libre Franklin), not by MapLibre's glyph atlas, so Arabic
  joins and bidi are the browser's.
- **The whole layer sits above the basemap's labels**, as designed. Its
  position is one constant in one module, so it can move under the basemap's
  first symbol layer or become a per-map setting.
- **Everything view-dependent is recomputed per view** — arrowheads, taper,
  front-line teeth and dash lengths are sized in screen pixels, never in
  metres, so they hold at every zoom.
- Image export draws the same scene at the export pixel ratio.

The renderer's own notes live beside its code in `web/src/render`.

## 5. Arabic / RTL

- **Feature text is the browser's.** Shaping, bidi and fonts come from the
  browser's text engine; MapLibre issue #8949 (halos of 1px or less cut Arabic
  joins) concerns MapLibre's own text and binds only if feature text ever moves
  into a MapLibre symbol layer.
- **Basemap labels follow `settings.basemap.labelLanguage`** (`ar`, `en` or the
  local name), restyled on the basemap's own symbol layers.
- **Direction is explicit per text.** Every `RichText` carries `dir`; `auto`
  resolves by first strong character. A map's `uiDir` mirrors the editor and the
  published furniture.
- **The editor is RTL from the first commit**: logical CSS properties only, and
  Arabic strings for every area that renders inside the editor or the embed.

## 6. Known gaps

Stated plainly rather than discovered later:

1. **No tile-performance measurement yet.** The PMTiles cold-start figure in
   `findings.md` is still someone else's number, and the basemap is
   OpenFreeMap's free service with no agreement.
2. **`AdminDb` has one caller and no operator surface.** Guest signup reaches
   it through `GuestProvisioner`, two operations that take no caller input
   (§9). There is still no identity provider, so there is no way to
   authenticate a platform operator. Scripts hold their own provisioning SQL.
3. **No approval workflow.** `publish_requests` has policies — a contributor may
   insert, a publishing role may decide — but nothing reads the table.
4. **Guest workspaces are reaped by a script nothing schedules.**
   `scripts/reap-guests.mjs` has to be run from outside. Until it is, expired
   guests count against `MAX_GUESTS`, and at that ceiling signup answers 503.
5. **The R2 store has not met a real bucket.** The bucket needs the CORS rule in
   §9 ("Artifacts on R2"), which the code cannot set.
6. **Rate limits are per process.** The limiter's store is in memory, which is
   right for one instance and wrong for two.
7. **No Content-Security-Policy beyond framing.** Pages send
   `frame-ancestors` (§9). A full policy needs writing against a running
   browser: MapLibre's worker (`worker-src data: blob:` in a sandboxed frame),
   the tile host, the API and artifact origins, and Turnstile.
8. **The publish pointer and the artifact store are not one transaction.** The
   pointer is written under the per-map lock after the artifact (§8), so the
   worst interruption leaves readers on the previous version; an unchanged
   republish rewrites the pointer and heals it.

## 7. Build requirements worth knowing

- **MapLibre 6.x ships its worker as a separate file.** Under Vite, web/ imports
  its URL (`?worker&url`) and calls `setWorkerUrl` before creating a map. If it
  is missing the map renders **nothing**, and the only clue is a 404.
- **In a sandboxed (opaque-origin) frame**, MapLibre 6.19 fetches the worker and
  starts it from a `data:` URL. The fetch is cross-origin, so every static file
  is served with `Access-Control-Allow-Origin: *`.
- **MapLibre 6.x has no default export.** `import { Map } from "maplibre-gl"`.
- **`*-sort-key` is a LAYOUT property**, not paint. Putting it in `paint` makes
  MapLibre reject the entire layer.
- `getCanvas().width` is **device** pixels; `clientWidth` is CSS pixels.

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
3. `setPublished` — after the artifact exists, takes the same advisory lock,
   points the map at the version only if no newer one is live
   (`published_version <= $v`), records `published_rev`, and writes
   `latest.json` **while the lock is held**. A slower, older publish therefore
   cannot repoint the map or overwrite the pointer after a newer one, and a
   failed pointer write rolls the repoint back.

The object store still cannot join a Postgres transaction, so the artifact is
written before anything points at it and the pointer last; an interruption
leaves readers on the previous version, and an unchanged republish rewrites the
pointer. Each version row records `source_rev` (the draft revision its content
came from) and its origin, publish or rollback; a rollback copies its source's
`source_rev`, so `published_rev` stays right however many rollbacks deep.

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
/  /maps  /maps/:id  /maps/:id/versions     pages — web/'s client router
/embed/:tenant/:slug                        the reader, inside a publisher's iframe
/assets/*  /embed-host.js                   the built front end
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

A page request (GET or HEAD, no file extension) gets `index.html` with
`cache-control: no-cache`; a miss under `/api/v1` is always JSON; a missing
asset is a 404 rather than the shell with the wrong content type. Hashed files
under `/assets/` are `public, max-age=31536000, immutable`.

**Framing.** Every page is sent with `X-Frame-Options: DENY` and
`Content-Security-Policy: frame-ancestors 'none'`, except `/embed/*`, which
sends `frame-ancestors *`: the reader is the one page meant to live in someone
else's frame. A publisher's snippet frames it with
`sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` and no
`allow-same-origin`, so the reader runs at an opaque origin and every request it
makes — scripts, styles, fonts, the MapLibre worker, `/config`, artifacts — is
cross-origin; static files and `/config` send `Access-Control-Allow-Origin: *`.

**Auto-height embeds.** `/embed-host.js` on the host page grows an embed whose
URL carries `embedId` when the map's furniture does not fit its frame. Both
sides validate: the frame reports only when its content overflows; the host
accepts a message only from that iframe's window, from its origin (or the
opaque `null`), with exactly the protocol's four fields, a bounded height, and
only to grow (`web/src/embed/protocol.ts`).

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

The schemas are a second copy of `core`'s TypeScript types, which have no
runtime form. What JSON Schema cannot express — closed rings, latitude within
±90, unique ids in one save, a window that ends after it starts — is checked in
`validate.ts`; whether every feature's group and preset exists is checked
inside the save's transaction, against the whole map, after the write.
Every refusal has one shape, `{ error, reason, retryAfter?, current? }`, with
`Retry-After` mirrored into the body.

### Artifacts on R2

`R2ArtifactStore` is the `ArtifactStore` for production. Two things differ from
the in-memory store, both deliberate:

- **The served ETag is R2's, not ours.** Ours is a hash of the map's content
  and is kept as object metadata. The reader echoes the HTTP `ETag` it was
  given (not the etag inside the pointer's body) and decides whether to fetch
  an artifact from the pointer's version number, so the two need not match.
- **The server stops serving artifacts.** With R2 configured `/public/*` is not
  registered: it would be an unauthenticated proxy onto the bucket, on the
  process that holds the database pool. The read path not touching the
  database is then a property of the deployment, not a convention.

### The bucket's CORS rule

Readers fetch the pointer and artifacts cross-origin, the pointer
conditionally. A conditional request with `cache-control` is not a simple
request, so browsers preflight it, and the client must be able to read the
`ETag` to send it back. The bucket needs this rule (R2's CORS JSON form; apply
it in the infrastructure repository, not here):

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["if-none-match", "cache-control"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

This is the dashboard's JSON form (a top-level array of rules); Wrangler's file
uses a different, nested shape. `OPTIONS` is not listed: it is the preflight
itself, and the R2 documentation shows only GET/HEAD/PUT/POST/DELETE as methods.
That R2 answers the preflight from this rule is **unverified** until it is
applied to a real bucket — check a preflight with
`curl -i -X OPTIONS -H "origin: https://example.org" -H "access-control-request-method: GET" -H "access-control-request-headers: if-none-match, cache-control" <pointer url>`.
The local `/public/*` route answers the same preflight.
