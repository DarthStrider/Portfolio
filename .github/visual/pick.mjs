// Temporary visual check of pick and place: drives the real app in headless Chromium and prints
// screenshots (base64 JPEG) to the log. Removed before merging.
import { chromium } from "playwright";

const API = "http://localhost:8080/api";
const shot = async (page, name) => {
  const buf = await page.screenshot({ type: "jpeg", quality: 55 });
  console.log(`SHOT-BEGIN ${name}`);
  console.log(buf.toString("base64").replace(/(.{76})/g, "$1\n"));
  console.log(`SHOT-END ${name}`);
};

// A box the gripper can hold, in front of the arm.
const created = await (await fetch(`${API}/shapes`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Test box", kind: "box", size: { x: 0.06, y: 0.08, z: 0.1 }, color: "#f59e0b", position: { x: 0.5, z: 0.25 }, rotationY: 20, sku: null }),
})).json();
console.log("created", created.id);

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:4173/");
await page.waitForSelector('[data-do="pick"]');
await page.waitForTimeout(1500);
await shot(page, "01-start");

const pick = page.locator('[data-do="pick"]').first();
console.log("pick disabled:", await pick.isDisabled(), "title:", await pick.getAttribute("title"));
await pick.click();

// Find a floor point that's in reach, by hovering and reading the hint.
let target = null;
for (let y = 380; y <= 720 && !target; y += 30) {
  for (let x = 380; x <= 1100 && !target; x += 40) {
    await page.mouse.move(x, y);
    const hint = await page.locator("#shapes-panel p.hint").first().textContent();
    const m = /x (-?\d+) cm, z (-?\d+) cm · in reach/.exec(hint ?? "");
    if (m && Number(m[2]) < -10 && Math.hypot(Number(m[1]), Number(m[2])) > 40) target = { x, y, hint };
  }
}
console.log("target", JSON.stringify(target));
for (let i = 0; i < 3; i++) await page.keyboard.press("q");
await page.mouse.move(target.x, target.y);
await page.waitForTimeout(200);
console.log("hint after Q x3:", await page.locator("#shapes-panel p.hint").first().textContent());
await shot(page, "02-choosing-spot");
await page.mouse.click(target.x, target.y);

const seen = new Set();
for (let i = 0; i < 400; i++) {
  await page.waitForTimeout(250);
  if (!(await page.locator("#program").isVisible())) break;
  const label = await page.locator("#program-label").textContent();
  if (!seen.has(label)) {
    seen.add(label);
    console.log("step:", label);
    if (/^(Grip|Carry|Lower)/.test(label)) await shot(page, `step-${seen.size}`);
  }
}
await page.waitForTimeout(1500);
await shot(page, "99-done");
console.log("status:", await page.locator("#shapes-panel p.shapes-status").last().textContent());
const after = (await (await fetch(`${API}/shapes`)).json()).find((s) => s.id === created.id);
console.log("saved", JSON.stringify({ position: after.position, rotationY: after.rotationY }));
console.log("errors", JSON.stringify(errors));
await browser.close();
