import { test } from "node:test";
import assert from "node:assert/strict";
import { angleForGap, fingerSegments, FINGER_RADIUS, gapForAngle, HINGE_Y, TCP_Y } from "../src/arm/claw";
import { beltBoxes, capsuleHits, firstHit, pointToBox, type Capsule, type Obstacle } from "../src/arm/collision";
import { GAP_CLOSED, GAP_OPEN, FINGERTIP_BELOW_TCP } from "../src/arm/gripperSpec";
import { endOf, place, startOf } from "../src/conveyors/sections";
import type { Conveyor } from "../src/conveyors/types";
import { gripHeight } from "../src/pick/grasp";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const box = (over: Partial<Obstacle> = {}): Obstacle => ({ name: "Crate", center: { x: 0, y: 0.05, z: 0 }, half: { x: 0.05, y: 0.05, z: 0.03 }, yaw: 0, ...over });

// ---- The claw ----

test("the claw's gap and its fingers' angle are two views of the same thing", () => {
  for (const gap of [GAP_CLOSED, 0.05, 0.1, GAP_OPEN]) assert.ok(close(gapForAngle(angleForGap(gap)), gap));
  assert.ok(angleForGap(GAP_OPEN) > 30 && angleForGap(GAP_OPEN) < 50); // wide open: about 40° out
  assert.ok(angleForGap(GAP_CLOSED) < 0); // shut: the fingers lean in a little
  assert.ok(TCP_Y > 0.15 && TCP_Y < 0.2);
});

test("four fingers 90° apart, and the fingertips no lower than the planner allows for", () => {
  for (const gap of [GAP_CLOSED, 0.08, GAP_OPEN]) {
    const segs = fingerSegments(gap);
    assert.equal(segs.length, 8);
    const elbows = segs.filter((_, i) => i % 2 === 0).map(([, b]) => Math.atan2(-b.z, b.x) * 180 / Math.PI);
    assert.deepEqual(elbows.map((a) => Math.round(((a % 360) + 360) % 360)), [0, 90, 180, 270]);
    for (const [, tip] of segs.filter((_, i) => i % 2 === 1)) {
      assert.ok(tip.y + FINGER_RADIUS - TCP_Y <= FINGERTIP_BELOW_TCP + 1e-9, `tip at ${tip.y}`);
    }
  }
});

test("closed on a box, the finger capsules stop short of it: only the pads touch", () => {
  // A 6 cm cube centered on the claw's axis, the claw pointing down with its TCP at the planner's grip height.
  const gap = 0.06;
  const tcpY = gripHeight(0.06);
  const toWorld = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: tcpY + TCP_Y - p.y, z: p.z }); // tool +Y points down
  const cube = box({ center: { x: 0, y: 0.03, z: 0 }, half: { x: 0.03, y: 0.03, z: 0.03 } });
  const fingers: Capsule[] = fingerSegments(gap).map(([a, b]) => ({ part: "claw", a: toWorld(a), b: toWorld(b), r: FINGER_RADIUS }));
  assert.equal(firstHit(fingers, [], [cube]), null);
  // Closed tighter than the cube, they'd go into it.
  const tight: Capsule[] = fingerSegments(0.02).map(([a, b]) => ({ part: "claw", a: toWorld(a), b: toWorld(b), r: FINGER_RADIUS }));
  assert.deepEqual(firstHit(tight, [], [cube]), { part: "claw", what: "Crate" });
  // And the palm is above the cube's top.
  assert.ok(toWorld({ x: 0, y: HINGE_Y, z: 0 }).y > 0.06);
});

// ---- Boxes and capsules ----

test("distance from a point to a turned box", () => {
  const o = box({ yaw: 90 }); // turned a quarter: its 10 cm side now runs along z
  assert.equal(pointToBox({ x: 0, y: 0.05, z: 0.04 }, o), 0); // inside along z
  assert.ok(close(pointToBox({ x: 0.04, y: 0.05, z: 0 }, o), 0.01)); // 1 cm outside its 6 cm side
  assert.ok(close(pointToBox({ x: 0, y: 0.2, z: 0 }, o), 0.1)); // above its top
});

test("a capsule hits a box it comes closer to than its radius, not one it only touches", () => {
  const o = box();
  const at = (y: number, r: number): Capsule => ({ part: "wrist", a: { x: -0.2, y, z: 0 }, b: { x: 0.2, y, z: 0 }, r });
  assert.ok(capsuleHits(at(0.12, 0.03), o)); // 2 cm above the top, but 3 cm thick
  assert.ok(!capsuleHits(at(0.12, 0.019), o));
  assert.ok(!capsuleHits(at(0.12, 0.02), o)); // exactly touching
  assert.deepEqual(firstHit([at(0.01, 0.02)], [], []), { part: "wrist", what: "the floor" });
  assert.deepEqual(firstHit([], [{ part: "palm", p: { x: 0, y: 0.09, z: 0 } }], [o]), { part: "palm", what: "Crate" });
});

test("a curved belt is solid all the way round, and nowhere else", () => {
  const curve = { name: "Bend", width: 0.3, height: 0.3, ...place({ x: 0, z: 0, heading: 0 }, { kind: "curve", turn: 90, radius: 0.5 }, 0.3) } as Conveyor;
  const pieces = beltBoxes(curve);
  assert.ok(pieces.length >= 6);
  const solidAt = (p: { x: number; z: number }) => pieces.some((o) => pointToBox({ ...p, y: 0.15 }, o) === 0);
  for (let t = 0.02; t < 1; t += 0.05) {
    const a = (90 * t * Math.PI) / 180;
    // Round the middle of the belt: from the start (0, 0) about its center (0, -0.5).
    assert.ok(solidAt({ x: 0.5 * Math.sin(a), z: -0.5 + 0.5 * Math.cos(a) }), `gap at ${t.toFixed(2)}`);
  }
  assert.ok(!solidAt({ x: 0, z: -0.5 })); // the middle of the turn is open floor
  assert.ok(solidAt(startOf(curve)) && solidAt(endOf(curve)));
});
