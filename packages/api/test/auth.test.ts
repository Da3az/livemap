import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, TokenAuth } from "../src/auth.js";
import type { FastifyRequest } from "fastify";

const SECRET = "test-secret-not-a-real-key";

const claims = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  tenantId: "t1",
  tenantSlug: "alpha",
  role: "editor",
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...over,
});

test("a signed token round-trips", () => {
  const token = signSession(claims(), SECRET);
  const out = verifySession(token, SECRET);
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.claims.tenantId, "t1");
});

test("a token signed with another secret is rejected", () => {
  const token = signSession(claims(), SECRET);
  assert.deepEqual(verifySession(token, "different-secret"), {
    ok: false,
    reason: "bad_signature",
  });
});

test("tampering with the claims invalidates the signature", () => {
  const token = signSession(claims(), SECRET);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify(claims({ tenantId: "someone-else", role: "owner" })),
    "utf8",
  ).toString("base64url");

  const out = verifySession(`${forged}.${sig}`, SECRET);
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.reason, "bad_signature");
  assert.notEqual(body, forged);
});

test("an expired token is rejected even though the signature is valid", () => {
  const token = signSession(
    claims({ exp: Math.floor(Date.now() / 1000) - 1 }),
    SECRET,
  );
  assert.deepEqual(verifySession(token, SECRET), {
    ok: false,
    reason: "expired",
  });
});

test("malformed tokens are rejected without throwing", () => {
  for (const bad of ["", ".", "nodot", "a.", ".b", "!!!.???"]) {
    const out = verifySession(bad, SECRET);
    assert.equal(out.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("a signature of the wrong length is rejected rather than throwing", () => {
  // timingSafeEqual throws on a length mismatch, so the length check has to
  // come first. This test exists to keep that ordering.
  const token = signSession(claims(), SECRET);
  const body = token.split(".")[0];
  const out = verifySession(`${body}.short`, SECRET);
  assert.deepEqual(out, { ok: false, reason: "bad_signature" });
});

test("claims missing a required field are malformed, not accepted", () => {
  const body = Buffer.from(JSON.stringify({ userId: "u1" }), "utf8").toString(
    "base64url",
  );
  // Sign it properly so only the shape check can reject it.
  const token = signSession(claims(), SECRET);
  const realSig = token.split(".")[1];
  const out = verifySession(`${body}.${realSig}`, SECRET);
  assert.equal(out.ok, false);
});

test("TokenAuth refuses to start on a placeholder secret", () => {
  assert.throws(() => new TokenAuth("replace-me"));
  assert.throws(() => new TokenAuth(""));
});

test("TokenAuth resolves an actor from a Bearer header", async () => {
  const auth = new TokenAuth(SECRET);
  const token = signSession(claims(), SECRET);
  const actor = await auth.resolve({
    headers: { authorization: `Bearer ${token}` },
  } as unknown as FastifyRequest);

  assert.deepEqual(actor, {
    userId: "u1",
    tenantId: "t1",
    tenantSlug: "alpha",
    role: "editor",
  });
});

test("TokenAuth returns null for a missing or non-Bearer header", async () => {
  const auth = new TokenAuth(SECRET);
  const token = signSession(claims(), SECRET);

  for (const headers of [
    {},
    { authorization: token },
    { authorization: `Basic ${token}` },
    { authorization: "Bearer " },
  ]) {
    const actor = await auth.resolve({ headers } as unknown as FastifyRequest);
    assert.equal(actor, null);
  }
});
