import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { MapFeature } from "@livemap/core";
import { PostgresRepo } from "../src/postgres.js";
import type { RepoCtx, VersionDraft } from "../src/repo.js";

// Integration tests. They need the compose stack and a migrated database:
//   docker compose up -d && node scripts/migrate.mjs up
// Without DATABASE_URL they skip rather than fail, so `npm test` still works
// on a machine with no database.
const { DATABASE_URL, APP_DATABASE_URL } = process.env;
const enabled = Boolean(DATABASE_URL && APP_DATABASE_URL);
const describeDb = { skip: enabled ? false : "DATABASE_URL not set" };

let admin: pg.Client;
let repo: PostgresRepo;

let alphaTenant = "";
let betaTenant = "";
let alphaMap = "";
let contribMap = "";
let betaMap = "";
let editorId = "";
let contribId = "";
let viewerId = "";

// Contexts, named for the pair that matters: which tenant, and as whom. The
// role in each one is backed by a real membership row, because
// livemap_granted_role() honours the app.role GUC only where a membership
// grants it — see the stale-claim test below.
let alphaEditor: RepoCtx;
let alphaContrib: RepoCtx;
let alphaViewer: RepoCtx;
let betaEditor: RepoCtx;

before(async () => {
  if (!enabled) return;

  admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query("delete from tenants where slug in ('t-alpha','t-beta')");

  const mkTenant = async (slug: string, dir: string) => {
    const { rows } = await admin.query(
      `insert into tenants (slug, name, default_dir) values ($1, $2, $3) returning id`,
      [slug, slug, dir],
    );
    return rows[0].id as string;
  };

  alphaTenant = await mkTenant("t-alpha", "ltr");
  betaTenant = await mkTenant("t-beta", "rtl");

  const mkUser = async (email: string, name: string) => {
    const { rows } = await admin.query(
      `insert into users (email, name) values ($1, $2)
       on conflict (email) do update set name = excluded.name returning id`,
      [email, name],
    );
    return rows[0].id as string;
  };

  editorId = await mkUser("rls-editor@livemap.test", "RLS Editor");
  contribId = await mkUser("rls-contrib@livemap.test", "RLS Contributor");
  viewerId = await mkUser("rls-viewer@livemap.test", "RLS Viewer");

  const mkMembership = (tenant: string, user: string, role: string) =>
    admin.query(
      `insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)
       on conflict (tenant_id, user_id) do update set role = excluded.role`,
      [tenant, user, role],
    );

  await mkMembership(alphaTenant, editorId, "editor");
  await mkMembership(alphaTenant, contribId, "contributor");
  await mkMembership(alphaTenant, viewerId, "viewer");
  await mkMembership(betaTenant, editorId, "editor");

  const mkMap = async (
    tenant: string,
    slug: string,
    title: string,
    createdBy: string,
  ) => {
    const { rows } = await admin.query(
      `insert into maps (tenant_id, slug, title, center, zoom, basemap_style_id, created_by)
       values ($1, $2, $3, ST_GeogFromText('SRID=4326;POINT(0 0)'), 8, 'base', $4)
       returning id`,
      [tenant, slug, title, createdBy],
    );
    return rows[0].id as string;
  };

  alphaMap = await mkMap(alphaTenant, "m", "Alpha Map", editorId);
  contribMap = await mkMap(alphaTenant, "c", "Contributor Map", contribId);
  betaMap = await mkMap(betaTenant, "m", "Beta Map", editorId);

  alphaEditor = { tenantId: alphaTenant, userId: editorId, role: "editor" };
  alphaContrib = { tenantId: alphaTenant, userId: contribId, role: "contributor" };
  alphaViewer = { tenantId: alphaTenant, userId: viewerId, role: "viewer" };
  betaEditor = { tenantId: betaTenant, userId: editorId, role: "editor" };

  // max: 1 forces every operation onto the same physical connection, which is
  // what makes the context-leak test meaningful.
  repo = new PostgresRepo({ connectionString: APP_DATABASE_URL!, max: 1 });
});

