/**
 * The rules, written down as examples. Each expected number is worked out by hand
 * in the test name or a comment, so this file doubles as the missing spec.
 *
 * Where the current behaviour is a bug, the test says so and pins it anyway:
 * the refactor must not change behaviour. Bugs get fixed afterwards, on purpose,
 * each with its own commit.
 */
import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, createQuote, lastQuote } from "../src/quote";
import type { Customer, Design } from "../src/types";

const NOW = 1_700_000_000_000;
afterEach(() => mock.restoreAll());

type Any = Record<string, any>;
const customer = (over: Any = {}) => ({ tier: "standard", region: "US", orders: 0, ...over });
// Items are written as plain objects for readability; cast once here.
const quote = (items: Any[], design: Any = {}, cust: Any = {}) =>
  createQuote({ items, assembly: false, rush: false, ...design } as unknown as Design, customer(cust) as Customer, NOW) as Any;

const extrusion = (profile: string, length: number, qty = 1, finish = "clear") =>
  ({ type: "extrusion", sku: "EX", profile, length, qty, finish });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

// ---- Parts ----

test("extrusion: profile price per meter × length, plus a 1.50 cut fee (40x40, 1 m: 28 + 1.5 = 29.50)", () => {
  const q = quote([extrusion("40x40", 1000, 2)]);
  assert.equal(q.lines[0].unit, 29.5);
  assert.equal(q.lines[0].total, 59);
});

test("black finish adds 15%, rounded to the cent ((6.25 + 1.5) × 1.15 = 8.9125 → 8.91)", () => {
  assert.equal(quote([extrusion("20x20", 500, 1, "black")]).lines[0].unit, 8.91);
});

test("over 3000 mm is spliced: +8 splice fee, +1.50 second cut, and a warning (173 + 9.5 = 182.50)", () => {
  const q = quote([extrusion("40x80", 3500)]);
  assert.equal(q.lines[0].unit, 182.5);
  assert.match(q.warnings[0], /spliced/);
});

test("pieces under 50 mm and unknown profiles are skipped with a warning", () => {
  const q = quote([extrusion("20x20", 40), extrusion("30x30", 500), { type: "plate", sku: "PL-100", qty: 1 }]);
  assert.equal(q.lines.length, 1);
  assert.match(q.warnings[0], /too short/);
  assert.match(q.warnings[1], /Unknown profile 30x30/);
});

test("plates come from a price list; unknown plates are skipped with a warning", () => {
  const q = quote([{ type: "plate", sku: "PL-300", qty: 2 }, { type: "plate", sku: "PL-999", qty: 1 }]);
  assert.equal(q.lines[0].total, 108.5);
  assert.match(q.warnings[0], /Unknown plate PL-999/);
});

test("fasteners are sold in whole packs of 50, rounded up: 120 bolts → 3 packs (was 2, a bug)", () => {
  const q = quote([{ type: "fastener", sku: "M6", qty: 120 }]);
  assert.equal(q.lines[0].qty, 3);
  assert.equal(q.lines[0].total, 20.25);
  assert.equal(quote([{ type: "fastener", sku: "M6", qty: 10 }]).lines[0].qty, 1, "at least one pack");
  assert.equal(quote([{ type: "fastener", sku: "M6", qty: 100 }]).lines[0].qty, 2, "exact multiples don't round up");
});

test("actuators: 420 each, 5% off when buying 4 or more", () => {
  close(quote([{ type: "actuator", sku: "LA", qty: 4 }]).lines[0].unit, 399);
  assert.equal(quote([{ type: "actuator", sku: "LA", qty: 3 }]).lines[0].unit, 420);
});

test("motors or actuators without a controller trigger a warning", () => {
  assert.deepEqual(quote([{ type: "motor", sku: "M", qty: 1 }]).warnings, ["No controller in design"]);
  assert.deepEqual(quote([{ type: "motor", sku: "M", qty: 1 }, { type: "controller", sku: "C", qty: 1 }]).warnings, []);
});

// ---- Labour and discounts ----

test("assembly: 35/h, with a 2-hour minimum (one plate = 0.25 h → billed 2 h = 70)", () => {
  const q = quote([{ type: "plate", sku: "PL-100", qty: 1 }], { assembly: true });
  assert.deepEqual(q.lines[1], { sku: "LAB", desc: "Assembly (2 h)", qty: 1, unit: 70, total: 70 });
  assert.equal(q.subtotal, 88.5);
});

// 10 × 1 m of 40x40 = 295 in parts; with assembly, 10 × 0.5 h = 5 h = 175 labour.
const tenBars = [extrusion("40x40", 1000, 10)];

test("tier discount is on parts only: partner 10% of 295 = 29.50, enterprise 15% = 44.25", () => {
  assert.equal(quote(tenBars, { assembly: true }, { tier: "partner" }).discount, 29.5);
  assert.equal(quote(tenBars, { assembly: true }, { tier: "enterprise" }).discount, 44.25);
});

