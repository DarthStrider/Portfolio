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
