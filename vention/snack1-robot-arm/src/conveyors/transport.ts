/**
 * How belts carry things. Pure math with no Three.js, so it's unit-tested.
 *
 * The model is deliberately simple, a "kinematic" conveyor like the arm's own gripper:
 * - a shape rests on whatever is under its center: the highest belt top at or below it, or the floor;
 * - resting on a running belt, it moves at the belt's speed along the belt;
 * - with nothing under it any more (it rode off the end), it falls with gravity, keeping the
 *   belt's forward speed like a thrown ball, until it lands on the floor (and stops) or on a
 *   lower belt (which carries it on).
 * - passing a splitter's gate, it's sent left, right or straight on by the splitter's rules
 *   (decided by the caller); sent sideways, it slides off the belt's side at an angle.
 * Shapes don't collide with each other or with a belt's sides. Snack 3 is where real contact
 * physics lives; here the point is layout and flow.
 */
import type { Conveyor } from "./types";

type Belt = Pick<Conveyor, "length" | "width" | "height" | "speed" | "position" | "rotationY"> & { id?: string };

/** A splitter's gate: on which belt, and how far from that belt's start (its -u end). */
export interface Gate {
  id: string;
  conveyorId: string;
  along: number;
}
export type Exit = "left" | "straight" | "right";

/** A diverted item leaves at this angle to the belt's direction of travel. */
export const DIVERT_ANGLE = 60 * (Math.PI / 180);

export const GRAVITY = 9.81; // m/s²
const DEG = Math.PI / 180;
const EPS = 1e-6;

/**
 * A world point in the belt's own frame: u along its length (direction of travel), v across.
 * Three.js turns local +x to (cos θ, 0, -sin θ) for a rotation θ about +y, so this is the inverse.
 */
export function toBelt(b: Belt, x: number, z: number): { u: number; v: number } {
  const t = b.rotationY * DEG;
  const dx = x - b.position.x;
  const dz = z - b.position.z;
  return { u: dx * Math.cos(t) - dz * Math.sin(t), v: dx * Math.sin(t) + dz * Math.cos(t) };
}

export function isOver(b: Belt, x: number, z: number): boolean {
  const { u, v } = toBelt(b, x, z);
  return Math.abs(u) <= b.length / 2 + EPS && Math.abs(v) <= b.width / 2 + EPS;
}

/** The highest belt under (x, z) whose top is at or below maxY, if any. */
export function beltUnder<B extends Belt>(belts: readonly B[], x: number, z: number, maxY = Infinity): B | null {
  let best: B | null = null;
  for (const b of belts) {
    if (b.height <= maxY + EPS && isOver(b, x, z) && (!best || b.height > best.height)) best = b;
  }
  return best;
}

/** What a shape at (x, z) rests on: the top of the highest belt at or below maxY, or the floor. */
export function supportHeight(belts: readonly Belt[], x: number, z: number, maxY = Infinity): number {
  return beltUnder(belts, x, z, maxY)?.height ?? 0;
}

/** World velocity of a belt's surface. */
export function beltVelocity(b: Belt): { vx: number; vz: number } {
  const t = b.rotationY * DEG;
  return { vx: b.speed * Math.cos(t), vz: -b.speed * Math.sin(t) };
}

/** A shape while the belts run: where it is, and how fast it's moving. */
export interface Body {
  /** The shape's id, passed back to the caller when the body reaches a gate. */
  id?: string;
  /** Set when a gate sent it sideways: which belt, and which side of it (+1 is the belt's +v side). */
  divert?: { beltId: string | undefined; side: 1 | -1 };
  x: number;
  z: number;
  /** Height of the shape's base. */
  y: number;
  /** Velocity, m/s: vx, vz while falling off a belt, vy negative while falling. */
  vx: number;
  vy: number;
  vz: number;
}

