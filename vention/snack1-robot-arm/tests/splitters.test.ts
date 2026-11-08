import { test } from "node:test";
import assert from "node:assert/strict";
import { matches, route, type Part } from "../src/splitters/rules";
import { step, sideOf, type Body, type Gate } from "../src/conveyors/transport";
import type { Shape } from "../src/shapes/types";
import type { Condition, Rule } from "../src/splitters/types";

const shape = (over: Partial<Shape> = {}): Shape => ({
  id: "s1", name: "Crate", kind: "box", size: { x: 0.2, y: 0.15, z: 0.2 }, color: "#e11d48",
  position: { x: 0, z: 0 }, rotationY: 0, sku: null, createdAt: "", updatedAt: "", ...over,
});
const plate: Part = { sku: "PL-200", name: "Mounting plate, 200 mm", category: "plate", unit: "plate", onHand: 45, available: 41, location: "B-01-2", reorderLevel: 10 };
const c = (field: Condition["field"], op: Condition["op"], value: Condition["value"]): Condition => ({ field, op, value });

test("text conditions ignore case; 'is one of' takes a list", () => {
  assert.ok(matches(c("color", "eq", "#E11D48"), shape(), undefined));
  assert.ok(matches(c("kind", "in", ["sphere", "BOX"]), shape(), undefined));
  assert.ok(matches(c("name", "contains", "rat"), shape(), undefined));
  assert.ok(!matches(c("kind", "ne", "box"), shape(), undefined));
});

test("sizes compare in meters, to the millimeter", () => {
  assert.ok(matches(c("height", "eq", 0.15), shape({ size: { x: 0.2, y: 0.15000000000000002, z: 0.2 } }), undefined));
  assert.ok(matches(c("height", "gte", 0.15), shape(), undefined));
  assert.ok(!matches(c("height", "gt", 0.15), shape(), undefined));
  assert.ok(matches(c("width", "lt", 0.25), shape(), undefined));
});

test("part conditions read the inventory part, and never match a plain shape", () => {
  const p = shape({ sku: "PL-200" });
  assert.ok(matches(c("part.category", "eq", "plate"), p, plate));
  assert.ok(matches(c("part.available", "gt", 40), p, plate));
  assert.ok(matches(c("isPart", "eq", true), p, plate));
  assert.ok(matches(c("isPart", "eq", false), shape(), undefined));
  assert.ok(!matches(c("part.category", "ne", "plate"), shape(), undefined)); // not a part: no part.category at all
  assert.ok(matches(c("part.low", "eq", false), p, plate));
  assert.ok(matches(c("part.low", "eq", true), p, { ...plate, available: 10 }));
});

test("the first matching rule wins; otherwise the default", () => {
  const rules: Rule[] = [
    { conditions: [c("part.category", "eq", "plate")], exit: "left" },
    { conditions: [c("color", "eq", "#e11d48"), c("height", "gt", 0.1)], exit: "right" },
  ];
  const s = { rules, otherwise: "straight" as const };
  assert.deepEqual(route(s, shape({ sku: "PL-200" }), plate), { exit: "left", rule: 0 });
  assert.deepEqual(route(s, shape(), undefined), { exit: "right", rule: 1 });
  assert.deepEqual(route(s, shape({ size: { x: 0.2, y: 0.05, z: 0.2 } }), undefined), { exit: "straight", rule: -1 });
  // Changing the part in the database changes the decision, with the same rules.
  assert.deepEqual(route(s, shape({ sku: "PL-200", color: "#000000" }), { ...plate, category: "gripper" }), { exit: "straight", rule: -1 });
});

// ---- Gates on a running belt ----

const belt = { id: "b1", length: 2, width: 0.4, height: 0.3, speed: 0.5, position: { x: 0, z: 0 }, rotationY: 0 };
const gate: Gate = { id: "g1", conveyorId: "b1", along: 1 }; // the middle of the belt
const body = (id: string): Body => ({ id, x: -0.8, z: 0, y: 0.3, vx: 0, vy: 0, vz: 0 });
function run(bodies: Body[], belts: typeof belt[], exits: Record<string, "left" | "right" | "straight">, seconds: number, asked: string[] = []) {
  const route = (b: Body, g: Gate) => (asked.push(`${b.id}@${g.id}`), exits[b.id!]);
  for (let t = 0; t < seconds; t += 1 / 120) step(bodies, belts, 1 / 120, { gates: [gate], route });
}

test("facing the way the belt runs, right is +v going forward and -v going backward", () => {
  assert.equal(sideOf("right", 0.5), 1);
  assert.equal(sideOf("left", 0.5), -1);
  assert.equal(sideOf("right", -0.5), -1);
});

test("a gate sends items left, right or straight, and asks once per item", () => {
  const [l, r, s] = [body("l"), body("r"), body("s")];
  const asked: string[] = [];
  run([l, r, s], [belt], { l: "left", r: "right", s: "straight" }, 6, asked);
  assert.deepEqual(asked, ["l@g1", "r@g1", "s@g1"]);
  // Belt runs +x; seen from above facing +x, right is +z.
  assert.equal(l.y, 0);
  assert.ok(l.z < -0.2, `left went to -z: ${l.z}`);
  assert.equal(r.y, 0);
  assert.ok(r.z > 0.2, `right went to +z: ${r.z}`);
  assert.ok(Math.abs(s.z) < 1e-9 && s.x > 1, `straight rode off the end: ${s.x}`);
  // Diverted items leave near the gate, not at the end.
  assert.ok(l.x > 0 && l.x < 0.6 && r.x > 0 && r.x < 0.6, `${l.x}, ${r.x}`);
});

test("on a reversed belt, left and right follow the direction of travel", () => {
  const b = { ...belt, speed: -0.5 };
  const it: Body = { id: "x", x: 0.8, z: 0, y: 0.3, vx: 0, vy: 0, vz: 0 };
  for (let t = 0; t < 4; t += 1 / 120) step([it], [b], 1 / 120, { gates: [gate], route: () => "right" });
  assert.ok(it.z < -0.2, `facing -x, right is -z: ${it.z}`);
});

test("gates only act on their own belt, and a diverted item lands on a belt beside it", () => {
  const side = { id: "b2", length: 2, width: 0.4, height: 0.15, speed: 0.5, position: { x: 0.2, z: 0.45 }, rotationY: 0 };
  const it = body("p");
  for (let t = 0; t < 2.5; t += 1 / 120) step([it], [belt, side], 1 / 120, { gates: [gate, { id: "g2", conveyorId: "b2", along: 0.1 }], route: () => "right" });
  assert.equal(it.y, 0.15); // caught by the lower belt on the right
  assert.ok(it.divert === undefined, "riding normally again");
  const x = it.x;
  for (let t = 0; t < 0.5; t += 1 / 120) step([it], [belt, side], 1 / 120, { gates: [gate], route: () => "right" });
  assert.ok(it.x > x + 0.2, "carried along the second belt");
});
