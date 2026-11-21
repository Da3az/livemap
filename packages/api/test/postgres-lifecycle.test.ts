import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { MapFeature } from "@livemap/core";
import { PostgresRepo } from "../src/postgres.js";
import { AdminDb } from "../src/admin.js";
import { PostgresGuestProvisioner } from "../src/guests.js";
import { isGuestSlug } from "../src/limits.js";
import type { MapDraft, RepoCtx, VersionDraft } from "../src/repo.js";

// Integration tests for map lifecycle and guest provisioning. Same contract as
// postgres.test.ts: they need the compose stack and a migrated database, and
// skip without DATABASE_URL. Their own tenant, so the two files cannot
// disturb each other's rows.
const { DATABASE_URL, APP_DATABASE_URL, ADMIN_DATABASE_URL } = process.env;
const enabled = Boolean(DATABASE_URL && APP_DATABASE_URL);
const describeDb = { skip: enabled ? false : "DATABASE_URL not set" };
const describeAdmin = {
  skip: enabled && ADMIN_DATABASE_URL ? false : "ADMIN_DATABASE_URL not set",
};

const SLUG = "t-lifecycle";

let admin: pg.Client;
let repo: PostgresRepo;
let tenant = "";
let editorId = "";
let contribId = "";
let viewerId = "";
let outsiderId = "";

let editor: RepoCtx;
let contrib: RepoCtx;
let viewer: RepoCtx;

const LIMITS = { maxMaps: 50 };

const draft = (title: string, features: MapFeature[] = []): MapDraft => ({
  title: { value: title, dir: "ltr" },
  uiDir: "ltr",
  viewport: { center: [12.5, 41.9], zoom: 6, bearing: 0, pitch: 0 },
  basemap: { styleId: "light", labelLangs: ["en"] },
  features,
});

const point = (id: string): MapFeature => ({
  id,
  kind: "point",
  at: "V",
  at_: [12.5, 41.9],
  icon: "evt:aid",
  iconColor: "#1F7A4C",
  iconSize: 1,
});

before(async () => {
  if (!enabled) return;

  admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query("delete from tenants where slug = $1", [SLUG]);

  const { rows } = await admin.query(
    `insert into tenants (slug, name) values ($1, $1) returning id`,
    [SLUG],
  );
  tenant = rows[0].id;

  const mkUser = async (email: string) => {
    const r = await admin.query(
      `insert into users (email, name) values ($1, $1)
       on conflict (email) do update set name = excluded.name returning id`,
      [email],
    );
    return r.rows[0].id as string;
  };
  editorId = await mkUser("life-editor@livemap.test");
  contribId = await mkUser("life-contrib@livemap.test");
  viewerId = await mkUser("life-viewer@livemap.test");
  outsiderId = await mkUser("life-outsider@livemap.test");

  for (const [user, role] of [
    [editorId, "editor"],
    [contribId, "contributor"],
    [viewerId, "viewer"],
  ] as const) {
    await admin.query(
      `insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)`,
      [tenant, user, role],
    );
  }

  editor = { tenantId: tenant, userId: editorId, role: "editor" };
  contrib = { tenantId: tenant, userId: contribId, role: "contributor" };
  viewer = { tenantId: tenant, userId: viewerId, role: "viewer" };

  repo = new PostgresRepo({ connectionString: APP_DATABASE_URL!, max: 2 });
});

after(async () => {
  if (!enabled) return;
  await repo.close();
  await admin.query("delete from tenants where slug = $1", [SLUG]);
  await admin.end();
});

async function create(ctx: RepoCtx, title: string, features: MapFeature[] = []) {
  const out = await repo.createMap(ctx, draft(title, features), LIMITS);
  assert.equal(out.status, "created");
  if (out.status !== "created") throw new Error("unreachable");
  return out.doc;
}

test("membershipRole reads the database, not the claim", describeDb, async () => {
  // The viewer claims to be an owner. The claim is ignored.
  assert.equal(await repo.membershipRole({ ...viewer, role: "owner" }), "viewer");
  assert.equal(await repo.membershipRole(editor), "editor");
});

test("membershipRole is null for a user with no membership here", describeDb, async () => {
  assert.equal(
    await repo.membershipRole({ tenantId: tenant, userId: outsiderId, role: "owner" }),
    null,
  );
});

