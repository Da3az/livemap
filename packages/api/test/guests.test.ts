import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildServer, type ServerDeps } from "../src/server.js";
import { MemoryMapRepo } from "../src/repo.js";
import { MemoryArtifactStore } from "../src/storage.js";
import { MemoryGuestProvisioner } from "../src/guests.js";
import { TokenAuth, signSession, verifySession } from "../src/auth.js";
import { turnstileCheck } from "../src/turnstile.js";
import { DEFAULT_LIMITS, GUEST_TTL_SECS, isGuestSlug } from "../src/limits.js";

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

  test("the workspace starts with no maps and guest limits", async () => {
    const { app } = setup();
    const { token } = (await signup(app)).json() as Signup;

    const me = (
      await app.inject({ method: "GET", url: `${API}/me`, headers: bearer(token) })
    ).json() as {
      guest: boolean;
      role: string;
      expiresAt: string | null;
      usage: { maps: number };
      limits: { maxMaps: number };
    };
    assert.equal(me.guest, true);
    assert.equal(me.role, "owner");
    assert.ok(me.expiresAt);
    assert.equal(me.usage.maps, 0);
    assert.equal(me.limits.maxMaps, DEFAULT_LIMITS.guest.maxMaps);
    await app.close();
  });

  test("a guest creates maps through the same route as anyone, up to the guest limit", async () => {
    const { app } = setup({
      limits: {
        member: DEFAULT_LIMITS.member,
        guest: { ...DEFAULT_LIMITS.guest, maxMaps: 1 },
      },
    });
    const { token } = (await signup(app)).json() as Signup;
    const create = () =>
      app.inject({
        method: "POST",
        url: `${API}/maps`,
        headers: bearer(token),
        payload: { title: { value: "Mine", dir: "ltr" } },
      });

    assert.equal((await create()).statusCode, 201);
    const second = await create();
    assert.equal(second.statusCode, 403);
    assert.equal((second.json() as { error: string }).error, "quota_exceeded");
    await app.close();
  });

  test("two guests cannot see each other's maps", async () => {
    const { app } = setup();
    const a = (await signup(app)).json() as Signup;
    const b = (await signup(app)).json() as Signup;

    const made = (
      await app.inject({
        method: "POST",
        url: `${API}/maps`,
        headers: bearer(a.token),
        payload: { title: { value: "A's map", dir: "ltr" } },
      })
    ).json() as { map: { id: string } };

    const res = await app.inject({
      method: "GET",
      url: `${API}/maps/${made.map.id}`,
      headers: bearer(b.token),
    });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  test("a reaped guest's token stops working although it still verifies", async () => {
    const { app, repo } = setup();
    const { token } = (await signup(app)).json() as Signup;
    const claims = verifySession(token, SECRET);
    assert.ok(claims.ok);

    repo.dropTenant(claims.claims.tenantId);

    const res = await app.inject({
      method: "GET",
      url: `${API}/me`,
      headers: bearer(token),
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  test("the route does not exist unless guest signup is configured", async () => {
    const app = buildServer({
      repo: new MemoryMapRepo(),
      store: new MemoryArtifactStore(),
      auth: new TokenAuth(SECRET),
    });
    assert.equal((await signup(app)).statusCode, 404);
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

    assert.equal((await signup(app)).statusCode, 403);
    assert.equal((await signup(app, { turnstileToken: "bad" })).statusCode, 403);
    assert.equal(await provisioner.count(), 0);

    assert.equal((await signup(app, { turnstileToken: "good" })).statusCode, 201);
    assert.equal(await provisioner.count(), 1);
    assert.deepEqual(seen, [undefined, "bad", "good"]);
    await app.close();
  });

  test("answers 503 once the guest ceiling is reached", async () => {
    const { app } = setup({}, { maxGuests: 2 });
    assert.equal((await signup(app)).statusCode, 201);
    assert.equal((await signup(app)).statusCode, 201);

    const res = await signup(app);
    assert.equal(res.statusCode, 503);
    assert.ok(res.headers["retry-after"]);
    assert.equal((res.json() as { error: string }).error, "guest_capacity");
    await app.close();
  });

  test("is rate limited per address", async () => {
    const { app } = setup({
      rateLimit: { signup: { max: 2, timeWindow: "1 hour" } },
    });
    await app.ready();
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await signup(app)).statusCode);
    assert.deepEqual(codes, [201, 201, 429, 429]);
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
        url: `${API}/me`,
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
        url: `${API}/me`,
        headers: bearer(token),
      });
      assert.equal(res.statusCode, 200);
    }
    await app.close();
  });

  test("reads have their own tier", async () => {
    const { app } = setup({
      rateLimit: { read: { max: 2, timeWindow: "1 minute" } },
    });
    await app.ready();
    const { token } = (await signup(app)).json() as Signup;
    const codes = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "GET",
        url: `${API}/maps`,
        headers: bearer(token),
      });
      codes.push(res.statusCode);
    }
    assert.deepEqual(codes, [200, 200, 429]);
    await app.close();
  });

  test("a guest publishes under a lower ceiling than a member", async () => {
    const { app } = setup({
      servePublic: true,
      rateLimit: { publish: { max: 50, guestMax: 1, timeWindow: "1 hour" } },
    });
    await app.ready();
    const { token } = (await signup(app)).json() as Signup;
    const { map } = (
      await app.inject({
        method: "POST",
        url: `${API}/maps`,
        headers: bearer(token),
        payload: { title: { value: "Mine", dir: "ltr" } },
      })
    ).json() as { map: { id: string } };

    const publish = () =>
      app.inject({
        method: "POST",
        url: `${API}/maps/${map.id}/publish`,
        headers: bearer(token),
      });
    assert.equal((await publish()).statusCode, 201);
    assert.equal((await publish()).statusCode, 429);
    await app.close();
  });
});

describe("turnstileCheck", () => {
  const respond =
    (body: unknown, ok = true): typeof fetch =>
    async () =>
      ({ ok, json: async () => body }) as Response;

  test("passes only when Siteverify says success", async () => {
    const pass = turnstileCheck({ secret: "s", fetchImpl: respond({ success: true }) });
    const fail = turnstileCheck({
      secret: "s",
      fetchImpl: respond({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    });
    assert.equal(await pass("tok", "203.0.113.9"), true);
    assert.equal(await fail("tok", "203.0.113.9"), false);
  });

  test("sends the secret, the token and the address", async () => {
    let sent: Record<string, unknown> = {};
    const check = turnstileCheck({
      secret: "s3cret",
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }) as typeof fetch,
    });
    await check("tok", "203.0.113.9");
    assert.deepEqual(sent, {
      secret: "s3cret",
      response: "tok",
      remoteip: "203.0.113.9",
    });
  });

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