after(async () => {
  if (!enabled) return;
  await repo.close();
  await admin.query("delete from tenants where slug in ('t-alpha','t-beta')");
  await admin.end();
});

/**
 * Raw SQL as `livemap_app`, with the three GUCs set exactly as PostgresRepo
 * sets them — and nothing else.
 *
 * The policy tests have to go around the repo. `applyEdit` consults authz.ts
 * before it ever reaches SQL, so a test driven through it would pass even with
 * every policy dropped: it would only be proving the TypeScript check. These
 * statements prove the database refuses on its own.
 */
async function asApp<T>(ctx: RepoCtx, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: APP_DATABASE_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query(
      `select set_config('app.tenant_id', $1, true),
              set_config('app.user_id',   $2, true),
              set_config('app.role',      $3, true)`,
      [ctx.tenantId, ctx.userId, ctx.role],
    );
    const out = await fn(c);
    await c.query("commit");
    return out;
  } finally {
    // Closing without a commit rolls back, which is what we want on failure.
    await c.end();
  }
}

/** 42501 (insufficient_privilege) is what a WITH CHECK violation raises. */
const RLS_DENIED = "42501";

const stroke = { color: "#ff0000", width: 2, opacity: 1 };
const labelStyle = {
  color: "#000000",
  haloColor: "#ffffff",
  haloWidth: 1.4,
  size: 12,
};

const allKinds = (): MapFeature[] => [
  {
    id: "area-1",
    kind: "area",
    at: "a0",
    rings: [
      [
        [0, 0],
        [0.1, 0],
        [0.1, 0.1],
        [0, 0.1],
        [0, 0],
      ],
    ],
    fill: { color: "#00ff00", opacity: 0.4 },
    stroke,
  },
  { id: "line-1", kind: "line", at: "a1", path: [[0, 0], [0.2, 0.2]], stroke },
  {
    id: "arrow-1",
    kind: "arrow",
    at: "a2",
    control: [[0, 0], [0.1, 0.05], [0.2, 0]],
    curvature: 0.7,
    head: "double",
    stroke,
    chevrons: true,
  },
  {
    id: "front-1",
    kind: "frontline",
    at: "a3",
    path: [[0, 0], [0.15, 0.02]],
    facing: "left",
    stroke,
    toothSpacing: 800,
    toothSize: 400,
  },
  {
    id: "pt-1",
    kind: "point",
    at: "a4",
    at_: [0.05, 0.05],
    icon: "ocha:Refugee",
    iconColor: "#ffffff",
    iconSize: 1.2,
    disc: { fill: "#780000", ring: "#ffffff" },
  },
  {
    id: "note-1",
    kind: "annotation",
    at: "a5",
    anchor: [0.08, 0.08],
    offset: [40, -30],
    text: { value: "ملاحظة", dir: "rtl" },
    labelStyle,
    leader: { color: "#222222", width: 1, shape: "elbow", anchorDot: true },
  },
];

