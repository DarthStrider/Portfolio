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
 * - on a curve, it goes round with the belt, keeping its distance from the curve's center;
 *   on a transfer, it rides in to the middle, then out to the side.
 * Shapes don't collide with each other or with a belt's sides. Snack 3 is where real contact
 * physics lives; here the point is layout and flow.
 */
import { curveFrame, headingOf, wrap } from "./sections";
import type { Conveyor } from "./types";

/** Belts without section fields (tests, older code) are straight. */
type Belt = Pick<Conveyor, "length" | "width" | "height" | "speed" | "position" | "rotationY"> &
  Partial<Pick<Conveyor, "kind" | "turn" | "radius">> & { id?: string };

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
  if (b.kind === "curve") {
    const at = onCurve(b, x, z);
    return Math.abs(at.r - b.radius!) <= b.width / 2 + EPS && at.progress >= -EPS && at.progress <= Math.abs(b.turn!) * DEG * b.radius! + EPS;
  }
  const { u, v } = toBelt(b, x, z);
  const along = b.kind === "transfer" ? b.width : b.length;
  return Math.abs(u) <= along / 2 + EPS && Math.abs(v) <= b.width / 2 + EPS;
}

/**
 * Where a point is on a curve: `r`, its distance from the curve's center, and `progress`,
 * how far round from the start it is, in meters at the middle of the belt. `angle` is the
 * heading from the center to the point.
 */
export function onCurve(b: Belt, x: number, z: number): { r: number; angle: number; progress: number } {
  const { side, startAngle } = curveFrame({ rotationY: b.rotationY, turn: b.turn! });
  const dx = x - b.position.x;
  const dz = z - b.position.z;
  const angle = headingOf(dx, dz);
  return { r: Math.hypot(dx, dz), angle, progress: side * wrap(angle - startAngle) * DEG * b.radius! };
}

/**
 * Carries a body along a curve or across a transfer for dt seconds; returns its velocity,
 * kept in case it rides off the end and falls.
 *
 * A curve turns like a rigid ring: every point on it goes round the center at the same
 * angular speed, speed / radius, so an item keeps its distance from the center (which
 * stepping along a tangent wouldn't: it would drift outward a little every step).
 *
 * A transfer carries an item in to the middle line, then pushes it out to the side the line
 * turns to. Run backwards, it does the opposite: in from that side to the middle, then back
 * the way the line came.
 */
export function carryOnSection(b: Belt, body: { x: number; z: number }, dt: number): { vx: number; vz: number } {
  if (b.kind === "curve") {
    const { side } = curveFrame({ rotationY: b.rotationY, turn: b.turn! });
    const { r, angle } = onCurve(b, body.x, body.z);
    const omega = (side * b.speed) / b.radius!; // radians per second, anticlockwise positive
    const a = angle * DEG + omega * dt;
    body.x = b.position.x + r * Math.cos(a);
    body.z = b.position.z - r * Math.sin(a);
    return { vx: -r * omega * Math.sin(a), vz: -r * omega * Math.cos(a) };
  }
  // Transfer: u along the way in, v across. The way out is -v for a left turn, +v for a right one.
  const out = b.turn! > 0 ? -1 : 1;
  const { u, v } = toBelt(b, body.x, body.z);
  const speed = Math.abs(b.speed);
  let nu = u;
  let nv = v;
  let du = 0;
  let dv = 0;
  if (b.speed >= 0) {
    if (u < -EPS) [nu, du] = [Math.min(0, u + speed * dt), speed];
    else [nv, dv] = [v + out * speed * dt, out * speed];
  } else if (v * out > EPS) [nv, dv] = [out > 0 ? Math.max(0, v - speed * dt) : Math.min(0, v + speed * dt), -out * speed];
  else [nu, du] = [u - speed * dt, -speed];
  const p = fromBelt(b, nu, nv);
  body.x = p.x;
  body.z = p.z;
  const t = b.rotationY * DEG;
  return { vx: du * Math.cos(t) + dv * Math.sin(t), vz: -du * Math.sin(t) + dv * Math.cos(t) };
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
  /** Its length along a belt, meters, for spacing in a queue. Defaults to 0.2. */
  size?: number;
  /** Set while it's held at a stop line (that line's id) or queued behind something held ("queue"). */
  heldAt?: string;
  /** Set when a station slides it somewhere, such as onto a main belt at a merge: target and speed. */
  guide?: { x: number; z: number; y: number; speed: number };
}

/**
 * A line across a belt where a station (a merger, a machine) may hold items. With `queue`,
 * items arriving behind a held item stop behind it, spaced by their sizes, instead of
 * passing through it: that's how a feeder belt backs up while it waits to merge.
 */
