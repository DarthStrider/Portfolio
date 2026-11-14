/**
 * A solid world: the arm can't go through shapes, belts, bins or the floor.
 *
 * Everything the arm can hit is a box turned only about the vertical (an "oriented bounding
 * box"): shapes, straight belts, transfers, bins, and short pieces along a curve. The arm is
 * a handful of capsules (a segment with a radius: links and fingers) and points (the palm's
 * underside, the corners of what it's holding). A capsule hits a box if any point along its
 * segment is closer to the box than its radius.
 *
 * Pure math, no Three.js: tests/collision.test.ts. main.ts and the robots ask before every
 * move, and don't make the move if it would hit something that wasn't already touching.
 */
import { BIN_SIZE } from "../line/types";
import type { Conveyor } from "../conveyors/types";
import { curveFrame, dir } from "../conveyors/sections";

export type V3 = { x: number; y: number; z: number };

export interface Obstacle {
  /** What it is, for messages: "Crate 2", "the belt Takeaway". */
  name: string;
  /** The shape's id, for shapes: so the one being grabbed can be left out. */
  id?: string;
  center: V3;
  half: V3;
  /** Turn about the vertical, degrees, like rotationY. */
  yaw: number;
}

export interface Capsule {
  part: string;
  a: V3;
  b: V3;
  r: number;
}

const DEG = Math.PI / 180;
/** Touching isn't hitting: a hit has to go this far in (meters). */
export const MARGIN = 0.002;

/** Distance from a point to a box (0 inside it). */
export function pointToBox(p: V3, o: Obstacle): number {
  const dx = p.x - o.center.x;
  const dz = p.z - o.center.z;
  const c = Math.cos(o.yaw * DEG);
  const s = Math.sin(o.yaw * DEG);
  // Into the box's own frame: the inverse of turning by yaw about +y.
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ly = p.y - o.center.y;
  const ox = Math.max(0, Math.abs(lx) - o.half.x);
  const oy = Math.max(0, Math.abs(ly) - o.half.y);
  const oz = Math.max(0, Math.abs(lz) - o.half.z);
  return Math.hypot(ox, oy, oz);
}

/** Points along a capsule's segment, about a centimeter apart. */
function samples(c: Capsule): V3[] {
  const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y, c.b.z - c.a.z);
  const n = Math.max(2, Math.ceil(len / 0.01) + 1);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t, z: c.a.z + (c.b.z - c.a.z) * t };
  });
}

export function capsuleHits(c: Capsule, o: Obstacle): boolean {
  // Skip boxes nowhere near the segment.
  const reach = c.r + Math.hypot(o.half.x, o.half.y, o.half.z) + Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y, c.b.z - c.a.z);
  const mid = { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2, z: (c.a.z + c.b.z) / 2 };
  if (Math.hypot(mid.x - o.center.x, mid.y - o.center.y, mid.z - o.center.z) > reach) return false;
  return samples(c).some((p) => pointToBox(p, o) < c.r - MARGIN);
}

/** What the arm would hit, if anything: the first part and obstacle, or the floor. */
export function firstHit(
  capsules: readonly Capsule[],
  points: readonly { part: string; p: V3 }[],
  obstacles: readonly Obstacle[],
): { part: string; what: string } | null {
  for (const c of capsules) {
    if (Math.min(c.a.y, c.b.y) - c.r < -MARGIN) return { part: c.part, what: "the floor" };
    for (const o of obstacles) if (capsuleHits(c, o)) return { part: c.part, what: o.name };
  }
  for (const { part, p } of points) {
    if (p.y < -MARGIN) return { part, what: "the floor" };
    for (const o of obstacles) if (pointToBox(p, o) === 0 && insideBy(p, o) > MARGIN) return { part, what: o.name };
  }
  return null;
}

/** How far inside a box a point is (0 if outside). */
export function insideBy(p: V3, o: Obstacle): number {
  const dx = p.x - o.center.x;
  const dz = p.z - o.center.z;
  const c = Math.cos(o.yaw * DEG);
  const s = Math.sin(o.yaw * DEG);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ly = p.y - o.center.y;
  return Math.max(0, Math.min(o.half.x - Math.abs(lx), o.half.y - Math.abs(ly), o.half.z - Math.abs(lz)));
}

/** Points through a box (corners, edge middles, face middles, center), for what the claw holds. */
export function boxPoints(center: V3, half: V3, axes: [V3, V3, V3]): V3[] {
  const out: V3[] = [];
  for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) {
    out.push({
      x: center.x + axes[0].x * half.x * i + axes[1].x * half.y * j + axes[2].x * half.z * k,
      y: center.y + axes[0].y * half.x * i + axes[1].y * half.y * j + axes[2].y * half.z * k,
      z: center.z + axes[0].z * half.x * i + axes[1].z * half.y * j + axes[2].z * half.z * k,
    });
  }
  return out;
}

/** A belt as boxes, from the floor to its top: one for a straight or a transfer, several along a curve. */
export function beltBoxes(b: Pick<Conveyor, "name" | "kind" | "length" | "width" | "height" | "position" | "rotationY" | "turn" | "radius">): Obstacle[] {
  const name = `the belt ${b.name}`;
  const half = (len: number) => ({ x: len / 2, y: b.height / 2, z: b.width / 2 });
  if (b.kind !== "curve") {
    const len = b.kind === "transfer" ? b.width : b.length;
    return [{ name, center: { x: b.position.x, y: b.height / 2, z: b.position.z }, half: half(len), yaw: b.rotationY }];
  }
  const { side, startAngle } = curveFrame(b);
  const pieces = Math.max(3, Math.ceil(Math.abs(b.turn) / 15));
  const piece = (b.radius * Math.abs(b.turn) * DEG) / pieces;
  return Array.from({ length: pieces }, (_, i) => {
    const t = (i + 0.5) / pieces;
    const p = dir(startAngle + side * Math.abs(b.turn) * t);
    return {
      name,
      center: { x: b.position.x + p.x * b.radius, y: b.height / 2, z: b.position.z + p.z * b.radius },
      half: half(piece * 1.08), // a little overlap, so there's no gap between pieces
      yaw: b.rotationY + b.turn * t,
    };
  });
}

/** A bin: solid to its rim. */
export function binBox(b: { name: string; position: { x: number; z: number }; rotationY: number }): Obstacle {
  return {
    name: `the bin ${b.name}`,
    center: { x: b.position.x, y: BIN_SIZE.y / 2, z: b.position.z },
    half: { x: BIN_SIZE.x / 2, y: BIN_SIZE.y / 2, z: BIN_SIZE.z / 2 },
    yaw: b.rotationY,
  };
}
