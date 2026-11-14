// Temporary: the claw grabs with G, carries, lets go; the arm is blocked by a solid box. Snack 5 memory DB.
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
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `/tmp/shots/${name}.jpg`, type: "jpeg", quality: 60 });
const status = () => page.locator("#status").textContent();
async function home() {
  await page.goto("http://localhost:5173/");
  await page.waitForTimeout(2000);
  if ((await page.locator("#btn-demo").getAttribute("aria-pressed")) === "true") await page.click("#btn-demo");
  await page.click("#btn-reset");
  await page.waitForTimeout(800);
}
const tcp = async () => ({
  x: Number(await page.locator("#scene-x").textContent()),
  y: Number(await page.locator("#scene-y").textContent()),
  z: Number(await page.locator("#scene-z").textContent()),
});

await home();
const t0 = await tcp();
log("home TCP:", JSON.stringify(t0));
const a = await j("/shapes", { method: "POST", body: JSON.stringify({ name: "Tall box", kind: "box", size: { x: 0.06, y: Math.round((t0.y + 0.05) * 1000) / 1000, z: 0.06 }, color: "#e11d48", position: { x: t0.x, z: t0.z }, rotationY: 0 }) });
await home();
await page.mouse.click(640, 120);
await page.click('[data-jump="fit"]').catch(() => {});
await page.waitForTimeout(800);
await shot("before-grab");

await page.keyboard.press("g");
await page.waitForTimeout(1200);
log("after G:", await status(), "| button:", await page.locator("#btn-gripper").textContent());
await shot("holding");

await page.keyboard.press("1");
await page.keyboard.down("d");
await page.waitForTimeout(900);
await page.keyboard.up("d");
await page.waitForTimeout(300);
await shot("carried");
await page.keyboard.press("g");
await page.waitForTimeout(2500);
log("after letting go:", await status());
const moved = (await j("/shapes")).find((s) => s.id === a.id);
log("box moved from", `${t0.x.toFixed(3)},${t0.z.toFixed(3)}`, "to", `${moved.position.x.toFixed(3)},${moved.position.z.toFixed(3)}`, "distance", Math.hypot(moved.position.x - t0.x, moved.position.z - t0.z).toFixed(3));

// The claw is open around the box it just put down: turning the base further sweeps the fingers into it.
const before = await tcp();
await page.keyboard.down("d");
await page.waitForTimeout(900);
await page.keyboard.up("d");
const after = await tcp();
log("pushing into the box:", await status(), "| TCP moved", Math.hypot(after.x - before.x, after.z - before.z).toFixed(3), "m");
await shot("blocked");

// And lowering onto the floor: the shoulder can't drive the claw through it.
await home();
await page.keyboard.press("2");
await page.keyboard.down("d");
await page.waitForTimeout(2500);
await page.keyboard.up("d");
log("lowering:", await status(), "| TCP y", (await tcp()).y);
await page.keyboard.down("a");
await page.waitForTimeout(2500);
await page.keyboard.up("a");
log("other way:", await status(), "| TCP y", (await tcp()).y);
await shot("floor");
log("errors:", JSON.stringify(errors));
await browser.close();
