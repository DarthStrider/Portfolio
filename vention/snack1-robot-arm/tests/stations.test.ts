import { test } from "node:test";
import assert from "node:assert/strict";
import { step, toBelt, type Body } from "../src/conveyors/transport";
import type { Conveyor } from "../src/conveyors/types";
import type { Shape } from "../src/shapes/types";
import { attachmentFor, localPoint, poses, turn } from "../src/line/joints";
import { createStations, type Join, type World } from "../src/line/stations";
import type { Bin, Machine, Merger } from "../src/line/types";

const T = "2026-01-01T00:00:00Z";
const belt = (id: string, over: Partial<Conveyor>): Conveyor => ({
  id, name: id, length: 2, width: 0.4, height: 0.3, speed: 0.5, position: { x: 0, z: 0 }, rotationY: 0,
  kind: "straight", turn: 0, radius: 0, lineId: null, lineIndex: 0, createdAt: T, updatedAt: T, ...over,
});
// Main runs +x from x = -1 to 1. The feeder comes in from +z, running toward -z (turned 90°),
// and ends at the main belt's +z edge (z = 0.2), right at x = 0: the merge point, along = 1.
const main = belt("main", {});
const feeder = belt("feeder", { length: 1, width: 0.3, height: 0.35, speed: 0.5, position: { x: 0, z: 0.7 }, rotationY: 90 });
const merger = (over: Partial<Merger> = {}): Merger => ({
  id: "m1", name: "Merge", kind: "side", conveyorId: "main", along: 1, feederIds: ["feeder"], priority: "main", gap: 0.3, createdAt: T, updatedAt: T, ...over,
});
const shape = (id: string, over: Partial<Shape> = {}): Shape => ({
  id, name: id, kind: "box", size: { x: 0.1, y: 0.1, z: 0.1 }, color: "#999999", position: { x: 0, z: 0 }, rotationY: 0, sku: null, createdAt: T, updatedAt: T, ...over,
});
const body = (id: string, x: number, z: number, y: number): Body => ({ id, x, z, y, vx: 0, vy: 0, vz: 0, size: 0.1 });

function run(w: World, bodies: Map<string, Body>, seconds: number, each?: (t: number) => void) {
  const st = createStations(() => w);
  const joins: Join[] = [];
  const dt = 1 / 120;
  for (let i = 0, t = 0; t < seconds; i++, t = i * dt) {
    st.prepare(bodies);
    step(bodies.values(), w.belts, dt, { stops: st.stops(), hold: st.hold });
    for (const j of st.afterStep(dt)) {
      joins.push(j);
      bodies.delete(j.attachedId);
    }
    each?.(t);
  }
  return { st, joins };
}
const world = (over: Partial<World>): World => ({ belts: [main, feeder], mergers: [merger()], machines: [], shapes: [], connectors: [], ...over });
const onMainCenter = (b: Body) => Math.abs(b.z) < 1e-6 && Math.abs(b.y - 0.3) < 1e-6;

test("a feeder item waits at the end of its belt, then slides onto the main belt's centerline", () => {
  const f = body("f", 0, 1.1, 0.35);
  run(world({}), new Map([["f", f]]), 3);
  assert.ok(onMainCenter(f), `on the main belt's centerline: z ${f.z}, y ${f.y}`);
  assert.ok(f.x > 0.3, `then carried along it: x ${f.x}`);
});

test("main priority: a feeder item waits for a gap, and the main belt never stops", () => {
  const passing = body("p", -0.6, 0, 0.3); // reaches the merge point just as the feeder item arrives
  const f = body("f", 0, 0.75, 0.35);
  let heldWhilePassing = false;
  let mainStopped = false;
  let last = passing.x;
  run(world({}), new Map([["p", passing], ["f", f]]), 3, () => {
    const u = passing.x; // main is unturned: u = x
    if (Math.abs(u) < 0.3 && f.heldAt) heldWhilePassing = true;
    if (passing.x === last && passing.x < 0.9) mainStopped = true;
    last = passing.x;
  });
  assert.ok(heldWhilePassing, "the feeder item was held while a main item was within the gap");
  assert.ok(!mainStopped, "the main item never stopped");
  assert.ok(onMainCenter(f) && passing.x - f.x >= 0.3 - 1e-6, `merged behind it with the gap: ${passing.x} vs ${f.x}`);
});

