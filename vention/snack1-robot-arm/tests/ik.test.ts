import { test } from "node:test";
import assert from "node:assert/strict";
import { DEG, forwardKinematics, type Vec3 } from "../src/arm/kinematics";
import { fingerYaw, rollFor, solveTopDown, withinLimits, wrapDeg, wrapHalfTurn } from "../src/arm/ik";
import { ARM, JOINTS } from "../src/arm/jointSpecs";

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("IK of the home pose's tool position gives back the home angles", () => {
  const home = JOINTS.map((j) => j.home);
  const tcp = forwardKinematics(ARM, home.map((a) => a * DEG));
  const q = solveTopDown(ARM, tcp)!;
  q.forEach((a, i) => assert.ok(Math.abs(a - home[i]) < 1e-9, `${JOINTS[i].name}: ${a} vs ${home[i]}`));
});

test("FK(IK(p)) = p with the gripper vertical, across the reachable work area", () => {
  let checked = 0;
  for (let x = -0.7; x <= 0.7; x += 0.05) {
    for (let z = -0.7; z <= 0.7; z += 0.05) {
      for (let y = 0.02; y <= 0.5; y += 0.04) {
        if (Math.hypot(x, z) < 0.15) continue; // too close to the base axis
        const target = { x, y, z };
        const q = solveTopDown(ARM, target, 30);
        if (!q) continue;
        assert.ok(distance(forwardKinematics(ARM, q.map((a) => a * DEG)), target) < 1e-9);
        assert.ok(Math.abs(q[1] + q[2] + q[3] - 180) < 1e-9, "pitch angles must sum to 180°");
        checked++;
      }
    }
  }
  assert.ok(checked > 1000, `only ${checked} reachable points checked`);
});

test("points beyond the arm's reach return null", () => {
  assert.equal(solveTopDown(ARM, { x: -2, y: 0.1, z: 0 }), null);
  assert.equal(solveTopDown(ARM, { x: 0, y: 3, z: 0.1 }), null);
});

test("withinLimits checks every joint", () => {
  assert.ok(withinLimits(JOINTS, [0, 0, 0, 0, 0]));
  assert.ok(!withinLimits(JOINTS, [0, 0, 150, 0, 0])); // elbow limit is 140°
  assert.ok(!withinLimits(JOINTS, [0, 0, 0, 0, 200])); // roll limit is 180°
});

test("wrapping angles", () => {
  assert.equal(wrapDeg(190), -170);
  assert.equal(wrapDeg(-190), 170);
  assert.equal(wrapDeg(180), -180);
  assert.equal(wrapDeg(30), 30);
  assert.equal(wrapHalfTurn(100), -80);
  assert.equal(wrapHalfTurn(-100), 80);
  assert.equal(wrapHalfTurn(45), 45);
});

// ---- Which way the fingers close: checked against the joints as rotation matrices ----

type Mat3 = number[]; // row-major
const mul = (a: Mat3, b: Mat3): Mat3 =>
  [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
const rotY = (t: number): Mat3 => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
const rotZ = (t: number): Mat3 => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];

/** The gripper's X axis (the way the fingers slide) in the world, built joint by joint like the scene graph. */
function fingerAxis(qDeg: number[]): Vec3 {
  const [b, s, e, w, r] = qDeg.map((a) => a * DEG);
  const m = [rotY(b), rotZ(s), rotZ(e), rotZ(w), rotY(r)].reduce(mul);
  return { x: m[0], y: m[3], z: m[6] }; // first column: where local X ends up
}

test("fingerYaw(base, roll) is the way the fingers close, for any reachable pose", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  for (let i = 0; i < 500; i++) {
    const target = { x: (random() - 0.5) * 1.4, y: 0.02 + random() * 0.4, z: (random() - 0.5) * 1.4 };
    const wanted = (random() - 0.5) * 720;
    const q = solveTopDown(ARM, target, wanted);
    if (!q) continue;
    assert.ok(Math.abs(q[4]) <= 90, "the roll picks the smaller turn");
    const axis = fingerAxis(q);
    assert.ok(Math.abs(axis.y) < 1e-9, "fingers stay level when the gripper points down");
    // A frame turned by `yaw` about Y has its X axis at (cos yaw, 0, -sin yaw). Either sign
    // is the same line, which is all two fingers need.
    const yaw = fingerYaw(q[0], q[4]) * DEG;
    const dot = axis.x * Math.cos(yaw) - axis.z * Math.sin(yaw);
    assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-9, `fingers along ${wanted}°`);
    const wantedDot = axis.x * Math.cos(wanted * DEG) - axis.z * Math.sin(wanted * DEG);
    assert.ok(Math.abs(Math.abs(wantedDot) - 1) < 1e-9);
  }
});

test("rollFor and fingerYaw undo each other, up to a half turn", () => {
  for (const base of [-170, -45, 0, 45, 120, 180]) {
    for (const want of [-200, -90, 0, 33, 90, 270]) {
      const got = fingerYaw(base, rollFor(base, want));
      assert.ok(Math.abs(wrapHalfTurn(got - want)) < 1e-9, `base ${base}, want ${want}, got ${got}`);
    }
  }
});