test("every feature kind round-trips through the geometry/props codec", describeDb, async () => {
  const out = await repo.applyEdit(alphaEditor, alphaMap, 0, allKinds(), []);
  assert.deepEqual(out, { status: "applied", rev: 1 });

  const back = await repo.listFeatures(alphaEditor, alphaMap);
  assert.equal(back.length, 6);

  const byId = new Map(back.map((f) => [f.id, f]));

  const area = byId.get("area-1");
  assert.equal(area?.kind, "area");
  assert.equal(area.kind === "area" && area.rings[0]?.length, 5);
  assert.deepEqual(area.kind === "area" && area.rings[0]?.[1], [0.1, 0]);

  const arrow = byId.get("arrow-1");
  assert.equal(arrow?.kind, "arrow");
  // Control points, not a rendered curve: three in, three out.
  assert.equal(arrow.kind === "arrow" && arrow.control.length, 3);
  assert.equal(arrow.kind === "arrow" && arrow.head, "double");
  assert.equal(arrow.kind === "arrow" && arrow.chevrons, true);

  const front = byId.get("front-1");
  assert.equal(front.kind === "frontline" && front.facing, "left");
  assert.equal(front.kind === "frontline" && front.toothSpacing, 800);

  const pt = byId.get("pt-1");
  assert.deepEqual(pt.kind === "point" && pt.at_, [0.05, 0.05]);
  assert.deepEqual(pt.kind === "point" && pt.disc, {
    fill: "#780000",
    ring: "#ffffff",
  });

  const note = byId.get("note-1");
  assert.equal(note.kind === "annotation" && note.text.dir, "rtl");
  assert.equal(note.kind === "annotation" && note.text.value, "ملاحظة");
  // Screen-space px, preserved exactly — a geographic round-trip would drift.
  assert.deepEqual(note.kind === "annotation" && note.offset, [40, -30]);
  assert.equal(note.kind === "annotation" && note.leader?.shape, "elbow");
});

test("features come back ordered by fractional index", describeDb, async () => {
  const back = await repo.listFeatures(alphaEditor, alphaMap);
  const keys = back.map((f) => f.at);
  assert.deepEqual(keys, [...keys].sort());
});

// The column existed from 0001 and nothing ever wrote it. It is now filled from
// livemap_current_user() inside the statement, so the value in the row and the
// value the policies saw cannot disagree.
test("updated_by is stamped from app.user_id, not from a parameter", describeDb, async () => {
  const { rows } = await admin.query(
    `select distinct updated_by from features where map_id = $1`,
    [alphaMap],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].updated_by, editorId);
});

test("a stale revision loses instead of clobbering", describeDb, async () => {
  const doc = await repo.getMap(alphaEditor, alphaMap);
  const current = doc!.rev;

  const stale = await repo.applyEdit(
    alphaEditor,
    alphaMap,
    current - 1,
    [{ id: "line-1", kind: "line", at: "a1", path: [[9, 9], [9.5, 9.5]], stroke }],
    [],
  );
  assert.equal(stale.status, "stale", "a stale write must be refused");

  const back = await repo.listFeatures(alphaEditor, alphaMap);
  const line = back.find((f) => f.id === "line-1");
  assert.deepEqual(
    line?.kind === "line" && line.path[0],
    [0, 0],
    "the refused write must not have landed",
  );

  const fresh = await repo.applyEdit(alphaEditor, alphaMap, current, [], ["line-1"]);
  assert.deepEqual(fresh, { status: "applied", rev: current + 1 });
});

test("row-level security hides another tenant's map", describeDb, async () => {
  // Beta's map id is real and the query is well-formed; only the tenant scope
  // differs, so a null here is RLS doing its job rather than a missing row.
  const crossed = await repo.getMap(alphaEditor, betaMap);
  assert.equal(crossed, null);

  const own = await repo.getMap(betaEditor, betaMap);
  assert.equal(own?.title.value, "Beta Map");
});

test("an edit cannot reach into another tenant's map", describeDb, async () => {
  const out = await repo.applyEdit(
    alphaEditor,
    betaMap,
    0,
    [{ id: "intruder", kind: "line", at: "z", path: [[1, 1], [2, 2]], stroke }],
    [],
  );
  // Invisible, so indistinguishable from absent — which is the right answer.
  assert.equal(out.status, "not_found");

  const betaFeatures = await repo.listFeatures(betaEditor, betaMap);
  assert.equal(
    betaFeatures.find((f) => f.id === "intruder"),
    undefined,
  );
});

