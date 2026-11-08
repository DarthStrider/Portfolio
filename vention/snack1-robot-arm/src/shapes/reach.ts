/**
 * Can the arm reach a shape? Pure math on the arm's dimensions, no Three.js, so it's
 * unit-tested like the kinematics.
 *
 * The gripper picks from above, so the question is whether the tool center point can get
 * to the middle of the shape's top face. The arm is a chain hinged at the shoulder, so the
 * points it can reach lie within a sphere of radius maxReach around the shoulder joint.
 * A small margin keeps "reachable" from meaning "only with the arm locked straight".
 */
import { maxReach, type ArmDimensions } from "../arm/kinematics";
import type { Shape } from "./types";

export type Reach = "reachable" | "too-far" | "too-close" | "overlaps-base";

/** Radius of the pedestal at the floor (RobotArm.ts builds it 0.2 m at the bottom). */
export const BASE_RADIUS = 0.2;
/** Closer than this, the arm would have to fold back on its own column. */
export const MIN_REACH_RADIUS = 0.25;
export const REACH_MARGIN = 0.03;

/** Radius of the circle a shape's footprint fits in, whatever its rotation. */
export function footprintRadius(shape: Pick<Shape, "kind" | "size">): number {
  return shape.kind === "box" ? Math.hypot(shape.size.x, shape.size.z) / 2 : shape.size.x / 2;
}

/** baseY is what the shape stands on: 0 on the floor, a belt's height on a conveyor. */
export function reachOf(shape: Pick<Shape, "kind" | "size" | "position">, arm: ArmDimensions, baseY = 0): Reach {
  const { x, z } = shape.position;
  const radius = Math.hypot(x, z); // horizontal distance from the base axis
  if (radius - footprintRadius(shape) < BASE_RADIUS) return "overlaps-base";
  if (radius < MIN_REACH_RADIUS) return "too-close";
  const shoulderY = arm.baseHeight + arm.shoulderHeight;
  const topY = baseY + shape.size.y;
  const distance = Math.hypot(radius, topY - shoulderY);
  return distance <= maxReach(arm) - REACH_MARGIN ? "reachable" : "too-far";
}

/** How far out, along the floor, the arm can reach a point at height y. */
export function reachRadiusAt(y: number, arm: ArmDimensions): number {
  const r = maxReach(arm) - REACH_MARGIN;
  const dy = y - (arm.baseHeight + arm.shoulderHeight);
  return Math.sqrt(Math.max(0, r * r - dy * dy));
}

export const REACH_LABEL: Record<Reach, string> = {
  reachable: "in reach",
  "too-far": "out of reach",
  "too-close": "too close",
  "overlaps-base": "hits the base",
};
