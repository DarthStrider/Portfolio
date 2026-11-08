/**
 * Line equipment for the robot arm's scene (Snack 1), beyond belts and splitters:
 *
 * - Connection points: named spots on a kind of object (an inventory part, or a plain shape
 *   kind) where it can be joined to something else. Positions are fractions of the object's
 *   size, -0.5..0.5 on each axis from its center, so they fit every size of that kind.
 * - Mergers: where belts come together. "side" brings one feeder belt onto a main belt at a
 *   point; "y" brings two feeders into the start of an output belt.
 * - Machines: stations on a belt that hold one item of each of two kinds and join them at
 *   their connection points.
 * - Assemblies: the record of a join. Making one uses up the parts from stock, all or nothing.
 */
import { isSku } from "./design.ts";
import { ValidationError } from "./errors.ts";
import { SHAPE_KINDS, type ShapeKind } from "./shapes.ts";

type Body = Record<string, unknown>;
const asBody = (v: unknown): Body => (v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() !== "" && v.trim().length <= max ? v.trim() : null);

/** Sets patch[key] when the parsed value is valid, or records the problem. */
function setter<P extends object>(patch: P, problems: string[]) {
  return <K extends keyof P>(key: K, value: P[K] | null, message: string) => {
    if (value === null) problems.push(message);
    else patch[key] = value;
  };
}

function unknownKeys(b: Body, allowed: string[], problems: string[], hint: string) {
  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  if (extra.length) problems.push(`can't change ${extra.join(", ")}; ${hint}`);
}

// ---------------------------------------------------------------------------------------------
// Connection points
// ---------------------------------------------------------------------------------------------

/** "part:PL-200" for an inventory part, "kind:box" for plain shapes of that kind. */
export type Owner = `part:${string}` | `kind:${ShapeKind}`;

export interface ConnectionPoint {
  name: string;
  /** Fractions of the object's size from its center, each -0.5..0.5. y = 0.5 is the top. */
  x: number;
  y: number;
  z: number;
}

export interface Connectors {
  owner: Owner;
  points: ConnectionPoint[];
  updatedAt: string;
}

/** What every kind of object has until someone defines its points. */
export const DEFAULT_POINTS: readonly ConnectionPoint[] = [
  { name: "top", x: 0, y: 0.5, z: 0 },
  { name: "bottom", x: 0, y: -0.5, z: 0 },
];
export const MAX_POINTS = 12;

export function isOwner(v: unknown): v is Owner {
  if (typeof v !== "string") return false;
  if (v.startsWith("part:")) return isSku(v.slice(5));
  return v.startsWith("kind:") && SHAPE_KINDS.includes(v.slice(5) as ShapeKind);
}

export function parsePoints(input: unknown): ConnectionPoint[] {
  const b = asBody(input);
  const problems: string[] = [];
  const list = b.points;
  if (!Array.isArray(list) || list.length > MAX_POINTS) throw new ValidationError([`points must be a list of at most ${MAX_POINTS}`]);
  const points: ConnectionPoint[] = [];
  list.forEach((raw, i) => {
    const p = asBody(raw);
    const name = typeof p.name === "string" && /^[\w -]{1,20}$/.test(p.name.trim()) ? p.name.trim() : null;
    if (!name) problems.push(`point ${i + 1}: name must be 1-20 letters, digits, spaces, dashes or underscores`);
    const [x, y, z] = [num(p.x, -0.5, 0.5), num(p.y, -0.5, 0.5), num(p.z, -0.5, 0.5)];
    if (x === null || y === null || z === null) problems.push(`point ${i + 1}: x, y and z must be fractions of the size, -0.5 to 0.5`);
    if (name && points.some((q) => q.name.toLowerCase() === name.toLowerCase())) problems.push(`point ${i + 1}: there's already a point called ${name}`);
    if (name && x !== null && y !== null && z !== null) points.push({ name, x, y, z });
  });
  if (problems.length) throw new ValidationError(problems);
  return points;
}

// ---------------------------------------------------------------------------------------------
// Mergers
// ---------------------------------------------------------------------------------------------

