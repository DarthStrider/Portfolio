/**
 * Conveyor lines: belts built one section at a time, each starting where the last one ends.
 * Pure math, no Three.js, so it's unit-tested (tests/sections.test.ts).
 *
 * Directions are headings in degrees, measured like rotationY: heading h points along
 * (cos h, -sin h) in world x, z, and a positive turn is to the left seen from above
 * (anticlockwise, the way Three.js turns about +y).
 *
 * Three kinds of section:
 * - straight: `position` is its center, `rotationY` the heading, `length` its length.
 * - curve:    a ring segment turning `turn` degrees (±45 or ±90) about `position`, with its
 *             middle at `radius` from it. `rotationY` is the heading in; `length` the arc.
 * - transfer: a square at a corner: in along `rotationY`, out `turn` degrees (±90) to the
 *             side. `position` is its center; it's as long as it is wide.
 */
import type { Conveyor, SectionKind } from "./types";

const DEG = Math.PI / 180;

/** A point on the floor and a heading: where a section starts or ends, and which way it runs. */
export interface Pose {
  x: number;
  z: number;
  heading: number;
}

/** What to add to the end of a line. */
export type SectionSpec =
  | { kind: "straight"; length: number }
  | { kind: "curve"; turn: number; radius: number }
  | { kind: "transfer"; turn: number };

/** The fields that decide where a section is and what shape it has. */
export type Section = Pick<Conveyor, "kind" | "length" | "width" | "position" | "rotationY" | "turn" | "radius">;
export type Placed = Pick<Conveyor, "kind" | "length" | "position" | "rotationY" | "turn" | "radius">;

/** The unit vector a heading points along. */
export function dir(heading: number): { x: number; z: number } {
  return { x: Math.cos(heading * DEG), z: -Math.sin(heading * DEG) };
}

/** The heading of a vector: the inverse of dir(). */
export function headingOf(x: number, z: number): number {
  return Math.atan2(-z, x) / DEG;
}

