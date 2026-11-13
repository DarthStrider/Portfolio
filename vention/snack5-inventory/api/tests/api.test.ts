/** The HTTP API end to end, on the in-memory database and a random port. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.ts";
import { MemoryRepo } from "../src/db/memory.ts";
import { SEED_PARTS } from "../src/domain/seed.ts";

process.env.LOG_REQUESTS = "0";
let server: Server;
let base = "";

before(async () => {
  const repo = new MemoryRepo();
  await repo.seedIfEmpty(SEED_PARTS);
  server = createServer(createApp(repo));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const DEMO = {
  items: [
    { type: "extrusion", sku: "EX-4040", profile: "40x40", length: 1200, qty: 4 },
    { type: "extrusion", sku: "EX-4080", profile: "40x80", length: 2400, qty: 2, finish: "black" },
    { type: "plate", sku: "PL-200", qty: 4 },
    { type: "fastener", sku: "M6-BOLT", qty: 120 },
    { type: "actuator", sku: "LA-300", qty: 2 },
    { type: "controller", sku: "MC-1", qty: 1 },
  ],
};

test("health and info", async () => {
  assert.deepEqual((await call("GET", "/api/health/live")).body, { ok: true });
  assert.deepEqual((await call("GET", "/api/health/ready")).body, { ok: true, db: "memory" });
  assert.equal((await call("GET", "/api/info")).body.db, "memory");
});

test("lists, searches and filters parts", async () => {
  assert.ok((await call("GET", "/api/parts")).body.length >= SEED_PARTS.length);
  assert.deepEqual((await call("GET", "/api/parts?search=actuator")).body.map((p: any) => p.sku), ["LA-300"]);
  const low = (await call("GET", "/api/parts?low=true")).body.map((p: any) => p.sku);
  assert.deepEqual(low, ["BAR-4040-BLK", "M5-BOLT", "PL-300"]);
  assert.equal((await call("GET", "/api/parts/PL-200")).body.onHand, 45);
  assert.equal((await call("GET", "/api/parts/NOPE-1")).status, 404);
});

test("receive and consume, with validation", async () => {
  assert.equal((await call("POST", "/api/parts/BR-90/receive", { qty: 10, note: "PO-77" })).body.onHand, 150);
  assert.equal((await call("POST", "/api/parts/BR-90/consume", { qty: 50 })).body.onHand, 100);
  assert.equal((await call("POST", "/api/parts/BR-90/consume", { qty: 1000 })).status, 409);
  const bad = await call("POST", "/api/parts/BR-90/receive", { qty: 1.5 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.problems[0], /qty/);
  assert.equal((await call("POST", "/api/parts/BR-90/receive", "{not json")).status, 400);
  assert.equal((await call("POST", "/api/parts/br 90/receive", { qty: 1 })).status, 400);
  const [m] = (await call("GET", "/api/movements?sku=BR-90&limit=1")).body;
  assert.equal(m.kind, "consume");
});

test("adds a part, refuses duplicates, and explains invalid input", async () => {
  const created = await call("POST", "/api/parts", { sku: "pl-400 ", name: " Mounting plate, 400 mm", category: "plate", unit: "plate", onHand: 10, reorderLevel: 4, location: "B-01-4" });
  assert.equal(created.status, 201);
  assert.deepEqual([created.body.sku, created.body.name, created.body.available], ["PL-400", "Mounting plate, 400 mm", 10]);
  assert.equal((await call("GET", "/api/parts/PL-400")).body.location, "B-01-4");
  assert.equal((await call("POST", "/api/parts", { sku: "PL-400", name: "Again", category: "plate", unit: "plate" })).status, 409);
  const bad = await call("POST", "/api/parts", { sku: "no spaces", name: "", category: "widget", unit: "piece", onHand: -1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.problems.length, 4); // sku, name, category, onHand
});

test("checks a design against stock", async () => {
  const { status, body } = await call("POST", "/api/check", { design: DEMO });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.lines.map((l: any) => [l.sku, l.qty]), [
    ["BAR-4040-CLR", 2], ["BAR-4080-BLK", 2], ["LA-300", 2], ["M6-BOLT", 3], ["MC-1", 1], ["PL-200", 4],
  ]);
  const bigger = { items: [...DEMO.items, { type: "actuator", sku: "LA-300", qty: 10 }, { type: "gripper", sku: "GR-9", qty: 1 }] };
  const short = (await call("POST", "/api/check", { design: bigger })).body;
  assert.equal(short.ok, false);
  assert.deepEqual(short.lines.filter((l: any) => l.short > 0).map((l: any) => [l.sku, l.short]), [["GR-9", 1], ["LA-300", 6]]);
  assert.equal((await call("POST", "/api/check", { design: { items: [] } })).status, 400);
});

test("reserves a design, refuses one that doesn't fit, then releases and fulfils", async () => {
  const first = await call("POST", "/api/reservations", { quoteRef: "Q-1001", design: DEMO });
  assert.equal(first.status, 201);
  const id = first.body.reservation.id;
  assert.equal((await call("GET", "/api/parts/LA-300")).body.available, 4);

  const tooMuch = { items: [{ type: "actuator", sku: "LA-300", qty: 5 }, { type: "plate", sku: "PL-200", qty: 1 }] };
  const refused = await call("POST", "/api/reservations", { quoteRef: "Q-1002", design: tooMuch });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body.shortages, [{ sku: "LA-300", need: 5, available: 4, known: true }]);
  assert.equal((await call("GET", "/api/parts/PL-200")).body.reserved, 4); // only Q-1001's plates

  assert.equal((await call("POST", "/api/reservations", { quoteRef: "bad ref!", design: DEMO })).status, 400);

  assert.equal((await call("POST", `/api/reservations/${id}/fulfil`)).body.status, "fulfilled");
  assert.equal((await call("POST", `/api/reservations/${id}/release`)).status, 409);
  const la = (await call("GET", "/api/parts/LA-300")).body;
  assert.deepEqual([la.onHand, la.reserved], [4, 0]);
  assert.equal((await call("GET", "/api/reservations")).body[0].quoteRef, "Q-1001");
});

test("shapes: create, validate, move, delete", async () => {
  const made = await call("POST", "/api/shapes", { name: "Ball", kind: "sphere", size: { x: 0.2 }, color: "#E11D48", position: { x: 0.5, z: 0 } });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.size, made.body.color, made.body.rotationY], [{ x: 0.2, y: 0.2, z: 0.2 }, "#e11d48", 0]);
  const cyl = await call("POST", "/api/shapes", { name: "Post", kind: "cylinder", size: { x: 0.08, y: 0.6, z: 1.5 }, color: "#64748b", position: { x: -0.5, z: 0.5 } });
  assert.deepEqual(cyl.body.size, { x: 0.08, y: 0.6, z: 0.08 }); // round: depth follows the diameter

  const bad = await call("POST", "/api/shapes", { name: "", kind: "pyramid", color: "red", position: { x: 9, z: 0 } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.problems.length, 4); // kind, name, color, position

  const moved = await call("PATCH", `/api/shapes/${made.body.id}`, { position: { x: 0.4, z: 0.3 } });
  assert.deepEqual(moved.body.position, { x: 0.4, z: 0.3 });
  assert.equal((await call("PATCH", `/api/shapes/${made.body.id}`, { kind: "box" })).status, 400);
  assert.equal((await call("PATCH", `/api/shapes/${made.body.id}`, {})).status, 400);

  assert.equal((await call("DELETE", `/api/shapes/${cyl.body.id}`)).status, 200);
  assert.equal((await call("DELETE", `/api/shapes/${cyl.body.id}`)).status, 404);
  assert.deepEqual((await call("GET", "/api/shapes")).body.map((s: any) => s.name), ["Ball"]);

  // Shapes can stand for inventory parts, which must exist.
  const part = await call("POST", "/api/shapes", { name: "Plate", kind: "box", size: { x: 0.2, y: 0.01, z: 0.2 }, color: "#9aa3af", position: { x: 0.5, z: 0.2 }, sku: "PL-200" });
  assert.deepEqual([part.status, part.body.sku], [201, "PL-200"]);
  const ghost = await call("POST", "/api/shapes", { name: "Nope", kind: "box", size: { x: 0.2, y: 0.2, z: 0.2 }, color: "#9aa3af", position: { x: 0.5, z: 0.2 }, sku: "NOPE-1" });
  assert.equal(ghost.status, 400);
  assert.match(ghost.body.problems[0], /No part NOPE-1/);
});

test("conveyors: create with defaults, validate, patch, delete", async () => {
  const made = await call("POST", "/api/conveyors", { name: "Belt A", length: 1.5, width: 0.3, height: 0.3, position: { x: 0.7, z: 0 } });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.speed, made.body.rotationY], [0.2, 0]); // defaults
  const bad = await call("POST", "/api/conveyors", { name: "", length: 9, width: 0.3, height: 0, speed: 5, position: { x: 0, z: 0 } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.problems.length, 4); // name, length, height, speed
  const fast = await call("PATCH", `/api/conveyors/${made.body.id}`, { speed: -0.5, rotationY: 90 });
  assert.deepEqual([fast.body.speed, fast.body.rotationY], [-0.5, 90]);
  assert.equal((await call("PATCH", `/api/conveyors/${made.body.id}`, { length: 2 })).status, 400);
  assert.equal((await call("DELETE", `/api/conveyors/${made.body.id}`)).status, 200);
  assert.deepEqual((await call("GET", "/api/conveyors")).body, []);
});

test("conveyor sections: a curve's length is its arc, a transfer is square, shapes are checked", async () => {
  const curve = await call("POST", "/api/conveyors", { name: "Bend", width: 0.3, height: 0.3, position: { x: 1, z: 0 }, kind: "curve", turn: -90, radius: 0.5 });
  assert.equal(curve.status, 201);
  assert.ok(Math.abs(curve.body.length - (Math.PI / 2) * 0.5) < 1e-6); // the length sent (none) is replaced by the arc
  const transfer = await call("POST", "/api/conveyors", { name: "Corner", width: 0.4, height: 0.3, position: { x: 0, z: 1 }, kind: "transfer", turn: 90 });
  assert.deepEqual([transfer.status, transfer.body.length, transfer.body.radius], [201, 0.4, 0]);
  const bad = await call("POST", "/api/conveyors", { name: "Odd", width: 0.6, height: 0.3, position: { x: 0, z: 0 }, kind: "curve", turn: 30, radius: 0.2, lineId: "line-1" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.problems.length, 3); // turn, radius (under half the width + 5 cm), lineId
  assert.match(bad.body.problems.join(" "), /turn must be one of -90, -45, 45, 90/);
  const twisted = await call("POST", "/api/conveyors", { name: "Twist", length: 1, width: 0.3, height: 0.3, position: { x: 0, z: 0 }, turn: 45 });
  assert.equal(twisted.status, 400); // a straight section has no turn

  // Stations only go on straight sections.
  const gate = await call("POST", "/api/splitters", { name: "On a bend", conveyorId: curve.body.id, along: 0.2, rules: [] });
  assert.equal(gate.status, 400);
  assert.match(gate.body.problems[0], /stations go on straight sections/);

  // PATCH /api/conveyors: several at once, all or none, each checked like a single PATCH.
  const both = await call("PATCH", "/api/conveyors", { updates: [{ id: curve.body.id, speed: 0.4 }, { id: transfer.body.id, speed: 0.4, lineIndex: 1 }] });
  assert.deepEqual([both.status, both.body.map((c: { speed: number }) => c.speed)], [200, [0.4, 0.4]]);
  const refused = await call("PATCH", "/api/conveyors", { updates: [{ id: curve.body.id, speed: 3 }, { id: curve.body.id, speed: 0 }, { speed: 0 }] });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.problems.length, 3); // speed out of range, a repeated id, a missing id
  assert.equal((await call("PATCH", "/api/conveyors", { updates: [] })).status, 400);
  for (const c of [curve, transfer]) await call("DELETE", `/api/conveyors/${c.body.id}`);
});

test("splitters: validate rules, fit on the belt, patch, delete", async () => {
  const belt = (await call("POST", "/api/conveyors", { name: "Sort belt", length: 1.6, width: 0.4, height: 0.3, position: { x: 0.8, z: 0 } })).body;
  const rule = { conditions: [{ field: "color", op: "eq", value: " #E11D48 " }], exit: "left" };
  const made = await call("POST", "/api/splitters", { name: "Reds", conveyorId: belt.id, along: 1, rules: [rule] });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.rules[0].conditions[0].value, made.body.otherwise], ["#e11d48", "straight"]); // trimmed, lowercased; default exit

  const bad = await call("POST", "/api/splitters", { name: "Bad", conveyorId: belt.id, along: 1, rules: [
    { conditions: [{ field: "weight", op: "eq", value: 1 }], exit: "left" },
    { conditions: [{ field: "kind", op: "gt", value: "box" }], exit: "up" },
    { conditions: [], exit: "right" },
  ] });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.problems.map((p: string) => p.split(":")[0]), ["rule 1, condition 1", "rule 2", "rule 2, condition 1", "rule 3"]);
  const tooFar = await call("POST", "/api/splitters", { name: "Off the end", conveyorId: belt.id, along: 2, rules: [] });
  assert.match(tooFar.body.problems[0], /at most 1.6 m/);
  assert.equal((await call("PATCH", `/api/splitters/${made.body.id}`, { along: 1.7 })).status, 400);
  assert.equal((await call("PATCH", `/api/splitters/${made.body.id}`, { conveyorId: belt.id })).status, 400);
  const moved = await call("PATCH", `/api/splitters/${made.body.id}`, { along: 0.5, otherwise: "right", rules: [] });
  assert.deepEqual([moved.body.along, moved.body.otherwise, moved.body.rules], [0.5, "right", []]);
  assert.equal((await call("DELETE", `/api/splitters/${made.body.id}`)).status, 200);
  assert.equal((await call("DELETE", `/api/conveyors/${belt.id}`)).status, 200);
});

test("parts: change details, not stock", async () => {
  const p = await call("PATCH", "/api/parts/MC-1", { category: "motor", location: "C-01-1" });
  assert.deepEqual([p.status, p.body.category, p.body.location], [200, "motor", "C-01-1"]);
  const stock = await call("PATCH", "/api/parts/MC-1", { onHand: 99 });
  assert.equal(stock.status, 400);
  assert.match(stock.body.problems[0], /receive and consume/);
  assert.equal((await call("PATCH", "/api/parts/MC-1", { category: "widget" })).status, 400);
  assert.equal((await call("PATCH", "/api/parts/NOPE-1", { location: "A" })).status, 404);
});

test("connection points, mergers, machines and assemblies over HTTP", async () => {
  const put = await call("PUT", "/api/connectors/part:PL-200", { points: [{ name: "hole A", x: -0.3, y: 0.5, z: 0 }] });
  assert.equal(put.status, 200);
  assert.equal((await call("PUT", "/api/connectors/part:NOPE-1", { points: [] })).status, 400);
  assert.equal((await call("PUT", "/api/connectors/widget", { points: [] })).status, 400);
  const badPoints = await call("PUT", "/api/connectors/kind:box", { points: [{ name: "a", x: 0, y: 0, z: 0 }, { name: "A", x: 0.1, y: 0, z: 0 }, { name: "b", x: 0.9, y: 0, z: 0 }] });
  assert.deepEqual(badPoints.body.problems, ["point 2: there's already a point called A", "point 3: x, y and z must be fractions of the size, -0.5 to 0.5"]);
  const listed = (await call("GET", "/api/connectors")).body;
  assert.deepEqual([listed.defaultPoints.map((p: any) => p.name), listed.connectors[0].owner], [["top", "bottom"], "part:PL-200"]);

  const belt = async (name: string) => (await call("POST", "/api/conveyors", { name, length: 1.5, width: 0.3, height: 0.3, position: { x: 0, z: 0 } })).body;
  const [main, feeder] = [await belt("Main"), await belt("Feeder")];
  const merger = await call("POST", "/api/mergers", { name: "Side in", kind: "side", conveyorId: main.id, along: 0.7, feederIds: [feeder.id] });
  assert.deepEqual([merger.status, merger.body.priority, merger.body.gap], [201, "main", 0.3]);
  const y = await call("POST", "/api/mergers", { name: "Y", kind: "y", conveyorId: main.id, feederIds: [feeder.id] });
  assert.match(y.body.problems[0], /2 conveyor ids/);
  assert.equal((await call("POST", "/api/mergers", { name: "Self", kind: "side", conveyorId: main.id, along: 0.2, feederIds: [main.id] })).status, 400);
  assert.equal((await call("POST", "/api/mergers", { name: "Far", kind: "side", conveyorId: main.id, along: 2, feederIds: [feeder.id] })).status, 400);

  const machine = await call("POST", "/api/machines", { name: "Joiner", conveyorId: main.id, along: 1.2, base: { owner: "part:PL-200", point: "hole A" }, attach: { owner: "kind:cylinder", point: "bottom" } });
  assert.deepEqual([machine.status, machine.body.cycleSeconds], [201, 1.5]);
  assert.equal((await call("PATCH", `/api/machines/${machine.body.id}`, { conveyorId: feeder.id })).status, 400);

  const shape = async (name: string, kind: string, sku?: string) => (await call("POST", "/api/shapes", { name, kind, size: { x: 0.2, y: 0.05, z: 0.2 }, color: "#9aa3af", position: { x: 0.5, z: 0 }, ...(sku ? { sku } : {}) })).body;
  const plate = await shape("Plate", "box", "PL-200");
  const can = await shape("Can", "cylinder");
  const made = await call("POST", "/api/assemblies", { name: "Plate + can", baseShapeId: plate.id, attachedShapeId: can.id, basePoint: "hole A", attachedPoint: "bottom", attachment: { x: -0.06, y: 0.05, z: 0, rotationY: 0 } });
  assert.deepEqual([made.status, made.body.consumed], [201, [{ sku: "PL-200", qty: 1 }]]);
  const again = await call("POST", "/api/assemblies", { baseShapeId: plate.id, attachedShapeId: can.id, basePoint: "top", attachedPoint: "bottom", attachment: { x: 0, y: 0, z: 0 } });
  assert.deepEqual([again.status, again.body.reason], [409, "already_attached"]);
  assert.equal((await call("GET", "/api/assemblies")).body[0].name, "Plate + can");
  assert.equal((await call("DELETE", `/api/conveyors/${main.id}`)).status, 200);
  assert.deepEqual([(await call("GET", "/api/mergers")).body, (await call("GET", "/api/machines")).body], [[], []]);
});

test("bins over HTTP: validation, loading, catching and releasing", async () => {
  const bad = await call("POST", "/api/bins", { name: "", holds: [], capacity: 0, position: { x: 9, z: 0 }, feed: { type: "belt" } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.problems.length >= 4);
  const missing = await call("POST", "/api/bins", { name: "X", holds: ["kind:box", "part:NOPE-1"], position: { x: 0, z: 0 } });
  assert.deepEqual([missing.status, missing.body.problems], [400, ["No part NOPE-1 in the inventory"]]);
  const bin = await call("POST", "/api/bins", { name: "Cans", holds: ["kind:cylinder"], position: { x: 1, z: 1 }, accept: [{ field: "color", op: "eq", value: "#22c55e" }] });
  assert.deepEqual([bin.status, bin.body.capacity, bin.body.feed, bin.body.count], [201, 50, { type: "none" }, 0]);
  const look = { kind: "cylinder", size: { x: 0.08, y: 0.12, z: 0.08 }, color: "#22C55E", name: "Can" };
  assert.deepEqual((await call("POST", `/api/bins/${bin.body.id}/load`, { qty: 2, owner: "kind:cylinder", look })).body, { count: 2, holds: ["kind:cylinder"] });
  // Several lines; the second names a part that doesn't exist, so nothing loads.
  const many = await call("POST", `/api/bins/${bin.body.id}/load`, { lines: [{ qty: 1, owner: "kind:cylinder", look }, { qty: 1, owner: "part:NOPE-1", look }], addToHolds: true });
  assert.deepEqual([many.status, many.body.problems], [400, ["No part NOPE-1 in the inventory"]]);
  assert.equal((await call("POST", `/api/bins/${bin.body.id}/load`, { lines: [] })).status, 400);
  const stored = (await call("GET", "/api/shapes")).body.filter((s: any) => s.binId === bin.body.id);
  assert.deepEqual([stored.length, stored[0].color, stored[0].stockTaken], [2, "#22c55e", false]); // plain shapes take no stock
  const out = await call("POST", `/api/bins/${bin.body.id}/release`, { shapeId: stored[0].id, position: { x: 0.4, z: 0.2 } });
  assert.equal(out.status, 200);
  assert.equal((await call("POST", `/api/bins/${bin.body.id}/release`, { shapeId: stored[0].id, position: { x: 0.4, z: 0.2 } })).status, 404);
  assert.equal((await call("POST", `/api/bins/${bin.body.id}/catch`, { shapeId: stored[0].id })).status, 200);
  assert.deepEqual((await call("PATCH", `/api/bins/${bin.body.id}`, { holds: ["kind:cylinder", "kind:box"] })).body.holds, ["kind:cylinder", "kind:box"]);
  assert.equal((await call("POST", `/api/bins/${bin.body.id}/load`, { qty: 1, owner: "kind:sphere", look })).status, 409);
  const feed = await call("PATCH", `/api/bins/${bin.body.id}`, { feed: { type: "machine", machineId: "00000000-0000-4000-8000-000000000000" } });
  assert.match(feed.body.problems[0], /No machine/);
  assert.equal((await call("DELETE", `/api/bins/${bin.body.id}`)).status, 409);
  assert.deepEqual((await call("POST", `/api/bins/${bin.body.id}/unload`, { qty: 5 })).body, { unloaded: 2 });
  assert.equal((await call("DELETE", `/api/bins/${bin.body.id}`)).status, 200);
});

test("CORS: pages on localhost may call the API; other sites may not", async () => {
  const pre = await fetch(base + "/api/shapes", { method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(pre.headers.get("access-control-allow-methods")!, /PATCH/);
  const get = await fetch(base + "/api/shapes", { headers: { origin: "http://localhost:5173" } });
  assert.equal(get.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const evil = await fetch(base + "/api/shapes", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  assert.equal((await fetch(base + "/api/shapes", { headers: { origin: "https://evil.example" } })).headers.get("access-control-allow-origin"), null);
});

test("unknown routes and methods", async () => {
  assert.equal((await call("GET", "/api/nope")).status, 404);
  assert.equal((await call("DELETE", "/api/parts")).status, 405);
  assert.equal((await call("GET", "/api/parts/%E0")).status, 400);
});