export const MERGER_KINDS = ["side", "y"] as const;
export type MergerKind = (typeof MERGER_KINDS)[number];
export const PRIORITIES = ["main", "feeders", "alternate"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Merger {
  id: string;
  name: string;
  kind: MergerKind;
  /** The belt items merge onto: the main belt ("side") or the output belt ("y"). */
  conveyorId: string;
  /** Where on that belt they merge, meters from its start. Always 0 for "y". */
  along: number;
  /** One feeder for "side", two for "y". */
  feederIds: string[];
  /** Who goes first when both sides have an item waiting. */
  priority: Priority;
  /** Clear space needed on the belt at the merge point before an item may join, meters. */
  gap: number;
  createdAt: string;
  updatedAt: string;
}

export type NewMerger = Omit<Merger, "id" | "createdAt" | "updatedAt">;
export type MergerPatch = Partial<Pick<Merger, "name" | "along" | "priority" | "gap">>;

export function parseNewMerger(input: unknown): NewMerger {
  const b = asBody(input);
  const problems: string[] = [];
  const name = text(b.name, 40);
  if (!name) problems.push("name must be text up to 40 characters");
  const kind = b.kind as MergerKind;
  if (!MERGER_KINDS.includes(kind)) problems.push("kind must be side or y");
  if (!isUuid(b.conveyorId)) problems.push("conveyorId must be a conveyor's id");
  const feeders = Array.isArray(b.feederIds) && b.feederIds.every(isUuid) ? (b.feederIds as string[]) : null;
  const want = kind === "y" ? 2 : 1;
  if (!feeders || feeders.length !== want) problems.push(`feederIds must list ${want} conveyor id${want > 1 ? "s" : ""} for a ${kind ?? "side"} merger`);
  else if (new Set([...feeders, b.conveyorId]).size !== feeders.length + 1) problems.push("the feeders and the main belt must be different belts");
  const along = kind === "y" ? 0 : num(b.along, 0, 4);
  if (along === null) problems.push("along must be meters from the start of the belt, 0 to 4");
  const priority = (b.priority ?? (kind === "y" ? "alternate" : "main")) as Priority;
  if (!PRIORITIES.includes(priority)) problems.push("priority must be main, feeders or alternate");
  const gap = num(b.gap ?? 0.3, 0.05, 1);
  if (gap === null) problems.push("gap must be 0.05 to 1 m");
  if (problems.length) throw new ValidationError(problems);
  return { name: name!, kind, conveyorId: b.conveyorId as string, along: along!, feederIds: feeders!, priority, gap: gap! };
}

export function parseMergerPatch(input: unknown): MergerPatch {
  const b = asBody(input);
  const problems: string[] = [];
  const patch: MergerPatch = {};
  const set = setter(patch, problems);
  if (b.name !== undefined) set("name", text(b.name, 40), "name must be text up to 40 characters");
  if (b.along !== undefined) set("along", num(b.along, 0, 4), "along must be 0 to 4 m");
  if (b.priority !== undefined) set("priority", PRIORITIES.includes(b.priority as Priority) ? (b.priority as Priority) : null, "priority must be main, feeders or alternate");
  if (b.gap !== undefined) set("gap", num(b.gap, 0.05, 1), "gap must be 0.05 to 1 m");
  unknownKeys(b, ["name", "along", "priority", "gap"], problems, "delete and re-create the merger to change its belts or kind");
  if (!problems.length && Object.keys(patch).length === 0) problems.push("nothing to change: send name, along, priority or gap");
  if (problems.length) throw new ValidationError(problems);
  return patch;
}

// ---------------------------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------------------------

/** What a machine takes in one of its two slots, and at which connection point it joins it. */
export interface Slot {
  owner: Owner;
  point: string;
}

export interface Machine {
  id: string;
  name: string;
  conveyorId: string;
  along: number;
  /** The item that stays on the belt; the other one is joined onto it. */
  base: Slot;
  attach: Slot;
  /** How long joining takes, seconds. */
  cycleSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export type NewMachine = Omit<Machine, "id" | "createdAt" | "updatedAt">;
export type MachinePatch = Partial<Pick<Machine, "name" | "along" | "base" | "attach" | "cycleSeconds">>;

function slot(v: unknown, label: string, problems: string[]): Slot | null {
  const s = asBody(v);
  const ok = isOwner(s.owner);
  if (!ok) problems.push(`${label}.owner must be "part:<SKU>" or "kind:<box|cylinder|sphere|cone>"`);
  const point = text(s.point, 20);
  if (!point) problems.push(`${label}.point must be the name of a connection point`);
  return ok && point ? { owner: s.owner as Owner, point } : null;
}

export function parseNewMachine(input: unknown): NewMachine {
  const b = asBody(input);
  const problems: string[] = [];
  const name = text(b.name, 40);
  if (!name) problems.push("name must be text up to 40 characters");
  if (!isUuid(b.conveyorId)) problems.push("conveyorId must be a conveyor's id");
  const along = num(b.along, 0, 4);
  if (along === null) problems.push("along must be meters from the start of the belt, 0 to 4");
  const base = slot(b.base, "base", problems);
  const attach = slot(b.attach, "attach", problems);
  const cycle = num(b.cycleSeconds ?? 1.5, 0.2, 10);
  if (cycle === null) problems.push("cycleSeconds must be 0.2 to 10");
  if (problems.length) throw new ValidationError(problems);
  return { name: name!, conveyorId: b.conveyorId as string, along: along!, base: base!, attach: attach!, cycleSeconds: cycle! };
}

export function parseMachinePatch(input: unknown): MachinePatch {
  const b = asBody(input);
  const problems: string[] = [];
  const patch: MachinePatch = {};
  const set = setter(patch, problems);
  if (b.name !== undefined) set("name", text(b.name, 40), "name must be text up to 40 characters");
  if (b.along !== undefined) set("along", num(b.along, 0, 4), "along must be 0 to 4 m");
  if (b.cycleSeconds !== undefined) set("cycleSeconds", num(b.cycleSeconds, 0.2, 10), "cycleSeconds must be 0.2 to 10");
  // slot() reports its own problems.
  if (b.base !== undefined) {
    const s = slot(b.base, "base", problems);
    if (s) patch.base = s;
  }
  if (b.attach !== undefined) {
    const s = slot(b.attach, "attach", problems);
    if (s) patch.attach = s;
  }
  unknownKeys(b, ["name", "along", "base", "attach", "cycleSeconds"], problems, "delete and re-create the machine to move it to another belt");
  if (!problems.length && Object.keys(patch).length === 0) problems.push("nothing to change: send name, along, base, attach or cycleSeconds");
  if (problems.length) throw new ValidationError(problems);
  return patch;
}

// ---------------------------------------------------------------------------------------------
// Assemblies
// ---------------------------------------------------------------------------------------------

/** Where the attached shape sits on its base: its center, in the base's own frame (meters), and its turn relative to the base. */
export interface Attachment {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

export interface NewAssembly {
  name: string;
  baseShapeId: string;
  attachedShapeId: string;
  basePoint: string;
  attachedPoint: string;
  attachment: Attachment;
}

export interface Assembly extends Omit<NewAssembly, "attachment"> {
  id: string;
  /** Parts used up from stock by this join (a part is used once, the first time it's joined). */
  consumed: { sku: string; qty: number }[];
  createdAt: string;
}

export type AssembleResult =
  | { ok: true; assembly: Assembly }
  | { ok: false; reason: "not_found" | "already_attached" | "cycle" | "short"; shortages?: { sku: string; need: number; available: number }[] };

export function parseNewAssembly(input: unknown): NewAssembly {
  const b = asBody(input);
  const problems: string[] = [];
  const name = text(b.name ?? "Assembly", 40);
  if (!name) problems.push("name must be text up to 40 characters");
  if (!isUuid(b.baseShapeId)) problems.push("baseShapeId must be a shape's id");
  if (!isUuid(b.attachedShapeId)) problems.push("attachedShapeId must be a shape's id");
  if (isUuid(b.baseShapeId) && b.baseShapeId === b.attachedShapeId) problems.push("a shape can't be joined to itself");
  const basePoint = text(b.basePoint, 20);
  const attachedPoint = text(b.attachedPoint, 20);
  if (!basePoint || !attachedPoint) problems.push("basePoint and attachedPoint must name connection points");
  const a = asBody(b.attachment);
  const attachment = { x: num(a.x, -4, 4), y: num(a.y, -4, 4), z: num(a.z, -4, 4), rotationY: num(a.rotationY ?? 0, -360, 360) };
  if (Object.values(attachment).some((v) => v === null)) problems.push("attachment must be { x, y, z } in meters (±4) and rotationY in degrees");
  if (problems.length) throw new ValidationError(problems);
  return {
    name: name!, baseShapeId: b.baseShapeId as string, attachedShapeId: b.attachedShapeId as string,
    basePoint: basePoint!, attachedPoint: attachedPoint!, attachment: attachment as Attachment,
  };
}
