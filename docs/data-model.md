# livemap — data model

**Status: built.** Migrations 0001–0004 are written, approved and applied.
Sections 1–8 are the original design and its reasoning; **§9 is the schema as
it now stands**, and wins wherever the two differ. Every migration needs the
owner's approval before it is written or run.

---

## 1. Principles

**Feature-per-row, never blob-per-map.** Two independent prior-art failures
drove this (`decisions.md`):

- uMap: documented object-count performance issue (#788), editing timeouts on
  large maps, and a user report of ~8 maps lost at ~50 MB each.
- Placemark: one FlatGeobuf blob per map with **no size guard anywhere** in
  the handler code, plus an in-memory full clone and `O(n log n)` re-sort on
  every single edit.

A blob model also makes concurrent editing a read-modify-write race and turns
every reorder into a whole-document write.

**Tenant isolation is enforced in the database, not the application.** Every
tenant-scoped table carries `tenant_id` and is covered by row-level security.
Application bugs are inevitable; a missing `WHERE tenant_id = ?` should fail
closed rather than leak another newsroom's embargoed map.

**Published artifacts are immutable and live outside Postgres.** The database
holds editor state and a version ledger. The bytes readers fetch live in
object storage. See `architecture.md` §1.

## 2. Entities

```
tenants ──┬── users ──── memberships ──┐
          │                            │
          ├── maps ──┬── features      │
          │          ├── map_versions  │
          │          └── map_locks     │
          │                            │
          ├── assets (custom icons)    │
          └── themes (house style) ◄───┘
```

## 3. Tenancy and identity

```sql
create table tenants (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  -- RTL-first: a tenant's default UI direction, not an afterthought.
  default_dir  text not null default 'ltr'
                 check (default_dir in ('ltr','rtl')),
  default_locale text not null default 'en',
  created_at   timestamptz not null default now()
);

create table users (
  id         uuid primary key default gen_random_uuid(),
  email      citext not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);

-- A user may belong to several tenants, so role lives on the join.
create table memberships (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id   uuid not null references users(id)   on delete cascade,
  role      text not null
              check (role in ('owner','admin','editor','contributor','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
```

**Roles**, chosen against the researched gap that only Flourish offers an
approval workflow:

| Role | Can edit | Can **publish** | Can administer |
|---|---|---|---|
| `owner` / `admin` | yes | yes | yes |
| `editor` | yes | yes | no |
| `contributor` | yes | **no** — submits for review | no |
| `viewer` | no | no | no |

`contributor` is the reporter-self-service-with-guardrails role: produce
on-brand maps, cannot put them in front of readers without sign-off.

## 4. Maps and features

```sql
create table maps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  slug        text not null,
  title       text not null,
  title_dir   text not null default 'auto'
                check (title_dir in ('ltr','rtl','auto')),
  ui_dir      text not null default 'ltr'
                check (ui_dir in ('ltr','rtl','auto')),

  -- Viewport, stored flat so it can be indexed and queried.
  center      geography(Point, 4326) not null,
  zoom        real not null check (zoom between 0 and 24),
  bearing     real not null default 0,
  pitch       real not null default 0,

  basemap_style_id text not null,
  -- Ordered language preference; resolved as coalesce(name:<l>, …).
  label_langs text[] not null default array['en'],

  theme_id    uuid references themes(id) on delete set null,

  -- Monotonic, bumped on every committed change. Used for optimistic
  -- concurrency: a write carries the rev it read, and loses if it is stale.
  rev         bigint not null default 0,
  published_version int,

  archived_at timestamptz,
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (tenant_id, slug)
);

create table features (
  id         uuid primary key default gen_random_uuid(),
  map_id     uuid not null references maps(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,

  kind       text not null
               check (kind in ('area','line','arrow','frontline','point','annotation')),

  -- Fractional index. Reordering one feature is a single-row write; see
  -- packages/core/src/order.ts for the invariant that makes this always
  -- subdividable.
  at         text not null,

  -- The authored geometry. For an arrow this is the CONTROL POINTS, not the
  -- rendered curve — the curve is derived at render time, which keeps the
  -- handles editable and the row small.
  geom       geography(Geometry, 4326),

  -- Kind-specific payload: curvature, head type, facing side, icon id,
  -- screen offset, text, and the full per-feature style.
  props      jsonb not null default '{}'::jsonb,

  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create index features_map_order_idx on features (map_id, at);
create index features_geom_idx      on features using gist (geom);
create index features_tenant_idx    on features (tenant_id);
```

**Why `props jsonb` rather than a column per kind.** Six feature kinds with
largely disjoint fields would mean either six tables (and six joins to render
one map) or a wide sparse table. The style payload in particular is
per-feature and open-ended. The geometry — the part we actually query
spatially — is a real PostGIS column; only the non-spatial payload is JSON.

**Why `geography` not `geometry`.** Distances and bearings in the annotation
engine are computed on a sphere. Matching the storage type to the maths avoids
a class of silent projection mistakes.

## 5. Versions and publishing

```sql
create table map_versions (
  map_id       uuid not null references maps(id) on delete cascade,
  version      int  not null,
  tenant_id    uuid not null references tenants(id) on delete cascade,

  -- Content hash of the artifact. Served as the ETag. Excludes published_at
  -- and published_by so republishing an unchanged map keeps reader caches warm.
  etag         text not null,
  -- Where the immutable bytes live.
  storage_key  text not null,
  byte_size    int  not null,
  feature_count int not null,

  published_at timestamptz not null default now(),
  published_by uuid not null references users(id),
  -- Set when this version is rolled back to or superseded.
  note         text,

  primary key (map_id, version)
);

-- Approval workflow: the gap nobody but Flourish fills.
create table publish_requests (
  id           uuid primary key default gen_random_uuid(),
  map_id       uuid not null references maps(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  state        text not null default 'pending'
                 check (state in ('pending','approved','rejected','withdrawn')),
  decided_by   uuid references users(id),
  decided_at   timestamptz,
  comment      text
);
```

**Publishing is a transaction plus an upload, in that order:**

1. Read all features for the map.
2. `buildVersion()` → sorted features + content hash.
3. **If the hash equals the current published version's, stop.** Nothing
   changed; readers keep their caches.
4. Insert `map_versions` row, `version = max + 1`.
5. Upload `v/{n}.json` (immutable, `max-age=31536000`).
6. Upload `latest.json` pointer (`max-age=5, stale-while-revalidate=30`).
7. Update `maps.published_version`.

Steps 4–7 are not atomic across two systems. The ordering is chosen so every
interruption leaves a consistent state: a version row with no object is
invisible (the pointer still names the old one) and is reconciled by a sweep;
an object with no pointer update is simply unreferenced. **Never update the
pointer before the artifact exists.**

**Rollback** is publishing a new version whose body is an old one — the ledger
stays append-only, so the audit trail is intact.

## 6. Live ingest (the paid tier)

```sql
create table feeds (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  map_id         uuid not null references maps(id) on delete cascade,
  kind           text not null check (kind in ('csv','geojson','sheet','http')),
  url            text not null,
  -- Cadence is the pricing axis: Felt charges $199→$1,250/mo for
  -- daily→15-minute. Enforced here, not in application code.
  interval_secs  int not null check (interval_secs >= 60),
  -- false = fetch and stage for approval; true = publish automatically.
  auto_publish   boolean not null default false,
  last_fetch_at  timestamptz,
  last_etag      text,
  last_error     text,
  enabled        boolean not null default true
);
```

Ingest stages into `features` with a `staged` marker in `props` and raises a
`publish_request`. Only `auto_publish` feeds skip the gate — and that flag is
the thing an editorial customer will want off.

## 7. What the first migration would do

**Creates** (nothing is modified or dropped — this is an empty database):

- Extensions: `postgis`, `pgcrypto` (for `gen_random_uuid`), `citext`.
- Tables: `tenants`, `users`, `memberships`, `themes`, `assets`, `maps`,
  `features`, `map_versions`, `publish_requests`, `feeds`.
- Indexes: the four on `features` above, plus `map_versions(map_id, version)`
  and tenant indexes on every tenant-scoped table.
- Row-level security enabled on all tenant-scoped tables, with policies keyed
  on a `current_setting('app.tenant_id')` session variable set per request.

**Why:** this is the minimum schema that supports the architecture in
`architecture.md` — feature-per-row editing, an immutable version ledger,
approval-gated publishing, and database-enforced tenant isolation.

**Risk:** low. It is additive-only against an empty database, and there is no
data to lose. The reversible-down migration drops the same objects.

**This needs explicit approval before I write or run it.**

## 8. Open questions

1. **Soft delete for features?** Currently a delete is a delete, with undo
   living client-side only. Server-side undo after a reload needs either
   tombstones or an edit log.
2. **Edit log for audit.** `map_versions` records what was published, not who
   changed which feature between publishes. Newsrooms may require the latter.
3. **Feature count ceiling.** Placemark had no size guard and that was a
   finding against it; we should pick an explicit per-map limit and fail
   cleanly rather than degrade.
4. **Asset storage for custom icons** — tenant-scoped SVG uploads need
   sanitising (SVG is an XSS vector) and a size cap.

---

## 9. As built (migrations 0001–0004)

| Migration | What it did |
|---|---|
| `0001_init` | Tenants, users, memberships, themes, assets, maps, features, map_versions, publish_requests, feeds; RLS on every tenant table; the `livemap_app` and `livemap_migrator` roles |
| `0002_role_aware_rls` | Role-aware policies (`livemap_granted_role()`, contributor ownership), the `livemap_admin` role |
| `0003_document_model` | The front end's document model (below). Discarded the maps that existed, as approved |
| `0004_version_origin_and_archive` | Version origin and source revision; archiving restricted to owners and admins; an archived map's features read-only |

**maps** — `settings jsonb` holds the whole `MapSettings` (opening view, basemap
and label language, presets, groups, legend, title block, timeline, embed
options): a JSON object of at most 256 KB. It replaced `center`, `zoom`,
`bearing`, `pitch`, `basemap_style_id` and `label_langs`. `updated_by` (who last
saved), `published_rev` (the draft revision the live version was built from;
null or between 0 and `rev`, and only with a `published_version`). `ui_dir` is
`ltr` or `rtl`. Settings are map-level and bounded; features stay one row each.
They change by patch (core's `SettingsPatch`), applied under the row lock the
revision guard takes.

**features** — `order_key` (was `at`), and as columns because the server acts on
them: `group_id`, `preset_id`, `lineage_id`, `hidden`, `locked`, `valid_from`,
`valid_to` (`valid_to >= valid_from`). `updated_by` is required. `geom` holds the
geography (Polygon for areas, LineString for lines, arrows' control points and
front lines, Point for points and annotation anchors); `props` holds the rest of
the feature as the model defines it. Indexed by `(map_id, order_key)` and
`(map_id, group_id)`. Whether each feature's group and preset exist in the
map's settings is checked in the save's transaction, across the whole map.

**map_versions** — `source_rev` (the draft revision the content came from; a
rollback copies its source's), `origin_type` (`publish` or `rollback`),
`origin_from_version` (set exactly for a rollback). Still append-only: no update
or delete policy.

**Archive rights** — the trigger `maps_guard_archive` refuses a change to
`archived_at` on the request path unless the caller is an owner or admin;
`livemap_can_edit_map()` answers false for an archived map, so its features
refuse every write.
