import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { templateSettings, type MapFeature, type Stroke } from "@livemap/core";
import { PostgresRepo } from "../src/postgres.js";
import { AdminDb } from "../src/admin.js";
import { PostgresGuestProvisioner } from "../src/guests.js";
import { isGuestSlug } from "../src/limits.js";
import type { EditInput, RepoCtx, VersionDraft } from "../src/repo.js";

// Integration tests against a real, migrated database: the row-level security
// policies, the version ledger and the codec. Without DATABASE_URL and
// APP_DATABASE_URL they skip rather than fail. The guest-provisioning test also
// needs ADMIN_DATABASE_URL.
const { DATABASE_URL, APP_DATABASE_URL, ADMIN_DATABASE_URL } = process.env;
const enabled = Boolean(DATABASE_URL && APP_DATABASE_URL);
const describeDb = { skip: enabled ? false : "DATABASE_URL not set" };
const describeAdmin = { skip: enabled && ADMIN_DATABASE_URL ? false : "ADMIN_DATABASE_URL not set" };

const SLUGS = ["t-alpha", "t-beta"];
const EMAILS = ["rls-editor@livemap.test", "rls-contrib@livemap.test", "rls-viewer@livemap.test", "rls-outsider@livemap.test"];

let admin: pg.Client | undefined;
let repo: PostgresRepo | undefined;

let alphaTenant = "";
let betaTenant = "";
let editorId = "";
let contribId = "";
let viewerId = "";
let outsiderId = "";

// Contexts, named for the pair that matters: which tenant, and as whom. Each
// role is backed by a real membership row, because livemap_granted_role()
// honours the app.role GUC only where a membership grants it.
let alphaEditor: RepoCtx;
let alphaContrib: RepoCtx;
let alphaViewer: RepoCtx;
let betaEditor: RepoCtx;

const db = (): pg.Client => admin!;
const pgRepo = (): PostgresRepo => repo!;

before(async () => {
  if (!enabled) return;

  admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query("delete from tenants where slug = any($1)", [SLUGS]);

  const mkTenant = async (slug: string, dir: string) => {
    const { rows } = await db().query(`insert into tenants (slug, name, default_dir) values ($1, $1, $2) returning id`, [slug, dir]);
    return rows[0].id as string;
  };
  alphaTenant = await mkTenant("t-alpha", "ltr");
  betaTenant = await mkTenant("t-beta", "rtl");

  const mkUser = async (email: string) => {
    const { rows } = await db().query(
      `insert into users (email, name) values ($1, $2)
       on conflict (email) do update set name = excluded.name returning id`,
      [email, email.split("@")[0]],
    );
    return rows[0].id as string;
  };
  [editorId, contribId, viewerId, outsiderId] = await Promise.all(EMAILS.map(mkUser)) as [string, string, string, string];

  const grant = (tenant: string, user: string, role: string) =>
    db().query(
      `insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)
       on conflict (tenant_id, user_id) do update set role = excluded.role`,
      [tenant, user, role],
    );
  await grant(alphaTenant, editorId, "editor");
  await grant(alphaTenant, contribId, "contributor");
  await grant(alphaTenant, viewerId, "viewer");
  await grant(betaTenant, editorId, "editor");

  alphaEditor = { tenantId: alphaTenant, userId: editorId, role: "editor" };
  alphaContrib = { tenantId: alphaTenant, userId: contribId, role: "contributor" };
  alphaViewer = { tenantId: alphaTenant, userId: viewerId, role: "viewer" };
  betaEditor = { tenantId: betaTenant, userId: editorId, role: "editor" };

  // max: 1 forces every repo call onto the same physical connection, which is
  // what makes the context-leak test meaningful.
  repo = new PostgresRepo({ connectionString: APP_DATABASE_URL!, max: 1 });
});

// Every handle is closed even when setup failed halfway: an unclosed client
// keeps the test process alive forever, which is how CI hung for six hours.
after(async () => {
  if (!enabled) return;
  try {
    await repo?.close();
  } finally {
    if (admin) {
      try {
        await admin.query("delete from tenants where slug = any($1)", [SLUGS]);
      } finally {
        await admin.end();
      }
    }
  }
});

let slugN = 0;

/** A map inserted as the migrator, so the fixture does not depend on the code under test. */
async function mkMap(tenant: string, createdBy: string, title = "Map"): Promise<string> {
  const { rows } = await db().query(
    `insert into maps (tenant_id, slug, title, title_dir, ui_dir, settings, created_by, updated_by)
     values ($1, $2, $3, 'ltr', 'ltr', $4::jsonb, $5, $5) returning id`,
    [tenant, `m-${++slugN}`, title, JSON.stringify(templateSettings("blank", "ltr")), createdBy],
  );
  return rows[0].id as string;
}

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
const isDenied = (err: { code?: string }) => err.code === RLS_DENIED;

