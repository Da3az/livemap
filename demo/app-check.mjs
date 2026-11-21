// Drives the application in a headless browser, the way a visitor would, and
// leaves screenshots to be READ — structural assertions have gone green in
// this project before while the picture was visibly wrong.
//
//   npm run demo                      (in one terminal)
//   node demo/app-check.mjs           (in another)
//
// Pass ?basemap=blank through BASEMAP=blank to run without fetching tiles.

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8800";
const BLANK = process.env.BASEMAP === "blank" ? "?basemap=blank" : "";
const SHOTS = new URL("./shots/", import.meta.url).pathname;

const exe =
  process.env.CHROMIUM ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;

const browser = await chromium.launch({
  executablePath: exe,
  args: [
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 880 },
  deviceScaleFactor: 2,
});

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });

await mkdir(SHOTS, { recursive: true });

// --- sign in ---------------------------------------------------------------
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForSelector(".signin");
await shot("app-signin");
check("sign-in offers guest access", (await page.locator("text=Continue as guest").count()) === 1);

await page.click("text=Continue as guest");
await page.waitForURL("**/maps");
await page.waitForSelector("table.grid");

// --- empty workspace -------------------------------------------------------
check(
  "an empty workspace is a table with headers and no rows",
  (await page.locator("table.grid thead th").count()) === 7 &&
    (await page.locator("table.grid tbody tr").count()) === 0,
);
check("guest strip is shown", (await page.locator(".strip").innerText()).includes("Temporary workspace"));
await shot("app-maps-empty");

// --- new map from a template ----------------------------------------------
await page.click("text=New map");
await page.waitForSelector(".newmap .choice");
check("blank plus three templates are offered", (await page.locator(".newmap .choice").count()) === 4);
await page.click(".choice:has-text('Conflict tracker')");
await shot("app-new-map");
await page.click(".newmap >> text=Create");
await page.waitForURL(/\/maps\/[0-9a-f-]{36}$/);
if (BLANK) await page.goto(page.url() + BLANK, { waitUntil: "load" });
await page.waitForSelector(".editor .tool");
await page.waitForTimeout(6000);

// --- editor ----------------------------------------------------------------
check("the side panel is absent with nothing selected", !(await page.locator(".editor").getAttribute("class")).includes("has-panel"));
check("the toolbar is one row", (await page.locator(".toolbar").boundingBox()).height < 56);
check("the shell is not mirrored by an RTL map", (await page.getAttribute("html", "dir")) === "ltr");
check("the editor root is mirrored", (await page.locator(".editor").getAttribute("dir")) === "rtl");
await shot("app-editor-rtl");

await page.click(".toolbar >> text=/^Features/");
await page.waitForSelector(".feature-row");
check("template features are listed", (await page.locator(".feature-row").count()) === 14);
await page.locator(".feature-row").first().click();
check("selecting a feature opens the inspector", (await page.locator(".inspector-body .field").count()) > 0);
await shot("app-editor-inspector");

await page.click(".toolbar >> text=Publish");
await page.waitForSelector(".publish-state:has-text('v1 live')");
check("publish reports the live version", true);

// --- versions --------------------------------------------------------------
await page.click("text=/^Versions/");
await page.waitForURL(/\/versions$/);
await page.waitForSelector("table.grid tbody tr");
await page.waitForTimeout(1500);
const headers = await page.locator("table.grid tbody tr td:nth-child(7)").first().innerText();
check("the artifact's cache policy is read from the artifact", /immutable/.test(headers), headers);
check("the pointer's policy differs from the artifact's", /max-age=\d+/.test(await page.locator(".pointer").innerText()));
check("an embed block is offered", (await page.locator(".snippet").count()) === 1);
await page.waitForTimeout(5000);
await shot("app-versions");

// --- the embed on someone else's page -------------------------------------
await page.goto(`${BASE}/article.html`, { waitUntil: "load" });
await page.waitForTimeout(6000);
await shot("app-article-embed");

// --- reference -------------------------------------------------------------
await page.goto(`${BASE}/docs`, { waitUntil: "load" });
await page.waitForTimeout(3000);
await shot("app-docs");

await browser.close();

if (errors.length) {
  console.log("\nbrowser errors:");
  for (const e of errors) console.log(`  ${e}`);
}
console.log(
  failures.length || errors.length
    ? `\n${failures.length} check(s) failed, ${errors.length} browser error(s)`
    : "\nall checks passed — now read the screenshots in demo/shots/",
);
process.exitCode = failures.length || errors.length ? 1 : 0;
