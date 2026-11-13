import { test } from "node:test";
import assert from "node:assert/strict";
import { beltPoint, decide, freeCell, inZone, MAX_CELLS, PITCH, placeFor, spiralCell, toLocal, toWorld } from "../src/robots/cell";
import { planPickPlace } from "../src/pick/program";
import { ARM, JOINTS } from "../src/arm/jointSpecs";
import type { Robot } from "../src/robots/types";
import type { Shape } from "../src/shapes/types";
import type { Conveyor } from "../src/conveyors/types";
import type { Bin } from "../src/line/types";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const T = "2026-01-01T00:00:00Z";

const robot = (over: Partial<Robot> = {}): Robot => ({
  id: "r1", name: "R", position: { x: 3, z: -2 }, rotationY: 120, pick: { x: 3, z: -2.5, radius: 0.15 },
  rules: [], otherwise: null, createdAt: T, updatedAt: T, ...over,
});
const shape = (over: Partial<Shape> = {}): Shape => ({
  id: "s1", name: "Box 1", kind: "box", size: { x: 0.08, y: 0.08, z: 0.08 }, color: "#e11d48",
  position: { x: 0, z: 0 }, rotationY: 0, sku: null, attachedTo: null, attach: null, binId: null, stockTaken: false,
  createdAt: T, updatedAt: T, ...over,
} as Shape);

test("the robot's frame: straight ahead is +x, and toWorld undoes toLocal", () => {
  const r = robot();
  const h = (r.rotationY * Math.PI) / 180;
  const ahead = { x: r.position.x + 0.5 * Math.cos(h), z: r.position.z - 0.5 * Math.sin(h) }; // heading rotationY
  const local = toLocal(r, ahead);
  assert.ok(close(local.x, 0.5) && close(local.z, 0));
  for (const p of [{ x: 1, z: 2 }, { x: -4.2, z: 0.3 }]) {
    const back = toWorld(r, toLocal(r, p));
    assert.ok(close(back.x, p.x) && close(back.z, p.z));
  }
});

test("a pick planned in the robot's frame, for an item in front of a turned robot, works", () => {
  const r = robot();
  const item = shape({ position: toWorld(r, { x: 0.55, z: 0.1 }), rotationY: 150 });
  const to = toWorld(r, { x: 0.1, z: 0.6 });
  const local = toLocal(r, item.position);
  const plan = planPickPlace(ARM, JOINTS, {
    shape: { ...item, position: local, rotationY: item.rotationY - r.rotationY },
    fromBaseY: 0, to: toLocal(r, to), toBaseY: 0, turn: 0,
  });
  assert.ok(plan.ok, plan.ok ? "" : plan.reason);
  // Put down facing the same way in the world (or a half turn round: the same for a box).
  const world = (plan.ok ? plan.rotationY : 0) + r.rotationY;
  assert.ok(close(((world - item.rotationY) % 180 + 180) % 180, 0, 1e-6));
});

test("rules: the first match decides, otherwise is the fallback, and null leaves the item", () => {
  const r = robot({
    rules: [
      { conditions: [{ field: "color", op: "eq", value: "#e11d48" }], target: { type: "spot", x: 1, z: 1 } },
      { conditions: [{ field: "kind", op: "eq", value: "box" }], target: { type: "bin", binId: "b1" } },
    ],
  });
  assert.deepEqual(decide(r, shape(), undefined), { target: { type: "spot", x: 1, z: 1 }, rule: 0 });
  assert.deepEqual(decide(r, shape({ color: "#2563eb" }), undefined), { target: { type: "bin", binId: "b1" }, rule: 1 });
  assert.equal(decide(r, shape({ kind: "sphere", color: "#2563eb" }), undefined), null);
  const withOtherwise = { ...r, otherwise: { type: "spot" as const, x: 0, z: 2 } };
  assert.deepEqual(decide(withOtherwise, shape({ kind: "sphere", color: "#2563eb" }), undefined)?.rule, -1);
  assert.ok(inZone(r, 3.1, -2.45) && !inZone(r, 3.2, -2.5));
});

test("spots fill in a spiral: the middle, then each ring, every cell once", () => {
  const seen = new Set<string>();
  for (let k = 0; k < MAX_CELLS; k++) {
    const { i, j } = spiralCell(k);
    assert.ok(Math.max(Math.abs(i), Math.abs(j)) <= 3);
    seen.add(`${i},${j}`);
  }
  assert.equal(seen.size, MAX_CELLS);
  assert.deepEqual(spiralCell(0), { i: 0, j: 0 });
  assert.equal(Math.max(Math.abs(spiralCell(8).i), Math.abs(spiralCell(8).j)), 1); // the first ring is cells 1–8
  assert.equal(Math.max(Math.abs(spiralCell(9).i), Math.abs(spiralCell(9).j)), 2);

  const spot = { x: 1, z: 1 };
  assert.deepEqual(freeCell(spot, []), spot);
  const second = freeCell(spot, [spot])!;
  assert.ok(close(Math.hypot(second.x - 1, second.z - 1), PITCH));
  const all = Array.from({ length: MAX_CELLS }, (_, k) => ({ x: 1 + spiralCell(k).i * PITCH, z: 1 + spiralCell(k).j * PITCH }));
  assert.equal(freeCell(spot, all), null);
});

test("where to put it: a free cell, a clear place on a belt, over a bin; or why not", () => {
  const belt = { id: "c1", name: "Out", length: 1, width: 0.3, height: 0.3, speed: 0.2, position: { x: 0, z: 0 }, rotationY: 90, kind: "straight", turn: 0, radius: 0, lineId: null, lineIndex: 0, createdAt: T, updatedAt: T } as Conveyor;
  const bin = { id: "b1", position: { x: 2, z: 2 } } as Bin;
  const world = { belts: [belt], bins: [bin], items: [] as { x: number; z: number }[], pending: [] as { x: number; z: number }[] };

  const p = beltPoint(belt, 0.2); // a belt turned 90° runs toward -z: its start is at z = +0.5
  assert.ok(close(p.x, 0) && close(p.z, 0.3));
  const onBelt = placeFor({ type: "belt", conveyorId: "c1", along: 0.2 }, world);
  assert.ok(onBelt.ok && close(onBelt.drop.z, 0.3) && onBelt.drop.baseY === 0.3);
  const busy = placeFor({ type: "belt", conveyorId: "c1", along: 0.2 }, { ...world, items: [{ x: 0, z: 0.25 }] });
  assert.ok(!busy.ok && busy.wait);
  const gone = placeFor({ type: "belt", conveyorId: "nope", along: 0.2 }, world);
  assert.ok(!gone.ok && !gone.wait);

  const inBin = placeFor({ type: "bin", binId: "b1" }, world);
  assert.ok(inBin.ok && inBin.drop.x === 2 && inBin.drop.baseY > 0.3);
  const spot = placeFor({ type: "spot", x: -1, z: 0 }, { ...world, pending: [{ x: -1, z: 0 }] });
  assert.ok(spot.ok && !(spot.drop.x === -1 && spot.drop.z === 0));
});