test("a busy feeder queues, and its items merge one at a time, spaced by the gap", () => {
  const items = ["a", "b", "c"].map((id, i) => body(id, 0, 0.75 + i * 0.12, 0.35));
  const bodies = new Map(items.map((b) => [b.id!, b] as const));
  let queued = false;
  const longMain = belt("main", { length: 4, position: { x: 1, z: 0 } }); // starts at x = -1 too, so the merge point is still x = 0
  run(world({ belts: [longMain, feeder] }), bodies, 5, () => {
    // While waiting, no two items on the feeder overlap.
    const onFeeder = items.filter((b) => Math.abs(b.y - 0.35) < 1e-6).map((b) => toBelt(feeder, b.x, b.z).u).sort((x, y) => x - y);
    for (let i = 1; i < onFeeder.length; i++) assert.ok(onFeeder[i] - onFeeder[i - 1] >= 0.1 - 1e-6, "spaced at least one item apart");
    if (items.some((b) => b.heldAt === "queue")) queued = true;
  });
  assert.ok(queued, "items queued behind the waiting one");
  const xs = items.map((b) => b.x).sort((x, y) => y - x);
  assert.ok(items.every(onMainCenter), "all three merged");
  assert.ok(xs[0] - xs[1] >= 0.3 - 1e-6 && xs[1] - xs[2] >= 0.3 - 1e-6, `spaced by the gap on the main belt: ${xs}`);
});

test("feeders priority: main-belt items stop short of the merge point while a feeder item waits", () => {
  const m = body("m", -0.9, 0, 0.3);
  const f = body("f", 0, 0.75, 0.35);
  let mainHeld = false;
  run(world({ mergers: [merger({ priority: "feeders" })] }), new Map([["m", m], ["f", f]]), 4, () => {
    if (m.heldAt === "main:m1") {
      mainHeld = true;
      assert.ok(Math.abs(m.x - -0.3) < 1e-6, `held a gap short of the merge point: ${m.x}`);
    }
  });
  assert.ok(mainHeld);
  assert.ok(f.x > m.x, "the feeder item went first");
});

test("a y merger alternates between its two feeders", () => {
  // The output runs +x from x = 0 to 4. Two feeders angled in from either side end at its start.
  const out = belt("out", { length: 4, position: { x: 2, z: 0 } });
  const fa = belt("fa", { length: 1, width: 0.3, height: 0.35, position: { x: -0.4, z: -0.45 }, rotationY: -45 });
  const fb = belt("fb", { length: 1, width: 0.3, height: 0.35, position: { x: -0.4, z: 0.45 }, rotationY: 45 });
  const y: Merger = merger({ id: "y1", kind: "y", conveyorId: "out", along: 0, feederIds: ["fa", "fb"], priority: "alternate", gap: 0.25 });
  // Two items on each feeder, A's slightly ahead.
  const startOn = (b: Conveyor, u: number) => {
    const t = (b.rotationY * Math.PI) / 180;
    return { x: b.position.x + u * Math.cos(t), z: b.position.z - u * Math.sin(t) };
  };
  const items = [["a1", fa, 0.3], ["a2", fa, 0.1], ["b1", fb, 0.25], ["b2", fb, 0.05]].map(([id, b, u]) => {
    const p = startOn(b as Conveyor, u as number);
    return body(id as string, p.x, p.z, 0.35);
  });
  const order: string[] = [];
  run({ ...world({}), belts: [out, fa, fb], mergers: [y] }, new Map(items.map((b) => [b.id!, b] as const)), 6, () => {
    for (const b of items) if (b.guide && !order.includes(b.id!)) order.push(b.id!);
  });
  assert.deepEqual(order, ["a1", "b1", "a2", "b2"]);
  assert.ok(items.every((b) => Math.abs(b.z) < 1e-6 && Math.abs(b.y - 0.3) < 1e-6), "all on the output's centerline");
});

// ---- Joining machines ----

