import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildServer, type ServerDeps } from "../src/server.js";
import { MemoryMapRepo } from "../src/repo.js";
import { MemoryArtifactStore } from "../src/storage.js";
import { MemoryGuestProvisioner } from "../src/guests.js";
import { TokenAuth, signSession, verifySession } from "../src/auth.js";
import { turnstileCheck } from "../src/turnstile.js";
import { GUEST_TTL_SECS, isGuestSlug } from "../src/limits.js";

const SECRET = "test-secret-not-the-placeholder";
const API = "/api/v1";

function setup(over: Partial<ServerDeps> = {}, guests: Partial<NonNullable<ServerDeps["guests"]>> = {}) {
  const repo = new MemoryMapRepo();
  const app = buildServer({
    repo,
    store: new MemoryArtifactStore(),
    auth: new TokenAuth(SECRET),
    guests: {
      provisioner: new MemoryGuestProvisioner(repo),
      issueToken: (claims) => signSession(claims, SECRET),
      ...guests,
    },
    ...over,
  });
  return { app, repo };
}

type Signup = { token: string; tenantSlug: string; expiresAt: string };

const signup = (app: ReturnType<typeof setup>["app"], payload: object = {}) =>
  app.inject({ method: "POST", url: "/auth/guest", payload });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("POST /auth/guest", () => {
  test("issues a token for a new guest workspace, valid for the TTL", async () => {
    const { app } = setup();
    const before = Math.floor(Date.now() / 1000);
    const res = await signup(app);
    assert.equal(res.statusCode, 201);

    const body = res.json() as Signup;
    assert.ok(isGuestSlug(body.tenantSlug));

    const verified = verifySession(body.token, SECRET);
    assert.ok(verified.ok);
    assert.equal(verified.claims.role, "owner");
    assert.ok(verified.claims.exp >= before + GUEST_TTL_SECS);
    assert.equal(
      body.expiresAt,
      new Date(verified.claims.exp * 1000).toISOString(),
    );
    await app.close();
  });

  test("two guests cannot see each other's maps", async () => {
    const { app } = setup();
    const a = (await signup(app)).json() as Signup;
    const b = (await signup(app)).json() as Signup;

    const created = await app.inject({
      method: "POST",
      url: `${API}/maps`,
      headers: bearer(a.token),
      payload: { title: { value: "A's map", dir: "ltr" }, uiDir: "ltr", template: "blank" },
    });
    assert.equal(created.statusCode, 201);
    const made = created.json() as { map: { id: string } };

    const read = (token: string) =>
      app.inject({ method: "GET", url: `${API}/maps/${made.map.id}`, headers: bearer(token) });
    assert.equal((await read(a.token)).statusCode, 200);

    const res = await read(b.token);
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as { error: string }).error, "not_found");
    await app.close();
  });

  test("a reaped guest's token stops working although it still verifies", async () => {
    const { app, repo } = setup();
    const { token } = (await signup(app)).json() as Signup;
    const claims = verifySession(token, SECRET);
    assert.ok(claims.ok);

    const session = () => app.inject({ method: "GET", url: `${API}/session`, headers: bearer(token) });
    assert.equal((await session()).statusCode, 200);

    repo.dropTenant(claims.claims.tenantId);

    const res = await session();
    assert.equal(res.statusCode, 401);
    assert.equal((res.json() as { error: string }).error, "unauthorised");
    await app.close();
  });

  test("signup is refused as disabled unless guest signup is configured", async () => {
    const repo = new MemoryMapRepo();
    const app = buildServer({
      repo,
      store: new MemoryArtifactStore(),
      auth: new TokenAuth(SECRET),
    });
    const res = await signup(app);
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as { error: string }).error, "guest_signup_disabled");
    await app.close();
  });

  test("is refused when the human check fails, and creates nothing", async () => {
    const seen: (string | undefined)[] = [];
    const repo = new MemoryMapRepo();
    const provisioner = new MemoryGuestProvisioner(repo);
    const app = buildServer({
      repo,
      store: new MemoryArtifactStore(),
      auth: new TokenAuth(SECRET),
      guests: {
        provisioner,
        issueToken: (claims) => signSession(claims, SECRET),
        humanCheck: async (token) => {
          seen.push(token);
          return token === "good";
        },
      },
    });

    for (const res of [await signup(app), await signup(app, { turnstileToken: "bad" })]) {
      assert.equal(res.statusCode, 403);
      assert.equal((res.json() as { error: string }).error, "human_check_failed");
    }
    assert.equal(await provisioner.count(), 0);

    assert.equal((await signup(app, { turnstileToken: "good" })).statusCode, 201);
    assert.equal(await provisioner.count(), 1);
    assert.deepEqual(seen, [undefined, "bad", "good"]);
    await app.close();
  });

});

describe("rate tiers", () => {
  test("rejected credentials are throttled per address", async () => {
    const { app } = setup({
      rateLimit: { unauth: { max: 2, timeWindow: "1 minute" } },
    });
    await app.ready();
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: "GET",
        url: `${API}/session`,
        headers: bearer("not.a-token"),
      });
      codes.push(res.statusCode);
    }
    assert.deepEqual(codes, [401, 401, 429, 429]);
    await app.close();
  });

  test("valid traffic from the same address is not counted as a failure", async () => {
    const { app } = setup({
      rateLimit: { unauth: { max: 1, timeWindow: "1 minute" } },
    });
    await app.ready();
    const { token } = (await signup(app)).json() as Signup;
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "GET",
        url: `${API}/session`,
        headers: bearer(token),
      });
      assert.equal(res.statusCode, 200);
    }
    await app.close();
  });

});

describe("turnstileCheck", () => {
  const respond =
    (body: unknown, ok = true): typeof fetch =>
    async () =>
      ({ ok, json: async () => body }) as Response;

  test("fails closed: no token, an HTTP error and a network error all refuse", async () => {
    const never = turnstileCheck({
      secret: "s",
      fetchImpl: (async () => {
        throw new Error("should not be called without a token");
      }) as typeof fetch,
    });
    assert.equal(await never(undefined, "203.0.113.9"), false);
    assert.equal(await never("", "203.0.113.9"), false);

    const down = turnstileCheck({ secret: "s", fetchImpl: respond({}, false) });
    assert.equal(await down("tok", "203.0.113.9"), false);

    const broken = turnstileCheck({
      secret: "s",
      fetchImpl: (async () => {
        throw new Error("ECONNRESET");
      }) as typeof fetch,
    });
    assert.equal(await broken("tok", "203.0.113.9"), false);
  });
});
