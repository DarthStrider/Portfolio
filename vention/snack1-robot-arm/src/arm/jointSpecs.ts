import type { ArmDimensions } from "./kinematics";

export type Axis = "x" | "y" | "z";

/** One rotary joint. Angles are in degrees. */
export interface JointSpec {
  name: string;
  axis: Axis;
  min: number;
  max: number;
  home: number;
}

/** Link lengths in meters (glTF and Three.js both treat 1 unit as 1 m). */
export const ARM: ArmDimensions = {
  baseHeight: 0.15,
  shoulderHeight: 0.2,
  upperArm: 0.45,
  forearm: 0.4,
  wrist: 0.12,
  tool: 0.115,
};

/**
 * The arm is built from this list, so adding or re-limiting a joint is a data
 * change. Home pose: gripper pointing straight down (30 + 90 + 60 = 180 degrees).
 */
export const JOINTS: readonly JointSpec[] = [
  { name: "Base", axis: "y", min: -180, max: 180, home: 45 },
  { name: "Shoulder", axis: "z", min: -100, max: 100, home: 30 },
  { name: "Elbow", axis: "z", min: -140, max: 140, home: 90 },
  { name: "Wrist", axis: "z", min: -120, max: 120, home: 60 },
];

/**
 * Demo motion: each joint sways around its home angle at its own frequency, so
 * the combined path never quite repeats. Amplitudes are chosen so the gripper
 * stays above the floor (checked in tests/kinematics.test.ts).
 */
const DEMO_MOTION = [
  { amplitude: 70, frequency: 0.07 },
  { amplitude: 20, frequency: 0.11 },
  { amplitude: 18, frequency: 0.13 },
  { amplitude: 30, frequency: 0.17 },
] as const;

/** Target angle in degrees for joint `index` at `time` seconds into the demo. */
export function demoTarget(index: number, time: number): number {
  const { amplitude, frequency } = DEMO_MOTION[index];
  return JOINTS[index].home + amplitude * Math.sin(2 * Math.PI * frequency * time + index);
}

/** Whether the gripper should be open at `time` seconds into the demo. */
export function demoGripperOpen(time: number): boolean {
  return Math.sin(2 * Math.PI * 0.15 * time) > 0;
}
