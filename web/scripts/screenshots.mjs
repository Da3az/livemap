// The screenshot matrix: every state in the catalogue (src/screens/dev/catalogue.ts)
// at each size, direction and theme, plus an index and a contact sheet.
//
//   node scripts/screenshots.mjs [--only <screen>[/<state>][,…]] [--width 1440,834,390]
//                                [--theme light,dark] [--dir ltr,rtl] [--base-url http://…]
//                                [--concurrency 4] [--out screenshots]
//
// Without --base-url it starts its own Vite dev server on a free port, with its
// own optimiser cache, and stops it at the end. It uses the Chromium Playwright
// already cached and never downloads one. The steps that reach a state run in
// the page through src/screens/dev/runner.ts, the same code the gallery uses.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { CATALOGUE, HEIGHTS, MATRIX_WIDTHS, directionsOf, recipeFor, stateUrl } = await import(join(ROOT, "src/screens/dev/catalogue.ts"));

/* ------------------------------------------------------------ options */

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    const value = inline ?? (argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true");
    options[key] = value;
  }
  return options;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 12).join("\n"));
  process.exit(0);
}
const list = (value) => (value ? String(value).split(",").map((v) => v.trim()).filter(Boolean) : null);
const only = list(args.only);
const widths = (list(args.width) ?? MATRIX_WIDTHS.map(String)).map(Number);
const themes = list(args.theme) ?? ["light", "dark"];
const dirs = list(args.dir) ?? ["ltr", "rtl"];
const concurrency = Math.max(1, Number(args.concurrency ?? 4));
const OUT = resolve(ROOT, args.out ?? "screenshots");

for (const width of widths) if (!HEIGHTS[width]) fail(`--width ${width}: not one of ${Object.keys(HEIGHTS).join(", ")}`);
for (const theme of themes) if (theme !== "light" && theme !== "dark") fail(`--theme ${theme}: light or dark`);
for (const dir of dirs) if (dir !== "ltr" && dir !== "rtl") fail(`--dir ${dir}: ltr or rtl`);

function fail(message) {
  console.error(message);
  process.exit(2);
}

/* ------------------------------------------------------------ browser */

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  const builds = existsSync(base) ? readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse() : [];
  for (const build of builds) {
    const candidate = join(base, build, "chrome-linux64", "chrome");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No cached Chromium under ~/.cache/ms-playwright. Refusing to download one.");
}

