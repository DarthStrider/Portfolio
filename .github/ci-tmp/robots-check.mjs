// Temporary: automated robots, Clear scene and FLOOR_SIZE, in a real browser against Snack 5 (memory DB).
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
const post = (p, b) => j(p, { method: "POST", body: JSON.stringify(b) });
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

log("config:", JSON.stringify(await j("/config")));
const out = await post("/conveyors", { name: "Out", length: 1, width: 0.3, height: 0.3, speed: 0.2, position: { x: 2.0, z: -0.65 }, rotationY: 0 });
const feed = await post("/conveyors", { name: "In", length: 1, width: 0.3, height: 0.3, speed: 0.25, position: { x: 0.85, z: 0 }, rotationY: 0 });
const bin = await post("/bins", { name: "Boxes", holds: ["kind:box"], capacity: 20, position: { x: 2.45, z: 0.5 }, rotationY: 0 });
const shape = (name, kind, color, x, z) => post("/shapes", { name, kind, size: { x: 0.08, y: 0.08, z: 0.08 }, color, position: { x, z }, rotationY: 0 });
const red = await shape("Red box", "box", "#e11d48", 1.5, 0.05);
const blue = await shape("Blue box", "box", "#2563eb", 1.45, -0.05);
const green = await shape("Green can", "cylinder", "#16a34a", 1.56, -0.03);
const robot = await post("/robots", {
  name: "Sorter", position: { x: 2.0, z: 0 }, rotationY: 180, pick: { x: 1.5, z: 0, radius: 0.15 },
  rules: [
    { conditions: [{ field: "color", op: "eq", value: "#e11d48" }], target: { type: "spot", x: 1.6, z: 0.55 } },
    { conditions: [{ field: "kind", op: "eq", value: "box" }], target: { type: "bin", binId: bin.id } },
  ],
  otherwise: { type: "belt", conveyorId: out.id, along: 0.5 },
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5173/");
await page.waitForTimeout(1500);
const shot = (name) => page.screenshot({ path: `/tmp/shots/${name}.jpg`, type: "jpeg", quality: 60 });
await page.click("#tab-robots");
await page.locator("#robots-panel .pick", { hasText: "Sorter" }).click();
await page.waitForTimeout(300);
// Look at the cell from above-ish.
await page.mouse.click(640, 150);
await page.click('[data-jump="fit"]');
await page.waitForTimeout(1500);
await shot("cell-start");

// Belts stopped: the robot sorts the three items on its own.
const t0 = Date.now();
let s = [];
while (Date.now() - t0 < 150000) {
  s = await j("/shapes");
  const r = s.find((x) => x.id === red.id), b = s.find((x) => x.id === blue.id), g = s.find((x) => x.id === green.id);
  if (Math.hypot(r.position.x - 1.6, r.position.z - 0.55) < 0.3 && b.binId === bin.id && Math.abs(g.position.z + 0.65) < 0.1) break;
  await sleep(2000);
}
log("static after", Math.round((Date.now() - t0) / 1000), "s:", s.map((x) => `${x.name}@${x.position.x.toFixed(2)},${x.position.z.toFixed(2)}${x.binId ? " in bin" : ""}`).join(" | "));
log("robot status:", await page.locator("#robots-panel .robot-status").first().textContent());
await shot("cell-sorted");

// Belts running: a yellow box rides the In belt off its end into the zone; the robot bins it.
const yellow = await shape("Yellow box", "box", "#eab308", 0.5, 0);
await page.waitForTimeout(5000); // the panels poll every 4 s
await page.click("#btn-run");
const t1 = Date.now();
await page.waitForTimeout(6000);
await shot("running");
await page.waitForTimeout(40000);
await page.click("#btn-run"); // stop: saves positions and catches
await page.waitForTimeout(3000);
s = await j("/shapes");
const y = s.find((x) => x.id === yellow.id);
log("running after", Math.round((Date.now() - t1) / 1000), "s: yellow", y ? `${y.position.x.toFixed(2)},${y.position.z.toFixed(2)} bin=${y.binId === bin.id}` : "missing");
log("status:", await page.locator("#status").textContent().catch(() => "?"));

// The editor shows the rules.
log("editor rules:", await page.locator("#robots-panel .robot-rules li.rule").count(), "otherwise:", await page.locator('#robots-panel .otherwise-row select[data-tk="type"]').inputValue());

// Clear scene: two clicks.
await page.click("#btn-clear");
log("armed:", await page.locator("#btn-clear").textContent());
await page.click("#btn-clear");
await page.waitForTimeout(2500);
log("after clear:", JSON.stringify({ shapes: (await j("/shapes")).length, belts: (await j("/conveyors")).length, bins: (await j("/bins")).length, robots: (await j("/robots")).length }));
log("clear message:", await page.locator("#status").textContent().catch(() => "?"));
await page.click('[data-jump="top"]');
await page.waitForTimeout(1200);
await shot("cleared-top");
log("errors:", JSON.stringify(errors));
await browser.close();