/** Degrees into [-180, 180). */
export function wrap(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

const add = (p: { x: number; z: number }, d: { x: number; z: number }, k: number) => ({ x: p.x + d.x * k, z: p.z + d.z * k });

/** A curve's geometry: which way it bends, and the angle (as a heading) from its center to its start. */
export function curveFrame(s: Pick<Section, "rotationY" | "turn">): { side: 1 | -1; startAngle: number } {
  const side = s.turn >= 0 ? 1 : -1;
  // The center is to the left of the start (side +1) or the right (-1); from the center, the
  // start is the opposite way: heading + 90·side + 180.
  return { side, startAngle: s.rotationY + 90 * side + 180 };
}

/** Where a section starts, and which way it's heading there. */
export function startOf(s: Section): Pose {
  if (s.kind === "curve") {
    const { startAngle } = curveFrame(s);
    return { ...add(s.position, dir(startAngle), s.radius), heading: s.rotationY };
  }
  const half = s.kind === "transfer" ? s.width / 2 : s.length / 2;
  return { ...add(s.position, dir(s.rotationY), -half), heading: s.rotationY };
}

/** Where a section ends, and which way it's heading there: where the next one starts. */
export function endOf(s: Section): Pose {
  if (s.kind === "curve") {
    const { side, startAngle } = curveFrame(s);
    return { ...add(s.position, dir(startAngle + side * Math.abs(s.turn)), s.radius), heading: s.rotationY + s.turn };
  }
  if (s.kind === "transfer") return { ...add(s.position, dir(s.rotationY + s.turn), s.width / 2), heading: s.rotationY + s.turn };
  return { ...add(s.position, dir(s.rotationY), s.length / 2), heading: s.rotationY };
}

/** Places a new section so it starts exactly at `start`. */
export function place(start: Pose, spec: SectionSpec, width: number): Placed {
  const heading = wrap(start.heading);
  if (spec.kind === "straight") {
    return { kind: "straight", length: spec.length, position: add(start, dir(heading), spec.length / 2), rotationY: heading, turn: 0, radius: 0 };
  }
  if (spec.kind === "transfer") {
    return { kind: "transfer", length: width, position: add(start, dir(heading), width / 2), rotationY: heading, turn: spec.turn, radius: 0 };
  }
  const side = spec.turn >= 0 ? 1 : -1;
  return {
    kind: "curve",
    length: spec.radius * Math.abs(spec.turn) * DEG,
    position: add(start, dir(heading + 90 * side), spec.radius),
    rotationY: heading,
    turn: spec.turn,
    radius: spec.radius,
  };
}

/** The smallest radius a curve of this width can have: half the width plus 5 cm (the API's rule). */
export function minRadius(width: number): number {
  return Math.max(0.1, width / 2 + 0.05);
}

/** A line's sections in order, or just the belt if it's on its own. */
export function lineOf<B extends Pick<Conveyor, "id" | "lineId" | "lineIndex">>(belts: readonly B[], belt: B): B[] {
  if (!belt.lineId) return [belt];
  return belts.filter((b) => b.lineId === belt.lineId).sort((a, b) => a.lineIndex - b.lineIndex);
}

/** Dragging the end of a line out: how long the new straight is, from the end to the mouse. */
export function dragLength(end: Pose, at: { x: number; z: number }, [min, max] = [0.3, 4], step = 0.05): number {
  const d = dir(end.heading);
  const along = (at.x - end.x) * d.x + (at.z - end.z) * d.z;
  return Math.min(max, Math.max(min, Math.round(along / step) * step));
}

/** Moves a section by (dx, dz): every kind's position is a point, so it just shifts. */
export function shifted<S extends Section>(s: S, dx: number, dz: number): Pick<Conveyor, "position"> {
  return { position: { x: s.position.x + dx, z: s.position.z + dz } };
}

/**
 * Turns a section about a pivot by `deg`, as part of turning a whole line rigidly: its
 * position swings round the pivot and its heading turns by the same amount. A curve's center
 * and a transfer's middle are points like a straight's center, so one rule covers all three.
 */
export function turnedAbout<S extends Section>(s: S, pivot: { x: number; z: number }, deg: number): Pick<Conveyor, "position" | "rotationY"> {
  const c = Math.cos(deg * DEG);
  const k = Math.sin(deg * DEG);
  const dx = s.position.x - pivot.x;
  const dz = s.position.z - pivot.z;
  // An anticlockwise turn seen from above (about +y) takes (x, z) to (x·c + z·k, -x·k + z·c).
  return { position: { x: pivot.x + dx * c + dz * k, z: pivot.z - dx * k + dz * c }, rotationY: wrap(s.rotationY + deg) };
}

/**
 * Deleting section `index` of a line: what the sections left need. Those before it stay;
 * those after it become a line of their own, numbered from 0. A piece of one section isn't a
 * line any more, so it goes back to being a belt on its own.
 */
export function afterRemoving<B extends Pick<Conveyor, "id" | "lineId" | "lineIndex">>(line: readonly B[], index: number, newLineId: () => string): { id: string; lineId: string | null; lineIndex: number }[] {
  const before = line.slice(0, index);
  const after = line.slice(index + 1);
  const out: { id: string; lineId: string | null; lineIndex: number }[] = [];
  if (before.length === 1) out.push({ id: before[0].id, lineId: null, lineIndex: 0 });
  if (after.length === 1) out.push({ id: after[0].id, lineId: null, lineIndex: 0 });
  else if (after.length > 1) {
    const id = newLineId();
    after.forEach((b, i) => out.push({ id: b.id, lineId: id, lineIndex: i }));
  }
  return out;
}

export const KIND_LABEL: Record<SectionKind, string> = { straight: "Straight", curve: "Curve", transfer: "Transfer" };

/** "Curve 90° left", "Transfer 90° right", "Straight 1.5 m". */
export function describe(s: Pick<Section, "kind" | "turn" | "length">): string {
  if (s.kind === "straight") return `Straight ${Math.round(s.length * 100)} cm`;
  return `${KIND_LABEL[s.kind]} ${Math.abs(s.turn)}° ${s.turn > 0 ? "left" : "right"}`;
}
