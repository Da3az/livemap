// The whole application on one port with no database: the real API and the
// real shell over an in-memory repository.
//
//   npm run demo        http://127.0.0.1:8800/
//
// Nothing here is a mock of the server. `buildServer` is the same function
// production calls; only the three things behind its seams are in memory —
// the repository, the artifact store and the guest provisioner.

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildServer,
  MemoryArtifactStore,
  MemoryGuestProvisioner,
  MemoryMapRepo,
  TokenAuth,
  findTemplate,
  signSession,
} from "../packages/api/src/index.ts";
import { APP_DIST, buildApp } from "../packages/app/build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8800);

// A seeded workspace beside the guests, so there is a published map to embed
// before anyone has drawn anything.
const DEMO = {
  tenantId: "t-demo",
  tenantSlug: "demo-news",
  userId: "u-demo",
  role: "editor",
  mapId: "m-1",
  mapSlug: "levant-tracker",
};

async function main() {
  await buildApp();

  // Fresh each run: a token minted by one run of the demo means nothing to
  // the next, which is the right lifetime for a secret that is printed below.
  const secret = randomBytes(32).toString("base64url");

  const repo = new MemoryMapRepo();
  const conflict = findTemplate("conflict-tracker");
  repo.seed(
    {
      id: DEMO.mapId,
      tenantId: DEMO.tenantId,
      slug: DEMO.mapSlug,
      title: { value: "Levant tracker", dir: "ltr" },
      viewport: conflict.viewport,
      basemap: { styleId: "light", labelLangs: [...conflict.labelLangs] },
      uiDir: "rtl",
      updatedAt: new Date().toISOString(),
      rev: 0,
    },
    conflict.features,
    { createdBy: DEMO.userId },
  );
  repo.grant(DEMO.tenantId, DEMO.userId, DEMO.role);

  const app = buildServer({
    repo,
    store: new MemoryArtifactStore(),
    auth: new TokenAuth(secret),
    appDir: APP_DIST,
    servePublic: true,
    docs: true,
    guests: {
      provisioner: new MemoryGuestProvisioner(repo),
      issueToken: (claims) => signSession(claims, secret),
    },
  });

  // A stand-in for a publisher's article, to show the embed on a page that is
  // not this application.
  app.get("/article.html", { schema: { hide: true } }, async (_req, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .send(await readFile(join(HERE, "article.html"))),
  );

  await app.listen({ port: PORT, host: "127.0.0.1" });

  const token = signSession(
    {
      userId: DEMO.userId,
      tenantId: DEMO.tenantId,
      tenantSlug: DEMO.tenantSlug,
      role: DEMO.role,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
    secret,
  );

  // Publish v1 so the embed and the versions page have something to show.
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/maps/${DEMO.mapId}/publish`,
    headers: { authorization: `Bearer ${token}` },
  });
  const published = res.json();

  console.log(`
  livemap

    http://127.0.0.1:${PORT}/                the application — continue as guest
    http://127.0.0.1:${PORT}/docs            API reference
    http://127.0.0.1:${PORT}/article.html    a published map embedded in a page

  A seeded workspace with a published map (v${published.version}). Paste this on
  the sign-in page, or send it as a bearer token:

    ${token}

  In-memory repository · nothing is kept · Ctrl-C to stop
`);
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exitCode = 1;
});
