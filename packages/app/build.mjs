#!/usr/bin/env node
// Builds the application shell into dist/: three bundles and the static files
// they need beside them. Importable, so the local demo can build before it
// serves; runnable, so `npm run build` can.

import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const pkg = (name, file = "index.ts") =>
  join(ROOT, "packages", name, "src", file);

export const APP_DIST = join(HERE, "dist");

export async function buildApp() {
  await mkdir(APP_DIST, { recursive: true });

  await build({
    entryPoints: {
      app: join(HERE, "src", "main.ts"),
      embed: join(HERE, "src", "embed-page.ts"),
      // The host-page half of the embed protocol, for a publisher's own page.
      "embed-host": pkg("viewer", "embed.ts"),
    },
    outdir: APP_DIST,
    bundle: true,
    // ESM, not IIFE: an IIFE breaks the `import.meta.url` MapLibre uses to
    // find its worker.
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    // Straight to source. The packages' own `main` points at their built
    // output, which would make this bundle only as fresh as the last build of
    // each of them.
    alias: {
      "@livemap/core": pkg("core"),
      "@livemap/renderer": pkg("renderer"),
      "@livemap/viewer": pkg("viewer"),
      "@livemap/editor": pkg("editor"),
    },
    logLevel: "warning",
  });

  const copies = [
    [join(HERE, "src", "index.html"), "index.html"],
    [join(HERE, "src", "embed.html"), "embed.html"],
    [join(HERE, "src", "app.css"), "app.css"],
    [pkg("editor", "tokens.css"), "tokens.css"],
    [pkg("editor", "editor.css"), "editor.css"],
    [
      join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl.css"),
      "maplibre-gl.css",
    ],
    // MapLibre 6 loads its worker as a separate file from beside the bundle.
    // Missing, the map renders nothing and the only clue is a 404.
    [
      join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"),
      "maplibre-gl-worker.mjs",
    ],
  ];
  for (const [from, to] of copies) await copyFile(from, join(APP_DIST, to));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  buildApp().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
