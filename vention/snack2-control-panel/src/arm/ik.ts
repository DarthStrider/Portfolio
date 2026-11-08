import { DEG, type ArmDimensions, type Vec3 } from "./kinematics";
import type { JointSpec } from "./jointSpecs";

/**
 * Inverse kinematics for a top-down grasp: find the joint angles that put the
 * tool center point on `target` with the gripper pointing straight down.
 *
 * Returns [base, shoulder, elbow, wrist] in degrees, or null if out of reach.
 *
 * Fixing the tool orientation makes this solvable in closed form:
 *  1. The base yaw is just the compass direction to the target.
 *  2. With the tool vertical, the wrist joint sits straight above the target,
 *     so shoulder + elbow form a two-link arm reaching for that point.
 *  3. The wrist takes whatever angle makes the three pitch angles sum to 180°.
 */
export function solveTopDown(d: ArmDimensions, target: Vec3): number[] | null {
  // 1. Base yaw. The arm reaches along its local -X, so FK gives
  //    x = -reach·cos(base), z = reach·sin(base).
  const reach = Math.hypot(target.x, target.z);
  const base = Math.atan2(target.z, -target.x);

  // 2. Two-link problem in the arm's vertical plane, measured from the shoulder joint:
  //    u = horizontal distance, v = height of the wrist joint above the shoulder.
  const u = reach;
  const v = target.y + d.wrist + d.tool - (d.baseHeight + d.shoulderHeight);
  const a = d.upperArm;
  const b = d.forearm;

  // Law of cosines gives the elbow bend. Outside [-1, 1] means the point is too far or too close.
  const cosElbow = (u * u + v * v - a * a - b * b) / (2 * a * b);
  if (cosElbow < -1 || cosElbow > 1) return null;
  const elbow = Math.acos(cosElbow); // 0..180°, the "elbow up" solution

  // Shoulder angle = direction to the wrist joint, minus the angle the elbow bend adds.
  // Angles here are measured from vertical, matching how the joints are built.
  const shoulder = Math.atan2(u, v) - Math.atan2(b * Math.sin(elbow), a + b * Math.cos(elbow));

  // 3. Keep the tool vertical: shoulder + elbow + wrist = 180°.
  const wrist = Math.PI - shoulder - elbow;

  return [base, shoulder, elbow, wrist].map((angle) => angle / DEG);
}

export function withinLimits(specs: readonly JointSpec[], anglesDeg: readonly number[]): boolean {
  return specs.every((s, i) => anglesDeg[i] >= s.min && anglesDeg[i] <= s.max);
}
