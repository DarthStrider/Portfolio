/**
 * How belts carry things. Pure math with no Three.js, so it's unit-tested.
 *
 * The model is deliberately simple, a "kinematic" conveyor like the arm's own gripper:
 * - a shape rests on whatever is under its center: the highest belt top at or below it, or the floor;
 * - resting on a running belt, it moves at the belt's speed along the belt;
 * - with nothing under it any more (it rode off the end), it falls with gravity, keeping the
 *   belt's forward speed like a thrown ball, until it lands on the floor (and stops) or on a
 *   lower belt (which carries it on).
 * Shapes don't collide with each other or with a belt's sides. Snack 3 is where real contact
 * physics lives; here the point is layout and flow.
 */
import type { Conveyor } from "./types";

type Belt = Pick<Conveyor, "length" | "width" | "height" | "speed" | "position" | "rotationY">;

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

/** A shape while the belts run: where it is, and how fast it's falling. */
export interface Body {
  x: number;
  z: number;
  /** Height of the shape's base. */
  y: number;
  /** Velocity, m/s: vx, vz while falling off a belt, vy negative while falling. */
  vx: number;
  vy: number;
  vz: number;
}

/** Advances every body by dt seconds. Bodies are changed in place. */
export function step(bodies: Iterable<Body>, belts: readonly Belt[], dt: number, floorLimit = 2.95): void {
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
      }
      continue;
    }
    body.y = support;
    body.vy = 0;
    const belt = beltUnder(belts, body.x, body.z, body.y);
    if (!belt || Math.abs(belt.height - body.y) > 1e-4) {
      body.vx = body.vz = 0; // resting on the floor
      continue;
    }
    const v = beltVelocity(belt);
    body.vx = v.vx;
    body.vz = v.vz;
    move(body, v.vx, v.vz, dt, floorLimit);
  }
}

/** Stop at the edge of the stored floor area rather than leaving it. */
function move(body: Body, vx: number, vz: number, dt: number, limit: number): void {
  body.x = Math.max(-limit, Math.min(limit, body.x + vx * dt));
  body.z = Math.max(-limit, Math.min(limit, body.z + vz * dt));
}
