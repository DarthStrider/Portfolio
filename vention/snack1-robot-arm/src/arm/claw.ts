/**
 * The claw: a palm with four fingers 90° apart, each with two joints, like a hand closing
 * round something from above.
 *
 *   palm ── root hinge ── upper finger ── elbow (knuckle) ── lower finger with a pad
 *
 * Opening swings each upper finger outward by an angle θ; the elbow turns back by the same
 * angle, so the lower finger stays upright and its pad stays flat against what it's holding
 * (a parallel claw, as on many industrial grippers). All four move together, so the claw
 * centers what it closes on.
 *
 * Everything here is in the tool frame: the origin at the wrist's mounting flange, +Y
 * pointing away from the wrist (down, when the claw points at the floor). Pure numbers, so
 * the GLB builder, the Three.js model, the planner and the tests all share them.
 */

/** Where each finger is hinged: on a circle of this radius under the palm (meters). */
export const ROOT_RADIUS = 0.035;
/** The palm's underside, where the fingers are hinged. */
export const HINGE_Y = 0.06;
/** Upper finger, root hinge to elbow. */
export const UPPER = 0.09;
/** Lower finger, elbow to tip (the claw's curl goes a little further). */
export const LOWER = 0.05;
export const TIP_CURL = 0.01;
/** From a lower finger's middle line to its pad's face, toward the claw's axis. */
export const PAD_INSET = 0.014;
/** The pad, measured along the lower finger from the elbow. */
export const PAD_FROM = 0.008;
export const PAD_TO = 0.044;
/** Thickness of a finger, for collisions (a capsule's radius). */
export const FINGER_RADIUS = 0.011;

export const FINGERS = 4;
const DEG = Math.PI / 180;

/** The gap between opposite pads for an opening angle θ (degrees; negative leans inward). */
export function gapForAngle(theta: number): number {
  return 2 * (ROOT_RADIUS + UPPER * Math.sin(theta * DEG) - PAD_INSET);
}

/** The opening angle that puts opposite pads `gap` apart. */
export function angleForGap(gap: number): number {
  const s = (gap / 2 + PAD_INSET - ROOT_RADIUS) / UPPER;
  return Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
}

/** Height of the elbow (and the top of the lower finger) at angle θ, along the tool axis. */
export function elbowY(theta: number): number {
  return HINGE_Y + UPPER * Math.cos(theta * DEG);
}

/** The tool center point: the middle of the pads with the claw half closed, as the arm's `tool` length. */
export const TCP_Y = Math.round((elbowY(10) + (PAD_FROM + PAD_TO) / 2) * 1000) / 1000;

type P3 = { x: number; y: number; z: number };

/**
 * Each finger as two segments in the tool frame, for collisions: [root, elbow] and
 * [elbow, tip]. Finger k points along angle k·90° about the axis.
 */
export function fingerSegments(gap: number): [P3, P3][] {
  const theta = angleForGap(gap);
  const out: [P3, P3][] = [];
  for (let k = 0; k < FINGERS; k++) {
    const a = (k * Math.PI) / 2;
    const at = (r: number, y: number): P3 => ({ x: r * Math.cos(a), y, z: -r * Math.sin(a) });
    const elbowR = ROOT_RADIUS + UPPER * Math.sin(theta * DEG);
    const ey = elbowY(theta);
    out.push([at(ROOT_RADIUS, HINGE_Y), at(elbowR, ey)]);
    // The lower capsule's end is set back by its radius, so its surface ends at the fingertip.
    out.push([at(elbowR, ey), at(elbowR - TIP_CURL * 0.5, ey + LOWER + TIP_CURL - FINGER_RADIUS)]);
  }
  return out;
}
