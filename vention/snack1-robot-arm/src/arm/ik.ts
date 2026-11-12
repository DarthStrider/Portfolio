import { DEG, type ArmDimensions, type Vec3 } from "./kinematics";
import type { JointSpec } from "./jointSpecs";

/**
 * Inverse kinematics for a top-down grasp: the joint angles that put the tool center
 * point on `target` with the gripper pointing straight down, and its fingers closing
 * along a chosen direction. (From Snack 2, plus the roll joint.)
 *
 * Returns [base, shoulder, elbow, wrist, roll] in degrees, or null if out of reach.
 *
 * Fixing the tool's orientation makes this solvable in closed form:
 *  1. The base yaw is just the compass direction to the target.
 *  2. With the tool vertical, the wrist joint sits straight above the target,
 *     so shoulder + elbow form a two-link arm reaching for that point.
 *  3. The wrist takes whatever angle makes the three pitch angles sum to 180°.
 *  4. Roll turns the fingers to `fingerYaw` (see fingerYaw below).
 */
export function solveTopDown(d: ArmDimensions, target: Vec3, fingerYawDeg?: number): number[] | null {
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

  const baseDeg = base / DEG;
  // 4. Without a direction, leave the roll at 0: the fingers close across the arm's reach.
  const roll = fingerYawDeg === undefined ? 0 : rollFor(baseDeg, fingerYawDeg);
  return [baseDeg, shoulder / DEG, elbow / DEG, wrist / DEG, roll];
}

/**
 * Which way the fingers close, as a turn about the vertical (degrees, measured like a
 * shape's rotationY): with the gripper pointing straight down, it's base − roll.
 *
 * Why: the three pitch joints add up to a half turn about Z, which flips the gripper's
 * X axis (the way its fingers slide) to point the other way; roll turns it about the
 * now-vertical tool axis, and the base turns the whole arm. Put together, the fingers
 * slide along the X axis of a frame turned by (base − roll). tests/ik.test.ts checks this
 * against a matrix chain built joint by joint.
 */
export function fingerYaw(baseDeg: number, rollDeg: number): number {
  return baseDeg - rollDeg;
}

/**
 * The roll that makes the fingers close along `fingerYawDeg`. Two fingers are the same
 * either way round, so any half turn will do: this picks the smallest, from -90° to 90°.
 */
export function rollFor(baseDeg: number, fingerYawDeg: number): number {
  return wrapHalfTurn(baseDeg - fingerYawDeg);
}

/** Wraps degrees into [-180, 180). */
export function wrapDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Wraps degrees into [-90, 90): the same line, pointing either way. */
export function wrapHalfTurn(deg: number): number {
  return ((((deg + 90) % 180) + 180) % 180) - 90;
}

export function withinLimits(specs: readonly JointSpec[], anglesDeg: readonly number[]): boolean {
  return specs.every((s, i) => anglesDeg[i] === undefined || (anglesDeg[i] >= s.min - 1e-9 && anglesDeg[i] <= s.max + 1e-9));
}
