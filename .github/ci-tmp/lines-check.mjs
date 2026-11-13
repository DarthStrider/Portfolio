// Temporary: drives Snack 1 against Snack 5 (memory DB) to build, run, turn and split a conveyor line.
import { chromium } from "playwright";
const API = "http://localhost:8081/api";
const j = async (path, init) => {
  const r = await fetch(API + path, { headers: { "content-type": "application/json" }, ...init });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};
const D = Math.PI / 180;
const dir = (h) => ({ x: Math.cos(h * D), z: -Math.sin(h * D) });
const add = (p, d, k) => ({ x: p.x + d.x * k, z: p.z + d.z * k });
function startOf(s) {
  if (s.kind === "curve") { const side = s.turn >= 0 ? 1 : -1; return { ...add(s.position, dir(s.rotationY + 90 * side + 180), s.radius), h: s.rotationY }; }
  return { ...add(s.position, dir(s.rotationY), -(s.kind === "transfer" ? s.width : s.length) / 2), h: s.rotationY };
}
function endOf(s) {
  if (s.kind === "curve") { const side = s.turn >= 0 ? 1 : -1; return { ...add(s.position, dir(s.rotationY + 90 * side + 180 + side * Math.abs(s.turn)), s.radius), h: s.rotationY + s.turn }; }
  if (s.kind === "transfer") return { ...add(s.position, dir(s.rotationY + s.turn), s.width / 2), h: s.rotationY + s.turn };
  return { ...add(s.position, dir(s.rotationY), s.length / 2), h: s.rotationY };
}
const angle = (a) => ((a % 360) + 540) % 360 - 180;
function joined(line) {
  for (let i = 1; i < line.length; i++) {
    const a = endOf(line[i - 1]), b = startOf(line[i]);
    const gap = Math.hypot(a.x - b.x, a.z - b.z);
    if (gap > 0.002 || Math.abs(angle(a.h - b.h)) > 0.01) return `gap ${gap.toFixed(4)} m / ${angle(a.h - b.h)}° before section ${i}`;
  }
  return "joined";
}
const lines = (belts) => {
  const m = new Map();
  for (const b of belts) { const k = b.lineId ?? b.id; m.set(k, [...(m.get(k) ?? []), b]); }
  return [...m.values()].map((l) => l.sort((a, b) => a.lineIndex - b.lineIndex));
};
const out = [];
const log = (...a) => { console.log(...a); out.push(a.join(" ")); };

await j("/conveyors", { method: "POST", body: JSON.stringify({ name: "Line A", length: 0.8, width: 0.3, height: 0.3, speed: 0.25, position: { x: -0.9, z: 0.7 }, rotationY: 0 }) });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5173/");
await page.click("#tab-conveyors");
await page.locator("#conveyors-panel .pick", { hasText: "Line A" }).click();
const count = (n) => page.waitForFunction((n) => document.querySelector("#conveyors-panel span.count")?.textContent === `(${n})`, n, { timeout: 10000 });
const shot = async (name) => {
  const b = await page.screenshot({ type: "jpeg", quality: 55 });
  console.log(`SHOT ${name} ${b.toString("base64")}`);
};
await page.locator("section.line-build").waitFor();
await page.click('[data-ext="curve"][data-turn="90"]'); await count(2);
await page.fill('[data-field="extLength"]', "60");
await page.click('[data-ext="straight"]'); await count(3);
await page.click('[data-ext="transfer"][data-turn="-90"]'); await count(4);
// Drag a straight out with the mouse: the camera mustn't orbit.
await page.click('[data-ext="drag"]');
const box = await page.locator("#scene").boundingBox();
await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.6);
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.62);
log("drag hint:", await page.locator("#conveyors-panel p.hint").textContent());
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.65, { steps: 8 });
await shot("dragging");
await page.mouse.up(); await count(5);
await page.click('[data-ext="curve"][data-turn="-45"]'); await count(6);
await page.click('[data-ext="straight"]'); await count(7);

let belts = await j("/conveyors");
let ls = lines(belts);
log("after build:", ls.length, "line(s);", ls[0].map((b) => `${b.kind}${b.turn ? b.turn : ""}:${b.length.toFixed(3)}`).join(" "), "|", joined(ls[0]));
log("splitter belt options:", await page.$$eval('#splitters-panel [data-draft="beltId"] option', (o) => o.map((x) => x.textContent).join(" / ")));

// Zoom out to see it all, then run with a box on the start.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
await page.waitForTimeout(400);
await shot("built");
const first = ls[0][0];
const s0 = startOf(first);
const shape = await j("/shapes", { method: "POST", body: JSON.stringify({ name: "Box", kind: "box", size: { x: 0.1, y: 0.1, z: 0.1 }, color: "#e8590c", position: add(s0, dir(s0.h), 0.1), rotationY: 0 }) });
await page.reload();
await page.click("#tab-conveyors");
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
await page.click("#btn-run");
await page.waitForTimeout(6000);
await shot("running");
await page.waitForTimeout(9000);
await page.click("#btn-run");
await page.waitForTimeout(800);
const after = (await j("/shapes")).find((s) => s.id === shape.id);
const last = ls[0].at(-1);
const e = endOf(last);
log("box ended at", JSON.stringify(after.position), "line end", e.x.toFixed(2), e.z.toFixed(2), "distance", Math.hypot(after.position.x - e.x, after.position.z - e.z).toFixed(2));

// Turn the whole line, then delete section 3 (split).
await page.locator('#conveyors-panel [data-do="turn"]').first().click();
await page.waitForTimeout(1500);
belts = await j("/conveyors"); ls = lines(belts);
log("after turn:", ls.length, "line(s)", joined(ls[0]), "first heading", ls[0][0].rotationY);
await page.locator(`#conveyors-panel [data-do="delete"][data-id="${ls[0][2].id}"]`).click();
await count(6);
belts = await j("/conveyors"); ls = lines(belts);
log("after delete:", ls.map((l) => `${l.length}[${l.map((b) => b.lineIndex).join(",")}] ${l[0].lineId ? "line" : "alone"} ${joined(l)}`).join(" | "));
log("status:", await page.locator("#conveyors-panel .status, #conveyors-panel [role=status]").first().textContent().catch(() => "?"));
await shot("split");
log("errors:", JSON.stringify(errors));
await browser.close();