export interface StepOptions {
  gates?: readonly Gate[];
  /** Asked once when a body crosses a gate: where should it go? */
  route?: (body: Body, gate: Gate) => Exit;
  floorLimit?: number;
}

/**
 * Which side of a belt is "left" depends on which way it runs. Seen from above, facing the
 * direction of travel, right is the belt's +v side when it runs forward (+u), and -v when
 * it runs backwards.
 */
export function sideOf(exit: "left" | "right", speed: number): 1 | -1 {
  const forward = speed >= 0 ? 1 : -1;
  return (exit === "right" ? forward : -forward) as 1 | -1;
}

/** World velocity of an item pushed off a belt's side at DIVERT_ANGLE to its travel. */
export function divertVelocity(b: Belt, side: 1 | -1): { vx: number; vz: number } {
  const t = b.rotationY * DEG;
  const du = b.speed * Math.cos(DIVERT_ANGLE);
  const dv = side * Math.abs(b.speed) * Math.sin(DIVERT_ANGLE);
  // u points along (cos θ, -sin θ) in world x, z, and v along (sin θ, cos θ): see toBelt.
  return { vx: du * Math.cos(t) + dv * Math.sin(t), vz: -du * Math.sin(t) + dv * Math.cos(t) };
}

/** Advances every body by dt seconds. Bodies are changed in place. */
export function step(bodies: Iterable<Body>, belts: readonly Belt[], dt: number, options: StepOptions | number = {}): void {
  const { gates = [], route, floorLimit = 2.95 } = typeof options === "number" ? { floorLimit: options } : options;
  for (const body of bodies) {
    // Only what's at or below the base can hold it up: a belt above it doesn't lift it.
    const support = supportHeight(belts, body.x, body.z, body.y);
    if (body.y > support + 1e-4) {
      // Semi-implicit Euler, as in Snack 3: velocity first, then position.
      body.vy -= GRAVITY * dt;
      body.y += body.vy * dt;
      move(body, body.vx, body.vz, dt, floorLimit);
      if (body.y <= support) {
        // Landed. What it landed on is found again next step, since the fall moved it.
        body.y = supportHeight(belts, body.x, body.z, support);
        body.vx = body.vy = body.vz = 0;
        body.divert = undefined;
      }
      continue;
    }
    body.y = support;
    body.vy = 0;
    const belt = beltUnder(belts, body.x, body.z, body.y);
    if (!belt || Math.abs(belt.height - body.y) > 1e-4) {
      body.vx = body.vz = 0; // resting on the floor
      body.divert = undefined;
      continue;
    }
    // Sent sideways by a gate on this belt: keep sliding off. On another belt, ride it normally.
    const diverted = body.divert && body.divert.beltId === belt.id ? body.divert : undefined;
    if (!diverted) body.divert = undefined;
    const v = diverted ? divertVelocity(belt, diverted.side) : beltVelocity(belt);
    const before = toBelt(belt, body.x, body.z).u;
    body.vx = v.vx;
    body.vz = v.vz;
    move(body, v.vx, v.vz, dt, floorLimit);
    if (diverted || !route || belt.id === undefined) continue;

    // Did this step carry it past a gate on this belt? Gates are measured from the belt's -u end.
    const after = toBelt(belt, body.x, body.z).u;
    for (const gate of gates) {
      if (gate.conveyorId !== belt.id) continue;
      const g = gate.along - belt.length / 2;
      const crossed = (before < g && after >= g) || (before > g && after <= g);
      if (!crossed) continue;
      const exit = route(body, gate);
      if (exit !== "straight") {
        body.divert = { beltId: belt.id, side: sideOf(exit, belt.speed) };
        break;
      }
    }
  }
}

/** Stop at the edge of the stored floor area rather than leaving it. */
function move(body: Body, vx: number, vz: number, dt: number, limit: number): void {
  body.x = Math.max(-limit, Math.min(limit, body.x + vx * dt));
  body.z = Math.max(-limit, Math.min(limit, body.z + vz * dt));
}
