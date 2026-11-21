import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("every API route still requires a token", async () => {
  const app = buildServer(deps({ auth: new StaticAuth(null) }));
  const res = await app.inject({ method: "GET", url: "/api/v1/maps/m1" });
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

  // Real routes still win over the fallback, and so does the whole API
  // prefix: a miss under it is JSON, never a page.
  for (const url of ["/api/v1/maps/nope", "/api/v1/nope"]) {
    const api = await app.inject({ method: "GET", url });
    assert.equal(api.statusCode, 404, url);
    assert.deepEqual(api.json(), { error: "not_found" });
  }
  await app.close();
});

test("a repository failure becomes a 500 with no internals leaked", async () => {
  // A real repo with one method replaced, so the stub does not have to restate
  // an interface it is not about.
  const exploding: MapRepo = Object.assign(new MemoryMapRepo(), {
    getMap: async () => {
      throw new Error("connection to 10.0.0.5:5432 refused for user livemap_app");
    },
  });

  const app = buildServer(deps({ repo: exploding }));
  const res = await app.inject({ method: "GET", url: "/api/v1/maps/m1" });

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
  const app = buildServer(
    deps({
      repo: Object.assign(new MemoryMapRepo(), {
        getMap: async () => {
          throw new Error("boom");
        },
      }),
    }),
  );

  const res = await app.inject({
    method: "GET",
    url: "/api/v1/maps/m1",
    headers: { "x-request-id": "trace-abc-123" },
  });
  assert.equal(res.json().reqId, "trace-abc-123");
  await app.close();
});

test("an oversized edit body is rejected rather than serialised", async () => {
  const app = buildServer(deps({ bodyLimit: 1024 }));
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/maps/m1/edit",
    payload: { rev: 0, put: [], pad: "x".repeat(4096) },
  });
  assert.equal(res.statusCode, 413);
  await app.close();
});

test("writes are rate limited per actor once configured", async () => {
  const app = buildServer(deps({ rateLimit: { write: { max: 3, timeWindow: "1 minute" } } }));
  await app.ready();

  const codes = [];
  for (let i = 0; i < 5; i++) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/maps/m1/edit",
      payload: { rev: 0 },
    });
    codes.push(res.statusCode);
  }

  // The first three get through to the handler (404 — no such map seeded),
  // then the limiter takes over.
  assert.equal(codes.filter((c) => c === 429).length, 2, `got ${codes.join(",")}`);
  await app.close();
});

test("reads are not counted against the write tier", async () => {
  const app = buildServer(
    deps({ rateLimit: { write: { max: 2, timeWindow: "1 minute" } } }),
  );
  await app.ready();

  for (let i = 0; i < 6; i++) {
    const res = await app.inject({ method: "GET", url: "/api/v1/maps/m1" });
    assert.notEqual(res.statusCode, 429);
  }
  await app.close();
});

test("with an app directory, page routes get the shell and everything else stays honest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "livemap-app-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>shell</title>");
  await writeFile(join(dir, "app.js"), "export {};");
  await writeFile(join(dir, "embed.html"), "<!doctype html><title>embed</title>");

  const app = buildServer(deps({ appDir: dir, auth: new StaticAuth(null) }));
  try {
    // A deep link or a refresh lands in the client router, not on a 404.
    for (const url of ["/", "/maps", "/maps/abc/versions?x=1"]) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 200, url);
      assert.match(res.body, /<title>shell<\/title>/, url);
      // The shell must not be framed, and must be revalidated on every load.
      assert.equal(res.headers["x-frame-options"], "DENY", url);
      assert.equal(res.headers["cache-control"], "no-cache", url);
    }

    const asset = await app.inject({ method: "GET", url: "/app.js" });
    assert.equal(asset.statusCode, 200);
    // Loaded by the embed page from a sandboxed frame, which is cross-origin.
    assert.equal(asset.headers["access-control-allow-origin"], "*");

    // The embed page is the one document that has to be frameable.
    const embed = await app.inject({ method: "GET", url: "/embed.html" });
    assert.equal(embed.statusCode, 200);
    assert.equal(embed.headers["x-frame-options"], undefined);

    // A missing asset is a 404, not the shell with a 200 and the wrong type.
    const missing = await app.inject({ method: "GET", url: "/gone.js" });
    assert.equal(missing.statusCode, 404);

    // The API keeps its own answers: JSON, and 401 before anything else.
    const api = await app.inject({ method: "GET", url: "/api/v1/maps" });
    assert.equal(api.statusCode, 401);
    assert.deepEqual(api.json(), { error: "unauthorised" });

    const post = await app.inject({ method: "POST", url: "/maps" });
    assert.equal(post.statusCode, 404);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("/config tells a page what it needs before it has a session", async () => {
  const app = buildServer(deps({ auth: new StaticAuth(null) }));
  const res = await app.inject({ method: "GET", url: "/config" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    artifactBase: "/public",
    guestSignup: false,
    humanCheckSiteKey: null,
  });
  await app.close();
});