const insertFeature = (c: pg.Client, id: string, mapId: string, tenantId: string) =>
  c.query(
    `insert into features (id, map_id, tenant_id, kind, order_key, props, updated_by)
     values ($1, $2, $3, 'line', 'z', '{}'::jsonb, livemap_current_user())`,
    [id, mapId, tenantId],
  );

const stroke: Stroke = { color: { slot: 1 }, width: 2, opacity: 1, dash: "solid" };

const base = (id: string, order: string) => ({
  id,
  order,
  name: { value: id, dir: "ltr" as const },
  groupId: null,
  hidden: false,
  locked: false,
  presetId: null,
  validFrom: null,
  validTo: null,
  lineageId: null,
  updatedAt: "",
  updatedBy: "",
});

const line = (id: string, path: [number, number][] = [[0, 0], [0.2, 0.2]]): MapFeature => ({
  ...base(id, "a1"),
  kind: "line",
  path,
  stroke,
});

const allKinds = (): MapFeature[] => [
  {
    ...base("area-1", "a0"),
    kind: "area",
    rings: [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]],
    fill: { color: { slot: 3 }, opacity: 0.4, pattern: "hatch" },
    stroke,
  },
  { ...line("line-1"), validFrom: "2026-11-01T00:00:00.000Z", validTo: "2026-11-02T00:00:00.000Z", lineageId: "front" },
  {
    ...base("arrow-1", "a2"),
    kind: "arrow",
    control: [[0, 0], [0.1, 0.05], [0.2, 0]],
    curvature: 0.7,
    bend: "right",
    head: "double",
    tapered: true,
    stroke: { ...stroke, dash: { custom: [4, 2] } },
  },
  {
    ...base("front-1", "a3"),
    kind: "frontline",
    path: [[0, 0], [0.15, 0.02]],
    facing: "left",
    toothShape: "semicircle",
    toothSpacing: 18,
    toothSize: 6,
    stroke,
  },
  {
    ...base("pt-1", "a4"),
    kind: "point",
    at: [0.05, 0.05],
    symbol: { number: "12" },
    color: { custom: "#780000" },
    size: 24,
    label: { value: "نقطة", dir: "rtl" },
  },
  {
    ...base("note-1", "a5"),
    kind: "annotation",
    anchor: [0.08, 0.08],
    textAt: [0.09, 0.07],
    text: { value: "ملاحظة", dir: "rtl" },
    labelStyle: { color: "ink", size: 13, weight: 600, halo: true, box: false },
    leader: { shape: "elbow", anchorDot: true },
  },
];

const edit = (rev: number, put: MapFeature[] = [], del: string[] = []): EditInput => ({ rev, force: false, put, delete: del });
const ROOMY = { maxFeaturesPerMap: 1000 };

const draft = (): VersionDraft => ({
  etag: '"abc"',
  storageKey: "t/alpha/m/m/v/n.json",
  byteSize: 100,
  featureCount: 5,
  publishedAt: new Date().toISOString(),
  sourceRev: 0,
  origin: { type: "publish", rev: 0 },
});

const withoutStamps = ({ updatedAt: _at, updatedBy: _by, ...rest }: MapFeature) => rest;

// ---------------------------------------------------------------------------
// Data integrity: the codec and the revision guard
// ---------------------------------------------------------------------------

test("every feature kind round-trips through the geometry/props codec unchanged", describeDb, async () => {
  const mapId = await mkMap(alphaTenant, editorId);
  const sent = allKinds();
  const out = await pgRepo().applyEdit(alphaEditor, mapId, edit(0, sent), ROOMY);
  assert.equal(out.status, "applied");

  const back = (await pgRepo().getMap(alphaEditor, mapId))!.features;
  const byId = new Map(back.map((f) => [f.id, f]));
  for (const feature of sent) {
    const stored = byId.get(feature.id);
    assert.ok(stored, `${feature.id} was not stored`);
    assert.deepEqual(withoutStamps(stored), withoutStamps(feature), `${feature.kind} changed on the way through the database`);
  }
});

