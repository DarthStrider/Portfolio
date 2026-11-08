/**
 * Bins in the robot arm's scene (Snack 1): containers on the floor that hold the kinds of object
 * you choose (one or several: plates and brackets, say).
 *
 * - Catching: items that fall into a bin from a belt end or a splitter exit are stored in it,
 *   if they're one of its kinds and pass its accept conditions. A stored item is a shape with `binId`
 *   set: it's off the floor and out of sight until it's released.
 * - Feeding: a bin can release its items onto a belt (whenever there's room, or only when a
 *   machine on that belt needs one), or hand them straight to a joining machine.
 * - Stock: loading a bin with parts takes them from stock (a ledger line); unloading puts them
 *   back. A part caught from the line is taken from stock as it goes in. Once a shape's part has
 *   left stock (`stockTaken`), it's never taken again, whether it's joined, caught or released.
 */
import { ValidationError } from "./errors.ts";
import { isOwner, type Owner } from "./assembly.ts";
import { parseCondition, type Condition } from "./splitters.ts";
import { SHAPE_KINDS, type ShapeKind, type Size } from "./shapes.ts";

export type FeedMode = "steady" | "demand";
export type Feed =
  | { type: "none" }
  /** Onto a belt at `along` meters from its start: whenever there's room, or only when a machine on it needs one. */
  | { type: "belt"; conveyorId: string; along: number; mode: FeedMode }
  /** Straight into a joining machine's slot for this bin's kind. */
  | { type: "machine"; machineId: string };

export interface Bin {
  id: string;
  name: string;
  /** The kinds of object it holds: one or more. */
  holds: Owner[];
  /** Extra conditions an item must meet to be caught (all of them), like a splitter rule's. */
  accept: Condition[];
  capacity: number;
  position: { x: number; z: number };
  rotationY: number;
  feed: Feed;
  /** How many items are in it now. */
  count: number;
  createdAt: string;
  updatedAt: string;
}

export type NewBin = Omit<Bin, "id" | "count" | "createdAt" | "updatedAt">;
export type BinPatch = Partial<Pick<Bin, "name" | "holds" | "accept" | "capacity" | "position" | "rotationY" | "feed">>;

/** Bins are this size; the arm app draws them so. Meters. */
export const BIN_SIZE = { x: 0.5, y: 0.35, z: 0.4 } as const;
export const MAX_CAPACITY = 200;
export const MAX_KINDS = 10;

function parseHolds(v: unknown, problems: string[]): Owner[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_KINDS || !v.every(isOwner)) {
    problems.push(`holds must list 1 to ${MAX_KINDS} kinds of object: "part:<SKU>" or "kind:<box|cylinder|sphere|cone>"`);
    return null;
  }
  return [...new Set(v as Owner[])];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = Record<string, unknown>;
const asBody = (v: unknown): Body => (v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {});
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);

function parseFeed(v: unknown, problems: string[]): Feed | null {
  const f = asBody(v ?? { type: "none" });
  if (f.type === "none") return { type: "none" };
  if (f.type === "machine") {
    if (typeof f.machineId === "string" && UUID.test(f.machineId)) return { type: "machine", machineId: f.machineId };
    problems.push("feed.machineId must be a machine's id");
    return null;
  }
  if (f.type === "belt") {
    const along = num(f.along, 0, 4);
    const mode = (f.mode ?? "steady") as FeedMode;
    if (typeof f.conveyorId !== "string" || !UUID.test(f.conveyorId)) problems.push("feed.conveyorId must be a conveyor's id");
    if (along === null) problems.push("feed.along must be 0 to 4 m");
    if (mode !== "steady" && mode !== "demand") problems.push("feed.mode must be steady or demand");
    return problems.length ? null : { type: "belt", conveyorId: f.conveyorId as string, along: along!, mode };
  }
  problems.push('feed.type must be "none", "belt" or "machine"');
  return null;
}

function parseAccept(v: unknown, problems: string[]): Condition[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 5) {
    problems.push("accept must be a list of at most 5 conditions");
    return null;
  }
  const out = v.map((c, i) => parseCondition(c, `accept condition ${i + 1}`, problems));
  return out.every((c) => c !== null) ? (out as Condition[]) : null;
}

function position(v: unknown) {
  const p = asBody(v);
  const x = num(p.x, -3, 3);
  const z = num(p.z, -3, 3);
  return x === null || z === null ? null : { x, z };
}

export function parseNewBin(input: unknown): NewBin {
  const b = asBody(input);
  const problems: string[] = [];
  const name = typeof b.name === "string" && b.name.trim() && b.name.trim().length <= 40 ? b.name.trim() : null;
  if (!name) problems.push("name must be text up to 40 characters");
  const holds = parseHolds(b.holds, problems);
  const accept = parseAccept(b.accept, problems);
  const capacity = b.capacity === undefined ? 50 : Number.isInteger(b.capacity) ? num(b.capacity, 1, MAX_CAPACITY) : null;
  if (capacity === null) problems.push(`capacity must be a whole number from 1 to ${MAX_CAPACITY}`);
  const pos = position(b.position);
  if (!pos) problems.push("position must be { x, z } in meters, each from -3 to 3");
  const rotationY = num(b.rotationY ?? 0, -360, 360);
  if (rotationY === null) problems.push("rotationY must be degrees from -360 to 360");
  const feed = parseFeed(b.feed, problems);
  if (problems.length) throw new ValidationError(problems);
  return { name: name!, holds: holds!, accept: accept!, capacity: capacity!, position: pos!, rotationY: rotationY!, feed: feed! };
}

