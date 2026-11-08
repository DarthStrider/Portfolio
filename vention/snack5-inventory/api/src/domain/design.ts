/**
 * Turns a machine design, in the same shape Snack 4's quote calculator takes, into the
 * stock it needs.
 *
 * Most items map one to one (4 × PL-200 plates need 4 plates). Two don't:
 * - fasteners are stocked in packs of 50, so 120 bolts need 3 packs;
 * - extrusions are cut from 3 m stock bars, so the question is how many bars the
 *   pieces fit into. That's the bin-packing problem; first-fit decreasing never uses more
 *   than about 11/9 of the optimal number of bars, and on short cut lists is usually optimal.
 */
import type { Line } from "./types.ts";
import { mergeLines } from "./lines.ts";
import { ValidationError } from "./errors.ts";

/** Same item shapes as snack4-refactor-kata/src/types.ts. */
export interface DesignItem {
  type: string;
  sku: string;
  qty: number;
  profile?: string;
  /** mm, extrusions only */
  length?: number;
  finish?: "clear" | "black";
}

export interface Design {
  items: DesignItem[];
}

export const BAR_LENGTH_MM = 3000;
/** Material lost to the saw blade per cut. */
export const KERF_MM = 3;
export const MIN_PIECE_MM = 50;
export const FASTENER_PACK = 50;
export const PROFILES = ["20x20", "40x40", "40x80"];

export interface Requirement extends Line {
  /** Where the number came from, for people: "120 bolts in packs of 50". */
  detail: string;
}

export interface Plan {
  requirements: Requirement[];
  /** Items that can't be turned into stock (unknown profile, piece too short). */
  warnings: string[];
}

export function barSku(profile: string, finish: string | undefined): string {
  return `BAR-${profile.replace("x", "")}-${finish === "black" ? "BLK" : "CLR"}`;
}

/**
 * First-fit decreasing: sort pieces longest first, put each into the first bar with room.
 * Each cut also loses one saw kerf. Pieces longer than a bar are spliced: whole bars
 * plus a remainder piece that's packed like any other.
 */
export function barsNeeded(piecesMm: readonly number[], barMm = BAR_LENGTH_MM, kerfMm = KERF_MM): number {
  let wholeBars = 0;
  const pieces: number[] = [];
  for (const len of piecesMm) {
    if (len > barMm) {
      wholeBars += Math.floor(len / barMm);
      const rest = len % barMm;
      if (rest > 0) pieces.push(rest);
    } else {
      pieces.push(len);
    }
  }
  pieces.sort((a, b) => b - a);
  const free: number[] = []; // remaining length in each opened bar
  for (const len of pieces) {
    // A piece fits if the bar has its length left. Cutting it off costs a kerf, unless
    // it takes the rest of the bar, so the leftover is never negative.
    const i = free.findIndex((room) => room >= len);
    if (i >= 0) free[i] = Math.max(0, free[i] - len - kerfMm);
    else free.push(Math.max(0, barMm - len - kerfMm));
  }
  return wholeBars + free.length;
}

export function plan(design: Design): Plan {
  const warnings: string[] = [];
  const cutLists = new Map<string, number[]>(); // bar SKU -> piece lengths
  const cutText = new Map<string, string[]>();
  const direct: Requirement[] = [];

  for (const item of design.items) {
    if (item.type === "extrusion") {
      const profile = item.profile ?? "";
      const length = item.length ?? 0;
      if (!PROFILES.includes(profile)) {
        warnings.push(`${item.sku}: unknown profile ${profile || "(none)"}, not checked`);
        continue;
      }
      if (length < MIN_PIECE_MM) {
        warnings.push(`${item.sku}: ${length} mm is below the ${MIN_PIECE_MM} mm minimum, not checked`);
        continue;
      }
      const sku = barSku(profile, item.finish);
      const list = cutLists.get(sku) ?? [];
      for (let i = 0; i < item.qty; i++) list.push(length);
      cutLists.set(sku, list);
      cutText.set(sku, [...(cutText.get(sku) ?? []), `${item.qty} × ${length} mm`]);
    } else if (item.type === "fastener") {
      const packs = Math.ceil(item.qty / FASTENER_PACK);
      direct.push({ sku: item.sku, qty: packs, detail: `${item.qty} pcs in packs of ${FASTENER_PACK}` });
    } else {
      // plates, motors, actuators, controllers, and anything else stocked by SKU
      direct.push({ sku: item.sku, qty: item.qty, detail: `${item.qty} × ${item.type}` });
    }
  }

  const bars: Requirement[] = [...cutLists].map(([sku, pieces]) => {
    const qty = barsNeeded(pieces);
    return { sku, qty, detail: `${cutText.get(sku)!.join(" + ")} cut from ${qty} × 3 m bar${qty === 1 ? "" : "s"}` };
  });

  // Merge requirements for the same SKU, keeping every detail.
  const details = new Map<string, string[]>();
  for (const r of [...bars, ...direct]) details.set(r.sku, [...(details.get(r.sku) ?? []), r.detail]);
  const requirements = mergeLines([...bars, ...direct]).map((l) => ({ ...l, detail: details.get(l.sku)!.join("; ") }));
  return { requirements, warnings };
}

/** Validates untrusted JSON into a Design, collecting every problem rather than stopping at the first. */
export function parseDesign(input: unknown): Design {
  const problems: string[] = [];
  const items = (input as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) throw new ValidationError(["design.items must be a non-empty array"]);
  if (items.length > 500) throw new ValidationError(["design.items has more than 500 items"]);

  const out: DesignItem[] = [];
  items.forEach((raw: unknown, i: number) => {
    const it = raw as Record<string, unknown> | null;
    const where = `items[${i}]`;
    if (!it || typeof it !== "object") return problems.push(`${where} must be an object`);
    const { type, sku, qty } = it;
    if (typeof type !== "string" || !type) problems.push(`${where}.type must be a string`);
    if (typeof sku !== "string" || !isSku(sku)) problems.push(`${where}.sku must be a SKU like "PL-200"`);
    if (!isQty(qty)) problems.push(`${where}.qty must be a whole number from 1 to 100000`);
    if (type === "extrusion") {
      if (typeof it.profile !== "string") problems.push(`${where}.profile is required for extrusions`);
      if (typeof it.length !== "number" || !Number.isFinite(it.length) || it.length <= 0 || it.length > 20000)
        problems.push(`${where}.length must be a length in mm up to 20000`);
      if (it.finish !== undefined && it.finish !== "clear" && it.finish !== "black") problems.push(`${where}.finish must be "clear" or "black"`);
    }
    out.push({
      type: String(type), sku: String(sku), qty: Number(qty),
      ...(type === "extrusion" ? { profile: String(it.profile), length: Number(it.length), finish: it.finish as DesignItem["finish"] } : {}),
    });
  });
  if (problems.length) throw new ValidationError(problems);
  return { items: out };
}

export function isSku(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(s);
}

export function isQty(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 100_000;
}
