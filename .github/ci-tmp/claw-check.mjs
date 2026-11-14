// Temporary: close-ups of the claw, open and closed on a box.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/tmp/shots", { recursive: true });
const API = "http://localhost:8081/api";
const j = async (path, init) => {
  const r = await fetch(API + path, { headers: { "content-type": "application/json" }, ...init });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await j("/shapes", { method: "POST", body: JSON.stringify({ name: "Box", kind: "box", size: { x: 0.08, y: 0.27, z: 0.06 }, color: "#e11d48", position: { x: -0.404, z: 0.404 }, rotationY: 0 }) });
await page.goto("http://localhost:5173/");
await page.waitForTimeout(2000);
if ((await page.locator("#btn-demo").getAttribute("aria-pressed")) === "true") await page.click("#btn-demo");
await page.click("#btn-reset");
await page.waitForTimeout(600);
await page.mouse.click(640, 120);
// Move the camera to the claw: along the floor to the left, then in close.
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
await hold("j", 380);
await hold("i", 250);
await hold("=", 900);
await page.waitForTimeout(300);
for (const [name, extra] of [["open-1", 0], ["open-2", 250]]) {
  if (extra) await hold("=", extra);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/shots/${name}.jpg`, type: "jpeg", quality: 70, clip: { x: 320, y: 0, width: 560, height: 800 } });
}
await page.keyboard.press("g");
await page.waitForTimeout(1200);
console.log("status:", await page.locator("#status").textContent());
await page.screenshot({ path: "/tmp/shots/closed.jpg", type: "jpeg", quality: 70, clip: { x: 320, y: 0, width: 560, height: 800 } });
await hold("o", 500);
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/shots/closed-side.jpg", type: "jpeg", quality: 70, clip: { x: 320, y: 0, width: 560, height: 800 } });
console.log("errors:", JSON.stringify(errors));
await browser.close();
