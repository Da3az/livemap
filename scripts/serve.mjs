#!/usr/bin/env node
// Production entrypoint. Wires the real implementations from the environment
// and refuses to start on a misconfiguration rather than degrading quietly.
//
//   node --import tsx scripts/serve.mjs

import {
  buildServer,
  AdminDb,
  PostgresRepo,
  PostgresGuestProvisioner,
  MemoryArtifactStore,
  r2FromEnv,
  TokenAuth,
  signSession,
  turnstileCheck,
  DEFAULT_LIMITS,
  DEFAULT_RATE_LIMITS,
} from "../packages/api/src/index.ts";

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;

// The application shell, built by `npm run build`. Without it this is an API
// with a reference page and no front door, which is a legitimate thing to run
// — so it is a warning, not a refusal.
const APP_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "app",
  "dist",
);
const appDir = existsSync(join(APP_DIST, "index.html")) ? APP_DIST : null;
if (!appDir) {
  console.warn("packages/app/dist is missing: run `npm run build` to serve the application");
}
const guestSignup = env.GUEST_SIGNUP === "on";

const required = ["APP_DATABASE_URL", "SESSION_SECRET"];
// Only signup crosses the tenant boundary, so only signup needs the role that
// can. A deployment without guests never holds a bypassrls connection at all.
if (guestSignup) required.push("ADMIN_DATABASE_URL");
const missing = required.filter((k) => !env[k]);
if (missing.length > 0) {
  console.error(`missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const PORT = Number(env.PORT ?? 8787);
const HOST = env.HOST ?? "127.0.0.1";

const repo = new PostgresRepo({
  connectionString: env.APP_DATABASE_URL,
  max: Number(env.DB_POOL_MAX ?? 10),
});

// Artifacts belong in object storage behind a CDN. Without R2 configured they
// are held in this process, which keeps the server runnable with no cloud
// credentials and loses every published map on restart — the ledger in
// Postgres survives, the bytes it points at do not. Say so, loudly.
let store;
try {
  store = r2FromEnv(env);
} catch (err) {
  console.error(`refusing to start: ${err.message}`);
  process.exit(1);
}
if (!store) {
  if (env.NODE_ENV === "production") {
    console.error(
      "refusing to start: no R2_* configuration in production. Published " +
        "maps would not survive a restart.",
    );
    process.exit(1);
  }
  console.warn("R2 is not configured: artifacts are in memory and will be lost on restart");
  store = new MemoryArtifactStore();
}
// With R2 the bucket's public domain serves artifacts and this process must
// not: it would be an open proxy onto the bucket.
const servePublic = store instanceof MemoryArtifactStore;
if (!servePublic && !env.PUBLIC_ARTIFACT_BASE) {
  console.error(
    "refusing to start: R2 is configured but PUBLIC_ARTIFACT_BASE is not, so " +
      "nothing would know where published maps are served from.",
  );
  process.exit(1);
}

const admin = guestSignup
  ? new AdminDb({ connectionString: env.ADMIN_DATABASE_URL })
  : null;

const num = (name, fallback) => {
  if (env[name] === undefined || env[name] === "") return fallback;
  const n = Number(env[name]);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} must be a non-negative number, got "${env[name]}"`);
    process.exit(1);
  }
  return n;
};

// RATE_<TIER>_MAX and RATE_<TIER>_WINDOW override one tier each.
const rate = (tier) => ({
  ...DEFAULT_RATE_LIMITS[tier],
  max: num(`RATE_${tier.toUpperCase()}_MAX`, DEFAULT_RATE_LIMITS[tier].max),
  timeWindow:
    env[`RATE_${tier.toUpperCase()}_WINDOW`] ?? DEFAULT_RATE_LIMITS[tier].timeWindow,
});

