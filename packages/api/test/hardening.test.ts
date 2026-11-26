import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, StaticAuth, MemoryMapRepo, MemoryArtifactStore, type ServerDeps } from "../src/index.js";

const actor = {
  userId: "u1",
  tenantId: "t1",
  tenantSlug: "alpha",
  role: "editor",
};

/**
 * The auth hook asks the repository for the actor's membership and refuses a
 * caller who has none, so a fixture with a signed-in actor has to grant one.
 */
const deps = (over: Partial<Omit<ServerDeps, "repo">> & { repo?: MemoryMapRepo } = {}): ServerDeps => {
  const repo = over.repo ?? new MemoryMapRepo();
  repo.grant(actor.tenantId, actor.userId, actor.role);
  return {
    store: new MemoryArtifactStore(),
    auth: new StaticAuth(actor),
    ...over,
    repo,
  };
};

const errorOf = (res: { json: () => unknown }) => (res.json() as { error: string }).error;

test("every API route still requires a token", async () => {
  const app = buildServer(deps({ auth: new StaticAuth(null) }));
  const routes: [string, string][] = [
    ["GET", "/api/v1/session"],
    ["GET", "/api/v1/templates"],
    ["GET", "/api/v1/maps"],
    ["POST", "/api/v1/maps"],
    ["GET", "/api/v1/maps/m1"],
    ["GET", "/api/v1/maps/m1/versions"],
    ["POST", "/api/v1/maps/m1/edit"],
    ["POST", "/api/v1/maps/m1/archive"],
    ["POST", "/api/v1/maps/m1/publish"],
    ["POST", "/api/v1/maps/m1/rollback"],
    // A path that does not exist is refused the same way, so an anonymous
    // probe learns nothing about which routes do.
    ["GET", "/api/v1/nope"],
  ];
  for (const [method, url] of routes) {
    const res = await app.inject({ method: method as "GET" | "POST", url });
    assert.equal(res.statusCode, 401, `${method} ${url}`);
    assert.equal(errorOf(res), "unauthorised", `${method} ${url}`);
  }
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
    assert.equal(errorOf(api), "not_found", url);
  }
  await app.close();
});

test("a repository failure becomes a 500 with no internals leaked", async () => {
  // A real repo with one method replaced, so the stub does not have to restate
  // an interface it is not about.
  const exploding = Object.assign(new MemoryMapRepo(), {
    getMap: async () => {
      throw new Error("connection to 10.0.0.5:5432 refused for user livemap_app");
    },
  });

  const app = buildServer(deps({ repo: exploding }));
  const res = await app.inject({ method: "GET", url: "/api/v1/maps/m1" });

  assert.equal(res.statusCode, 500);
  const body = res.json() as { error: string; reason: unknown; reqId: unknown };
  assert.equal(body.error, "internal_error");
  assert.equal(typeof body.reason, "string");
  assert.ok(body.reqId, "a request id should be returned for correlation");

  const raw = res.body;
  assert.ok(!raw.includes("10.0.0.5"), "must not leak the host");
  assert.ok(!raw.includes("livemap_app"), "must not leak the db user");
  assert.ok(!raw.includes("refused"), "must not leak the driver message");
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
  assert.equal(errorOf(res), "body_too_large");
  await app.close();
});

test("with an app directory, only the embed page may be framed, the shell is revalidated, and the API still needs a token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "livemap-app-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>shell</title>");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "index-abc123.js"), "export {};");

  const app = buildServer(deps({ appDir: dir, auth: new StaticAuth(null) }));
  try {
    // Every page other than the embed must refuse to be framed, and the shell
    // must revalidate on every load or a deploy stays invisible.
    for (const url of ["/", "/maps", "/maps/abc", "/maps/abc/versions?x=1", "/index.html"]) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 200, url);
      assert.match(res.body, /<title>shell<\/title>/, url);
      assert.equal(res.headers["x-frame-options"], "DENY", url);
      assert.equal(res.headers["content-security-policy"], "frame-ancestors 'none'", url);
      assert.equal(res.headers["cache-control"], "no-cache", url);
    }

    // The embed is a client route answered with the same shell, and it is the
    // one page meant to live in someone else's frame.
    const embed = await app.inject({ method: "GET", url: "/embed/alpha/some-map" });
    assert.equal(embed.statusCode, 200);
    assert.match(embed.body, /<title>shell<\/title>/);
    assert.equal(embed.headers["x-frame-options"], undefined);
    assert.equal(embed.headers["content-security-policy"], "frame-ancestors *");
    assert.equal(embed.headers["cache-control"], "no-cache");

    // The API keeps its own answers: 401 before anything else.
    const api = await app.inject({ method: "GET", url: "/api/v1/maps" });
    assert.equal(api.statusCode, 401);
    assert.equal(errorOf(api), "unauthorised");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
