import { test } from "node:test";
import assert from "node:assert/strict";
import { ARM } from "../src/arm/jointSpecs";
import { maxReach } from "../src/arm/kinematics";
import { BASE_RADIUS, footprintRadius, reachOf, reachRadiusAt, REACH_MARGIN } from "../src/shapes/reach";

const cube = (x: number, z: number, cm = 20) => ({ kind: "box" as const, size: { x: cm / 100, y: cm / 100, z: cm / 100 }, position: { x, z } });

test("a small box in front of the arm is reachable", () => {
  assert.equal(reachOf(cube(0.6, 0), ARM), "reachable");
  assert.equal(reachOf(cube(0, -0.6), ARM), "reachable"); // the base turns, so direction doesn't matter
});

test("far away is out of reach, and the limit matches the reach sphere", () => {
  assert.equal(reachOf(cube(1.5, 0), ARM), "too-far");
  // A thin 1 cm plate's top is at y = 0.01: the limit is the reach sphere's radius at that height.
  const r = reachRadiusAt(0.01, ARM);
  const plate = (x: number) => ({ kind: "box" as const, size: { x: 0.05, y: 0.01, z: 0.05 }, position: { x, z: 0 } });
  assert.equal(reachOf(plate(r - 0.001), ARM), "reachable");
  assert.equal(reachOf(plate(r + 0.001), ARM), "too-far");
});

test("tall shapes reach higher, so they can be reached further out", () => {
  const tall = { kind: "cylinder" as const, size: { x: 0.1, y: 0.35, z: 0.1 }, position: { x: 1.04, z: 0 } };
  const flat = { ...tall, size: { x: 0.1, y: 0.02, z: 0.1 } };
  assert.equal(reachOf(tall, ARM), "reachable"); // top level with the shoulder: full reach sideways
  assert.equal(reachOf(flat, ARM), "too-far");
  assert.ok(Math.abs(reachRadiusAt(ARM.baseHeight + ARM.shoulderHeight, ARM) - (maxReach(ARM) - REACH_MARGIN)) < 1e-12);
});

test("shapes overlapping the pedestal, or tucked against it, are flagged", () => {
  assert.equal(reachOf(cube(0.25, 0), ARM), "overlaps-base"); // 20 cm box reaches within 0.2 m of the axis
  assert.equal(reachOf({ kind: "sphere", size: { x: 0.04, y: 0.04, z: 0.04 }, position: { x: 0.23, z: 0 } }, ARM), "too-close");
  assert.ok(footprintRadius(cube(0, 0)) > 0.1); // a box's footprint circle covers its corners
  assert.equal(BASE_RADIUS, 0.2);
});