const limits = {
  member: DEFAULT_LIMITS.member,
  guest: {
    maxMaps: num("GUEST_MAX_MAPS", DEFAULT_LIMITS.guest.maxMaps),
    maxFeaturesPerMap: num(
      "GUEST_MAX_FEATURES_PER_MAP",
      DEFAULT_LIMITS.guest.maxFeaturesPerMap,
    ),
    maxVersionsPerMap: num(
      "GUEST_MAX_VERSIONS_PER_MAP",
      DEFAULT_LIMITS.guest.maxVersionsPerMap,
    ),
    maxBodyBytes: num("GUEST_MAX_BODY_BYTES", DEFAULT_LIMITS.guest.maxBodyBytes),
  },
};

// An unchecked signup endpoint on the public internet is a tenant factory for
// anyone with a loop. Outside production that is a convenience; in production
// it has to be asked for by name.
// The two halves of the check are useless apart: a secret with no site key
// means a page that can never produce a token, so every signup is refused.
if (Boolean(env.TURNSTILE_SECRET) !== Boolean(env.TURNSTILE_SITE_KEY)) {
  console.error(
    "refusing to start: set TURNSTILE_SECRET and TURNSTILE_SITE_KEY together, or neither.",
  );
  process.exit(1);
}

if (
  guestSignup &&
  !env.TURNSTILE_SECRET &&
  env.NODE_ENV === "production" &&
  env.GUEST_SIGNUP_UNCHECKED !== "on"
) {
  console.error(
    "refusing to start: GUEST_SIGNUP is on without TURNSTILE_SECRET. Set the " +
      "secret, or set GUEST_SIGNUP_UNCHECKED=on to run without a bot check.",
  );
  process.exit(1);
}

// Prove the isolation before accepting a single request. Every policy could be
// missing — a migration applied without the policy block, a connection string
// pointing at a bypassrls role — and nothing else in this process would notice;
// the server would start and serve other tenants' rows. Refuse to start instead.
try {
  await repo.assertRlsActive();
  // The mirror image: the provisioning pool must be the role that CAN cross
  // tenants, or signup would fail halfway through creating one.
  if (admin) await admin.assertBypassesRls();
} catch (err) {
  console.error(`refusing to start: ${err.message}`);
  await repo.close();
  if (admin) await admin.close();
  process.exit(1);
}

const app = buildServer({
  repo,
  store,
  auth: new TokenAuth(env.SESSION_SECRET),
  logger: {
    level: env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie"],
  },
  rateLimit: {
    signup: rate("signup"),
    publish: {
      ...rate("publish"),
      guestMax: num("RATE_PUBLISH_GUEST_MAX", DEFAULT_RATE_LIMITS.publish.guestMax),
    },
    write: rate("write"),
    read: rate("read"),
    unauth: rate("unauth"),
  },
  limits,
  // Comma-separated addresses or CIDRs of the proxies in front of this
  // process. Unset means none: correct when it is reached directly, and wrong
  // behind anything else, where every visitor would share one address.
  ...(env.TRUST_PROXY ? { trustProxy: env.TRUST_PROXY } : {}),
  servePublic,
  docs: true,
  ...(appDir ? { appDir } : {}),
  ...(env.PUBLIC_ARTIFACT_BASE
    ? { publicArtifactBase: env.PUBLIC_ARTIFACT_BASE }
    : {}),
  ...(admin
    ? {
        guests: {
          provisioner: new PostgresGuestProvisioner(admin),
          issueToken: (claims) => signSession(claims, env.SESSION_SECRET),
          maxGuests: num("MAX_GUESTS", 500),
          ...(env.TURNSTILE_SECRET
            ? {
                humanCheck: turnstileCheck({ secret: env.TURNSTILE_SECRET }),
                humanCheckSiteKey: env.TURNSTILE_SITE_KEY,
              }
            : {}),
        },
      }
    : {}),
  readiness: () => repo.ping(),
});

await app.listen({ port: PORT, host: HOST });

// Drain in-flight requests before dropping the pool, otherwise a deploy
// returns 500s to requests that were already being served.
let closing = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    app.log.info("shutting down");
    try {
      await app.close();
      await repo.close();
      if (admin) await admin.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown failed");
      process.exit(1);
    }
  });
}
