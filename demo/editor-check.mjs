import { chromium } from "playwright-core";
const exe = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--no-sandbox","--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", e => errs.push("pageerror: " + e.message));
p.on("console", m => { if (m.type()==="error") errs.push("console: " + m.text()); });

await p.goto("http://127.0.0.1:8800/editor.html", { waitUntil: "load" });
await p.waitForTimeout(6000);

const count = () => p.evaluate(() => document.querySelectorAll(".feature-row").length);
console.log("tools rendered:", await p.locator(".tool").count());
console.log("features on load:", await count());

// Draw an area: click each vertex, then double-click to finish.
await p.locator('.tool:has-text("Area")').click();
const box = await p.locator(".map").boundingBox();
const pt = (dx, dy) => ({ x: box.x + dx, y: box.y + dy });
for (const [dx,dy] of [[240,220],[430,210],[450,380],[250,400]]) {
  await p.mouse.move(pt(dx,dy).x, pt(dx,dy).y); await p.mouse.click(pt(dx,dy).x, pt(dx,dy).y); await p.waitForTimeout(120);
}
await p.mouse.dblclick(pt(250,400).x, pt(250,400).y);
await p.waitForTimeout(900);
console.log("after area:", await count());

await p.locator('.tool:has-text("Arrow")').click();
for (const [dx,dy] of [[560,560],[700,470],[850,420]]) {
  await p.mouse.move(pt(dx,dy).x, pt(dx,dy).y); await p.mouse.click(pt(dx,dy).x, pt(dx,dy).y); await p.waitForTimeout(120);
}
await p.mouse.dblclick(pt(850,420).x, pt(850,420).y);
await p.waitForTimeout(900);
console.log("after arrow:", await count());

await p.locator('.tool:has-text("Icon")').click();
await p.mouse.click(pt(620,300).x, pt(620,300).y);
await p.waitForTimeout(800);
console.log("after icon:", await count());

console.log("inspector fields:", await p.locator(".inspector-body .field").count());

await p.evaluate(() => window.app && null);
await p.keyboard.press("Control+z");
await p.waitForTimeout(500);
console.log("after undo:", await count());
await p.keyboard.press("Control+Shift+z");
await p.waitForTimeout(500);
console.log("after redo:", await count());

await p.locator('.btn:has-text("Save")').click();
await p.waitForTimeout(1200);
console.log("status after save:", (await p.locator(".status").textContent()).trim());
await p.locator('.btn:has-text("Publish")').click();
await p.waitForTimeout(1800);
console.log("status after publish:", (await p.locator(".status").textContent()).trim());

// The seeded map has uiDir "rtl", so the editor boots mirrored.
await p.screenshot({ path: "demo/shots/editor-rtl.png" });

await p.locator('.btn:has-text("RTL")').click();
await p.waitForTimeout(600);
console.log("dir after toggle (expect ltr, boots rtl):", await p.evaluate(() => document.querySelector(".editor").dir));
await p.screenshot({ path: "demo/shots/editor-rtl.png" });

console.log("errors:", errs.length ? errs.slice(0,6) : "none");
await b.close();
