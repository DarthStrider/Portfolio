/** Validates a new part sent from the "Add part" form. */
import { isSku } from "./design.ts";
import { ValidationError } from "./errors.ts";
import type { Category, SeedPart } from "./types.ts";

export const CATEGORIES: readonly Category[] = ["extrusion", "plate", "fastener", "motor", "actuator", "controller", "gripper"];

const MAX_QTY = 100_000;

export function parseNewPart(input: unknown): SeedPart {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const text = (key: string, max: number, required = true): string => {
    const v = b[key];
    if (v === undefined && !required) return "";
    if (typeof v !== "string" || (required && v.trim() === "") || v.trim().length > max) {
      problems.push(`${key} must be text${required ? "" : " (optional)"} up to ${max} characters`);
      return "";
    }
    return v.trim();
  };
  const whole = (key: string): number => {
    const v = b[key] ?? 0;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_QTY) {
      problems.push(`${key} must be a whole number from 0 to ${MAX_QTY}`);
      return 0;
    }
    return v;
  };

  const sku = typeof b.sku === "string" ? b.sku.trim().toUpperCase() : "";
  if (!isSku(sku)) problems.push('sku must be 2-32 capital letters, digits or dashes, like "PL-400"');
  const name = text("name", 80);
  const category = b.category as Category;
  if (!CATEGORIES.includes(category)) problems.push(`category must be one of ${CATEGORIES.join(", ")}`);
  const unit = text("unit", 30);
  const location = text("location", 20, false);
  const onHand = whole("onHand");
  const reorderLevel = whole("reorderLevel");

  if (problems.length) throw new ValidationError(problems);
  return { sku, name, category, unit, onHand, reorderLevel, location };
}

/** What can change about an existing part. Stock changes go through receive and consume, so the ledger explains them. */
export type PartPatch = Partial<Pick<SeedPart, "name" | "category" | "location" | "reorderLevel">>;

export function parsePartPatch(input: unknown): PartPatch {
  const b = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const patch: PartPatch = {};
  if (b.name !== undefined) {
    if (typeof b.name !== "string" || b.name.trim() === "" || b.name.trim().length > 80) problems.push("name must be text up to 80 characters");
    else patch.name = b.name.trim();
  }
  if (b.category !== undefined) {
    if (!CATEGORIES.includes(b.category as Category)) problems.push(`category must be one of ${CATEGORIES.join(", ")}`);
    else patch.category = b.category as Category;
  }
  if (b.location !== undefined) {
    if (typeof b.location !== "string" || b.location.trim().length > 20) problems.push("location must be text up to 20 characters");
    else patch.location = b.location.trim();
  }
  if (b.reorderLevel !== undefined) {
    const v = b.reorderLevel;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_QTY) problems.push(`reorderLevel must be a whole number from 0 to ${MAX_QTY}`);
    else patch.reorderLevel = v;
  }
  const unknown = Object.keys(b).filter((k) => !["name", "category", "location", "reorderLevel"].includes(k));
  if (unknown.length) {
    const stock = unknown.filter((k) => ["onHand", "reserved", "available"].includes(k));
    problems.push(stock.length ? "stock changes go through receive and consume, so the ledger records them" : `can't change ${unknown.join(", ")}`);
  }
  if (!problems.length && Object.keys(patch).length === 0) problems.push("nothing to change: send name, category, location or reorderLevel");
  if (problems.length) throw new ValidationError(problems);
  return patch;
}
