import { test } from "node:test";
import assert from "node:assert/strict";
import { afterRemoving, describe, dir, dragLength, endOf, lineOf, minRadius, place, startOf, turnedAbout, type Pose, type SectionSpec } from "../src/conveyors/sections";
import { carryOnSection, isOver, onCurve, step, type Body } from "../src/conveyors/transport";
import type { Conveyor } from "../src/conveyors/types";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const samePose = (a: Pose, b: Pose, eps = 1e-9) =>
  close(a.x, b.x, eps) && close(a.z, b.z, eps) && close(((a.heading - b.heading) % 360 + 540) % 360 - 180, 0, eps);

const WIDTH = 0.3;
const HEIGHT = 0.3;

/** Builds a line the way the app does: each section placed at the end of the one before. */
function build(start: Pose, specs: SectionSpec[], speed = 0.3): Conveyor[] {
  const out: Conveyor[] = [];
  let at = start;
  specs.forEach((spec, i) => {
    const placed = place(at, spec, WIDTH);
    const c: Conveyor = {
      id: `s${i}`, name: `S${i}`, width: WIDTH, height: HEIGHT, speed, lineId: "L", lineIndex: i,
      createdAt: "", updatedAt: "", ...placed,
    };
    out.push(c);
    at = endOf(c);
  });
  return out;
}

const SPECS: SectionSpec[] = [
  { kind: "straight", length: 1 },
  { kind: "curve", turn: 90, radius: 0.5 },
  { kind: "straight", length: 0.6 },
  { kind: "transfer", turn: -90 },
  { kind: "curve", turn: -45, radius: 0.4 },
  { kind: "straight", length: 0.5 },
];

test("each section starts exactly where the one before it ends", () => {
  const line = build({ x: -1, z: 0.5, heading: 30 }, SPECS);
  assert.ok(samePose(startOf(line[0]), { x: -1, z: 0.5, heading: 30 }));
  for (let i = 1; i < line.length; i++) assert.ok(samePose(startOf(line[i]), endOf(line[i - 1])), `section ${i}`);
  // The turns add up: +90, -90, -45.
  assert.ok(close(endOf(line.at(-1)!).heading, 30 + 90 - 90 - 45));
});

test("a left curve from heading 0 turns toward -z, ending a quarter circle away", () => {
  const curve = { ...place({ x: 0, z: 0, heading: 0 }, { kind: "curve", turn: 90, radius: 0.5 }, WIDTH), width: WIDTH };
  assert.ok(close(curve.position.x, 0) && close(curve.position.z, -0.5)); // the center is to the left
  const end = endOf(curve);
  assert.ok(samePose(end, { x: 0.5, z: -0.5, heading: 90 }));
  assert.ok(close(curve.length, Math.PI / 4)); // a quarter of a circle of radius 0.5
  const right = { ...place({ x: 0, z: 0, heading: 0 }, { kind: "curve", turn: -90, radius: 0.5 }, WIDTH), width: WIDTH };
  assert.ok(samePose(endOf(right), { x: 0.5, z: 0.5, heading: -90 }));
});

test("a transfer is square: in at one side, out of the side it turns to", () => {
  const t = { ...place({ x: 0, z: 0, heading: 0 }, { kind: "transfer", turn: 90 }, WIDTH), width: WIDTH };
  assert.deepEqual([t.position, t.length], [{ x: 0.15, z: 0 }, WIDTH]);
  assert.ok(samePose(endOf(t), { x: 0.15, z: -0.15, heading: 90 }));
});

test("turning a whole line about its start keeps every section joined", () => {
  const line = build({ x: 0.2, z: 0.1, heading: 0 }, SPECS);
  const pivot = startOf(line[0]);
  const turned = line.map((s) => ({ ...s, ...turnedAbout(s, pivot, 90) }));
  assert.ok(samePose(startOf(turned[0]), { ...pivot, heading: 90 }));
  for (let i = 1; i < turned.length; i++) assert.ok(samePose(startOf(turned[i]), endOf(turned[i - 1])), `section ${i}`);
});

test("dragging the end out: the length follows the mouse along the line, in 5 cm steps", () => {
  const end: Pose = { x: 1, z: 0, heading: 0 };
  assert.ok(close(dragLength(end, { x: 2.23, z: 0.4 }), 1.25)); // sideways doesn't count; 1.23 rounds to 1.25
  assert.equal(dragLength(end, { x: 0.5, z: 0 }), 0.3); // behind the end: the shortest straight
  assert.equal(dragLength(end, { x: 9, z: 0 }), 4); // the longest
  assert.ok(close(dragLength({ x: 0, z: 0, heading: 90 }, { x: 0, z: -0.8 }), 0.8)); // heading 90 is toward -z
});

