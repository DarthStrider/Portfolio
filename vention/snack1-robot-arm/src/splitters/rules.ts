/**
 * Which way does a splitter send an item? Pure functions over a shape and the inventory
 * part it stands for, so they're unit-tested and the panel can preview every decision.
 *
 * Part fields are looked up from the latest inventory list when the item reaches the gate,
 * so changing a part in the database (its category, location or stock) changes where its
 * items go on the next pass, without touching the splitter.
 */
import type { Shape } from "../shapes/types";
import type { InventoryPart } from "../shapes/fromPart";
import type { Condition, Exit, Field, Splitter } from "./types";

export type Part = InventoryPart & { location?: string; onHand: number; available: number; low?: boolean; reorderLevel?: number };

/** The value of one field for a shape, or undefined when it doesn't apply (part fields for a plain shape). */
export function fieldValue(field: Field, shape: Shape, part: Part | undefined): string | number | boolean | undefined {
  switch (field) {
    case "kind": return shape.kind;
    case "color": return shape.color;
    case "name": return shape.name;
    case "sku": return shape.sku ?? undefined;
    case "width": return shape.size.x;
    case "height": return shape.size.y;
    case "depth": return shape.size.z;
    case "isPart": return shape.sku !== null;
    case "part.category": return part?.category;
    case "part.location": return part?.location;
    case "part.name": return part?.name;
    case "part.onHand": return part?.onHand;
    case "part.available": return part?.available;
    case "part.low": return part ? (part.low ?? part.available <= (part.reorderLevel ?? 0)) : undefined;
  }
}

/** Sizes are stored in meters but typed in centimeters; compare to the nearest millimeter so 20 cm equals 0.2 m. */
const close = (a: number, b: number) => Math.abs(a - b) < 0.0005;

export function matches(c: Condition, shape: Shape, part: Part | undefined): boolean {
  const v = fieldValue(c.field, shape, part);
  // A condition about a part never matches a shape that isn't one, even "is not".
  if (v === undefined) return false;
  if (typeof v === "number") {
    const x = Number(c.value);
    switch (c.op) {
      case "eq": return close(v, x);
      case "ne": return !close(v, x);
      case "lt": return v < x && !close(v, x);
      case "lte": return v < x || close(v, x);
      case "gt": return v > x && !close(v, x);
      case "gte": return v > x || close(v, x);
      default: return false;
    }
  }
  if (typeof v === "boolean") return c.op === "eq" && v === c.value;
  const text = v.toLowerCase();
  switch (c.op) {
    case "eq": return text === String(c.value).toLowerCase();
    case "ne": return text !== String(c.value).toLowerCase();
    case "contains": return text.includes(String(c.value).toLowerCase());
    case "in": return Array.isArray(c.value) && c.value.some((s) => s.toLowerCase() === text);
    default: return false;
  }
}

/** The first rule whose conditions all hold decides; otherwise the splitter's default. rule is -1 for the default. */
export function route(splitter: Pick<Splitter, "rules" | "otherwise">, shape: Shape, part: Part | undefined): { exit: Exit; rule: number } {
  const i = splitter.rules.findIndex((r) => r.conditions.length > 0 && r.conditions.every((c) => matches(c, shape, part)));
  return i >= 0 ? { exit: splitter.rules[i].exit, rule: i } : { exit: splitter.otherwise, rule: -1 };
}
