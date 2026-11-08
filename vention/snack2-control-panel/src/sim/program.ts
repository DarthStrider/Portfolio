import type { Vec3 } from "../arm/kinematics";

/**
 * The robot program: a list of steps, in the style of an industrial robot's
 * teach pendant or Vention's MachineLogic.
 *
 * - moveJ:   joint move. Solve IK for the end point once, then interpolate each
 *            joint. Fast and smooth, but the tool's path in space is a curve.
 * - moveL:   linear move. Interpolate the tool position in a straight line and
 *            solve IK every frame. Used for approaching and leaving the part.
 * - gripper: open or close the fingers to a gap (meters).
 * - home:    joint move back to the home pose.
 */
export type Step =
  | { kind: "moveJ"; label: string; to: Vec3; duration: number }
  | { kind: "moveL"; label: string; to: Vec3; duration: number }
  | { kind: "gripper"; label: string; gap: number; duration: number }
  | { kind: "home"; label: string; duration: number };

// ---- Work cell layout (meters) ----

export const PART_SIZE = 0.05; // cube edge
export const GAP_OPEN = 0.096; // distance between the grip pads
export const GAP_CLOSED = 0.006;

export const PLATFORM = { x: 0.3, z: 0.45, size: 0.18, height: 0.075 };

/** Where the part's center sits when resting at each station. */
export const FLOOR_SPOT: Vec3 = { x: -0.45, y: PART_SIZE / 2, z: 0.35 };
export const PLATFORM_SPOT: Vec3 = { x: PLATFORM.x, y: PLATFORM.height + PART_SIZE / 2, z: PLATFORM.z };

const CLEARANCE = 0.15; // approach height above a station
const RELEASE_DROP = 0.002; // let go 2 mm above the surface so the part settles

const above = (p: Vec3, height = CLEARANCE): Vec3 => ({ ...p, y: p.y + height });

/** One pick-and-place cycle, ending back at home. */
export function pickAndPlace(from: Vec3, to: Vec3, fromName: string, toName: string): Step[] {
  const release = above(to, RELEASE_DROP);
  return [
    { kind: "moveJ", label: `Move above ${fromName}`, to: above(from), duration: 2 },
    { kind: "moveL", label: "Descend to part", to: from, duration: 1.2 },
    { kind: "gripper", label: "Close gripper", gap: PART_SIZE, duration: 0.6 },
    { kind: "moveL", label: "Lift part", to: above(from), duration: 1 },
    { kind: "moveJ", label: `Move above ${toName}`, to: above(release), duration: 2.2 },
    { kind: "moveL", label: "Lower part", to: release, duration: 1.2 },
    { kind: "gripper", label: "Open gripper", gap: GAP_OPEN, duration: 0.5 },
    { kind: "moveL", label: "Retract", to: above(release), duration: 0.9 },
    { kind: "home", label: "Return home", duration: 2 },
  ];
}

/** Even cycles move the part floor → platform, odd cycles bring it back, so looping never runs out of work. */
export function programForCycle(cycle: number): Step[] {
  return cycle % 2 === 0
    ? pickAndPlace(FLOOR_SPOT, PLATFORM_SPOT, "part", "platform")
    : pickAndPlace(PLATFORM_SPOT, FLOOR_SPOT, "part", "floor spot");
}
