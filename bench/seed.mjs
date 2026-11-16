#!/usr/bin/env node
// Seeds a tenant, a user, a membership, a map and N features, then prints the
// ids and a signed token the load tests use.
//
//   node --import tsx bench/seed.mjs [featureCount]

import pg from "pg";
import { PostgresRepo } from "../packages/api/src/postgres.ts";
import { signSession } from "../packages/api/src/auth.ts";

const FEATURES = Number(process.argv[2] ?? 250);
const DATABASE_URL = process.env.DATABASE_URL;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!DATABASE_URL || !APP_DATABASE_URL || !SESSION_SECRET) {
  console.error("DATABASE_URL, APP_DATABASE_URL and SESSION_SECRET must be set");
  process.exit(1);
}

// Admin connection: provisioning a tenant is cross-tenant by nature, so it runs
// as the bypassrls role rather than through the app's RLS-scoped pool.
const admin = new pg.Client({ connectionString: DATABASE_URL });
await admin.connect();

await admin.query("delete from tenants where slug = 'bench'");

const { rows: tRows } = await admin.query(
  `insert into tenants (slug, name, default_dir, default_locale)
   values ('bench', 'Bench Newsroom', 'rtl', 'ar')
   returning id`,
);
const tenantId = tRows[0].id;

const { rows: uRows } = await admin.query(
  `insert into users (email, name) values ('bench@livemap.test', 'Bench Editor')
   on conflict (email) do update set name = excluded.name
   returning id`,
);
const userId = uRows[0].id;

await admin.query(
  `insert into memberships (tenant_id, user_id, role) values ($1, $2, 'editor')
   on conflict (tenant_id, user_id) do update set role = excluded.role`,
  [tenantId, userId],
);

const { rows: mRows } = await admin.query(
  `insert into maps (tenant_id, slug, title, title_dir, ui_dir, center, zoom,
                     basemap_style_id, label_langs, created_by)
   values ($1, 'bench', 'خريطة الاختبار', 'rtl', 'rtl',
           ST_GeogFromText('SRID=4326;POINT(31.24 30.05)'), 9,
           'livemap-base', array['ar','en'], $2)
   returning id`,
  [tenantId, userId],
);
const mapId = mRows[0].id;

await admin.end();

// Feature writes go through the repo so the geometry/props codec and the
// RLS-scoped pool are both exercised by the seed itself.
const repo = new PostgresRepo({ connectionString: APP_DATABASE_URL, max: 4 });

const stroke = { color: "#c1121f", width: 2, opacity: 1 };
const labelStyle = {
  color: "#111111",
  haloColor: "#ffffff",
  haloWidth: 1.4,
  size: 13,
};

function makeFeatures(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const lng = 31.0 + (i % 40) * 0.012;
    const lat = 29.9 + Math.floor(i / 40) * 0.012;
    const at = String(i).padStart(6, "0");
    const kind = i % 5;

    if (kind === 0) {
      out.push({
        id: `area-${i}`,
        kind: "area",
        at,
        rings: [
          [
            [lng, lat],
            [lng + 0.01, lat],
            [lng + 0.01, lat + 0.01],
            [lng, lat + 0.01],
            [lng, lat],
          ],
        ],
        fill: { color: "#e5383b", opacity: 0.35 },
        stroke,
      });
    } else if (kind === 1) {
      out.push({
        id: `arrow-${i}`,
        kind: "arrow",
        at,
        control: [
          [lng, lat],
          [lng + 0.02, lat + 0.01],
          [lng + 0.04, lat],
        ],
        curvature: 0.6,
        head: "single",
        stroke,
        chevrons: i % 2 === 0,
      });
    } else if (kind === 2) {
      out.push({
        id: `front-${i}`,
        kind: "frontline",
        at,
        path: [
          [lng, lat],
          [lng + 0.03, lat + 0.005],
          [lng + 0.05, lat],
        ],
        facing: i % 2 === 0 ? "left" : "right",
        stroke,
        toothSpacing: 900,
        toothSize: 450,
      });
    } else if (kind === 3) {
      out.push({
        id: `pt-${i}`,
        kind: "point",
        at,
        at_: [lng, lat],
        icon: "ocha:Refugee",
        iconColor: "#ffffff",
        iconSize: 1,
        disc: { fill: "#780000", ring: "#ffffff" },
      });
    } else {
      out.push({
        id: `note-${i}`,
        kind: "annotation",
        at,
        anchor: [lng, lat],
        offset: [40, -30],
        text: { value: `ملاحظة ${i}`, dir: "rtl" },
        labelStyle,
        leader: {
          color: "#333333",
          width: 1.2,
          shape: i % 2 === 0 ? "elbow" : "straight",
          anchorDot: true,
        },
      });
    }
  }
  return out;
}

const features = makeFeatures(FEATURES);

// Written in batches so one transaction does not hold a huge statement set.
const BATCH = 100;
let rev = 0;
for (let i = 0; i < features.length; i += BATCH) {
  const slice = features.slice(i, i + BATCH);
  const next = await repo.applyEdit(tenantId, mapId, rev, slice, []);
  if (next === null) throw new Error(`seed write rejected at rev ${rev}`);
  rev = next;
}

const readBack = await repo.listFeatures(tenantId, mapId);
await repo.close();

const token = signSession(
  {
    userId,
    tenantId,
    tenantSlug: "bench",
    role: "editor",
    exp: Math.floor(Date.now() / 1000) + 24 * 3600,
  },
  SESSION_SECRET,
);

console.log(
  JSON.stringify(
    { tenantId, mapId, userId, rev, featuresWritten: features.length, featuresReadBack: readBack.length, token },
    null,
    2,
  ),
);