const machine: Machine = {
  id: "j1", name: "Joiner", conveyorId: "main", along: 1.2,
  base: { owner: "part:PL-200", point: "top" }, attach: { owner: "kind:cylinder", point: "bottom" },
  cycleSeconds: 0.5, createdAt: T, updatedAt: T,
};

test("joining geometry: the attached point lands on the base point, whatever the turns", () => {
  const base = { size: { x: 0.4, y: 0.02, z: 0.2 }, rotationY: 30 };
  const attached = { size: { x: 0.1, y: 0.3, z: 0.1 }, rotationY: 75 };
  const bp = { name: "corner", x: 0.5, y: 0.5, z: -0.5 };
  const ap = { name: "side", x: -0.5, y: -0.5, z: 0 };
  const a = attachmentFor(base, bp, attached, ap);
  // Put the base anywhere and work out both points in the world: they must coincide.
  const shapes = [shape("b", { ...base }), shape("a", { ...attached })];
  const links = new Map([["a", { parentId: "b", attach: a }]]);
  const pose = poses(shapes, () => ({ x: 0.7, y: 0.31, z: -0.2, rotationY: 30 }), links);
  const world = (id: string, p: typeof bp, sz: typeof base.size) => {
    const q = pose.get(id)!;
    const l = localPoint({ size: sz }, p);
    const o = turn(l.x, l.z, q.rotationY);
    return [q.x + o.x, q.y + l.y, q.z + o.z];
  };
  const [w1, w2] = [world("b", bp, base.size), world("a", ap, attached.size)];
  w1.forEach((v, i) => assert.ok(Math.abs(v - w2[i]) < 1e-9, `${w1} vs ${w2}`));
  assert.equal(pose.get("a")!.rotationY, 75, "the attached object keeps its heading");
});

test("a machine holds a base and an attach item, joins them, and lets the base go on", () => {
  const plate = shape("plate", { sku: "PL-200", size: { x: 0.2, y: 0.02, z: 0.2 } });
  const can = shape("can", { kind: "cylinder", size: { x: 0.08, y: 0.12, z: 0.08 } });
  const ball = shape("ball", { kind: "sphere" });
  const bodies = new Map([
    ["plate", body("plate", -0.6, 0, 0.3)], ["ball", body("ball", -0.75, 0, 0.3)], ["can", body("can", -0.9, 0, 0.3)],
  ]);
  const w = world({ mergers: [], machines: [machine], shapes: [plate, can, ball] });
  const { joins } = run(w, bodies, 4);
  assert.equal(joins.length, 1);
  assert.deepEqual([joins[0].baseId, joins[0].attachedId, joins[0].basePoint, joins[0].attachedPoint], ["plate", "can", "top", "bottom"]);
  // The can's bottom sits on the plate's top: 0.01 up from the plate's center, plus half the can.
  const a = joins[0].attach;
  assert.ok(Math.abs(a.y - (0.01 + 0.06)) < 1e-9 && Math.abs(a.x) < 1e-9 && Math.abs(a.z) < 1e-9, JSON.stringify(a));
  assert.ok(!bodies.has("can"), "the can now rides on the plate");
  assert.ok(bodies.get("plate")!.x > 0.3, "the plate went on after the join");
  assert.ok(bodies.get("ball")!.x > bodies.get("plate")!.x, "the ball, not needed, passed straight through");
});

test("a machine whose connection point was removed lets both items go unjoined", () => {
  const plate = shape("plate", { sku: "PL-200" });
  const can = shape("can", { kind: "cylinder" });
  const w = world({ mergers: [], machines: [{ ...machine, base: { owner: "part:PL-200", point: "gone" } }], shapes: [plate, can] });
  const bodies = new Map([["plate", body("plate", -0.6, 0, 0.3)], ["can", body("can", -0.8, 0, 0.3)]]);
  const { joins, st } = run(w, bodies, 3);
  assert.deepEqual(joins, []);
  assert.ok(bodies.get("plate")!.x > 0.3 && bodies.get("can")!.x > 0.3);
  assert.equal(st.snapshot().machines.get("j1")?.state, "idle"); // the error showed, then it carried on
});

// ---- Bins ----

