import { test } from "node:test";
import assert from "node:assert/strict";
import { ARM } from "../src/arm/jointSpecs";
import { maxReach } from "../src/arm/kinematics";
import { BASE_RADIUS, footprintRadius, reachOf, reachRadiusAt, REACH_MARGIN } from "../src/shapes/reach";
import { gripHeight } from "../src/pick/grasp";
import { CLEARANCE } from "../src/pick/clearance";
import { solveTopDown } from "../src/arm/ik";

const cube = (x: number, z: number, cm = 20) => ({ kind: "box" as const, size: { x: cm / 100, y: cm / 100, z: cm / 100 }, position: { x, z } });

test("a small box in front of the arm is reachable", () => {
  assert.equal(reachOf(cube(0.6, 0), ARM), "reachable");
  assert.equal(reachOf(cube(0, -0.6), ARM), "reachable"); // the base turns, so direction doesn't matter
});

test("far away is out of reach, and the limit is where the wrist joint can no longer get above the grip point", () => {
  assert.equal(reachOf(cube(1.5, 0), ARM), "too-far");
  // A thin 1 cm plate is gripped with the TCP 2 cm up, and that's the lowest, so the hardest, point.
  const grip = gripHeight(0.01);
  const r = Math.min(reachRadiusAt(grip, ARM), reachRadiusAt(grip + CLEARANCE, ARM));
  const plate = (x: number) => ({ kind: "box" as const, size: { x: 0.05, y: 0.01, z: 0.05 }, position: { x, z: 0 } });
  assert.equal(reachOf(plate(r - 0.001), ARM), "reachable");
  assert.equal(reachOf(plate(r + 0.001), ARM), "too-far");
  // With the gripper vertical, only the upper arm and forearm reach out: less than the whole arm stretched.
  assert.ok(r < ARM.upperArm + ARM.forearm && r < maxReach(ARM) - 0.2);
});

test("the reach is widest where the wrist joint is level with the shoulder", () => {
  const level = ARM.baseHeight + ARM.shoulderHeight - ARM.wrist - ARM.tool; // TCP height putting them level
  const widest = reachRadiusAt(level, ARM);
  assert.ok(Math.abs(widest - (ARM.upperArm + ARM.forearm - REACH_MARGIN)) < 1e-12);
  assert.ok(reachRadiusAt(level + 0.2, ARM) < widest && reachRadiusAt(level - 0.1, ARM) < widest);
});

test("what's reachable can be planned: the top-down IK agrees at the limit", () => {
  for (const h of [0.01, 0.1, 0.3]) {
    const grip = gripHeight(h);
    const r = Math.min(reachRadiusAt(grip, ARM), reachRadiusAt(grip + CLEARANCE, ARM));
    assert.ok(solveTopDown(ARM, { x: r - 0.001, y: grip, z: 0 }), `h=${h}: grip point`);
    assert.ok(solveTopDown(ARM, { x: r - 0.001, y: grip + CLEARANCE, z: 0 }), `h=${h}: lifted`);
  }
});

test("shapes overlapping the pedestal, or tucked against it, are flagged", () => {
  assert.equal(reachOf(cube(0.25, 0), ARM), "overlaps-base"); // 20 cm box reaches within 0.2 m of the axis
  assert.equal(reachOf({ kind: "sphere", size: { x: 0.04, y: 0.04, z: 0.04 }, position: { x: 0.23, z: 0 } }, ARM), "too-close");
  assert.ok(footprintRadius(cube(0, 0)) > 0.1); // a box's footprint circle covers its corners
  assert.equal(BASE_RADIUS, 0.2);
});
