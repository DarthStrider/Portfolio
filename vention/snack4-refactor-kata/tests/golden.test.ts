/**
 * Golden master (a.k.a. characterization or approval test).
 *
 * The legacy code has no spec, so its behaviour *is* the spec. Every generated
 * case runs through the frozen legacy copy and through the current code, and the
 * results must be deeply equal, down to the last floating-point bit.
 *
 * After the refactor, bugs were fixed on purpose. Each fix is listed in
 * INTENTIONAL_CHANGES with a rule for which cases it may affect. A case may only
 * differ from legacy if one of those rules explains it, and each fix must change
 * at least one case (otherwise its rule, or the fix, is wrong).
 */
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { calculateQuote as legacyQuote } from "../legacy/quote";
import { calculateQuote } from "../src/quote";
import type { Customer, Design } from "../src/types";
import { generateCases, type Case } from "./cases";

const FIXED_NOW = 1_700_000_000_000;
const cases = generateCases();

before(() => {
  mock.method(Date, "now", () => FIXED_NOW); // quote IDs use the clock
  mock.method(console, "log", () => {}); // the legacy code logs every quote
});
after(() => mock.restoreAll());

type Any = Record<string, any>;
const itemsOf = (c: Case): Any[] => ((c.design as Any | null)?.items ?? []) as Any[];

interface IntentionalChange {
  name: string;
  /** Could this fix change this case's quote? */
  mayAffect(c: Case, before: Any, after: Any): boolean;
}

const INTENTIONAL_CHANGES: IntentionalChange[] = [
  {
    name: "fasteners round up to whole packs",
    // Only quantities where rounding to nearest and rounding up disagree: 51-74, 101-124, ...
    mayAffect: (c) =>
      itemsOf(c).some((i) => i.type === "fastener" && Math.max(1, Math.round(i.qty / 50)) !== Math.max(1, Math.ceil(i.qty / 50))),
  },
  {
    name: "free-shipping threshold uses the discounted order value",
    // Only CA/US orders without the free-shipping code, where free shipping applied before or applies now.
    mayAffect: (c, before, after) => {
      const cust = c.customer as Any;
      return ["CA", "US"].includes(cust.region) && cust.code !== "FREESHIP" && (before.shipping === 0 || after.shipping === 0);
    },
  },
];

test(`current code matches legacy on all ${cases.length} cases, apart from intentional changes`, () => {
  const changedBy = new Map(INTENTIONAL_CHANGES.map((ch) => [ch.name, 0]));
  for (const c of cases) {
    const before = legacyQuote(c.design, c.customer) as Any;
    const after = calculateQuote(c.design as Design, c.customer as Customer) as Any;
    if (isDeepStrictEqual(after, before)) continue;

    const reasons = INTENTIONAL_CHANGES.filter((ch) => ch.mayAffect(c, before, after));
    assert.ok(reasons.length > 0, `${c.name} changed, and no intentional change explains it`);
    for (const r of reasons) changedBy.set(r.name, changedBy.get(r.name)! + 1);
  }
  for (const [name, count] of changedBy) assert.ok(count > 0, `"${name}" changed no cases at all`);
});

test("the cases exercise every branch worth protecting", () => {
  const seen = new Map<string, number>();
  const hit = (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1);

  for (const c of cases) {
    const q = legacyQuote(c.design, c.customer) as Any;
    if ("error" in q) {
      hit("error");
      continue;
    }
    const warnings = q.warnings.join(" | ");
    if (warnings.includes("too short")) hit("too short");
    if (warnings.includes("spliced")) hit("spliced");
    if (warnings.includes("Unknown profile")) hit("unknown profile");
    if (warnings.includes("Unknown plate")) hit("unknown plate");
    if (warnings.includes("Unknown item type")) hit("unknown type");
    if (warnings.includes("No controller")) hit("no controller");
    if (q.lines.some((l: Any) => l.sku === "LAB")) hit("assembly");
    if (q.lines.some((l: Any) => l.desc.endsWith("black"))) hit("black finish");
    if (q.discount > 0) hit("discount");
    if (q.shipping === 0) hit("free shipping");
    const cust = c.customer as Any;
    if (q.shipping === 0 && cust.code !== "FREESHIP") hit("free-shipping threshold");
    if (cust.code === "SPRING10" && q.discount > 0) hit("promo code");
    if (q.tax > 0) hit("tax");
  }

  const expected = [
    "error", "too short", "spliced", "unknown profile", "unknown plate", "unknown type", "no controller",
    "assembly", "black finish", "discount", "free shipping", "free-shipping threshold", "promo code", "tax",
  ];
  for (const key of expected) assert.ok((seen.get(key) ?? 0) >= 2, `only ${seen.get(key) ?? 0} cases hit "${key}"`);
});