/* --------------------------------------------------------- dev server */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const cacheDir = join(tmpdir(), `livemap-screenshots-vite`);
  const child = spawn(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT,
    env: { ...process.env, VITE_CACHE_DIR: cacheDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`vite exited:\n${log}`);
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > until) throw new Error(`vite did not start:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(`dev server ${base} (pid ${child.pid}, cache ${cacheDir})`);
  return { base, stop: () => child.kill("SIGTERM") };
}

/* --------------------------------------------------------------- jobs */

function selected(screen, state) {
  if (!only) return true;
  return only.some((entry) => {
    const [screenId, stateId] = entry.split("/");
    return screenId === screen.id && (stateId === undefined || stateId === state.id);
  });
}

const jobs = [];
const skipped = [];
for (const screen of CATALOGUE) {
  for (const state of screen.states) {
    if (!selected(screen, state)) continue;
    if (state.linkOnly) continue;
    if (state.blocked) {
      skipped.push({ key: `${screen.id}/${state.id}`, reason: state.blocked });
      continue;
    }
    const stateWidths = (state.widths ?? MATRIX_WIDTHS).filter((w) => widths.includes(w));
    for (const dir of directionsOf(state).filter((d) => dirs.includes(d))) {
      for (const width of stateWidths) {
        for (const theme of themes) {
          jobs.push({ screen, state, dir, width, theme, recipe: recipeFor(state, dir), file: `${screen.id}/${state.id}-${width}-${dir}-${theme}.png` });
        }
      }
    }
  }
}
if (only && jobs.length === 0) fail(`--only ${args.only}: no state matches`);

/* ---------------------------------------------------------------- run */

/** Resolves when no request has been in flight for `quietMs`, or after `maxMs`. */
function networkQuiet(tracker, quietMs, maxMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const now = Date.now();
      if ((tracker.inflight.size === 0 && now - tracker.last >= quietMs) || now - started >= maxMs) resolve(now - started >= maxMs ? "timeout" : "quiet");
      else setTimeout(tick, 100);
    };
    tick();
  });
}

async function shoot(browser, base, job) {
  const problems = [];
  const context = await browser.newContext({
    viewport: { width: job.width, height: HEIGHTS[job.width] },
    colorScheme: job.theme,
    deviceScaleFactor: 1,
    hasTouch: job.width === 390,
    isMobile: false,
  });
  const page = await context.newPage();
  const tracker = { inflight: new Set(), last: Date.now() };
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message.split("\n")[0]}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text().split("\n")[0].slice(0, 300)}`);
  });
  page.on("request", (request) => {
    /* A worker's own script never reports finished; the requests the worker makes do. */
    if (request.url().includes("worker_file")) return;
    if (process.env.SHOTS_DEBUG) console.log("req", request.url().slice(0, 100));
    tracker.inflight.add(request);
    tracker.last = Date.now();
  });
  const settle = (request) => {
    tracker.inflight.delete(request);
    tracker.last = Date.now();
  };
  page.on("requestfinished", settle);
  page.on("requestfailed", (request) => {
    settle(request);
    const reason = request.failure()?.errorText ?? "";
    /* An aborted navigation request, or a blocked one a state asked for, is not a defect of the page. */
    if (!reason.includes("ERR_ABORTED")) problems.push(`request failed: ${request.url().slice(0, 200)} ${reason}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url().slice(0, 200)}`);
  });

  try {
    const url = `${base}${stateUrl(job.recipe)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const report = await page.evaluate(
      async ({ steps, ready }) => {
        const runner = await import("/src/screens/dev/runner.ts");
        await runner.waitForPage(window, ready);
        return runner.runSteps(window, steps, {
          mock: async () => (await import("/src/api/mock/index.ts")).mockControl,
          server: async () => (await import("/src/api/mock/server.ts")).server,
        });
      },
      { steps: job.recipe.steps ?? [], ready: job.recipe.ready },
    );
    if (report.phase === "failed") {
      const label = await page.evaluate(async (step) => (await import("/src/screens/dev/runner.ts")).describeStep(step), report.step);
      throw new Error(`step ${report.index + 1} of ${report.total} failed (${label}): ${report.message}`);
    }
    if (job.recipe.map) {
      const quiet = await networkQuiet(tracker, 800, 20_000);
      if (quiet === "timeout") problems.push(`map: still loading after 20 s: ${[...tracker.inflight].slice(0, 3).map((r) => r.url().slice(0, 120)).join(", ")}`);
    } else {
      await networkQuiet(tracker, 300, 5_000);
    }
    /* Two frames, so whatever the last response caused has been painted. */
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await page.waitForTimeout(job.recipe.settle ?? (job.recipe.map ? 600 : 250));
    const path = join(OUT, job.file);
    mkdirSync(dirname(path), { recursive: true });
    await page.screenshot({ path, animations: "disabled", caret: "hide" });
    return { ok: true, problems };
  } catch (error) {
    /* What the page looked like when it went wrong, for working out the recipe. Not part of the index. */
    const path = join(OUT, "_failed", job.file);
    mkdirSync(dirname(path), { recursive: true });
    await page.screenshot({ path }).catch(() => undefined);
    return { ok: false, problems: [...problems, `failed: ${error.message.split("\n")[0]}`] };
  } finally {
    await context.close();
  }
}

async function run() {
  if (jobs.length === 0) {
    console.log("nothing to shoot");
    return;
  }
  const server = args["base-url"] ? { base: String(args["base-url"]).replace(/\/$/, ""), stop: () => undefined } : await startServer();
  const browser = await chromium.launch({
    executablePath: findChromium(),
    /* Software GL: without these MapLibre never gets a WebGL context headless. */
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const started = Date.now();
  const results = new Map();
  let done = 0;
  try {
    /* Warm the dev server: the first page load compiles every module. */
    const warm = await browser.newPage();
    await warm.goto(`${server.base}/dev/states?mock-reset=1&fast=1`, { waitUntil: "load", timeout: 120_000 }).catch(() => undefined);
    await warm.close();

    const queue = [...jobs];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        let result = await shoot(browser, server.base, job);
        if (!result.ok) {
          const first = result.problems;
          result = await shoot(browser, server.base, job);
          result.retried = true;
          if (!result.ok) result.problems = [...new Set([...first, ...result.problems])];
        }
        results.set(job, result);
        done++;
        const mark = result.ok ? (result.problems.length ? "~" : " ") : "x";
        console.log(`${mark} [${done}/${jobs.length}] ${job.file}${result.retried ? " (retried)" : ""}${result.problems.length ? ` · ${result.problems[result.problems.length - 1]}` : ""}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  } finally {
    await browser.close();
    server.stop();
  }
  writeIndex(results, server.base, Date.now() - started);
}

/* -------------------------------------------------------------- index */

