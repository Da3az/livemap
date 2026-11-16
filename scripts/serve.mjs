#!/usr/bin/env node
// Production entrypoint. Wires the real implementations from the environment
// and refuses to start on a misconfiguration rather than degrading quietly.
//
//   node --import tsx scripts/serve.mjs

import {
  buildServer,
  PostgresRepo,
  MemoryArtifactStore,
  TokenAuth,
} from "../packages/api/src/index.ts";

const required = ["APP_DATABASE_URL", "SESSION_SECRET"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

const repo = new PostgresRepo({
  connectionString: process.env.APP_DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

// Artifacts belong in object storage behind a CDN. This in-process store keeps
// the server runnable without cloud credentials; swapping in S3 or R2 is one
// ArtifactStore implementation and no change above it.
const store = new MemoryArtifactStore();

const app = buildServer({
  repo,
  store,
  auth: new TokenAuth(process.env.SESSION_SECRET),
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie"],
  },
  rateLimit: {
    max: Number(process.env.RATE_LIMIT_MAX ?? 60),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
  },
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
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown failed");
      process.exit(1);
    }
  });
}