test("SPRING10 is 10% of parts AND labour (470 → 47), and replaces the tier discount when larger", () => {
  assert.equal(quote(tenBars, { assembly: true }, { tier: "enterprise", code: "SPRING10" }).discount, 47);
});

test("promo codes are case-sensitive: spring10 does nothing", () => {
  assert.equal(quote(tenBars, { assembly: true }, { tier: "partner", code: "spring10" }).discount, 29.5);
});

test("more than 10 previous orders adds 2% of the parts subtotal (295 → 5.90)", () => {
  assert.equal(quote(tenBars, {}, { orders: 11 }).discount, 5.9);
  assert.equal(quote(tenBars, {}, { orders: 10 }).discount, 0);
});

// ---- Shipping, tax, lead time ----

test("shipping is by weight and region, with a minimum (US: 1.50/kg, at least 30; EU: 2.40/kg)", () => {
  assert.equal(quote([{ type: "plate", sku: "PL-100", qty: 1 }]).shipping, 30);
  assert.equal(quote([{ type: "actuator", sku: "LA", qty: 10 }], {}, { region: "EU" }).shipping, 84); // 35 kg × 2.4
});

test("free shipping at 2,500 is judged on what the customer pays, after discounts (was before, a bug)", () => {
  const sevenActuators = [{ type: "actuator", sku: "LA", qty: 7 }]; // 2,793 in parts, 24.5 kg
  // Standard customer: 2,793 ≥ 2,500, ships free.
  assert.equal(quote(sevenActuators).shipping, 0);
  // Enterprise: 2,793 − 418.95 (15%) = 2,374.05 < 2,500, so pays 24.5 kg × 1.50 = 36.75.
  const enterprise = quote(sevenActuators, {}, { tier: "enterprise" });
  assert.equal(enterprise.discount, 418.95);
  assert.equal(enterprise.shipping, 36.75);
});

test("FREESHIP zeroes shipping; rush multiplies it by 1.5", () => {
  const plate = [{ type: "plate", sku: "PL-100", qty: 1 }];
  assert.equal(quote(plate, {}, { code: "FREESHIP" }).shipping, 0);
  assert.equal(quote(plate, { rush: true }).shipping, 45);
});

test("tax is on discounted goods plus shipping: Ontario 13% of (59 + 25) = 10.92; Québec 14.975% → 12.58; US none", () => {
  const bars = [extrusion("40x40", 1000, 2)];
  const on = quote(bars, {}, { region: "CA", province: "ON" });
  assert.equal(on.shipping, 25);
  assert.equal(on.tax, 10.92);
  assert.equal(on.total, 94.92);
  assert.equal(quote(bars, {}, { region: "CA", province: "QC" }).tax, 12.58);
  assert.equal(quote(bars).tax, 0);
});

test("lead time: 5 days, +3 for pieces over 2 m, +7 with actuators, +2 for assembly, rush halves (rounded up)", () => {
  const plate = { type: "plate", sku: "PL-100", qty: 1 };
  assert.equal(quote([plate]).leadTimeDays, 5);
  assert.equal(quote([extrusion("20x20", 2001)]).leadTimeDays, 8);
  assert.equal(quote([{ type: "actuator", sku: "LA", qty: 1 }], { assembly: true }).leadTimeDays, 14);
  assert.equal(quote([plate], { rush: true }).leadTimeDays, 3);
});

// ---- Edges and side effects ----

test("an empty design returns an error instead of a quote", () => {
  assert.deepEqual(createQuote({ items: [] }, customer(), NOW), { error: "Empty design" });
});

test("createQuote is pure: the ID comes from the `now` argument, nothing is logged or stored", () => {
  const log = mock.method(console, "log", () => {});
  const design = { items: [{ type: "plate", sku: "PL-100", qty: 1 }] } as Design;
  const a = createQuote(design, customer(), NOW) as Any;
  assert.equal(a.quoteId, "Q-1700000000000");
  assert.deepEqual(createQuote(design, customer(), NOW), a, "same inputs, same quote");
  assert.equal(log.mock.callCount(), 0);
});

test("the deprecated calculateQuote keeps its old side effects: clock ID, global lastQuote, log line", () => {
  mock.method(Date, "now", () => NOW);
  const log = mock.method(console, "log", () => {});
  const q = calculateQuote({ items: [{ type: "plate", sku: "PL-100", qty: 1 }] } as Design, customer()) as Any;
  assert.equal(q.quoteId, "Q-1700000000000");
  assert.equal(lastQuote, q);
  assert.deepEqual(log.mock.calls[0].arguments, ["quote Q-1700000000000 total 48.5"]);
});
