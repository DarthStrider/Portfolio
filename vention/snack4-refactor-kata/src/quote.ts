import { priceItem } from "./items";
import { round2 } from "./money";
import { assemblyLabor, discount, leadTimeDays, shipping, taxRate } from "./rules";
import type { Customer, Design, Quote, QuoteError, QuoteLine } from "./types";

/**
 * Prices a machine design for a customer.
 *
 * Pure: no globals, no logging, and the clock is a parameter, so the same inputs
 * always produce the same quote (which is also what makes it easy to test).
 */
export function createQuote(design: Design | null | undefined, customer: Customer, now: number): Quote | QuoteError {
  if (!design || !design.items || design.items.length === 0) return { error: "Empty design" };

  // 1. Price every item, adding up money, weight and labour as we go.
  const lines: QuoteLine[] = [];
  const warnings: string[] = [];
  let parts = 0;
  let weightKg = 0;
  let laborHours = 0;
  let longestPieceMm = 0;
  let hasMotion = false;
  let hasActuator = false;
  let hasController = false;

  for (const item of design.items) {
    const priced = priceItem(item);
    if ("skipped" in priced) {
      warnings.push(priced.skipped);
      continue;
    }
    lines.push(priced.line);
    warnings.push(...priced.warnings);
    parts += priced.line.total;
    weightKg += priced.weightKg;
    laborHours += priced.laborHours;

    if (item.type === "motor" || item.type === "actuator") hasMotion = true;
    if (item.type === "actuator") hasActuator = true;
    if (item.type === "controller") hasController = true;
    if (item.type === "extrusion" && item.length > longestPieceMm) longestPieceMm = item.length;
  }

  if (hasMotion && !hasController) warnings.push("No controller in design");

  // 2. Assembly labour, if asked for.
  let labor = 0;
  if (design.assembly) {
    const billed = assemblyLabor(laborHours);
    labor = billed.cost;
    lines.push({ sku: "LAB", desc: `Assembly (${billed.hours} h)`, qty: 1, unit: labor, total: labor });
  }

  // 3. Discount, shipping, tax.
  const rush = Boolean(design.rush);
  const disc = discount(parts, labor, customer);
  // Free-shipping threshold: what the customer pays for parts and assembly, after discounts.
  const ship = shipping(weightKg, parts + labor - disc, customer, rush);
  const taxable = parts + labor - disc + ship;
  const tax = round2(taxable * taxRate(customer));

  return {
    quoteId: `Q-${now}`,
    lines,
    subtotal: round2(parts + labor),
    discount: disc,
    shipping: ship,
    tax,
    total: round2(taxable + tax),
    leadTimeDays: leadTimeDays({ longestPieceMm, hasActuator, assembly: Boolean(design.assembly), rush }),
    warnings,
  };
}

// ---- Legacy API, kept so existing callers keep working ----

/** @deprecated The most recent quote from calculateQuote(). Use its return value instead. */
export let lastQuote: Quote | null = null;

/**
 * @deprecated Use createQuote(design, customer, Date.now()).
 * Same result, plus the legacy side effects: it records the quote in `lastQuote` and logs it.
 */
export function calculateQuote(design: Design | null | undefined, customer: Customer): Quote | QuoteError {
  const quote = createQuote(design, customer, Date.now());
  if ("error" in quote) return quote;
  lastQuote = quote;
  console.log(`quote ${quote.quoteId} total ${quote.total}`);
  return quote;
}