export function parseBinPatch(input: unknown): BinPatch {
  const b = asBody(input);
  const problems: string[] = [];
  const patch: BinPatch = {};
  if (b.name !== undefined) {
    if (typeof b.name === "string" && b.name.trim() && b.name.trim().length <= 40) patch.name = b.name.trim();
    else problems.push("name must be text up to 40 characters");
  }
  if (b.holds !== undefined) {
    const h = parseHolds(b.holds, problems);
    if (h) patch.holds = h;
  }
  if (b.accept !== undefined) {
    const a = parseAccept(b.accept, problems);
    if (a) patch.accept = a;
  }
  if (b.capacity !== undefined) {
    const c = Number.isInteger(b.capacity) ? num(b.capacity, 1, MAX_CAPACITY) : null;
    if (c === null) problems.push(`capacity must be a whole number from 1 to ${MAX_CAPACITY}`);
    else patch.capacity = c;
  }
  if (b.position !== undefined) {
    const p = position(b.position);
    if (p) patch.position = p;
    else problems.push("position must be { x, z } in meters, each from -3 to 3");
  }
  if (b.rotationY !== undefined) {
    const r = num(b.rotationY, -360, 360);
    if (r === null) problems.push("rotationY must be degrees from -360 to 360");
    else patch.rotationY = r;
  }
  if (b.feed !== undefined) {
    const f = parseFeed(b.feed, problems);
    if (f) patch.feed = f;
  }
  const unknown = Object.keys(b).filter((k) => !["name", "holds", "accept", "capacity", "position", "rotationY", "feed"].includes(k));
  if (unknown.length) problems.push(`can't change ${unknown.join(", ")}`);
  if (!problems.length && Object.keys(patch).length === 0) problems.push("nothing to change");
  if (problems.length) throw new ValidationError(problems);
  return patch;
}

/** What a loaded item looks like: the arm app sends it, since only it knows how parts are drawn. */
export interface ItemLook {
  kind: ShapeKind;
  size: Size;
  color: string;
  name: string;
}

/** One line of a load: so many of one kind, drawn like this. */
export interface LoadLine {
  owner: Owner;
  qty: number;
  look: ItemLook;
}

export const MAX_LINES = 20;

function parseLook(v: unknown, where: string, problems: string[]): ItemLook | null {
  const l = asBody(v);
  const size = asBody(l.size);
  const look = {
    kind: l.kind as ShapeKind,
    size: { x: num(size.x, 0.01, 2), y: num(size.y, 0.01, 2), z: num(size.z, 0.01, 2) },
    color: typeof l.color === "string" && /^#[0-9a-fA-F]{6}$/.test(l.color) ? l.color.toLowerCase() : null,
    name: typeof l.name === "string" && l.name.trim() && l.name.trim().length <= 40 ? l.name.trim() : null,
  };
  if (!SHAPE_KINDS.includes(look.kind) || Object.values(look.size).some((x) => x === null) || !look.color || !look.name) {
    problems.push(`${where}look must be { kind, size: { x, y, z } in meters (0.01-2), color: "#rrggbb", name }`);
    return null;
  }
  return look as ItemLook;
}

/**
 * A load is a list of lines: `{ lines: [{ owner, qty, look }, ...], addToHolds }`, or a single
 * line sent as `{ owner, qty, look }`. Lines for the same kind are added together.
 * With `addToHolds`, kinds the bin doesn't hold yet are added to its list; otherwise they're refused.
 */
export function parseLoad(input: unknown): { lines: LoadLine[]; addToHolds: boolean } {
  const b = asBody(input);
  const problems: string[] = [];
  const raw = Array.isArray(b.lines) ? b.lines : b.lines === undefined ? [b] : null;
  if (!raw || raw.length < 1 || raw.length > MAX_LINES) throw new ValidationError([`lines must be a list of 1 to ${MAX_LINES} items to load`]);
  const merged = new Map<Owner, LoadLine>();
  raw.forEach((r, i) => {
    const l = asBody(r);
    const where = raw.length > 1 ? `line ${i + 1}: ` : "";
    const qty = Number.isInteger(l.qty) ? num(l.qty, 1, MAX_CAPACITY) : null;
    if (qty === null) problems.push(`${where}qty must be a whole number from 1 to ${MAX_CAPACITY}`);
    if (!isOwner(l.owner)) problems.push(`${where}owner must be "part:<SKU>" or "kind:<box|cylinder|sphere|cone>"`);
    const look = parseLook(l.look, where, problems);
    if (qty === null || !isOwner(l.owner) || !look) return;
    const prev = merged.get(l.owner);
    merged.set(l.owner, { owner: l.owner, qty: (prev?.qty ?? 0) + qty, look: prev?.look ?? look });
  });
  if (problems.length) throw new ValidationError(problems);
  return { lines: [...merged.values()], addToHolds: b.addToHolds === true };
}

/** Parts a load takes from stock, by SKU. */
export function stockNeeded(lines: readonly LoadLine[]): { sku: string; qty: number }[] {
  return lines.filter((l) => l.owner.startsWith("part:")).map((l) => ({ sku: l.owner.slice(5), qty: l.qty })).sort((a, b) => (a.sku < b.sku ? -1 : 1));
}

export type BinResult<T = undefined> = { ok: true; value: T } | { ok: false; reason: "not_found" | "short" | "full" | "wrong_kind" | "not_in_bin" | "not_empty"; detail?: string };
