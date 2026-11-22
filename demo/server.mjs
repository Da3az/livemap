// The whole product on one port with no database: the real API serving the
// built front end (web/dist) over an in-memory repository.
//
//   npm run demo        http://127.0.0.1:8800/
//
// Nothing here is a mock of the server. `buildServer` is the same function
// production calls; only the three things behind its seams are in memory —
// the repository, the artifact store and the guest provisioner.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildServer,
  MemoryArtifactStore,
  MemoryGuestProvisioner,
  MemoryMapRepo,
  signSession,
  TokenAuth,
} from "../packages/api/src/index.ts";
import { templateSettings } from "@livemap/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const WEB_DIST = join(ROOT, "web", "dist");
const PORT = Number(process.env.PORT ?? 8800);

const TENANT = { id: "t-demo", slug: "al-mashriq", name: "Al Mashriq Newsroom" };
const PEOPLE = [
  { id: "u-layla", role: "owner", name: "Layla Haddad" },
  { id: "u-sarah", role: "admin", name: "Sarah Whitfield" },
  { id: "u-omar", role: "editor", name: "عمر الفارسي" },
  { id: "u-yousef", role: "contributor", name: "يوسف بن عمر" },
  { id: "u-hannah", role: "viewer", name: "Hannah Lindqvist" },
];

const en = (value) => ({ value, dir: "ltr" });
const base = (id, order, name, groupId, presetId, extra = {}) => ({
  id,
  order,
  name: en(name),
  groupId,
  hidden: false,
  locked: false,
  presetId,
  validFrom: null,
  validTo: null,
  lineageId: null,
  ...extra,
});
const slot = (n) => ({ slot: n });
const stroke = (n, width, dash = "solid") => ({ color: slot(n), width, opacity: 1, dash });

/** Cyclone Shaheen, October 2021: warning areas, the observed track and a shelter. */
const FEATURES = [
  base("w-red", "a", "Red warning: Al Batinah North", "g-warnings", "p-red", {
    kind: "area",
    rings: [[[56.45, 24.62], [57.35, 24.02], [57.62, 23.71], [57.21, 23.5], [56.32, 24.31], [56.45, 24.62]]],
    fill: { color: slot(1), opacity: 0.3, pattern: "none" },
    stroke: stroke(1, 1.5),
  }),
  base("track", "b", "Observed track", "g-track", "p-track", {
    kind: "line",
    path: [[63.1, 22.9], [61.2, 23.3], [59.4, 23.7], [57.9, 23.85], [56.9, 24.05]],
    stroke: stroke(5, 3),
  }),
  base("landfall", "c", "Landfall near Al Khaburah", "g-notes", null, {
    kind: "annotation",
    anchor: [57.1, 23.98],
    textAt: [57.9, 24.75],
    text: en("Landfall near Al Khaburah, 3 October, evening"),
    labelStyle: { color: "ink", size: 12, weight: 400, halo: false, box: true },
    leader: { shape: "elbow", anchorDot: true },
  }),
  base("sohar", "d", "Sohar shelter", "g-shelters", "p-shelter", {
    kind: "point",
    at: [56.71, 24.35],
    symbol: { icon: "shelter" },
    color: slot(4),
    size: 24,
    label: { value: "صحار", dir: "rtl" },
    labelStyle: { color: "ink", size: 12, weight: 600, halo: true, box: false },
  }),
];

function ensureBuilt() {
  if (existsSync(join(WEB_DIST, "index.html")) && process.env.DEMO_REBUILD !== "1") return;
  console.log("building web/ …");
  const out = spawnSync("npm", ["run", "build", "-w", "@livemap/web"], { cwd: ROOT, stdio: "inherit" });
  if (out.status !== 0) throw new Error("the web build failed");
}

async function main() {
  ensureBuilt();

  // Fresh each run: a token minted by one run of the demo means nothing to
  // the next, which is the right lifetime for a secret that is printed below.
  const secret = randomBytes(32).toString("base64url");
  const repo = new MemoryMapRepo();
  for (const person of PEOPLE) repo.grant(TENANT.id, person.id, person.role, { user: person.name, tenant: TENANT.name });

  const app = buildServer({
    repo,
    store: new MemoryArtifactStore(),
    auth: new TokenAuth(secret),
    appDir: WEB_DIST,
    servePublic: true,
    docs: true,
    specimen: { tenantSlug: TENANT.slug, mapSlug: "cyclone-shaheen" },
    guests: {
      provisioner: new MemoryGuestProvisioner(repo),
      issueToken: (claims) => signSession(claims, secret),
    },
  });

  // A stand-in for a publisher's article, to show the embed on a page that is
  // not this application.
  app.get("/article.html", { schema: { hide: true } }, async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(await readFile(join(HERE, "article.html"))),
  );

  await app.listen({ port: PORT, host: "127.0.0.1" });

  const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const tokens = PEOPLE.map((person) => ({
    ...person,
    token: signSession({ userId: person.id, tenantId: TENANT.id, tenantSlug: TENANT.slug, role: person.role, exp }, secret),
  }));
  const owner = tokens[0];
  const call = async (method, url, payload) => {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${owner.token}` }, ...(payload ? { payload } : {}) });
    if (res.statusCode >= 400) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
    return res.json();
  };

  // One map, made, drawn and published through the API like any other.
  const { map } = await call("POST", "/api/v1/maps", { title: en("Cyclone Shaheen"), uiDir: "ltr", template: "storm-track" });
  const settings = templateSettings("storm-track", "ltr");
  await call("POST", `/api/v1/maps/${map.id}/edit`, {
    rev: map.rev,
    put: FEATURES,
    delete: [],
    settings: {
      openingView: { center: [57.4, 23.9], zoom: 6.6, bearing: 0, pitch: 0 },
      titleBlock: {
        ...settings.titleBlock,
        subtitle: en("Warnings, track and shelters as the storm came ashore"),
        source: en("Source: Oman Meteorology, National Committee for Emergency Management"),
        credit: en("Graphic: Al Mashriq"),
        asOf: "2021-10-03T18:00:00Z",
      },
    },
  });
  const published = await call("POST", `/api/v1/maps/${map.id}/publish`);

  console.log(`
  livemap

    http://127.0.0.1:${PORT}/                the application: continue as guest, or paste a token
    http://127.0.0.1:${PORT}/docs            API reference
    http://127.0.0.1:${PORT}/article.html    the published map embedded in an article

  Workspace "${TENANT.name}" with one published map (v${published.version}).
  Paste one of these on the sign-in page:
${tokens.map((t) => `\n    ${t.role.padEnd(12)} ${t.name}\n    ${t.token}`).join("\n")}

  In-memory repository · nothing is kept · Ctrl-C to stop
`);
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exitCode = 1;
});
