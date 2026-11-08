/**
 * What the HTTP routes call. Turns designs into stock lines and answers "can we build
 * this?" without touching the database's own rules, which live in the repositories.
 */
import { parseDesign, plan, type Requirement } from "./domain/design.ts";
import { ValidationError } from "./domain/errors.ts";
import type { InventoryRepo, Reservation, Shortage } from "./domain/types.ts";

export interface CheckLine extends Requirement {
  name: string | null;
  unit: string | null;
  available: number;
  short: number;
}

export interface CheckResult {
  ok: boolean;
  lines: CheckLine[];
  warnings: string[];
}

export async function checkDesign(repo: InventoryRepo, input: unknown): Promise<CheckResult> {
  const { requirements, warnings } = plan(parseDesign(input));
  const parts = new Map((await repo.getParts(requirements.map((r) => r.sku))).map((p) => [p.sku, p]));
  const lines = requirements.map((r) => {
    const p = parts.get(r.sku);
    const available = p?.available ?? 0;
    return { ...r, name: p?.name ?? null, unit: p?.unit ?? null, available, short: Math.max(0, r.qty - available) };
  });
  return { ok: lines.every((l) => l.short === 0), lines, warnings };
}

export type ReserveOutcome =
  | { ok: true; reservation: Reservation; warnings: string[] }
  | { ok: false; shortages: Shortage[]; warnings: string[] };

export async function reserveDesign(repo: InventoryRepo, quoteRef: string, input: unknown): Promise<ReserveOutcome> {
  const { requirements, warnings } = plan(parseDesign(input));
  if (requirements.length === 0) throw new ValidationError(["nothing in this design maps to stock", ...warnings]);
  const result = await repo.reserve(quoteRef, requirements.map(({ sku, qty }) => ({ sku, qty })));
  return { ...result, warnings };
}