test("a stale revision loses instead of clobbering", describeDb, async () => {
  const mapId = await mkMap(alphaTenant, editorId);
  const first = await pgRepo().applyEdit(alphaEditor, mapId, edit(0, [line("line-1")]), ROOMY);
  assert.equal(first.status, "applied");

  const stale = await pgRepo().applyEdit(alphaEditor, mapId, edit(0, [line("line-1", [[9, 9], [9.5, 9.5]])]), ROOMY);
  assert.equal(stale.status, "stale", "a write against an old revision must be refused");

  const stored = (await pgRepo().getMap(alphaEditor, mapId))!.features.find((f) => f.id === "line-1");
  assert.deepEqual(stored?.kind === "line" && stored.path[0], [0, 0], "the refused write must not have landed");
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("row-level security hides another tenant's map", describeDb, async () => {
  const betaMap = await mkMap(betaTenant, editorId, "Beta Map");
  // The id is real and the query well-formed; only the tenant scope differs.
  assert.equal(await pgRepo().getMap(alphaEditor, betaMap), null);
  assert.equal((await pgRepo().getMap(betaEditor, betaMap))?.map.title.value, "Beta Map");
});

test("an edit cannot reach into another tenant's map", describeDb, async () => {
  const betaMap = await mkMap(betaTenant, editorId);
  const out = await pgRepo().applyEdit(alphaEditor, betaMap, edit(0, [line("intruder")]), ROOMY);
  // Invisible, so indistinguishable from absent — which is the right answer.
  assert.equal(out.status, "not_found");
  const { rows } = await db().query(`select 1 from features where map_id = $1`, [betaMap]);
  assert.equal(rows.length, 0);
});

test("actor context does not leak across a reused pooled connection", describeDb, async () => {
  // The pool holds a single connection, so these calls run on the same backend.
  // `set_config(..., true)` scopes each GUC to the transaction; a plain SET
  // would persist and hand the next caller the previous one's tenant and role.
  const alphaMap = await mkMap(alphaTenant, editorId, "Alpha Map");
  assert.equal((await pgRepo().getMap(alphaEditor, alphaMap))?.map.title.value, "Alpha Map");
  assert.equal(await pgRepo().getMap(betaEditor, alphaMap), null, "beta must not inherit alpha's scope");
  assert.equal((await pgRepo().getMap(alphaEditor, alphaMap))?.map.title.value, "Alpha Map");

  // After an editor's transaction, a viewer's is still refused by the policies.
  await assert.rejects(() => asApp(alphaViewer, (c) => insertFeature(c, "leaked", alphaMap, alphaTenant)), isDenied);
});

test("two tenants can use the same feature id", describeDb, async () => {
  // Regression: with a global `features.id` key this collided, and the upsert's
  // ON CONFLICT path failed the RLS check. Feature ids are client-generated.
  const alphaMap = await mkMap(alphaTenant, editorId);
  const betaMap = await mkMap(betaTenant, editorId);
  assert.equal((await pgRepo().applyEdit(alphaEditor, alphaMap, edit(0, [line("shared-id")]), ROOMY)).status, "applied");
  assert.equal((await pgRepo().applyEdit(betaEditor, betaMap, edit(0, [line("shared-id")]), ROOMY)).status, "applied");

  const { rows } = await db().query(`select map_id from features where id = 'shared-id' and map_id = any($1)`, [[alphaMap, betaMap]]);
  assert.equal(rows.length, 2);
});

test("reads are scoped by tenant, not gated by the role claim", describeDb, async () => {
  // The contributor claims editor. Reads stay visible (they are tenant-scoped
  // only); the next test shows the unbacked claim still widens no write.
  const alphaMap = await mkMap(alphaTenant, editorId);
  assert.ok(await pgRepo().getMap({ ...alphaContrib, role: "editor" }, alphaMap));
});

test("loadForPublish is tenant-scoped", describeDb, async () => {
  const alphaMap = await mkMap(alphaTenant, editorId);
  assert.equal(await pgRepo().loadForPublish(betaEditor, alphaMap), null);
});

// ---------------------------------------------------------------------------
// Role policies — the database half of authz.ts. Raw SQL on purpose: through
// the repo these would pass with every policy dropped.
// ---------------------------------------------------------------------------

test("a role claim with no matching membership grants nothing", describeDb, async () => {
  // The token says owner; the membership says viewer. A demotion that has not
  // yet expired every outstanding token looks exactly like this.
  const alphaMap = await mkMap(alphaTenant, editorId);
  await assert.rejects(
    () => asApp({ ...alphaViewer, role: "owner" }, (c) => insertFeature(c, "stale-claim", alphaMap, alphaTenant)),
    isDenied,
  );
});

test("membershipRole reads the database, not the claim", describeDb, async () => {
  assert.equal(await pgRepo().membershipRole({ ...alphaViewer, role: "owner" }), "viewer");
  assert.equal(await pgRepo().membershipRole(alphaEditor), "editor");
});

test("membershipRole is null for a user with no membership here", describeDb, async () => {
  assert.equal(await pgRepo().membershipRole({ tenantId: alphaTenant, userId: outsiderId, role: "owner" }), null);
});

test("a viewer cannot insert a feature even with a valid tenant scope", describeDb, async () => {
  const alphaMap = await mkMap(alphaTenant, editorId);
  await assert.rejects(() => asApp(alphaViewer, (c) => insertFeature(c, "viewer-write", alphaMap, alphaTenant)), isDenied);
});

test("a viewer's update of a map matches no rows", describeDb, async () => {
  // A USING clause filters rather than raises, so the refusal is zero rows.
  const alphaMap = await mkMap(alphaTenant, editorId, "Alpha Map");
  const n = await asApp(alphaViewer, async (c) => (await c.query(`update maps set title = 'hijacked' where id = $1`, [alphaMap])).rowCount);
  assert.equal(n, 0);
  const { rows } = await db().query(`select title from maps where id = $1`, [alphaMap]);
  assert.equal(rows[0].title, "Alpha Map");
});

test("a viewer's createMap is refused by the database itself", describeDb, async () => {
  // The route checks the capability first; this goes around it on purpose.
  await assert.rejects(
    () => pgRepo().createMap(alphaViewer, { title: { value: "Should Not Exist", dir: "ltr" }, uiDir: "ltr", settings: templateSettings("blank", "ltr") }, { maxMaps: 50 }),
    isDenied,
  );
  const { rows } = await db().query(`select 1 from maps where tenant_id = $1 and title = 'Should Not Exist'`, [alphaTenant]);
  assert.equal(rows.length, 0);
});

test("a contributor may write to a map it created", describeDb, async () => {
  const contribMap = await mkMap(alphaTenant, contribId);
  const n = await asApp(alphaContrib, async (c) => (await insertFeature(c, "own-feature", contribMap, alphaTenant)).rowCount);
  assert.equal(n, 1);
});

test("a contributor may NOT write to a map someone else created", describeDb, async () => {
  const alphaMap = await mkMap(alphaTenant, editorId);
  await assert.rejects(() => asApp(alphaContrib, (c) => insertFeature(c, "not-mine", alphaMap, alphaTenant)), isDenied);
});

test("a contributor may retitle its own map and not another's", describeDb, async () => {
  const mine = await mkMap(alphaTenant, contribId, "Mine");
  const theirs = await mkMap(alphaTenant, editorId, "Theirs");
  const renamed = await asApp(alphaContrib, async (c) => ({
    mine: (await c.query(`update maps set title = 'Renamed' where id = $1`, [mine])).rowCount,
    theirs: (await c.query(`update maps set title = 'Renamed' where id = $1`, [theirs])).rowCount,
  }));
  assert.deepEqual(renamed, { mine: 1, theirs: 0 });
});

test("a contributor cannot publish: the ledger refuses the insert", describeDb, async () => {
  const contribMap = await mkMap(alphaTenant, contribId);
  await assert.rejects(
    () =>
      asApp(alphaContrib, (c) =>
        c.query(
          `insert into map_versions
             (map_id, version, tenant_id, etag, storage_key, byte_size, feature_count, published_by, source_rev)
           values ($1, 99, $2, 'x', 'k', 1, 0, $3, 0)`,
          [contribMap, alphaTenant, contribId],
        ),
      ),
    isDenied,
  );
});

// ---------------------------------------------------------------------------
// The version ledger
// ---------------------------------------------------------------------------

test("the version ledger is append-only in the database", describeDb, async () => {
  // A mutated ledger row would point a cached reader at bytes that no longer match.
  const alphaMap = await mkMap(alphaTenant, editorId);
  assert.ok(await pgRepo().recordNextVersion(alphaEditor, alphaMap, draft));

  const { update, remove } = await asApp(alphaEditor, async (c) => ({
    update: (await c.query(`update map_versions set etag = 'rewritten' where map_id = $1`, [alphaMap])).rowCount,
    remove: (await c.query(`delete from map_versions where map_id = $1`, [alphaMap])).rowCount,
  }));
  assert.equal(update, 0, "a ledger row was rewritten");
  assert.equal(remove, 0, "a ledger row was deleted");
});

test("the version ledger is per tenant", describeDb, async () => {
  const betaMap = await mkMap(betaTenant, editorId);
  const rec = await pgRepo().recordNextVersion(betaEditor, betaMap, draft);
  assert.ok(rec);
  assert.equal((await pgRepo().getLatestVersion(betaEditor, betaMap))?.version, rec.version);
  assert.equal(await pgRepo().getLatestVersion(alphaEditor, betaMap), null);
});

test("recordNextVersion allocates distinct numbers under concurrency", describeDb, async () => {
  // Regression: allocation and insert were two transactions, so two publishers
  // read the same max(version) and collided after uploading. A pool of one
  // would hide that, so this test gets its own.
  const alphaMap = await mkMap(alphaTenant, editorId);
  const parallel = new PostgresRepo({ connectionString: APP_DATABASE_URL!, max: 4 });
  try {
    const results = await Promise.all([0, 1, 2, 3].map(() => parallel.recordNextVersion(alphaEditor, alphaMap, draft)));
    assert.deepEqual(
      results.map((r) => r!.version).sort((a, b) => a - b),
      [1, 2, 3, 4],
      "concurrent publishers must not be handed the same version number",
    );
  } finally {
    await parallel.close();
  }
});

// ---------------------------------------------------------------------------
// Unparseable input and boot-time checks
// ---------------------------------------------------------------------------

test("a map id that is not a uuid misses instead of raising", describeDb, async () => {
  // Postgres raises 22P02 (invalid_text_representation) on the cast, and the
  // route would answer 500 for what is plainly a 404.
  const bad = "not-a-uuid";
  assert.equal(await pgRepo().getMap(alphaEditor, bad), null);
  assert.deepEqual(await pgRepo().applyEdit(alphaEditor, bad, edit(0), ROOMY), { status: "not_found" });
  assert.deepEqual(await pgRepo().setArchived({ ...alphaEditor, role: "owner" }, bad, true, { maxMaps: 50 }), { status: "not_found" });
  assert.deepEqual(await pgRepo().listVersions(alphaEditor, bad), []);
  assert.equal(await pgRepo().getVersion(alphaEditor, bad, 1), null);
  assert.equal(await pgRepo().getLatestVersion(alphaEditor, bad), null);
  assert.equal(await pgRepo().loadForPublish(alphaEditor, bad), null);
  assert.equal(await pgRepo().recordNextVersion(alphaEditor, bad, draft), null);
});

test("assertRlsActive passes against a correctly migrated database", describeDb, async () => {
  await pgRepo().assertRlsActive();
});

test("assertRlsActive names the table when one is unprotected", describeDb, async () => {
  // schema_migrations is the runner's own table: real, public, and deliberately
  // without RLS — a safe stand-in for a table that lost its policies.
  await assert.rejects(
    () => pgRepo().assertRlsActive(["maps", "schema_migrations"]),
    (err: Error) =>
      /schema_migrations/.test(err.message) && /row level security is not enabled/.test(err.message) && !/\bmaps\b/.test(err.message),
  );
});

test("assertRlsActive refuses a bypassrls connection", describeDb, async () => {
  // DATABASE_URL is the migration role, which has BYPASSRLS. Pointing the app
  // at it makes every policy inert while the server still answers normally.
  const wrong = new PostgresRepo({ connectionString: DATABASE_URL! });
  try {
    await assert.rejects(() => wrong.assertRlsActive(), (err: Error) => /BYPASSRLS/.test(err.message));
  } finally {
    await wrong.close();
  }
});

// ---------------------------------------------------------------------------
// Guest provisioning, the one cross-tenant write
// ---------------------------------------------------------------------------

test("a provisioned guest is an owner who can create a map through the policy, and sees only its own", describeAdmin, async () => {
  const adminDb = new AdminDb({ connectionString: ADMIN_DATABASE_URL! });
  const provisioner = new PostgresGuestProvisioner(adminDb);
  let slug = "";
  let userId = "";
  try {
    await adminDb.assertBypassesRls();
    const guest = await provisioner.provision();
    slug = guest.tenantSlug;
    userId = guest.userId;
    assert.ok(isGuestSlug(guest.tenantSlug));

    // Everything after provisioning goes through the RLS-scoped pool.
    assert.equal(await pgRepo().membershipRole(guest), "owner");
    const out = await pgRepo().createMap(guest, { title: { value: "Guest Map", dir: "ltr" }, uiDir: "ltr", settings: templateSettings("blank", "ltr") }, { maxMaps: 50 });
    assert.equal(out.status, "created");
    assert.equal((await pgRepo().listMaps(guest, { archived: false })).length, 1);
  } finally {
    // Tenant first: maps.created_by references the user without a cascade.
    if (slug) await db().query("delete from tenants where slug = $1", [slug]);
    if (userId) await db().query("delete from users where id = $1", [userId]);
    await adminDb.close();
  }
});
