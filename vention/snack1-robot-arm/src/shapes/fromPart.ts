/**
 * Turns an inventory part into a shape for the scene. The inventory doesn't store
 * dimensions, so they're read from the SKU where it carries them (BAR-4040 is a 40 x 40 mm
 * profile, PL-200 a 200 mm plate, LA-300 a 300 mm stroke) and otherwise come from a
 * typical size for the category. Pure, so it's unit-tested.
 */
import type { NewShape, ShapeKind, Size } from "./types";

/** The fields of an inventory part this needs (snack5-inventory/api/src/domain/types.ts). */
export interface InventoryPart {
  sku: string;
  name: string;
  category: string;
  unit: string;
  onHand: number;
  available: number;
}

export interface PartLook {
  kind: ShapeKind;
  size: Size;
  color: string;
}

/** A cut piece, not a whole 3 m bar, so it fits on the arm's floor. */
export const EXTRUSION_PIECE_M = 0.5;

const mm = (n: number) => n / 1000;

/** The first run of digits in a SKU, e.g. 4040 in BAR-4040-CLR. */
function digits(sku: string): string | null {
  return /(\d+)/.exec(sku)?.[1] ?? null;
}

export function lookFor(part: Pick<InventoryPart, "sku" | "category">): PartLook {
  const d = digits(part.sku);
  switch (part.category) {
    case "extrusion": {
      // BAR-2020 / BAR-4040 / BAR-4080: width and height of the profile in mm.
      const w = d && d.length === 4 ? Number(d.slice(0, 2)) : 40;
      const h = d && d.length === 4 ? Number(d.slice(2)) : 40;
      const black = /-BLK\b/.test(part.sku);
      // Lying on the floor along x, taller side up.
      return { kind: "box", size: { x: EXTRUSION_PIECE_M, y: mm(Math.max(w, h)), z: mm(Math.min(w, h)) }, color: black ? "#2b2f36" : "#c3c9d1" };
    }
    case "plate": {
      if (/^BR-/.test(part.sku)) return { kind: "box", size: { x: 0.04, y: 0.04, z: 0.04 }, color: "#9aa3af" }; // corner bracket
      const side = d ? Math.min(Math.max(Number(d), 50), 1000) : 150;
      return { kind: "box", size: { x: mm(side), y: 0.01, z: mm(side) }, color: "#9aa3af" };
    }
    case "fastener":
      return { kind: "box", size: { x: 0.08, y: 0.04, z: 0.06 }, color: "#b7791f" }; // a small box of bolts
    case "motor":
      return { kind: "cylinder", size: { x: 0.09, y: 0.14, z: 0.09 }, color: "#1f2937" };
    case "actuator": {
      const stroke = d ? Math.min(Number(d), 1500) : 300;
      return { kind: "box", size: { x: mm(stroke) + 0.1, y: 0.06, z: 0.06 }, color: "#3b82f6" };
    }
    case "controller":
      return { kind: "box", size: { x: 0.2, y: 0.08, z: 0.15 }, color: "#334155" };
    case "gripper":
      return { kind: "box", size: { x: 0.12, y: 0.08, z: 0.06 }, color: "#f59e0b" };
    default:
      return { kind: "box", size: { x: 0.1, y: 0.1, z: 0.1 }, color: "#94a3b8" };
  }
}

/** A new shape for `part` at (x, z), named after it and linked to it by SKU. */
export function shapeForPart(part: InventoryPart, x: number, z: number, look: PartLook = lookFor(part), rotationY = 0): NewShape {
  return { name: part.name.slice(0, 40), ...look, position: { x, z }, rotationY, sku: part.sku };
}

/** How many shapes in the scene stand for each SKU. */
export function placedBySku(shapes: readonly { sku: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of shapes) if (s.sku) counts.set(s.sku, (counts.get(s.sku) ?? 0) + 1);
  return counts;
}
