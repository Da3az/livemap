import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Actor, AuthResolver } from "./server.js";

export interface SessionClaims {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly role: string;
  /** Unix seconds. */
  readonly exp: number;
}

const b64url = (b: Buffer): string => b.toString("base64url");

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

/** `<base64url(claims)>.<base64url(hmac)>` — stateless, so no session store. */
export function signSession(claims: SessionClaims, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${body}.${sign(body, secret)}`;
}

export type VerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifySession(
  token: string,
  secret: string,
  nowSecs = Math.floor(Date.now() / 1000),
): VerifyResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };

  const body = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = sign(body, secret);

  // Compare in constant time, and only after a length check — timingSafeEqual
  // throws on a length mismatch, which would itself leak the length.
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof claims?.userId !== "string" ||
    typeof claims?.tenantId !== "string" ||
    typeof claims?.tenantSlug !== "string" ||
    typeof claims?.role !== "string" ||
    typeof claims?.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (claims.exp <= nowSecs) return { ok: false, reason: "expired" };

  return { ok: true, claims };
}

/**
 * Bearer-token resolver. The claims carry the tenant, so every downstream
 * query is scoped by something the client cannot alter without the secret.
 *
 * Not an identity provider: tokens are minted out of band by
 * `scripts/mint-token.mjs`. Swapping in OIDC means replacing this class only,
 * because the rest of the server depends on `AuthResolver`.
 */
export class TokenAuth implements AuthResolver {
  constructor(private readonly secret: string) {
    if (!secret || secret === "replace-me") {
      throw new Error("SESSION_SECRET is unset or still the placeholder");
    }
  }

  async resolve(req: FastifyRequest): Promise<Actor | null> {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;

    const out = verifySession(header.slice(7).trim(), this.secret);
    if (!out.ok) return null;

    return {
      userId: out.claims.userId,
      tenantId: out.claims.tenantId,
      tenantSlug: out.claims.tenantSlug,
      role: out.claims.role,
    };
  }
}
