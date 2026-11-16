import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, StaticAuth, MemoryMapRepo, MemoryArtifactStore } from "../src/index.js";
import type { MapRepo } from "../src/repo.js";

const actor = {
  userId: "u1",
  tenantId: "t1",
  tenantSlug: "alpha",
  role: "editor",
};

const deps = (over: Record<string, unknown> = {}) => ({
  repo: new MemoryMapRepo(),
  store: new MemoryArtifactStore(),
  auth: new StaticAuth(actor),
  ...over,
});

test("/health needs no token", async () => {
  const app = buildServer(deps({ auth: new StaticAuth(null) }));
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("/ready needs no token and reports the dependency check", async () => {
  const app = buildServer(
    deps({ auth: new StaticAuth(null), readiness: async () => true }),
  );
  const res = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  await app.close();
});

test("/ready returns 503 when the dependency is down", async () => {
  // A failing database has to take the instance out of rotation rather than
  // surface 500s to readers.
  const app = buildServer(deps({ readiness: async () => false }));
  const res = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { ok: false });
  await app.close();
});

test("every other route still requires a token", async () => {
  const app = buildServer(deps({ auth: new StaticAuth(null) }));
  const res = await app.inject({ method: "GET", url: "/maps/m1" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("an unknown route returns a JSON 404, not an HTML error page", async () => {
  const app = buildServer(deps());
  const res = await app.inject({ method: "GET", url: "/nope" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "not_found" });
  await app.close();
});

test("a caller can supply the not-found handler to serve static pages", async () => {
  // Regression: Fastify allows one not-found handler per prefix, so when
  // buildServer claimed it, demo/server.mjs could no longer serve its pages
  // from the fallback and the whole demo failed to boot.
  const app = buildServer(
    deps({
      notFound: async (req, reply) =>
        reply.code(200).type("text/html").send(`<h1>page ${req.url}</h1>`),
    }),
  );

  const res = await app.inject({ method: "GET", url: "/index.html" });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /page \/index\.html/);

  // Real routes still win over the fallback.
  const api = await app.inject({ method: "GET", url: "/maps/nope" });
  assert.equal(api.statusCode, 404);
  assert.deepEqual(api.json(), { error: "not_found" });
  await app.close();
});

test("a repository failure becomes a 500 with no internals leaked", async () => {
  const exploding: MapRepo = {
    getMap: async () => {
      throw new Error("connection to 10.0.0.5:5432 refused for user livemap_app");
    },
    listFeatures: async () => [],
    applyEdit: async () => null,
    nextVersion: async () => 1,
    getLatestVersion: async () => null,
    recordVersion: async () => {},
    setPublishedVersion: async () => {},
  };

  const app = buildServer(deps({ repo: exploding }));
  const res = await app.inject({ method: "GET", url: "/maps/m1" });

  assert.equal(res.statusCode, 500);
  const body = res.json();
  assert.equal(body.error, "internal_error");
  assert.ok(body.reqId, "a request id should be returned for correlation");

  const raw = res.body;
  assert.ok(!raw.includes("10.0.0.5"), "must not leak the host");
  assert.ok(!raw.includes("livemap_app"), "must not leak the db user");
  assert.ok(!raw.includes("refused"), "must not leak the driver message");
  await app.close();
});

test("an inbound x-request-id is honoured so a trace survives a proxy", async () => {
  const app = buildServer(deps({ repo: {
    getMap: async () => { throw new Error("boom"); },
    listFeatures: async () => [],
    applyEdit: async () => null,
    nextVersion: async () => 1,
    getLatestVersion: async () => null,
    recordVersion: async () => {},
    setPublishedVersion: async () => {},
  } as MapRepo }));

  const res = await app.inject({
    method: "GET",
    url: "/maps/m1",
    headers: { "x-request-id": "trace-abc-123" },
  });
  assert.equal(res.json().reqId, "trace-abc-123");
  await app.close();
});

test("an oversized edit body is rejected rather than serialised", async () => {
  const app = buildServer(deps({ bodyLimit: 1024 }));
  const res = await app.inject({
    method: "POST",
    url: "/maps/m1/edit",
    payload: { rev: 0, put: [], pad: "x".repeat(4096) },
  });
  assert.equal(res.statusCode, 413);
  await app.close();
});

test("writes are rate limited per actor once configured", async () => {
  const app = buildServer(deps({ rateLimit: { max: 3, timeWindow: "1 minute" } }));
  await app.ready();

  const codes = [];
  for (let i = 0; i < 5; i++) {
    const res = await app.inject({
      method: "POST",
      url: "/maps/m1/edit",
      payload: { rev: 0 },
    });
    codes.push(res.statusCode);
  }

  // The first three get through to the handler (404 — no such map seeded),
  // then the limiter takes over.
  assert.equal(codes.filter((c) => c === 429).length, 2, `got ${codes.join(",")}`);
  await app.close();
});

test("reads are not rate limited — the CDN absorbs them", async () => {
  const app = buildServer(deps({ rateLimit: { max: 2, timeWindow: "1 minute" } }));
  await app.ready();

  for (let i = 0; i < 6; i++) {
    const res = await app.inject({ method: "GET", url: "/maps/m1" });
    assert.notEqual(res.statusCode, 429);
  }
  await app.close();
});
