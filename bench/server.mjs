#!/usr/bin/env node
// Load-test harness. Serves the same map three ways so the read-path design
// can be measured rather than argued about:
//
//   GET  /bench/db/:mapId        read from Postgres on every request
//   GET  /bench/artifact/:mapId  prebuilt immutable artifact, ETag + 304
//   WS   /live?map=:mapId        WebSocket fan-out (the rejected design)
//
// Not the product server. packages/api/src/server.ts is, and it requires auth
// on every route; these endpoints are deliberately open so the numbers measure
// the read path and nothing else.
//
//   node --import tsx bench/server.mjs

import Fastify from "fastify";
import pg from "pg";
import { buildVersion, pointerCachePolicy, versionedCachePolicy, etagFor } from "../packages/core/src/index.ts";
import { PostgresRepo } from "../packages/api/src/postgres.ts";
import { RealtimeHub } from "../packages/api/src/realtime.ts";

const PORT = Number(process.env.BENCH_PORT ?? 8801);
const { DATABASE_URL, APP_DATABASE_URL } = process.env;
const POOL_MAX = Number(process.env.BENCH_POOL_MAX ?? 10);

if (!DATABASE_URL || !APP_DATABASE_URL) {
  console.error("DATABASE_URL and APP_DATABASE_URL must be set");
  process.exit(1);
}

const admin = new pg.Client({ connectionString: DATABASE_URL });
await admin.connect();
const { rows } = await admin.query(
  `select m.id as map_id, m.tenant_id, m.created_by
     from maps m join tenants t on t.id = m.tenant_id
    where t.slug = 'bench' and m.slug = 'bench'`,
);
await admin.end();

if (rows.length === 0) {
  console.error("no bench map found — run: node --import tsx bench/seed.mjs");
  process.exit(1);
}
const { map_id: MAP_ID, tenant_id: TENANT_ID } = rows[0];

// Read-only context. `viewer` is the narrowest role that can select, and these
// endpoints only read — using anything wider would measure a permission this
// harness does not need.
const CTX = { tenantId: TENANT_ID, userId: rows[0].created_by, role: "viewer" };

const repo = new PostgresRepo({
  connectionString: APP_DATABASE_URL,
  max: POOL_MAX,
});

// Build the artifact once at boot, exactly as the publish pipeline would.
async function rebuild() {
  const doc = await repo.getMap(CTX, MAP_ID);
  const features = await repo.listFeatures(CTX, MAP_ID);
  const version = buildVersion({
    doc,
    features,
    version: 1,
    publishedBy: doc.id,
    // Pinned so the artifact is byte-stable across restarts and the ETag does
    // not change just because the process was restarted mid-run.
    publishedAt: "2026-11-16T00:00:00.000Z",
  });
  const body = JSON.stringify(version);
  return { body, etag: etagFor(version.etag), featureCount: features.length };
}

let artifact = await rebuild();

const counters = { db: 0, artifact: 0, notModified: 0, publishes: 0 };

const app = Fastify({ logger: false });

app.get("/health", async () => ({ ok: true }));

app.get("/ready", async (_req, reply) => {
  const ok = await repo.ping();
  return reply.code(ok ? 200 : 503).send({ ok, db: ok });
});

// Scenario A — the read path touches the database on every request.
app.get("/bench/db/:mapId", async (req, reply) => {
  counters.db++;
  const doc = await repo.getMap(CTX, req.params.mapId);
  if (!doc) return reply.code(404).send({ error: "not_found" });
  const features = await repo.listFeatures(CTX, req.params.mapId);
  const version = buildVersion({
    doc,
    features,
    version: 1,
    publishedBy: doc.id,
    publishedAt: "2026-11-16T00:00:00.000Z",
  });
  return reply
    .code(200)
    .header("content-type", "application/json")
    .header("cache-control", "no-store")
    .send(JSON.stringify(version));
});

// Scenario B — immutable prebuilt artifact with real conditional requests.
app.get("/bench/artifact/:mapId", async (req, reply) => {
  counters.artifact++;
  const policy = versionedCachePolicy(artifact.etag);

  if (req.headers["if-none-match"] === artifact.etag) {
    counters.notModified++;
    return reply
      .code(304)
      .header("etag", artifact.etag)
      .header("cache-control", policy.cacheControl)
      .send();
  }

  return reply
    .code(200)
    .header("content-type", "application/json")
    .header("cache-control", policy.cacheControl)
    .header("etag", artifact.etag)
    .header("access-control-allow-origin", "*")
    .send(artifact.body);
});

// The short-TTL pointer readers resolve first.
app.get("/bench/latest/:mapId", async (_req, reply) => {
  const policy = pointerCachePolicy(artifact.etag);
  return reply
    .code(200)
    .header("cache-control", policy.cacheControl)
    .header("etag", artifact.etag)
    .send(JSON.stringify({ version: 1, etag: artifact.etag }));
});

// Drives the WebSocket scenario: rebuild and push to every subscriber.
app.post("/bench/publish", async () => {
  artifact = await rebuild();
  counters.publishes++;
  // `ts` lets the load test measure publish-to-receipt latency.
  hub.broadcast(MAP_ID, {
    type: "version",
    version: 1,
    etag: artifact.etag,
    ts: Date.now(),
  });
  return { ok: true, etag: artifact.etag, subscribers: hub.stats.connections };
});

app.get("/bench/stats", async () => {
  const m = process.memoryUsage();
  return {
    mapId: MAP_ID,
    tenantId: TENANT_ID,
    poolMax: POOL_MAX,
    counters,
    pool: repo.poolStats,
    hub: hub.stats,
    memory: {
      rssMb: +(m.rss / 1048576).toFixed(1),
      heapUsedMb: +(m.heapUsed / 1048576).toFixed(1),
    },
    artifactBytes: Buffer.byteLength(artifact.body),
    featureCount: artifact.featureCount,
  };
});

app.post("/bench/reset-counters", async () => {
  counters.db = 0;
  counters.artifact = 0;
  counters.notModified = 0;
  counters.publishes = 0;
  return { ok: true };
});

const hub = new RealtimeHub(app.server, { heartbeatMs: 30_000 });

await app.listen({ port: PORT, host: "127.0.0.1" });

console.log(
  JSON.stringify({
    listening: `http://127.0.0.1:${PORT}`,
    mapId: MAP_ID,
    tenantId: TENANT_ID,
    poolMax: POOL_MAX,
    features: artifact.featureCount,
    artifactBytes: Buffer.byteLength(artifact.body),
  }),
);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await hub.close();
    await app.close();
    await repo.close();
    process.exit(0);
  });
}