test("deleting a middle section splits the line; a single piece left is a belt on its own", () => {
  const line = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, lineId: "L", lineIndex: i }));
  assert.deepEqual(afterRemoving(line, 2, () => "M"), [
    { id: "d", lineId: "M", lineIndex: 0 },
    { id: "e", lineId: "M", lineIndex: 1 },
  ]);
  assert.deepEqual(afterRemoving(line, 1, () => "M"), [
    { id: "a", lineId: null, lineIndex: 0 },
    { id: "c", lineId: "M", lineIndex: 0 }, { id: "d", lineId: "M", lineIndex: 1 }, { id: "e", lineId: "M", lineIndex: 2 },
  ]);
  assert.deepEqual(afterRemoving(line, 4, () => "M"), []); // the last one: nothing else changes
  assert.deepEqual(lineOf([...line].reverse(), line[0]).map((b) => b.id), ["a", "b", "c", "d", "e"]);
});

test("labels and limits", () => {
  assert.equal(describe({ kind: "curve", turn: -45, length: 0.3 }), "Curve 45° right");
  assert.equal(describe({ kind: "straight", turn: 0, length: 1.5 }), "Straight 150 cm");
  assert.equal(minRadius(0.3), 0.2);
  assert.deepEqual(dir(90).x.toFixed(9), "0.000000000");
});

// ---- Carrying things round ----

test("on a curve, an item goes round at a constant distance from the center", () => {
  const curve = { ...place({ x: 0, z: 0, heading: 0 }, { kind: "curve", turn: 90, radius: 0.5 }, WIDTH), width: WIDTH, height: HEIGHT, speed: 0.25 };
  const body = { x: 0.01, z: 0.08 }; // just in, 8 cm toward the outside
  const r0 = onCurve(curve, body.x, body.z).r;
  for (let i = 0; i < 200; i++) carryOnSection(curve, body, 1 / 120);
  assert.ok(close(onCurve(curve, body.x, body.z).r, r0, 1e-9));
  // At the middle radius it would have gone 0.25 m/s × 1.67 s; at r0 it goes round the same angle.
  const travelled = onCurve(curve, body.x, body.z).progress - onCurve(curve, 0.01, 0.08).progress;
  assert.ok(close(travelled, 0.25 * (200 / 120), 1e-9));
});

test("on a transfer, an item goes in to the middle and out of the side; backwards, the other way", () => {
  const t = { ...place({ x: 0, z: 0, heading: 0 }, { kind: "transfer", turn: 90 }, WIDTH), width: WIDTH, height: HEIGHT, speed: 0.3 };
  const body = { x: 0.01, z: 0.02 };
  for (let i = 0; i < 240 && isOver(t, body.x, body.z); i++) carryOnSection(t, body, 1 / 120);
  assert.ok(close(body.x, 0.15, 1e-9)); // stopped at the middle line...
  assert.ok(body.z < -0.15); // ...then went out to the left (-z)
  const back = { ...t, speed: -0.3 };
  const b2 = { x: 0.16, z: -0.14 };
  for (let i = 0; i < 240 && isOver(back, b2.x, b2.z); i++) carryOnSection(back, b2, 1 / 120);
  assert.ok(close(b2.z, 0, 1e-9)); // in from the left side to the middle...
  assert.ok(b2.x < 0); // ...then back out the way the line comes in
});

test("an item put at the start of a line rides every section to the end", () => {
  const line = build({ x: -1.5, z: 1, heading: 0 }, SPECS);
  const s = startOf(line[0]);
  const body: Body = { id: "box", x: s.x + 0.05, z: s.z, y: HEIGHT, vx: 0, vy: 0, vz: 0 };
  const visited = new Set<string>();
  for (let i = 0; i < 120 * 20; i++) {
    for (const b of line) if (isOver(b, body.x, body.z) && Math.abs(body.y - HEIGHT) < 1e-6) visited.add(b.id);
    step([body], line, 1 / 120);
    if (body.y < HEIGHT - 0.05) break; // rode off the end and is falling
  }
  assert.deepEqual([...visited].sort(), line.map((b) => b.id).sort());
  const end = endOf(line.at(-1)!);
  // It left the last section at its end, moving that way.
  assert.ok(Math.hypot(body.x - end.x, body.z - end.z) < 0.3);
  const d = dir(end.heading);
  assert.ok(body.vx * d.x + body.vz * d.z > 0);
});