export interface StopLine {
  id: string;
  conveyorId: string;
  along: number;
  queue?: boolean;
}

export interface StepOptions {
  gates?: readonly Gate[];
  /** Asked once when a body crosses a gate: where should it go? */
  route?: (body: Body, gate: Gate) => Exit;
  stops?: readonly StopLine[];
  /** Asked every step while a body is at or crossing a stop line: hold it there? */
  hold?: (body: Body, stop: StopLine) => boolean;
  floorLimit?: number;
}

/** World position of a point given in a belt's frame: the inverse of toBelt. */
export function fromBelt(b: Belt, u: number, v: number): { x: number; z: number } {
  const t = b.rotationY * DEG;
  return { x: b.position.x + u * Math.cos(t) + v * Math.sin(t), z: b.position.z - u * Math.sin(t) + v * Math.cos(t) };
}

const QUEUE_GAP = 0.02; // meters between queued items

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
  const { gates = [], route, stops = [], hold, floorLimit = 2.95 } = typeof options === "number" ? { floorLimit: options } : options;
  const all = [...bodies];
  for (const body of all) {
    if (body.guide) {
      // Slid by a station: straight to the target at the guide's speed, then let go on whatever is there.
      const g = body.guide;
      const dx = g.x - body.x;
      const dz = g.z - body.z;
      const d = Math.hypot(dx, dz);
      body.y = g.y;
      body.vx = body.vy = body.vz = 0;
      if (d <= g.speed * dt) {
        body.x = g.x;
        body.z = g.z;
        body.guide = undefined;
      } else {
        body.x += (dx / d) * g.speed * dt;
        body.z += (dz / d) * g.speed * dt;
      }
      continue;
    }
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
    // Curves and transfers carry things their own way, and have no gates or stations.
    if (belt.kind === "curve" || belt.kind === "transfer") {
      body.divert = undefined;
      body.heldAt = undefined;
      const v = carryOnSection(belt, body, dt);
      body.vx = v.vx;
      body.vz = v.vz;
      body.x = Math.max(-floorLimit, Math.min(floorLimit, body.x));
      body.z = Math.max(-floorLimit, Math.min(floorLimit, body.z));
      continue;
    }
    // Sent sideways by a gate on this belt: keep sliding off. On another belt, ride it normally.
    const diverted = body.divert && body.divert.beltId === belt.id ? body.divert : undefined;
    if (!diverted) body.divert = undefined;
    const v = diverted ? divertVelocity(belt, diverted.side) : beltVelocity(belt);
    const start = toBelt(belt, body.x, body.z);
    const before = start.u;
    body.vx = v.vx;
    body.vz = v.vz;
    move(body, v.vx, v.vz, dt, floorLimit);
    if (diverted || belt.id === undefined) continue;
    let after = toBelt(belt, body.x, body.z).u;
    const dir = belt.speed >= 0 ? 1 : -1;

    // Stop lines: a station may hold the item at the line (it's put back exactly on it).
    let held: string | undefined;
    if (hold) {
      for (const stop of stops) {
        if (stop.conveyorId !== belt.id) continue;
        const g = stop.along - belt.length / 2;
        if (Math.min(before, after) <= g && g <= Math.max(before, after) && before !== after && hold(body, stop)) {
          after = g;
          held = stop.id;
          break;
        }
      }
    }
    // Queues: don't pass through something held at a queueing line, or queued behind one.
    if (!held) {
      const queueing = new Set(stops.filter((s) => s.queue && s.conveyorId === belt.id).map((s) => s.id));
      for (const other of all) {
        if (other === body || !other.heldAt || (other.heldAt !== "queue" && !queueing.has(other.heldAt))) continue;
        if (!isOver(belt, other.x, other.z) || Math.abs(other.y - body.y) > 1e-3) continue;
        const ou = toBelt(belt, other.x, other.z).u;
        const limit = ou - dir * ((body.size ?? 0.2) + (other.size ?? 0.2)) / 2 - dir * QUEUE_GAP;
        // Only what's ahead of it counts, and only if this step would take it past the limit.
        if ((ou - before) * dir > 0 && (after - limit) * dir > 0) {
          after = (before - limit) * dir > 0 ? before : limit;
          held = "queue";
        }
      }
    }
    body.heldAt = held;
    if (held) {
      const p = fromBelt(belt, after, start.v);
      body.x = p.x;
      body.z = p.z;
      body.vx = body.vz = 0;
      continue;
    }
    if (!route) continue;

    // Did this step carry it past a gate on this belt? Gates are measured from the belt's -u end.
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