const bin = (over: Partial<Bin> = {}): Bin => ({
  id: "bin1", name: "Bin", holds: ["kind:box"], accept: [], capacity: 10, position: { x: 1.3, z: 0 }, rotationY: 0,
  feed: { type: "none" }, count: 0, createdAt: T, updatedAt: T, ...over,
});

function runBins(w: World, bodies: Map<string, Body>, seconds: number) {
  const st = createStations(() => w);
  st.reset();
  const caught: string[] = [];
  const released: string[] = [];
  const joins: Join[] = [];
  const dt = 1 / 120;
  for (let t = 0; t < seconds; t += dt) {
    st.prepare(bodies);
    step(bodies.values(), w.belts, dt, { stops: st.stops(), hold: st.hold });
    for (const j of st.afterStep(dt)) {
      joins.push(j);
      bodies.delete(j.attachedId);
    }
    const r = st.binStep(dt, bodies);
    for (const c of r.caught) {
      caught.push(c.shapeId);
      bodies.delete(c.shapeId);
    }
    for (const x of r.released) {
      released.push(x.body.id!);
      bodies.set(x.body.id!, x.body);
    }
  }
  return { st, caught, released, joins };
}

test("a bin at the end of a belt catches its kind, and leaves anything else lying in it", () => {
  // The main belt ends at x = 1; the bin's footprint is x 1.05..1.55.
  const red = shape("red", { color: "#e11d48" });
  const blue = shape("blue", { color: "#2563eb" });
  const ball = shape("ball", { kind: "sphere" });
  const w = world({ mergers: [], shapes: [red, blue, ball], bins: [bin({ accept: [{ field: "color", op: "eq", value: "#e11d48" }] })] });
  const bodies = new Map([["red", body("red", 0.5, 0, 0.3)], ["blue", body("blue", 0.2, 0, 0.3)], ["ball", body("ball", -0.1, 0, 0.3)]]);
  const { caught, st } = runBins(w, bodies, 4);
  assert.deepEqual(caught, ["red"]);
  assert.deepEqual([...st.stored()], [["red", "bin1"]]);
  assert.ok(bodies.has("blue") && bodies.has("ball"), "the others lie where they fell");
  assert.equal(bodies.get("blue")!.y, 0);
});

test("a full bin catches nothing more", () => {
  const items = ["a", "b", "c"].map((id) => shape(id));
  const w = world({ mergers: [], shapes: items, bins: [bin({ capacity: 2 })] });
  const bodies = new Map(items.map((s, i) => [s.id, body(s.id, 0.5 - i * 0.3, 0, 0.3)] as const));
  const { caught } = runBins(w, bodies, 5);
  assert.deepEqual(caught, ["a", "b"]);
});

test("a steady bin feeds a belt one item at a time, keeping the spot clear", () => {
  const stored = ["s1", "s2", "s3"].map((id, i) => shape(id, { binId: "bin1", createdAt: `2026-01-0${i + 1}` }));
  const w = world({ mergers: [], shapes: stored, bins: [bin({ position: { x: -1.5, z: 0 }, feed: { type: "belt", conveyorId: "main", along: 0.1, mode: "steady" } })] });
  const bodies = new Map<string, Body>();
  let closest = Infinity;
  const st = createStations(() => w);
  st.reset();
  const dt = 1 / 120;
  const order: string[] = [];
  for (let t = 0; t < 2.5; t += dt) {
    step(bodies.values(), w.belts, dt, {});
    for (const x of st.binStep(dt, bodies).released) {
      order.push(x.body.id!);
      bodies.set(x.body.id!, x.body);
    }
    const xs = [...bodies.values()].filter((b) => b.y > 0.29).map((b) => b.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) closest = Math.min(closest, xs[i] - xs[i - 1]);
  }
  assert.deepEqual(order, ["s1", "s2", "s3"], "oldest first");
  assert.ok(closest >= 0.25 - 1e-6, `spaced at least 25 cm apart on the belt: ${closest}`);
  assert.equal(st.binCounts().get("bin1"), 0);
});