function writeIndex(results, base, elapsed) {
  const indexPath = join(OUT, "index.json");
  /* A partial run (--only, --width…) updates its entries and keeps the rest. */
  const previous = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : { states: {} };
  const states = previous.states ?? {};
  for (const [job, result] of results) {
    const key = `${job.screen.id}/${job.state.id}`;
    const entry = (states[key] ??= { screen: job.screen.id, state: job.state.id, title: job.state.title, how: job.state.how, files: [] });
    entry.title = job.state.title;
    entry.how = job.state.how;
    entry.files = entry.files.filter((file) => file.file !== job.file);
    entry.files.push({ file: job.file, width: job.width, dir: job.dir, theme: job.theme, ok: result.ok, retried: Boolean(result.retried), problems: result.problems });
    entry.files.sort((a, b) => b.width - a.width || a.dir.localeCompare(b.dir) || a.theme.localeCompare(b.theme));
  }
  /* Drop entries whose state no longer exists in the catalogue. */
  const known = new Set(CATALOGUE.flatMap((screen) => screen.states.map((state) => `${screen.id}/${state.id}`)));
  for (const key of Object.keys(states)) if (!known.has(key)) delete states[key];

  const files = Object.values(states).flatMap((entry) => entry.files);
  const totals = {
    states: Object.keys(states).length,
    files: files.length,
    failed: files.filter((file) => !file.ok).length,
    withProblems: files.filter((file) => file.ok && file.problems.length > 0).length,
  };
  const thisRun = [...results.values()];
  const index = {
    generatedAt: new Date().toISOString(),
    baseUrl: base,
    lastRun: { jobs: thisRun.length, failed: thisRun.filter((r) => !r.ok).length, seconds: Math.round(elapsed / 1000), only: only ?? null, widths, themes, dirs },
    skipped: [...(previous.skipped ?? []).filter((s) => !skipped.some((t) => t.key === s.key)), ...skipped],
    totals,
    states,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(join(OUT, "index.html"), contactSheet(index));
  console.log(`\n${thisRun.length} shots in ${Math.round(elapsed / 1000)} s, ${index.lastRun.failed} failed. Index: ${relative(ROOT, indexPath)}, ${relative(ROOT, join(OUT, "index.html"))}`);
  for (const skip of skipped) console.log(`skipped ${skip.key}: ${skip.reason}`);
}

function escape(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function contactSheet(index) {
  const byScreen = new Map();
  for (const entry of Object.values(index.states)) {
    if (!byScreen.has(entry.screen)) byScreen.set(entry.screen, []);
    byScreen.get(entry.screen).push(entry);
  }
  const order = CATALOGUE.map((screen) => screen.id);
  const titles = Object.fromEntries(CATALOGUE.map((screen) => [screen.id, screen.title]));
  const stateOrder = Object.fromEntries(CATALOGUE.flatMap((screen) => screen.states.map((state, i) => [`${screen.id}/${state.id}`, i])));
  const sections = [...byScreen.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([screen, entries]) => {
      const rows = entries
        .sort((a, b) => stateOrder[`${a.screen}/${a.state}`] - stateOrder[`${b.screen}/${b.state}`])
        .map((entry) => {
          const shots = entry.files
            .map((file) => {
              const label = `${file.width} ${file.dir} ${file.theme}`;
              const flag = !file.ok ? " failed" : file.problems.length ? " problems" : "";
              const title = file.problems.length ? file.problems.join("\n") : label;
              const img = file.ok ? `<img src="${escape(file.file)}" alt="${escape(`${entry.title}, ${label}`)}" loading="lazy">` : `<span class="missing">not shot</span>`;
              return `<a class="shot${flag}" href="${escape(file.file)}" title="${escape(title)}">${img}<span>${escape(label)}${file.problems.length ? ` · ${file.problems.length} problem${file.problems.length > 1 ? "s" : ""}` : ""}</span></a>`;
            })
            .join("");
          return `<section id="${escape(`${entry.screen}-${entry.state}`)}"><h3>${escape(entry.title)} <small>${escape(entry.screen)}/${escape(entry.state)}</small></h3><p>${escape(entry.how)}</p><div class="shots">${shots}</div></section>`;
        })
        .join("");
      return `<h2 id="${escape(screen)}">${escape(titles[screen] ?? screen)}</h2>${rows}`;
    })
    .join("");
  const nav = order.filter((id) => byScreen.has(id)).map((id) => `<a href="#${id}">${escape(titles[id])} (${byScreen.get(id).length})</a>`).join(" · ");
  const skippedList = index.skipped.length ? `<p>Not shot: ${index.skipped.map((s) => `${escape(s.key)} (${escape(s.reason)})`).join("; ")}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>livemap screenshots</title>
<style>
  :root { color-scheme: light dark; font: 13px/1.4 system-ui, sans-serif; }
  body { margin: 0 16px 48px; }
  header { position: sticky; top: 0; background: Canvas; padding: 8px 0; border-bottom: 1px solid GrayText; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 24px 0 4px; border-bottom: 1px solid GrayText; }
  h3 { font-size: 13px; margin: 14px 0 0; }
  h3 small { font-weight: normal; color: GrayText; }
  p { margin: 2px 0 6px; color: GrayText; }
  .shots { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
  .shot { display: flex; flex-direction: column; gap: 2px; color: inherit; text-decoration: none; font-size: 11px; }
  .shot img { height: 150px; width: auto; border: 1px solid GrayText; display: block; }
  .shot.failed span, .shot.problems span { color: #b3261e; }
  .missing { display: grid; place-items: center; height: 150px; width: 120px; border: 1px dashed #b3261e; }
</style>
</head>
<body>
<header>
<h1>livemap screenshots</h1>
<p>${index.totals.states} states, ${index.totals.files} files, ${index.totals.failed} failed, ${index.totals.withProblems} with console or network problems. Generated ${escape(index.generatedAt)} from ${escape(index.baseUrl)}. Hover a thumbnail for its problems.</p>
${skippedList}
<nav>${nav}</nav>
</header>
${sections}
</body>
</html>
`;
}

await run();
