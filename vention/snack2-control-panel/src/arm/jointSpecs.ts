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

/** Link lengths in meters. Same arm as Snack 1. */
export const ARM: ArmDimensions = {
  baseHeight: 0.15,
  shoulderHeight: 0.2,
  upperArm: 0.45,
  forearm: 0.4,
  wrist: 0.12,
  tool: 0.115,
};

/** Home pose: gripper pointing straight down (30 + 90 + 60 = 180 degrees). */
export const JOINTS: readonly JointSpec[] = [
  { name: "Base", axis: "y", min: -180, max: 180, home: 45 },
  { name: "Shoulder", axis: "z", min: -100, max: 100, home: 30 },
  { name: "Elbow", axis: "z", min: -140, max: 140, home: 90 },
  { name: "Wrist", axis: "z", min: -120, max: 120, home: 60 },
];