test("actor context does not leak across a reused pooled connection", describeDb, async () => {
  // The pool holds a single connection, so these calls run on the same backend.
  // `set_config(..., local => true)` scopes each GUC to the transaction; a plain
  // SET would persist and hand the next caller the previous one's tenant AND
  // role.
  const alpha = await repo.getMap(alphaEditor, alphaMap);
  assert.equal(alpha?.title.value, "Alpha Map");

  const betaSeesAlpha = await repo.getMap(betaEditor, alphaMap);
  assert.equal(betaSeesAlpha, null, "beta must not inherit alpha's scope");

  const alphaAgain = await repo.getMap(alphaEditor, alphaMap);
  assert.equal(alphaAgain?.title.value, "Alpha Map");

  // And the role does not persist either: after an editor transaction, a viewer
  // transaction on the same connection is still refused by the policies.
  await assert.rejects(
    () =>
      asApp(alphaViewer, (c) =>
        c.query(
          `insert into features (id, map_id, tenant_id, kind, at, props)
           values ('leaked', $1, $2, 'line', 'z', '{}'::jsonb)`,
          [alphaMap, alphaTenant],
        ),
      ),
    (err: { code?: string }) => err.code === RLS_DENIED,
  );
});

test("two tenants can use the same feature id", describeDb, async () => {
  // Regression: with a global `features.id` primary key this collided, and the
  // upsert's ON CONFLICT path then failed the RLS check instead of inserting.
  // Feature ids are client-generated, so collisions across tenants are certain.
  const shared: MapFeature = {
    id: "shared-id",
    kind: "line",
    at: "k0",
    path: [[1, 1], [2, 2]],
    stroke,
  };

  const alphaDoc = await repo.getMap(alphaEditor, alphaMap);
  const betaDoc = await repo.getMap(betaEditor, betaMap);

  const a = await repo.applyEdit(alphaEditor, alphaMap, alphaDoc!.rev, [shared], []);
  const b = await repo.applyEdit(betaEditor, betaMap, betaDoc!.rev, [shared], []);
  assert.equal(a.status, "applied", "alpha write should land");
  assert.equal(b.status, "applied", "beta write should land despite the duplicate id");

  const alphaFeatures = await repo.listFeatures(alphaEditor, alphaMap);
  const betaFeatures = await repo.listFeatures(betaEditor, betaMap);
  assert.equal(alphaFeatures.filter((f) => f.id === "shared-id").length, 1);
  assert.equal(betaFeatures.filter((f) => f.id === "shared-id").length, 1);
});

// ---------------------------------------------------------------------------
// Role policies — the database half of authz.ts
//
// These go through raw SQL on purpose. Driven through the repo they would pass
// with every policy dropped, because authz.ts would have refused first.
// ---------------------------------------------------------------------------

test("a viewer cannot insert a feature even with a valid tenant scope", describeDb, async () => {
  await assert.rejects(
    () =>
      asApp(alphaViewer, (c) =>
        c.query(
          `insert into features (id, map_id, tenant_id, kind, at, props)
           values ('viewer-write', $1, $2, 'line', 'z', '{}'::jsonb)`,
          [alphaMap, alphaTenant],
        ),
      ),
    (err: { code?: string }) => err.code === RLS_DENIED,
  );
});

test("a viewer's update of a map matches no rows", describeDb, async () => {
  // A USING clause filters rather than raises, so the refusal shows up as zero
  // rows affected. That is why applyEdit reads the row separately: otherwise
  // this is indistinguishable from a lost race.
  const n = await asApp(alphaViewer, async (c) => {
    const r = await c.query(`update maps set title = 'hijacked' where id = $1`, [
      alphaMap,
    ]);
    return r.rowCount;
  });
  assert.equal(n, 0);

  const { rows } = await admin.query(`select title from maps where id = $1`, [
    alphaMap,
  ]);
  assert.equal(rows[0].title, "Alpha Map");
});

test("a contributor may write to a map it created", describeDb, async () => {
  const n = await asApp(alphaContrib, async (c) => {
    const r = await c.query(
      `insert into features (id, map_id, tenant_id, kind, at, props)
       values ('own-feature', $1, $2, 'line', 'z', '{}'::jsonb)`,
      [contribMap, alphaTenant],
    );
    return r.rowCount;
  });
  assert.equal(n, 1);
});

