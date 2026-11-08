import type { Line, Part } from "./types.ts";

/** Adds up lines with the same SKU and sorts by SKU (the order rows are locked in, to avoid deadlocks). */
export function mergeLines(lines: readonly Line[]): Line[] {
  const total = new Map<string, number>();
  for (const { sku, qty } of lines) total.set(sku, (total.get(sku) ?? 0) + qty);
  return [...total].map(([sku, qty]) => ({ sku, qty })).sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
}

/** Derived fields, computed the same way for every database. */
export function withDerived(p: Omit<Part, "available" | "low">): Part {
  const available = p.onHand - p.reserved;
  return { ...p, available, low: available <= p.reorderLevel };
}
