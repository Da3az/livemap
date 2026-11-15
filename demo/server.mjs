// Real Fastify API over an in-memory repo seeded with the spike scene, plus the demo pages.

import { readFile, mkdir, copyFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.PORT ?? 8800);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sh(bin, args, label) {
  const r = spawnSync(bin, args, { encoding: "utf8", cwd: ROOT });
  if (r.status !== 0) throw new Error(`${label} failed:\n${r.stderr || r.stdout}`);
}

async function buildAssets() {
  const esbuild = join(ROOT, "node_modules", ".bin", "esbuild");
  await mkdir(join(HERE, "dist"), { recursive: true });

  sh(esbuild, [
    join(HERE, "app.ts"),
    "--bundle", "--format=esm", "--platform=browser", "--target=chrome120",
    "--sourcemap", `--outfile=${join(HERE, "dist", "demo.js")}`,
  ], "demo bundle");

  sh(esbuild, [
    join(HERE, "editor-app.ts"),
    "--bundle", "--format=esm", "--platform=browser", "--target=chrome120",
    "--sourcemap", `--outfile=${join(HERE, "dist", "editor.js")}`,
  ], "editor bundle");

  await copyFile(
    join(ROOT, "packages", "editor", "src", "editor.css"),
    join(HERE, "dist", "editor.css"),
  );

  // The embed parent helper, for the article page.
  sh(esbuild, [
    join(ROOT, "packages", "viewer", "src", "embed.ts"),
    "--bundle", "--format=esm", "--platform=browser", "--target=chrome120",
    `--outfile=${join(HERE, "dist", "embed.js")}`,
  ], "embed bundle");

  // MapLibre 6 loads its worker as a separate file next to the bundle.
  await copyFile(
    join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"),
    join(HERE, "dist", "maplibre-gl-worker.mjs"),
  );
  await copyFile(
    join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl.css"),
    join(HERE, "maplibre-gl.css"),
  );

  const shots = join(ROOT, "spikes", "shots");
  if (existsSync(shots)) {
    await cp(shots, join(HERE, "shots"), { recursive: true });
  }
}

async function main() {
  await buildAssets();

  const { buildServer, StaticAuth, MemoryMapRepo, MemoryArtifactStore } =
    await import(join(ROOT, "packages", "api", "src", "index.ts"));
  const { scene, SCENE_CENTER, SCENE_ZOOM } =
    await import(join(ROOT, "spikes", "scene.ts"));

  const repo = new MemoryMapRepo();
  repo.seed(
    {
      id: "m-1",
      tenantId: "t-demo",
      slug: "levant-tracker",
      title: { value: "Levant tracker", dir: "ltr" },
      viewport: { center: SCENE_CENTER, zoom: SCENE_ZOOM, bearing: 0, pitch: 0 },
      basemap: { styleId: "light", labelLangs: ["ar", "en"] },
      uiDir: "rtl",
      updatedAt: new Date().toISOString(),
      rev: 0,
    },
    scene,
  );

  const store = new MemoryArtifactStore();
  const app = buildServer({
    repo,
    store,
    auth: new StaticAuth({
      userId: "u-demo",
      tenantId: "t-demo",
      tenantSlug: "demo-news",
      role: "editor",
    }),
  });

  // Serve the demo pages for anything the API does not claim.
  app.setNotFoundHandler(async (req, reply) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/favicon.ico") return reply.code(204).send();
    const rel = url === "/" ? "/index.html" : url;
    try {
      const body = await readFile(join(HERE, rel));
      return reply
        .header("content-type", MIME[extname(rel)] ?? "application/octet-stream")
        .header("cache-control", "no-store")
        .send(body);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });

  await app.listen({ port: PORT, host: "127.0.0.1" });

  // Publish v1 so the viewer has something to fetch on first load.
  const res = await app.inject({ method: "POST", url: "/maps/m-1/publish" });
  const published = res.json();

  console.log(`
  livemap demo

    http://127.0.0.1:${PORT}/

  published v${published.version}  etag ${published.etag}
  ${scene.length} features · in-memory repo · press Ctrl-C to stop
`);
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exitCode = 1;
});
