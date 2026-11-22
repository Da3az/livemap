#!/usr/bin/env node
// Seeds a tenant, a user, a membership, a map and N features, then prints the
// ids and a signed token the load tests use.
//
//   node --conditions=livemap-source --import tsx bench/seed.mjs [featureCount]

import pg from "pg";
import { PostgresRepo } from "../packages/api/src/postgres.ts";
import { signSession } from "../packages/api/src/auth.ts";
import { keysBetween, templateSettings } from "@livemap/core";

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

await admin.end();

// Feature writes go through the repo so the geometry/props codec and the
// RLS-scoped pool are both exercised by the seed itself.
const repo = new PostgresRepo({ connectionString: APP_DATABASE_URL, max: 4 });

// The repo context the policies read. The role has to match the membership
// granted above: livemap_granted_role() honours the app.role GUC only where a
// membership row in this tenant actually carries it, so a mismatch here denies
// every write rather than silently widening one.
const ctx = { tenantId, userId, role: "editor" };

// The map goes through the repo too: created from a template, so its settings
// are real ones, and written by the editor the token belongs to.
const created = await repo.createMap(
  ctx,
  { title: { value: "خريطة الاختبار", dir: "rtl" }, uiDir: "rtl", settings: templateSettings("conflict-tracker", "rtl") },
  { maxMaps: 1000 },
);
if (created.status !== "created") throw new Error(`could not create the bench map: ${created.reason}`);
const mapId = created.map.id;

const stroke = (slot, dash = "solid") => ({ color: { slot }, width: 2, opacity: 1, dash });
const labelStyle = { color: "ink", size: 13, weight: 400, halo: true, box: false };

function makeFeatures(n) {
  const orders = keysBetween(null, null, n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const lng = 31.0 + (i % 40) * 0.012;
    const lat = 29.9 + Math.floor(i / 40) * 0.012;
    const base = {
      id: `f-${i}`,
      order: orders[i],
      name: { value: `عنصر ${i}`, dir: "rtl" },
      groupId: null,
      hidden: false,
      locked: false,
      presetId: null,
      validFrom: null,
      validTo: null,
      lineageId: null,
    };
    const kind = i % 5;
    if (kind === 0) {
      out.push({
        ...base,
        kind: "area",
        rings: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]]],
        fill: { color: { slot: 1 }, opacity: 0.35, pattern: i % 2 === 0 ? "hatch" : "none" },
        stroke: stroke(1),
      });
    } else if (kind === 1) {
      out.push({
        ...base,
        kind: "arrow",
        control: [[lng, lat], [lng + 0.02, lat + 0.01], [lng + 0.04, lat]],
        curvature: 0.6,
        head: "single",
        tapered: i % 2 === 0,
        stroke: stroke(2),
      });
    } else if (kind === 2) {
      out.push({
        ...base,
        kind: "frontline",
        path: [[lng, lat], [lng + 0.03, lat + 0.005], [lng + 0.05, lat]],
        facing: i % 2 === 0 ? "left" : "right",
        toothShape: "triangle",
        toothSpacing: 18,
        toothSize: 7,
        stroke: stroke(1, "dashed"),
      });
    } else if (kind === 3) {
      out.push({ ...base, kind: "point", at: [lng, lat], symbol: { icon: "camp" }, color: { slot: 4 }, size: 22 });
    } else {
      out.push({
        ...base,
        kind: "annotation",
        anchor: [lng, lat],
        textAt: [lng + 0.006, lat + 0.004],
        text: { value: `ملاحظة ${i}`, dir: "rtl" },
        labelStyle,
        leader: { shape: i % 2 === 0 ? "elbow" : "straight", anchorDot: true },
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
  const out = await repo.applyEdit(ctx, mapId, { rev, force: false, put: slice, delete: [] }, { maxFeaturesPerMap: 100_000 });
  if (out.status !== "applied") {
    throw new Error(
      `seed write rejected at rev ${rev}: ${out.status}${out.reason ? ` — ${out.reason}` : ""}`,
    );
  }
  rev = out.rev;
}

const readBack = (await repo.getMap(ctx, mapId)).features;
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
