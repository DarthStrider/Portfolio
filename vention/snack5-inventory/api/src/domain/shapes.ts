/**
 * Simple 3D shapes placed in the robot arm's scene (Snack 1). They're stored with the
 * inventory, so any API replica, and any browser, sees the same scene.
 *
 * Units are meters and degrees. The floor is y = 0; a shape always rests on it, so only
 * x and z are stored and its height decides where its center is.
 */
import { isSku } from "./design.ts";
import { ValidationError } from "./errors.ts";
import type { Attachment } from "./assembly.ts";

export type ShapeKind = "box" | "cylinder" | "sphere" | "cone";
export const SHAPE_KINDS: readonly ShapeKind[] = ["box", "cylinder", "sphere", "cone"];

/**
 * size.x, size.y, size.z are the bounding box: width, height, depth.
 * A cylinder or cone is round, so its depth equals its width (the diameter);
 * a sphere's three sizes are all its diameter. parseNewShape enforces both.
 */
export interface Size {
  x: number;
  y: number;
  z: number;
}

export interface Shape {
  id: string;
  name: string;
  kind: ShapeKind;
  size: Size;
  /** "#rrggbb" */
  color: string;
  /** Floor position of the shape's center. */
  position: { x: number; z: number };
  /** Turn about the vertical axis, in degrees. */
  rotationY: number;
  /** The inventory part this shape stands for, or null for a plain shape. */
  sku: string | null;
  /** Set once the shape has been joined onto another (an assembly): it then moves with that shape. */
  attachedTo: string | null;
  /** Where it sits on that shape, in that shape's frame. Null unless attached. */
  attach: Attachment | null;
  createdAt: string;
  updatedAt: string;
}

/** New shapes stand alone; only an assembly attaches one shape to another. */
export type NewShape = Omit<Shape, "id" | "createdAt" | "updatedAt" | "attachedTo" | "attach">;
/** What can change after a shape is placed: move it, turn it, rename or recolor it. */
export type ShapePatch = Partial<Pick<Shape, "name" | "color" | "position" | "rotationY">>;

export const LIMITS = {
  minSize: 0.01, // 1 cm
  maxSize: 2, // 2 m
  floor: 3, // positions within ±3 m of the arm's base
};

const COLOR = /^#[0-9a-f]{6}$/;

type Body = Record<string, unknown>;

function asBody(input: unknown): Body {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Body) : {};
}

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function readPosition(v: unknown, problems: string[]): { x: number; z: number } | undefined {
  const p = asBody(v);
  const x = num(p.x, -LIMITS.floor, LIMITS.floor);
  const z = num(p.z, -LIMITS.floor, LIMITS.floor);
  if (x === null || z === null) {
    problems.push(`position must be { x, z } in meters, each from -${LIMITS.floor} to ${LIMITS.floor}`);
    return undefined;
  }
  return { x, z };
}

function readName(v: unknown, problems: string[]): string | undefined {
  if (typeof v !== "string" || v.trim() === "" || v.trim().length > 40) {
    problems.push("name must be text up to 40 characters");
    return undefined;
  }
  return v.trim();
}

function readColor(v: unknown, problems: string[]): string | undefined {
  const c = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!COLOR.test(c)) {
    problems.push('color must be a hex color like "#3b82f6"');
    return undefined;
  }
  return c;
}

function readRotation(v: unknown, problems: string[]): number | undefined {
  const r = num(v, -360, 360);
  if (r === null) {
    problems.push("rotationY must be degrees from -360 to 360");
    return undefined;
  }
  return r;
}

/** Validates a new shape, collecting every problem, and normalizes round shapes' sizes. */
export function parseNewShape(input: unknown): NewShape {
  const b = asBody(input);
  const problems: string[] = [];

  const kind = b.kind as ShapeKind;
  if (!SHAPE_KINDS.includes(kind)) problems.push(`kind must be one of ${SHAPE_KINDS.join(", ")}`);

  const s = asBody(b.size);
  const dim = (v: unknown) => num(v, LIMITS.minSize, LIMITS.maxSize);
  let size: Size | undefined;
  const range = `from ${LIMITS.minSize} to ${LIMITS.maxSize} m`;
  if (kind === "sphere") {
    const d = dim(s.x);
    if (d === null) problems.push(`size.x (diameter) must be ${range}`);
    else size = { x: d, y: d, z: d };
  } else if (kind === "cylinder" || kind === "cone") {
    const d = dim(s.x);
    const h = dim(s.y);
    if (d === null) problems.push(`size.x (diameter) must be ${range}`);
    if (h === null) problems.push(`size.y (height) must be ${range}`);
    if (d !== null && h !== null) size = { x: d, y: h, z: d };
  } else if (kind === "box") {
    const [x, y, z] = [dim(s.x), dim(s.y), dim(s.z)];
    if (x === null || y === null || z === null) problems.push(`size.x, size.y and size.z (width, height, depth) must each be ${range}`);
    else size = { x, y, z };
  }

  const name = readName(b.name, problems);
  const color = readColor(b.color, problems);
  const position = readPosition(b.position, problems);
  const rotationY = b.rotationY === undefined ? 0 : readRotation(b.rotationY, problems);
  let sku: string | null = null;
  if (b.sku !== undefined && b.sku !== null) {
    if (isSku(b.sku)) sku = b.sku;
    else problems.push('sku must be an inventory SKU like "PL-200", or left out for a plain shape');
  }

  if (problems.length) throw new ValidationError(problems);
  return { name: name!, kind, size: size!, color: color!, position: position!, rotationY: rotationY!, sku };
}

/** Validates a change to a placed shape. At least one field must be given. */
export function parseShapePatch(input: unknown): ShapePatch {
  const b = asBody(input);
  const problems: string[] = [];
  const patch: ShapePatch = {};
  if (b.name !== undefined) patch.name = readName(b.name, problems);
  if (b.color !== undefined) patch.color = readColor(b.color, problems);
  if (b.position !== undefined) patch.position = readPosition(b.position, problems);
  if (b.rotationY !== undefined) patch.rotationY = readRotation(b.rotationY, problems);
  const unknown = Object.keys(b).filter((k) => !["name", "color", "position", "rotationY"].includes(k));
  if (unknown.length) problems.push(`can't change ${unknown.join(", ")}; delete and re-create the shape instead`);
  if (!problems.length && Object.keys(patch).length === 0) problems.push("nothing to change: send name, color, position or rotationY");
  if (problems.length) throw new ValidationError(problems);
  return patch;
}
