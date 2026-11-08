/**
 * Forward kinematics for the arm, written by hand with no Three.js dependency.
 *
 * The arm is a base that yaws about Y, followed by three joints that all pitch
 * about their local Z axis. Because the pitch joints are parallel, everything
 * after the base yaw lies in one vertical plane, so FK reduces to summing link
 * vectors in that plane, then rotating the plane about Y by the base angle.
 *
 * main.ts compares this against Three.js's own scene-graph result every frame,
 * which is a good sanity check that the hierarchy is built the way we think.
 */

export interface ArmDimensions {
  /** Floor to the base (yaw) joint. */
  baseHeight: number;
  /** Base joint to the shoulder joint. */
  shoulderHeight: number;
  /** Shoulder joint to elbow joint. */
  upperArm: number;
  /** Elbow joint to wrist joint. */
  forearm: number;
  /** Wrist joint to the tool flange. */
  wrist: number;
  /** Tool flange to the tool center point (between the gripper fingertips). */
  tool: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * World position of the tool center point.
 * @param q joint angles in radians: [base yaw, shoulder, elbow, wrist]
 */
export function forwardKinematics(d: ArmDimensions, q: readonly number[]): Vec3 {
  const [base = 0, shoulder = 0, elbow = 0, wrist = 0] = q;

  // Each pitch joint adds to the angle of every link after it.
  const a1 = shoulder;
  const a2 = shoulder + elbow;
  const a3 = shoulder + elbow + wrist;
  const distal = d.wrist + d.tool;

  // Rotating (0, L, 0) about Z by a gives (-L sin a, L cos a, 0).
  const r = -(d.upperArm * Math.sin(a1) + d.forearm * Math.sin(a2) + distal * Math.sin(a3));
  const y =
    d.baseHeight +
    d.shoulderHeight +
    d.upperArm * Math.cos(a1) +
    d.forearm * Math.cos(a2) +
    distal * Math.cos(a3);

  // Rotating (r, y, 0) about Y by `base` gives (r cos b, y, -r sin b).
  return { x: r * Math.cos(base), y, z: -r * Math.sin(base) };
}

/** Distance from the shoulder joint to the TCP with the arm fully stretched. */
export function maxReach(d: ArmDimensions): number {
  return d.upperArm + d.forearm + d.wrist + d.tool;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const DEG = Math.PI / 180;
