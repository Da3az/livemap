import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { MapFeature } from "@livemap/core";
import { PostgresRepo } from "../src/postgres.js";

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
let betaMap = "";
let userId = "";

before(async () => {
  if (!enabled) return;

  admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query("delete from tenants where slug in ('t-alpha','t-beta')");

  const mk = async (slug: string, dir: string) => {
    const { rows } = await admin.query(
      `insert into tenants (slug, name, default_dir) values ($1, $2, $3) returning id`,
      [slug, slug, dir],
    );
    return rows[0].id as string;
  };

  alphaTenant = await mk("t-alpha", "ltr");
  betaTenant = await mk("t-beta", "rtl");

  const { rows: u } = await admin.query(
    `insert into users (email, name) values ('rls@livemap.test', 'RLS Test')
     on conflict (email) do update set name = excluded.name returning id`,
  );
  userId = u[0].id;

  const mkMap = async (tenant: string, title: string) => {
    const { rows } = await admin.query(
      `insert into maps (tenant_id, slug, title, center, zoom, basemap_style_id, created_by)
       values ($1, 'm', $2, ST_GeogFromText('SRID=4326;POINT(0 0)'), 8, 'base', $3)
       returning id`,
      [tenant, title, userId],
    );
    return rows[0].id as string;
  };

  alphaMap = await mkMap(alphaTenant, "Alpha Map");
  betaMap = await mkMap(betaTenant, "Beta Map");

  // max: 1 forces every operation onto the same physical connection, which is
  // what makes the tenant-scope leak test meaningful.
  repo = new PostgresRepo({ connectionString: APP_DATABASE_URL!, max: 1 });
});

after(async () => {
  if (!enabled) return;
  await repo.close();
  await admin.query("delete from tenants where slug in ('t-alpha','t-beta')");
  await admin.end();
});

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
  const rev = await repo.applyEdit(alphaTenant, alphaMap, 0, allKinds(), []);
  assert.equal(rev, 1);

  const back = await repo.listFeatures(alphaTenant, alphaMap);
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
  const back = await repo.listFeatures(alphaTenant, alphaMap);
  const keys = back.map((f) => f.at);
  assert.deepEqual(keys, [...keys].sort());
});

test("a stale revision loses instead of clobbering", describeDb, async () => {
  const doc = await repo.getMap(alphaTenant, alphaMap);
  const current = doc!.rev;

  const stale = await repo.applyEdit(
    alphaTenant,
    alphaMap,
    current - 1,
    [{ id: "line-1", kind: "line", at: "a1", path: [[9, 9], [9.5, 9.5]], stroke }],
    [],
  );
  assert.equal(stale, null, "a stale write must be refused");

  const back = await repo.listFeatures(alphaTenant, alphaMap);
  const line = back.find((f) => f.id === "line-1");
  assert.deepEqual(
    line?.kind === "line" && line.path[0],
    [0, 0],
    "the refused write must not have landed",
  );

  const fresh = await repo.applyEdit(alphaTenant, alphaMap, current, [], ["line-1"]);
  assert.equal(fresh, current + 1);
});

test("row-level security hides another tenant's map", describeDb, async () => {
  // Beta's map id is real and the query is well-formed; only the tenant scope
  // differs, so a null here is RLS doing its job rather than a missing row.
  const crossed = await repo.getMap(alphaTenant, betaMap);
  assert.equal(crossed, null);

  const own = await repo.getMap(betaTenant, betaMap);
  assert.equal(own?.title.value, "Beta Map");
});

test("an edit cannot reach into another tenant's map", describeDb, async () => {
  const out = await repo.applyEdit(
    alphaTenant,
    betaMap,
    0,
    [{ id: "intruder", kind: "line", at: "z", path: [[1, 1], [2, 2]], stroke }],
    [],
  );
  assert.equal(out, null);

  const betaFeatures = await repo.listFeatures(betaTenant, betaMap);
  assert.equal(
    betaFeatures.find((f) => f.id === "intruder"),
    undefined,
  );
});

test("tenant scope does not leak across a reused pooled connection", describeDb, async () => {
  // The pool holds a single connection, so these two calls run on the same
  // backend. `set_config(..., local => true)` scopes the GUC to the
  // transaction; a plain SET would persist and let beta read alpha's rows.
  const alpha = await repo.getMap(alphaTenant, alphaMap);
  assert.equal(alpha?.title.value, "Alpha Map");

  const betaSeesAlpha = await repo.getMap(betaTenant, alphaMap);
  assert.equal(betaSeesAlpha, null, "beta must not inherit alpha's scope");

  const alphaAgain = await repo.getMap(alphaTenant, alphaMap);
  assert.equal(alphaAgain?.title.value, "Alpha Map");
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

  const alphaDoc = await repo.getMap(alphaTenant, alphaMap);
  const betaDoc = await repo.getMap(betaTenant, betaMap);

  const a = await repo.applyEdit(alphaTenant, alphaMap, alphaDoc!.rev, [shared], []);
  const b = await repo.applyEdit(betaTenant, betaMap, betaDoc!.rev, [shared], []);
  assert.ok(a !== null, "alpha write should land");
  assert.ok(b !== null, "beta write should land despite the duplicate id");

  const alphaFeatures = await repo.listFeatures(alphaTenant, alphaMap);
  const betaFeatures = await repo.listFeatures(betaTenant, betaMap);
  assert.equal(alphaFeatures.filter((f) => f.id === "shared-id").length, 1);
  assert.equal(betaFeatures.filter((f) => f.id === "shared-id").length, 1);
});

test("the version ledger is per tenant", describeDb, async () => {
  await repo.recordVersion(alphaTenant, {
    mapId: alphaMap,
    version: 1,
    etag: '"abc"',
    storageKey: "t/alpha/m/m/v/1.json",
    byteSize: 100,
    featureCount: 5,
    publishedAt: new Date().toISOString(),
    publishedBy: userId,
  });

  const latest = await repo.getLatestVersion(alphaTenant, alphaMap);
  assert.equal(latest?.version, 1);
  assert.equal(latest?.etag, '"abc"');

  assert.equal(await repo.getLatestVersion(betaTenant, alphaMap), null);
  assert.equal(await repo.nextVersion(alphaTenant, alphaMap), 2);
});