test("a contributor may NOT write to a map someone else created", describeDb, async () => {
  await assert.rejects(
    () =>
      asApp(alphaContrib, (c) =>
        c.query(
          `insert into features (id, map_id, tenant_id, kind, at, props)
           values ('not-mine', $1, $2, 'line', 'z', '{}'::jsonb)`,
          [alphaMap, alphaTenant],
        ),
      ),
    (err: { code?: string }) => err.code === RLS_DENIED,
    "livemap_can_edit_map() should refuse a map the contributor does not own",
  );
});

test("a contributor cannot publish: the ledger refuses the insert", describeDb, async () => {
  await assert.rejects(
    () =>
      asApp(alphaContrib, (c) =>
        c.query(
          `insert into map_versions
             (map_id, version, tenant_id, etag, storage_key, byte_size,
              feature_count, published_by)
           values ($1, 99, $2, 'x', 'k', 1, 0, $3)`,
          [contribMap, alphaTenant, contribId],
        ),
      ),
    (err: { code?: string }) => err.code === RLS_DENIED,
  );
});

test("the version ledger is append-only in the database", describeDb, async () => {
  // No update or delete policy exists on map_versions, so both match no rows.
  // The read path hands out immutable artifacts keyed by these rows; a mutated
  // ledger row would point a cached reader at bytes that no longer match.
  await repo.recordNextVersion(alphaEditor, alphaMap, () => draft(editorId));

  const { update, remove } = await asApp(alphaEditor, async (c) => {
    const u = await c.query(
      `update map_versions set etag = 'rewritten' where map_id = $1`,
      [alphaMap],
    );
    const d = await c.query(`delete from map_versions where map_id = $1`, [
      alphaMap,
    ]);
    return { update: u.rowCount, remove: d.rowCount };
  });

  assert.equal(update, 0, "a ledger row was rewritten");
  assert.equal(remove, 0, "a ledger row was deleted");
});

// The reason livemap_granted_role() exists at all, rather than trusting the GUC.
test("a role claim with no matching membership grants nothing", describeDb, async () => {
  const stale: RepoCtx = {
    tenantId: alphaTenant,
    userId: viewerId,
    // The token says owner; the membership says viewer. A demotion that has not
    // yet expired every outstanding token looks exactly like this.
    role: "owner",
  };

  await assert.rejects(
    () =>
      asApp(stale, (c) =>
        c.query(
          `insert into features (id, map_id, tenant_id, kind, at, props)
           values ('stale-claim', $1, $2, 'line', 'z', '{}'::jsonb)`,
          [alphaMap, alphaTenant],
        ),
      ),
    (err: { code?: string }) => err.code === RLS_DENIED,
    "an unbacked role claim must not widen what the policies allow",
  );
});

test("a user with no membership in the tenant sees nothing", describeDb, async () => {
  const outsider: RepoCtx = {
    tenantId: alphaTenant,
    userId: contribId,
    role: "editor",
  };
  // contribId is a contributor here, never an editor, so the claim is unbacked
  // — but reads are role-independent, so the map is still visible. Only the
  // write is refused. This pins that reads did NOT regress into needing a role.
  const doc = await repo.getMap(outsider, alphaMap);
  assert.ok(doc, "selects must stay tenant-scoped only, not role-gated");
});

// ---------------------------------------------------------------------------
// Publish: atomic version allocation
// ---------------------------------------------------------------------------

const draft = (by: string): VersionDraft => ({
  etag: '"abc"',
  storageKey: "t/alpha/m/m/v/n.json",
  byteSize: 100,
  featureCount: 5,
  publishedAt: new Date().toISOString(),
  publishedBy: by,
});