test("createMap inserts through the policy, authored by the actor", describeDb, async () => {
  const doc = await create(editor, "Policy Call Site", [point("p1"), point("p2")]);
  assert.equal(doc.slug, "policy-call-site");
  assert.equal(doc.rev, 0);
  assert.deepEqual(doc.viewport.center, [12.5, 41.9]);

  const { rows } = await admin.query(
    `select created_by, tenant_id from maps where id = $1`,
    [doc.id],
  );
  assert.equal(rows[0].created_by, editorId);
  assert.equal(rows[0].tenant_id, tenant);

  const feats = await repo.listFeatures(editor, doc.id);
  assert.deepEqual(feats.map((f) => f.id).sort(), ["p1", "p2"]);
});

test("createMap gives a repeated title the next free slug", describeDb, async () => {
  const a = await create(editor, "Same Title");
  const b = await create(editor, "Same Title");
  assert.equal(a.slug, "same-title");
  assert.equal(b.slug, "same-title-2");
});

test("concurrent creates with one title both succeed with distinct slugs", describeDb, async () => {
  // Both read the slugs in use before either inserts; the unique index picks
  // a loser and the repo retries it in a fresh transaction.
  const [a, b] = await Promise.all([
    create(editor, "Racing Title"),
    create(editor, "Racing Title"),
  ]);
  assert.notEqual(a.slug, b.slug);
  assert.deepEqual([a.slug, b.slug].sort(), ["racing-title", "racing-title-2"]);
});

test("a viewer's createMap is refused by the database itself", describeDb, async () => {
  // The route checks the capability first. This goes around the route on
  // purpose: the insert policy has to hold without it.
  await assert.rejects(
    () => repo.createMap(viewer, draft("Should Not Exist"), LIMITS),
    (err: { code?: string }) => err.code === "42501",
  );
  const { rows } = await admin.query(
    `select 1 from maps where tenant_id = $1 and slug = 'should-not-exist'`,
    [tenant],
  );
  assert.equal(rows.length, 0);
});

test("createMap refuses at the limit and leaves nothing behind", describeDb, async () => {
  const have = await repo.countMaps(editor);
  const out = await repo.createMap(editor, draft("Over Quota", [point("p1")]), {
    maxMaps: have,
  });
  assert.equal(out.status, "quota");
  assert.equal(await repo.countMaps(editor), have);
});

test("updateMap changes the title and leaves rev and slug alone", describeDb, async () => {
  const doc = await create(editor, "Before Rename");
  const out = await repo.updateMap(editor, doc.id, {
    title: { value: "بعد", dir: "rtl" },
    uiDir: "rtl",
  });
  assert.equal(out.status, "updated");
  if (out.status !== "updated") return;
  assert.deepEqual(out.doc.title, { value: "بعد", dir: "rtl" });
  assert.equal(out.doc.uiDir, "rtl");
  assert.equal(out.doc.rev, 0);
  assert.equal(out.doc.slug, "before-rename");
});

test("updateMap with only a direction keeps the title", describeDb, async () => {
  const doc = await create(editor, "Keep Me");
  const out = await repo.updateMap(editor, doc.id, { uiDir: "rtl" });
  assert.equal(out.status, "updated");
  if (out.status !== "updated") return;
  assert.equal(out.doc.title.value, "Keep Me");
});

test("a contributor may rename their own map and not another's", describeDb, async () => {
  const mine = await create(contrib, "Contrib Own");
  const theirs = await create(editor, "Editor Own");

  const ok = await repo.updateMap(contrib, mine.id, { uiDir: "rtl" });
  assert.equal(ok.status, "updated");

  const no = await repo.updateMap(contrib, theirs.id, { uiDir: "rtl" });
  assert.equal(no.status, "forbidden");
});

test("archiving hides a map from reads but not from the count", describeDb, async () => {
  const doc = await create(editor, "To Archive");
  const before = await repo.countMaps(editor);

  assert.deepEqual(await repo.setArchived(editor, doc.id, true), { status: "ok" });
  assert.equal(await repo.getMap(editor, doc.id), null);
  assert.equal(await repo.countMaps(editor), before);

  const live = await repo.listMaps(editor, { archived: false });
  const gone = await repo.listMaps(editor, { archived: true });
  assert.ok(!live.some((m) => m.id === doc.id));
  assert.ok(gone.some((m) => m.id === doc.id && m.archived));

  assert.deepEqual(await repo.setArchived(editor, doc.id, false), { status: "ok" });
  assert.ok(await repo.getMap(editor, doc.id));
});

