import { test } from "node:test";
import assert from "node:assert/strict";
import { DEG, forwardKinematics, maxReach, type Vec3 } from "../src/arm/kinematics";
import { FINGERTIP_BELOW_TCP } from "../src/arm/gripperSpec"; // the claw's fingertips reach past the TCP
import { ARM, JOINTS, demoTarget } from "../src/arm/jointSpecs";

const H = ARM.baseHeight + ARM.shoulderHeight; // shoulder joint height
const REACH = maxReach(ARM);

function assertClose(actual: Vec3, expected: Vec3, tolerance = 1e-12) {
  const err = Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z);
  assert.ok(err < tolerance, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (error ${err})`);
}

// ---- An independent reference: the same chain as 4x4 matrices, mirroring the scene graph ----

type Mat4 = number[]; // row-major

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
}
const translateY = (y: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, y, 0, 0, 1, 0, 0, 0, 0, 1];
const rotateY = (t: number): Mat4 => {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
};
const rotateZ = (t: number): Mat4 => {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};

function matrixChainFK(q: number[]): Vec3 {
  const chain = [
    translateY(ARM.baseHeight), rotateY(q[0]),
    translateY(ARM.shoulderHeight), rotateZ(q[1]),
    translateY(ARM.upperArm), rotateZ(q[2]),
    translateY(ARM.forearm), rotateZ(q[3]),
    translateY(ARM.wrist), rotateY(q[4] ?? 0), // roll turns about the tool axis...
    translateY(ARM.tool), // ...which the TCP is on, so it never moves the TCP
  ].reduce(multiply);
  return { x: chain[3], y: chain[7], z: chain[11] }; // translation column
}

// ---- Tests ----

test("zero pose points straight up", () => {
  assertClose(forwardKinematics(ARM, [0, 0, 0, 0]), { x: 0, y: H + REACH, z: 0 });
});

test("shoulder +90 degrees lays the arm along -X", () => {
  assertClose(forwardKinematics(ARM, [0, 90 * DEG, 0, 0]), { x: -REACH, y: H, z: 0 });
});

test("base +90 degrees swings that pose to +Z", () => {
  assertClose(forwardKinematics(ARM, [90 * DEG, 90 * DEG, 0, 0]), { x: 0, y: H, z: REACH });
});

test("home pose has the gripper pointing straight down", () => {
  const q = JOINTS.map((j) => j.home * DEG);
  const tcp = forwardKinematics(ARM, q);
  const flange = forwardKinematics({ ...ARM, wrist: 0, tool: 0 }, q); // the wrist joint
  assert.ok(Math.abs(tcp.x - flange.x) < 1e-12 && Math.abs(tcp.z - flange.z) < 1e-12);
  assert.ok(tcp.y < flange.y);
});

test("matches a 4x4 matrix chain for 1,000 random poses", () => {
  let seed = 42; // deterministic pseudo-random numbers
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  for (let i = 0; i < 1000; i++) {
    const q = JOINTS.map((j) => (j.min + random() * (j.max - j.min)) * DEG);
    assertClose(forwardKinematics(ARM, q), matrixChainFK(q));
  }
});

test("never reaches farther than the stretched arm", () => {
  for (let i = 0; i < 500; i++) {
    const q = [i * 0.7, Math.sin(i), Math.cos(i * 1.3), Math.sin(i * 0.4) * 2];
    const p = forwardKinematics(ARM, q);
    assert.ok(Math.hypot(p.x, p.y - H, p.z) <= REACH + 1e-12);
  }
});

test("demo motion stays within joint limits and keeps the gripper above the floor", () => {
  let lowest = Infinity;
  for (let t = 0; t < 600; t += 0.05) {
    const anglesDeg = JOINTS.map((_, i) => demoTarget(i, t));
    anglesDeg.forEach((a, i) => {
      assert.ok(a >= JOINTS[i].min && a <= JOINTS[i].max, `${JOINTS[i].name} = ${a} at t=${t}`);
    });
    lowest = Math.min(lowest, forwardKinematics(ARM, anglesDeg.map((a) => a * DEG)).y);
  }
  assert.ok(lowest - FINGERTIP_BELOW_TCP > 0.02, `gripper dips to ${lowest.toFixed(3)} m`);
});
