// Drives the demo in a headless browser, the way a visitor would, and leaves
// screenshots to be READ — structural checks have gone green in this project
// before while the picture was visibly wrong.
//
//   npm run demo                      (in one terminal)
//   node demo/app-check.mjs           (in another)

import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8800";
const SHOTS = new URL("./shots/", import.meta.url).pathname;

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  const builds = existsSync(root) ? readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse() : [];
  for (const build of builds) {
    const candidate = join(root, build, "chrome-linux64", "chrome");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No cached Chromium under ~/.cache/ms-playwright. Refusing to download one.");
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  // Software GL: without these MapLibre never gets a WebGL context headless.
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("response", (r) => {
  // The signed-out session probe is expected to be refused.
  if (r.status() >= 400 && !r.url().endsWith("/api/v1/session")) problems.push(`${r.status()} ${r.url()}`);
});

const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

try {
  await mkdir(SHOTS, { recursive: true });

  await page.goto(`${BASE}/`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOTS}signin.png` });
  check(await page.getByRole("button", { name: "Continue as guest" }).isVisible(), "sign-in offers a guest workspace");

  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.waitForURL(/\/maps$/, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}workspace.png` });
  check(page.url().endsWith("/maps"), "a guest lands in its own workspace");

  await page.goto(`${BASE}/article.html`);
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${SHOTS}article.png`, fullPage: true });
  const frame = page.frames().find((f) => f.url().includes("/embed/"));
  check(Boolean(frame), "the article holds the embed");
  if (frame) {
    const origin = await frame.evaluate(() => origin);
    check(origin === "null", "the embed runs sandboxed, with an opaque origin");
    check(await frame.getByText("Cyclone Shaheen").first().isVisible(), "the embed shows the published map's title");
  }
} finally {
  await browser.close();
}

console.log(problems.length ? `\n${problems.length} problem(s):\n  ${problems.join("\n  ")}` : "\nall checks passed — now read the screenshots in demo/shots/");
process.exitCode = problems.length ? 1 : 0;