test("listMaps carries a feature count and is tenant-scoped", describeDb, async () => {
  const doc = await create(editor, "Counted", [point("a"), point("b"), point("c")]);
  const maps = await repo.listMaps(editor, { archived: false });
  assert.equal(maps.find((m) => m.id === doc.id)?.featureCount, 3);

  const { rows } = await admin.query(
    `select count(*)::int as n from maps where tenant_id = $1 and archived_at is null`,
    [tenant],
  );
  assert.equal(maps.length, rows[0].n);
});

test("an edit past the feature limit rolls back whole", describeDb, async () => {
  const doc = await create(editor, "Feature Quota", [point("p1")]);
  const out = await repo.applyEdit(
    editor,
    doc.id,
    0,
    [point("p2"), point("p3")],
    [],
    { maxFeaturesPerMap: 2 },
  );
  assert.equal(out.status, "quota");

  // The revision bump and both inserts were in the abandoned transaction.
  assert.equal((await repo.getMap(editor, doc.id))!.rev, 0);
  assert.equal((await repo.listFeatures(editor, doc.id)).length, 1);

  // Replacing at the limit adds no row, so it is not over it.
  const ok = await repo.applyEdit(editor, doc.id, 0, [point("p1")], [], {
    maxFeaturesPerMap: 1,
  });
  assert.equal(ok.status, "applied");
});

test("listVersions is newest first and getVersion finds one", describeDb, async () => {
  const doc = await create(editor, "Versioned");
  const build = (version: number): VersionDraft => ({
    etag: `"e${version}"`,
    storageKey: `t/${SLUG}/m/${doc.slug}/v/${version}.json`,
    byteSize: 10,
    featureCount: 0,
    publishedAt: new Date().toISOString(),
    publishedBy: editorId,
  });
  await repo.recordNextVersion(editor, doc.id, build);
  await repo.recordNextVersion(editor, doc.id, build);

  const all = await repo.listVersions(editor, doc.id);
  assert.deepEqual(all.map((v) => v.version), [2, 1]);

  const one = await repo.getVersion(editor, doc.id, 1);
  assert.equal(one?.storageKey, `t/${SLUG}/m/${doc.slug}/v/1.json`);
  assert.equal(await repo.getVersion(editor, doc.id, 9), null);
});

test("a provisioned guest is an owner who can create a map through the policy", describeAdmin, async () => {
  const adminDb = new AdminDb({ connectionString: ADMIN_DATABASE_URL! });
  const provisioner = new PostgresGuestProvisioner(adminDb);
  let slug = "";
  let userId = "";
  try {
    await adminDb.assertBypassesRls();
    const before = await provisioner.count();
    const guest = await provisioner.provision();
    slug = guest.tenantSlug;
    userId = guest.userId;

    assert.ok(isGuestSlug(guest.tenantSlug));
    assert.equal(await provisioner.count(), before + 1);

    // Everything after provisioning goes through the RLS-scoped pool.
    assert.equal(await repo.membershipRole(guest), "owner");
    assert.equal(await repo.countMaps(guest), 0);

    const out = await repo.createMap(guest, draft("Guest Map"), LIMITS);
    assert.equal(out.status, "created");

    // And the guest sees none of the other tenant's maps.
    assert.equal((await repo.listMaps(guest, { archived: false })).length, 1);
  } finally {
    // Tenant first: maps.created_by references the user without a cascade.
    if (slug) await admin.query("delete from tenants where slug = $1", [slug]);
    if (userId) await admin.query("delete from users where id = $1", [userId]);
    await adminDb.close();
  }
});

test("a map id that is not a uuid misses instead of raising", describeDb, async () => {
  // Postgres would raise 22P02 (invalid_text_representation) on the cast, and
  // the route would answer 500 for what is plainly a 404.
  const bad = "not-a-uuid";
  assert.equal(await repo.getMap(editor, bad), null);
  assert.deepEqual(await repo.listFeatures(editor, bad), []);
  assert.deepEqual(await repo.applyEdit(editor, bad, 0, [], []), {
    status: "not_found",
  });
  assert.deepEqual(await repo.updateMap(editor, bad, { uiDir: "rtl" }), {
    status: "not_found",
  });
  assert.deepEqual(await repo.setArchived(editor, bad, true), {
    status: "not_found",
  });
  assert.deepEqual(await repo.listVersions(editor, bad), []);
  assert.equal(await repo.getVersion(editor, bad, 1), null);
  assert.equal(await repo.loadForPublish(editor, bad), null);
  assert.equal(await repo.getLatestVersion(editor, bad), null);
});
