// Builds and serves the spike harness, drives it in cached headless Chromium,
// then asserts on the generated GeoJSON and captures screenshots per view.

import { createServer } from "node:http";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SHOTS = join(HERE, "shots");
const PORT = 8771;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function findChromium() {
  const base = join(process.env.HOME, ".cache", "ms-playwright");
  // Prefer the newest full chromium build; headless_shell lacks some APIs.
  for (const v of ["chromium-1248", "chromium-1243"]) {
    const p = join(base, v, "chrome-linux64", "chrome");
    if (existsSync(p)) return p;
  }
  throw new Error(
    "No cached Chromium under ~/.cache/ms-playwright. Refusing to download one.",
  );
}

function build() {
  const esbuild = join(ROOT, "node_modules", ".bin", "esbuild");
  const r = spawnSync(
    esbuild,
    [
      join(HERE, "app.ts"),
      "--bundle",
      // ESM, not IIFE: MapLibre 6 resolves its worker through `import.meta.url`,
      // which IIFE destroys — symptom is a blank map and a 404 for the worker.
      "--format=esm",
      "--platform=browser",
      "--target=chrome120",
      "--sourcemap",
      `--outfile=${join(HERE, "dist", "app.js")}`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`esbuild failed:\n${r.stderr || r.stdout}`);
  process.stdout.write(r.stderr || "");
}

async function main() {
  await mkdir(join(HERE, "dist"), { recursive: true });
  await mkdir(SHOTS, { recursive: true });

  build();
  await copyFile(
    join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl.css"),
    join(HERE, "maplibre-gl.css"),
  );

  // Bundling does not inline the worker, so `maplibre-gl-worker.mjs` must sit
  // next to the output bundle or the map renders nothing, with only a 404 as
  // the clue. Applies to the editor and viewer builds too.
  await copyFile(
    join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"),
    join(HERE, "dist", "maplibre-gl-worker.mjs"),
  );

  const server = createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];
    // Empty favicon, so Chromium's automatic request is not logged as a 404.
    if (url === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    const rel = url === "/" ? "/page.html" : url;
    try {
      const body = await readFile(join(HERE, rel));
      res.writeHead(200, {
        "content-type": MIME[extname(rel)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  console.log(`serving http://127.0.0.1:${PORT}`);

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [
      // Software GL: without these MapLibre never gets a WebGL context headless.
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await browser.newPage({
    viewport: { width: 1100, height: 760 },
    deviceScaleFactor: 2,
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`http${r.status()}: ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.endsWith("/favicon.ico")) {
      errors.push(`requestfailed: ${u} ${r.failure()?.errorText ?? ""}`);
    }
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });

  const gl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("webgl2") || c.getContext("webgl");
    if (!ctx) return null;
    const dbg = ctx.getExtension("WEBGL_debug_renderer_info");
    return {
      version: ctx.getParameter(ctx.VERSION),
      renderer: dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
    };
  });
  console.log("WebGL:", gl ? `${gl.version} / ${gl.renderer}` : "UNAVAILABLE");
  if (!gl) throw new Error("No WebGL context — any visual result would be fake.");

  await page.waitForFunction(() => Boolean(window.lm), null, { timeout: 30_000 });

  // Bound the wait and report the stage reached: an unbounded `evaluate` on a
  // promise that never settles hangs with no diagnostic.
  const readyOutcome = await page.evaluate(async () => {
    const timeout = new Promise((r) => setTimeout(() => r("timeout"), 25_000));
    const result = await Promise.race([
      window.lm.ready.then(() => "ready"),
      timeout,
    ]);
    return { result, stages: window.lm.stages() };
  });
  console.log(
    `harness: ${readyOutcome.result} (stages: ${readyOutcome.stages.join(" -> ")})`,
  );
  if (readyOutcome.result !== "ready") {
    for (const e of errors.slice(0, 10)) console.log("  " + e);
    throw new Error(
      `harness never became ready; last stage was "${readyOutcome.stages.at(-1) ?? "none"}"`,
    );
  }

  const results = { webgl: gl, views: [] };

  // z6.2 is where the first prototype visibly broke — a regression view, not a sample.
  const views = [
    { name: "z9.2-authoring", zoom: 9.2, bearing: 0, pitch: 0 },
    { name: "z6.2-zoomed-out", zoom: 6.2, bearing: 0, pitch: 0 },
    { name: "z4.5-far-out", zoom: 4.5, bearing: 0, pitch: 0 },
    { name: "z12-zoomed-in", zoom: 12, bearing: 0, pitch: 0 },
    { name: "z9.2-rotated-pitched", zoom: 9.2, bearing: 55, pitch: 50 },
  ];

  for (const v of views) {
    await page.evaluate(
      ([z, b, p]) => window.lm.setView(z, b, p),
      [v.zoom, v.bearing, v.pitch],
    );
    await page.waitForTimeout(500);

    const counts = await page.evaluate(() => window.lm.sourceCounts());
    const labels = await page.evaluate(() => window.lm.labelPositions());
    const heads = await page.evaluate(() => window.lm.arrowheads());

    const shot = join(SHOTS, `${v.name}.png`);
    await page.screenshot({ path: shot });

    results.views.push({ ...v, counts, labels, heads, shot });
    console.log(
      `${v.name.padEnd(22)} areas=${counts["lm-areas"]} lines=${counts["lm-lines"]} ` +
        `teeth=${String(counts["lm-teeth"]).padStart(3)} markers=${String(counts["lm-markers"]).padStart(3)} ` +
        `labels=${counts["lm-labels"]} heads=${heads.length}`,
    );
  }

  await browser.close();
  await new Promise((r) => server.close(r));

  console.log("\n=== assertions ===");
  const fails = [];
  const check = (ok, msg) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
    if (!ok) fails.push(msg);
  };

  const byName = Object.fromEntries(results.views.map((v) => [v.name, v]));
  const authoring = byName["z9.2-authoring"];
  const far = byName["z4.5-far-out"];
  const zoomedIn = byName["z12-zoomed-in"];
  const rotated = byName["z9.2-rotated-pitched"];

  check(errors.length === 0, `no page errors (got ${errors.length})`);
  check(authoring.counts["lm-areas"] === 3, "3 areas rendered");
  check(authoring.counts["lm-markers"] >= 8, "icons + arrowheads rendered");
  check(authoring.heads.length === 3, "3 arrowheads (1 single + 1 double)");
  check(authoring.counts["lm-teeth"] > 5, "front line generated teeth");

  // Tooth count scaling with zoom is the px-denominated sizing fix.
  check(
    zoomedIn.counts["lm-teeth"] > authoring.counts["lm-teeth"],
    `teeth increase zooming in (${authoring.counts["lm-teeth"]} -> ${zoomedIn.counts["lm-teeth"]})`,
  );
  check(
    far.counts["lm-teeth"] < authoring.counts["lm-teeth"],
    `teeth decrease zooming out (${authoring.counts["lm-teeth"]} -> ${far.counts["lm-teeth"]})`,
  );

  // The collision engine silently dropped these before `icon-ignore-placement` was set.
  for (const v of results.views) {
    check(v.heads.length === 3, `${v.name}: all 3 arrowheads present`);
  }

  // icon-rotation-alignment:"map" means bearings must not change with the camera.
  const headKey = (v) =>
    Object.fromEntries(v.heads.map((h) => [`${h.id}:${h.lng.toFixed(4)}`, h.rotate]));
  const a = headKey(authoring);
  const r2 = headKey(rotated);
  check(
    Object.keys(a).every((k) => k in r2 && Math.abs(a[k] - r2[k]) < 0.001),
    "arrowhead rotations are view-independent",
  );

  for (const v of results.views) {
    let overlaps = 0;
    const pairs = [];
    for (let i = 0; i < v.labels.length; i++) {
      for (let j = i + 1; j < v.labels.length; j++) {
        const A = v.labels[i];
        const B = v.labels[j];
        const aw = A.text.length * 7 + 8;
        const bw = B.text.length * 7 + 8;
        if (Math.abs(A.x - B.x) < (aw + bw) / 2 && Math.abs(A.y - B.y) < 20) {
          overlaps++;
          pairs.push(`${A.id}/${B.id}`);
        }
      }
    }
    check(
      overlaps === 0,
      `${v.name}: no overlapping labels${pairs.length ? ` (${pairs.join(", ")})` : ""}`,
    );
  }

  if (errors.length) {
    console.log("\n=== page errors ===");
    for (const e of errors.slice(0, 20)) console.log("  " + e);
  }

  console.log(`\nscreenshots in ${SHOTS}`);
  console.log(
    fails.length === 0 ? "\nALL ASSERTIONS PASSED" : `\n${fails.length} ASSERTION(S) FAILED`,
  );
  process.exitCode = fails.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("spike failed:", e);
  process.exitCode = 1;
});
