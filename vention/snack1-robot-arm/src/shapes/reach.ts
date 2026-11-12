/**
 * Can the arm pick a shape up? Pure math on the arm's dimensions, no Three.js, so it's
 * unit-tested like the kinematics.
 *
 * The gripper picks from above, pointing straight down. That fixes where the wrist joint
 * is: straight above the tool center point, by the wrist link plus the tool. So the question
 * is whether the upper arm and forearm, hinged at the shoulder, can put the wrist joint there:
 * it must lie within a circle of radius upperArm + forearm around the shoulder joint, in the
 * arm's vertical plane. That's checked at the two heights a pick goes through, gripping the
 * shape and lifting it clear; everything in between is reachable if both ends are.
 *
 * A small margin keeps "reachable" from meaning "only with the arm locked straight".
 * (This is less far than the arm can reach with the gripper at any angle, the whole chain
 * stretched out: a sphere of radius maxReach. Picking from above can't use that.)
 */
import type { ArmDimensions } from "../arm/kinematics";
import { gripHeight } from "../pick/grasp";
import { CLEARANCE } from "../pick/clearance";
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

/** baseY is what the shape stands on: 0 on the floor, a belt's height on a belt. */
export function reachOf(shape: Pick<Shape, "kind" | "size" | "position">, arm: ArmDimensions, baseY = 0): Reach {
  const { x, z } = shape.position;
  const radius = Math.hypot(x, z); // horizontal distance from the base axis
  if (radius - footprintRadius(shape) < BASE_RADIUS) return "overlaps-base";
  if (radius < MIN_REACH_RADIUS) return "too-close";
  const grip = baseY + gripHeight(shape.size.y); // the TCP's height while gripping...
  const lifted = grip + CLEARANCE; // ...and lifted clear
  return radius <= Math.min(reachRadiusAt(grip, arm), reachRadiusAt(lifted, arm)) ? "reachable" : "too-far";
}

/** How far out from the base the TCP can get, pointing straight down, at height y. */
export function reachRadiusAt(y: number, arm: ArmDimensions): number {
  const r = arm.upperArm + arm.forearm - REACH_MARGIN;
  const dy = y + arm.wrist + arm.tool - (arm.baseHeight + arm.shoulderHeight); // wrist joint vs shoulder
  return Math.sqrt(Math.max(0, r * r - dy * dy));
}

export const REACH_LABEL: Record<Reach, string> = {
  reachable: "in reach",
  "too-far": "out of reach",
  "too-close": "too close",
  "overlaps-base": "hits the base",
};
