// Headless screenshot of a state that needs a few interactions to reach.
// Same browser rules as shot.mjs: the Chromium Playwright already cached, never a download.
//   node scripts/shot-steps.mjs <url> <out.png> [width] [height] [--dark] [--full] [--wait=ms] --do="<step>;<step>…"
// Steps:
//   click:<selector>      fill:<selector>=><text>      press:<key>      focus:<selector>
//   hover:<selector>      wait:<ms>                   reload
//   mock:<expression>     runs against the mock's control object, e.g. mock:requireHumanCheck(true)
// Selectors are Playwright selectors, so `text=Archive` and `role=button[name="Sign in"]` work.
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
  console.error('usage: node scripts/shot-steps.mjs <url> <out.png> [width] [height] [--dark] [--full] [--wait=ms] --do="click:text=Archive;wait:300"');
  process.exit(2);
}
const flag = (name) => flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
const value = (name, fallback) => {
  const found = flag(name);
  return found && found.includes("=") ? found.slice(found.indexOf("=") + 1) : fallback;
};
const wait = Number(value("wait", "600"));
const steps = value("do", "").split(";").map((s) => s.trim()).filter(Boolean);

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(height) },
    colorScheme: flag("dark") ? "dark" : "light",
  });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 }).catch((e) => problems.push(`goto: ${e.message}`));
  await page.waitForTimeout(400);
  /* Webfonts load when first used; a shot taken before they arrive shows fallback faces. */
  const fontsReady = () => page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => false);
  await fontsReady();

  for (const step of steps) {
    const [verb, ...rest] = step.split(":");
    const arg = rest.join(":");
    try {
      if (verb === "click") await page.click(arg, { timeout: 5000 });
      else if (verb === "fill") await page.fill(arg.slice(0, arg.indexOf("=>")), arg.slice(arg.indexOf("=>") + 2), { timeout: 5000 });
      else if (verb === "press") await page.keyboard.press(arg);
      else if (verb === "focus") await page.focus(arg, { timeout: 5000 });
      else if (verb === "hover") await page.hover(arg, { timeout: 5000 });
      else if (verb === "wait") await page.waitForTimeout(Number(arg));
      else if (verb === "reload") await page.reload({ waitUntil: "networkidle" });
      else if (verb === "mock") {
        await page.evaluate(async (expression) => {
          const { mockControl } = await import("/src/api/mock/index.ts");
          new Function("mockControl", `mockControl.${expression}`)(mockControl);
        }, arg);
      } else problems.push(`unknown step: ${step}`);
    } catch (e) {
      problems.push(`step "${step}": ${e.message.split("\n")[0]}`);
    }
  }

  await page.waitForTimeout(wait);
  await fontsReady();
  await page.screenshot({ path: out, fullPage: Boolean(flag("full")) });
  for (const p of problems.slice(0, 20)) console.error(p);
  console.log(`${out} ${problems.length ? `(${problems.length} problems)` : "ok"}`);
} finally {
  await browser.close();
}