test("a bin wired to a machine supplies its slot, and the machine joins the item onto the base", () => {
  const plate = shape("plate", { sku: "PL-200", size: { x: 0.2, y: 0.02, z: 0.2 } });
  const cans = ["c1", "c2"].map((id) => shape(id, { kind: "cylinder", size: { x: 0.08, y: 0.12, z: 0.08 }, binId: "bin1" }));
  const w = world({
    mergers: [], machines: [machine], shapes: [plate, ...cans],
    bins: [bin({ holds: ["kind:cylinder"], position: { x: 0.2, z: 0.6 }, feed: { type: "machine", machineId: "j1" } })],
  });
  const bodies = new Map([["plate", body("plate", -0.6, 0, 0.3)]]);
  const { joins, released, st } = runBins(w, bodies, 4);
  assert.deepEqual(joins.map((j) => [j.baseId, j.attachedId]), [["plate", "c1"]]);
  // As soon as its can slot is empty again, the machine gets the next can, which waits there for the next plate.
  assert.deepEqual(released, ["c1", "c2"]);
  assert.equal(bodies.get("c2")!.heldAt, "machine:j1");
  assert.equal(st.binCounts().get("bin1"), 0);
});

test("a demand bin feeds a belt only when a machine further along needs its kind", () => {
  const plate = shape("plate", { sku: "PL-200" });
  const cans = ["c1", "c2", "c3"].map((id) => shape(id, { kind: "cylinder", binId: "bin1" }));
  const w = world({
    mergers: [], machines: [machine], shapes: [plate, ...cans],
    bins: [bin({ holds: ["kind:cylinder"], position: { x: -1.5, z: 0.6 }, feed: { type: "belt", conveyorId: "main", along: 0.2, mode: "demand" } })],
  });
  const bodies = new Map([["plate", body("plate", -0.4, 0, 0.3)]]);
  const { released, joins } = runBins(w, bodies, 6);
  // One can for the one plate: after the join the machine's slot is empty again, and it asks
  // for another. That's demand: a can whenever the cylinder slot is empty and none is on its way.
  assert.equal(joins.length, 1);
  assert.ok(released.length >= 1 && released.length <= 3, `${released}`);
  assert.equal(released[0], "c1");
});

test("a bin holding several kinds catches each of them, and hands a machine the kind it needs", () => {
  // One bin holds plates and cans, wired to the machine. The machine needs one of each, so the
  // bin hands over its oldest plate, then a can; once the plate slot is full, it only sends cans.
  const onBelt = shape("plate1", { sku: "PL-200", size: { x: 0.2, y: 0.02, z: 0.2 } });
  const stored = [
    shape("plate2", { sku: "PL-200", size: { x: 0.2, y: 0.02, z: 0.2 }, binId: "bin1", createdAt: "2026-01-01" }),
    shape("can", { kind: "cylinder", size: { x: 0.08, y: 0.12, z: 0.08 }, binId: "bin1", createdAt: "2026-01-02" }),
  ];
  const mixed = bin({ holds: ["part:PL-200", "kind:cylinder"], position: { x: 0.2, z: 0.6 }, feed: { type: "machine", machineId: "j1" } });
  const w = world({ mergers: [], machines: [machine], shapes: [onBelt, ...stored], bins: [mixed] });
  const bodies = new Map([["plate1", body("plate1", -0.6, 0, 0.3)]]);
  const { released, joins } = runBins(w, bodies, 1.5);
  assert.deepEqual(released, ["plate2", "can"]);
  assert.deepEqual(joins.map((j) => [j.baseId, j.attachedId]), [["plate2", "can"]]);
  assert.ok(!bodies.get("plate1")!.heldAt, "the belt's own plate found the slot taken and passed by");

  // Catching: both kinds go in; a ball doesn't.
  const out = bin({ id: "out", holds: ["kind:box", "kind:cylinder"], position: { x: 1.3, z: 0 } });
  const items = [shape("b", {}), shape("c", { kind: "cylinder" }), shape("s", { kind: "sphere" })];
  const bodies2 = new Map(items.map((s, i) => [s.id, body(s.id, 0.5 - i * 0.3, 0, 0.3)] as const));
  const { caught } = runBins(world({ mergers: [], shapes: items, bins: [out] }), bodies2, 5);
  assert.deepEqual(caught.sort(), ["b", "c"]);
});
