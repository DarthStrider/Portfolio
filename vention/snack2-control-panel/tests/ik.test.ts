import { test } from "node:test";
import assert from "node:assert/strict";
import { DEG, forwardKinematics, type Vec3 } from "../src/arm/kinematics";
import { solveTopDown, withinLimits } from "../src/arm/ik";
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
        const q = solveTopDown(ARM, target);
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
  assert.ok(withinLimits(JOINTS, [0, 0, 0, 0]));
  assert.ok(!withinLimits(JOINTS, [0, 0, 150, 0])); // elbow limit is 140°
});
