// Headless screenshot of one URL. Uses the Chromium already cached by
// Playwright and refuses to download one.
//   node scripts/shot.mjs <url> <out.png> [width] [height] [--full] [--dark] [--wait=ms] [--scale=n]
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  const builds = existsSync(base)
    ? readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()
    : [];
  for (const build of builds) {
    const candidate = join(base, build, "chrome-linux64", "chrome");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No cached Chromium under ~/.cache/ms-playwright. Refusing to download one.");
}

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const [url, out, width = "1440", height = "900"] = args.filter((a) => !a.startsWith("--"));
if (!url || !out) {
  console.error("usage: node scripts/shot.mjs <url> <out.png> [width] [height] [--full] [--dark] [--wait=ms] [--scale=n]");
  process.exit(2);
}
const flag = (name) => flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
const wait = Number((flag("wait") ?? "--wait=2500").split("=")[1]);
const scale = Number((flag("scale") ?? "--scale=1").split("=")[1]);

const browser = await chromium.launch({
  executablePath: findChromium(),
  // Software GL: without these MapLibre never gets a WebGL context headless.
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(height) },
    deviceScaleFactor: scale,
    colorScheme: flag("dark") ? "dark" : "light",
  });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()} ${r.failure()?.errorText ?? ""}`));
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 }).catch((e) => problems.push(`goto: ${e.message}`));
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out, fullPage: Boolean(flag("full")) });
  for (const p of problems.slice(0, 20)) console.error(p);
  console.log(`${out} ${problems.length ? `(${problems.length} problems)` : "ok"}`);
} finally {
  await browser.close();
}
