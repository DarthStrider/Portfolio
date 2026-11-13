// Temporary: the bigger floor and the camera pad, in a real browser against Snack 5 (memory DB).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/tmp/shots", { recursive: true });
const API = "http://localhost:8081/api";
const j = async (path, init) => {
  const r = await fetch(API + path, { headers: { "content-type": "application/json" }, ...init });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};
const log = (...a) => console.log(...a);
for (const [x, z] of [[7.5, 7.5], [-8, 4], [5, -9]]) {
  await j("/conveyors", { method: "POST", body: JSON.stringify({ name: `Far ${x},${z}`, length: 2, width: 0.4, height: 0.3, speed: 0.2, position: { x, z }, rotationY: 30 }) });
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5173/");
await page.waitForTimeout(1500);
const shot = (name) => page.screenshot({ path: `/tmp/shots/${name}.jpg`, type: "jpeg", quality: 60 });
// Where the camera looks: read from the scene through a tiny probe (the pixel under the middle changes as we move).
const sample = async () => (await page.screenshot({ clip: { x: 560, y: 300, width: 160, height: 120 } })).toString("base64").length;
await shot("start");
const pad = await page.locator(".view-pad").boundingBox();
log("pad:", JSON.stringify(pad));
await page.click('[data-jump="fit"]'); await page.waitForTimeout(800); await shot("fit");
await page.click('[data-jump="top"]'); await page.waitForTimeout(800); await shot("top");
// Hold the zoom-out button for a second.
const zo = page.locator('[data-hold="zoomOut"]');
await zo.hover(); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up(); await page.waitForTimeout(200);
await shot("top-zoomed-out");
await page.click('[data-jump="home"]'); await page.waitForTimeout(800);
const a = await sample();
// Keys: hold L (move right) and O (orbit) for a while.
await page.mouse.click(640, 120); // focus the page without hitting a panel button
await page.keyboard.down("l"); await page.waitForTimeout(700); await page.keyboard.up("l");
await page.keyboard.down("o"); await page.waitForTimeout(500); await page.keyboard.up("o");
await page.waitForTimeout(300);
const b = await sample();
log("view changed with keys:", a !== b);
await shot("keys");
// Place a belt far out with "Add at X, Z".
await page.click("#tab-conveyors");
await page.fill('#conveyors-panel [data-field="x"]', "850");
await page.fill('#conveyors-panel [data-field="z"]', "-850");
await page.click('#conveyors-panel [data-action="add"]');
await page.waitForTimeout(1200);
const belts = await j("/conveyors");
log("belts:", belts.map((b) => `${b.name}@${b.position.x},${b.position.z}`).join(" | "));
await page.click('[data-jump="fit"]'); await page.waitForTimeout(800); await shot("fit-after");
log("status:", await page.locator("#conveyors-panel .status").first().textContent().catch(() => "?"));
log("errors:", JSON.stringify(errors));
await browser.close();