test("the version ledger is per tenant", describeDb, async () => {
  const rec = await repo.recordNextVersion(betaEditor, betaMap, () =>
    draft(editorId),
  );
  assert.ok(rec);

  const latest = await repo.getLatestVersion(betaEditor, betaMap);
  assert.equal(latest?.version, rec!.version);
  assert.equal(latest?.etag, '"abc"');

  assert.equal(await repo.getLatestVersion(alphaEditor, betaMap), null);
});

test("recordNextVersion allocates distinct numbers under concurrency", describeDb, async () => {
  // This is the bug the method exists to close. nextVersion() and
  // recordVersion() were two transactions, so two publishers read the same
  // max(version) and the second collided on the (map_id, version) primary key
  // only after it had already uploaded an artifact. A pool of one would hide
  // that, so this test gets its own.
  const parallel = new PostgresRepo({
    connectionString: APP_DATABASE_URL!,
    max: 4,
  });
  try {
    const before = await parallel.getLatestVersion(alphaEditor, alphaMap);
    const base = before?.version ?? 0;

    const results = await Promise.all(
      [0, 1, 2, 3].map(() =>
        parallel.recordNextVersion(alphaEditor, alphaMap, () => draft(editorId)),
      ),
    );

    const versions = results.map((r) => r!.version).sort((a, b) => a - b);
    assert.deepEqual(
      versions,
      [base + 1, base + 2, base + 3, base + 4],
      "concurrent publishers must not be handed the same version number",
    );
  } finally {
    await parallel.close();
  }
});

test("recordNextVersion reports a vanished map instead of throwing", describeDb, async () => {
  const gone = await repo.recordNextVersion(
    alphaEditor,
    "00000000-0000-4000-8000-000000000000",
    () => draft(editorId),
  );
  assert.equal(gone, null);
});

test("loadForPublish returns the map, its features and the newest version", describeDb, async () => {
  const snap = await repo.loadForPublish(alphaEditor, alphaMap);
  assert.ok(snap);
  assert.equal(snap!.doc.id, alphaMap);
  assert.equal(snap!.createdBy, editorId);
  assert.ok(snap!.features.length > 0);
  assert.ok(snap!.latest, "a version has been recorded by now");

  // created_by must not have leaked into the document itself: the doc is
  // embedded verbatim in every published artifact, and those are public.
  assert.equal(
    "createdBy" in (snap!.doc as Record<string, unknown>),
    false,
    "an author's user id must not ride along into a public artifact",
  );
});

test("loadForPublish is tenant-scoped", describeDb, async () => {
  assert.equal(await repo.loadForPublish(betaEditor, alphaMap), null);
});

// ---------------------------------------------------------------------------
// Boot-time assertion
// ---------------------------------------------------------------------------

test("assertRlsActive passes against a correctly migrated database", describeDb, async () => {
  await repo.assertRlsActive();
});

test("assertRlsActive names the table when one is unprotected", describeDb, async () => {
  // schema_migrations is the migration runner's own bookkeeping table: it is
  // real, it is in the public schema, and it deliberately has no RLS. That
  // makes it a safe stand-in for "a table that should be protected and is not",
  // without having to disable a policy on a table that matters.
  await assert.rejects(
    () => repo.assertRlsActive(["maps", "schema_migrations"]),
    (err: Error) =>
      /schema_migrations/.test(err.message) &&
      /row level security is not enabled/.test(err.message) &&
      !/\bmaps\b/.test(err.message),
  );
});

test("assertRlsActive refuses a bypassrls connection", describeDb, async () => {
  // DATABASE_URL is the migration role, which has BYPASSRLS. Pointing the app
  // at it is the single misconfiguration that makes every policy in 0002
  // inert while the server still starts and answers normally.
  const wrong = new PostgresRepo({ connectionString: DATABASE_URL! });
  try {
    await assert.rejects(
      () => wrong.assertRlsActive(),
      (err: Error) => /BYPASSRLS/.test(err.message),
    );
  } finally {
    await wrong.close();
  }
});
