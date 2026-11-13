/**
 * What an automated robot decides, as pure functions: which items in its pick zone it takes,
 * where each one goes, and where exactly to put it down. No Three.js, so it's unit-tested
 * (tests/robots.test.ts); controller.ts does the moving.
 *
 * A robot plans in its own frame: the pick-and-place planner (src/pick/program.ts) was written
 * for the main arm, whose base is at the origin facing +x. For a robot standing at `position`
 * and turned `rotationY`, a world point is first moved and turned into that frame.
 */
import { fromBelt } from "../conveyors/transport";
import type { Conveyor } from "../conveyors/types";
import { BIN_SIZE, type Bin } from "../line/types";
import { matches, type Part } from "../splitters/rules";
import type { Shape } from "../shapes/types";
import type { Robot, Target } from "./types";

const DEG = Math.PI / 180;

/** World point → the robot's frame (its base at the origin, facing +x). */
export function toLocal(r: Pick<Robot, "position" | "rotationY">, p: { x: number; z: number }): { x: number; z: number } {
  const dx = p.x - r.position.x;
  const dz = p.z - r.position.z;
  const c = Math.cos(r.rotationY * DEG);
  const s = Math.sin(r.rotationY * DEG);
  // The inverse of turning anticlockwise (about +y) by rotationY.
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** The robot's frame → world: turn anticlockwise by rotationY, then move to its position. */
export function toWorld(r: Pick<Robot, "position" | "rotationY">, p: { x: number; z: number }): { x: number; z: number } {
  const c = Math.cos(r.rotationY * DEG);
  const s = Math.sin(r.rotationY * DEG);
  return { x: r.position.x + p.x * c + p.z * s, z: r.position.z - p.x * s + p.z * c };
}

export function inZone(r: Pick<Robot, "pick">, x: number, z: number): boolean {
  return Math.hypot(x - r.pick.x, z - r.pick.z) <= r.pick.radius;
}

/** Where an item goes: the first rule whose conditions all hold, else `otherwise`. rule is -1 for otherwise. */
export function decide(r: Pick<Robot, "rules" | "otherwise">, shape: Shape, part: Part | undefined): { target: Target; rule: number } | null {
  const i = r.rules.findIndex((rule) => rule.conditions.length > 0 && rule.conditions.every((c) => matches(c, shape, part)));
  if (i >= 0) return { target: r.rules[i].target, rule: i };
  return r.otherwise ? { target: r.otherwise, rule: -1 } : null;
}

/** A point to put an item down, and the height of what's there. */
export interface Drop {
  x: number;
  z: number;
  baseY: number;
}

/** Spots are filled in a square spiral, PITCH apart: the middle first, then the ring around it… */
export const PITCH = 0.16;
export const MAX_CELLS = 49; // a 7 × 7 square

/** The k-th cell of the spiral around a spot, as an offset in cells. */
export function spiralCell(k: number): { i: number; j: number } {
  if (k === 0) return { i: 0, j: 0 };
  let ring = 1;
  while ((2 * ring + 1) ** 2 <= k) ring++;
  const before = (2 * ring - 1) ** 2;
  const t = k - before; // 0 .. 8·ring − 1 round this ring
  const side = Math.floor(t / (2 * ring));
  const o = (t % (2 * ring)) - ring + 1;
  switch (side) {
    case 0: return { i: ring, j: o };
    case 1: return { i: -o, j: ring };
    case 2: return { i: -ring, j: -o };
    default: return { i: o, j: -ring };
  }
}

/** The first free cell around a spot: none of `taken` (other items, and drops on their way) within half a pitch… plus a bit. */
export function freeCell(spot: { x: number; z: number }, taken: readonly { x: number; z: number }[]): { x: number; z: number } | null {
  for (let k = 0; k < MAX_CELLS; k++) {
    const { i, j } = spiralCell(k);
    const p = { x: spot.x + i * PITCH, z: spot.z + j * PITCH };
    if (!taken.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < PITCH * 0.6)) return p;
  }
  return null;
}

/** On a belt: the point `along` from its start, on its middle line. */
export function beltPoint(belt: Conveyor, along: number): { x: number; z: number } {
  return fromBelt(belt, along - belt.length / 2, 0);
}

export type Where =
  | { ok: true; drop: Drop }
  /** Can't go now; try again later (the spot is full, the place on the belt isn't clear). */
  | { ok: false; wait: true; reason: string }
  /** Can't go at all (the belt or bin was deleted). */
  | { ok: false; wait: false; reason: string };

/**
 * Exactly where to put an item for a target. `items` are the other items' positions (to find a
 * free cell, or wait until the belt is clear); `pending` the drops already promised.
 */
export function placeFor(
  target: Target,
  world: { belts: readonly Conveyor[]; bins: readonly Bin[]; items: readonly { x: number; z: number }[]; pending: readonly { x: number; z: number }[] },
): Where {
  if (target.type === "spot") {
    const cell = freeCell(target, [...world.items, ...world.pending]);
    return cell ? { ok: true, drop: { ...cell, baseY: 0 } } : { ok: false, wait: true, reason: "the spot is full" };
  }
  if (target.type === "belt") {
    const belt = world.belts.find((b) => b.id === target.conveyorId);
    if (!belt) return { ok: false, wait: false, reason: "its belt was deleted" };
    const p = beltPoint(belt, Math.min(target.along, belt.length));
    const near = (q: { x: number; z: number }) => Math.hypot(q.x - p.x, q.z - p.z) < 0.2;
    if (world.items.some(near) || world.pending.some(near)) return { ok: false, wait: true, reason: `waiting for room on ${belt.name}` };
    return { ok: true, drop: { ...p, baseY: belt.height } };
  }
  const bin = world.bins.find((b) => b.id === target.binId);
  if (!bin) return { ok: false, wait: false, reason: "its bin was deleted" };
  // Let go just above the rim, over the middle.
  return { ok: true, drop: { x: bin.position.x, z: bin.position.z, baseY: BIN_SIZE.y } };
}

/** "the spot at (120, -40) cm", "Takeaway at 30 cm", "Bin A". */
export function describeTarget(t: Target, belts: readonly Conveyor[], bins: readonly Bin[]): string {
  if (t.type === "spot") return `the spot at (${Math.round(t.x * 100)}, ${Math.round(t.z * 100)}) cm`;
  if (t.type === "belt") return `${belts.find((b) => b.id === t.conveyorId)?.name ?? "a deleted belt"} at ${Math.round(t.along * 100)} cm`;
  return bins.find((b) => b.id === t.binId)?.name ?? "a deleted bin";
}
