import { test } from "node:test";
import assert from "node:assert/strict";
import { barSku, barsNeeded, parseDesign, plan } from "../src/domain/design.ts";
import { ValidationError } from "../src/domain/errors.ts";

test("bars: pieces are packed longest first into 3 m bars, with a 3 mm kerf each", () => {
  assert.equal(barsNeeded([1200, 1200, 1200, 1200]), 2); // two per bar; a third would need 3609
  assert.equal(barsNeeded([1500, 1500]), 2); // 1500 + 3 + 1500 > 3000: the saw cut doesn't fit
  assert.equal(barsNeeded([1498, 1498]), 1); // 1498 + 3 + 1498 = 2999
  assert.equal(barsNeeded([3000]), 1); // a full bar needs no cut
  assert.equal(barsNeeded([2400, 500, 500, 2400]), 2); // each 2400 shares with one 500
  assert.equal(barsNeeded([]), 0);
});

test("bars: first-fit decreasing fills gaps an in-order packing would waste", () => {
  // In order, the two 990s share a bar and each 2000 needs its own: 3 bars.
  // Longest first, each 2000 opens a bar and a 990 fills the rest of it: 2 bars.
  assert.equal(barsNeeded([990, 990, 2000, 2000]), 2);
});

test("bars: pieces longer than a bar are spliced from whole bars plus a remainder", () => {
  assert.equal(barsNeeded([4000]), 2); // 1 whole bar + a 1000 mm piece
  assert.equal(barsNeeded([4000, 1900]), 2); // the 1000 mm remainder shares a bar with the 1900
  assert.equal(barsNeeded([6000]), 2);
});

test("bar SKUs come from profile and finish", () => {
  assert.equal(barSku("40x80", "black"), "BAR-4080-BLK");
  assert.equal(barSku("20x20", undefined), "BAR-2020-CLR");
});

test("plan: Snack 4's demo design becomes stock lines", () => {
  const { requirements, warnings } = plan({
    items: [
      { type: "extrusion", sku: "EX-4040", profile: "40x40", length: 1200, qty: 4 },
      { type: "extrusion", sku: "EX-4080", profile: "40x80", length: 2400, qty: 2, finish: "black" },
      { type: "plate", sku: "PL-200", qty: 4 },
      { type: "fastener", sku: "M6-BOLT", qty: 120 },
      { type: "actuator", sku: "LA-300", qty: 2 },
      { type: "controller", sku: "MC-1", qty: 1 },
    ],
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(requirements.map(({ sku, qty }) => [sku, qty]), [
    ["BAR-4040-CLR", 2], ["BAR-4080-BLK", 2], ["LA-300", 2], ["M6-BOLT", 3], ["MC-1", 1], ["PL-200", 4],
  ]);
  assert.equal(requirements.find((r) => r.sku === "M6-BOLT")!.detail, "120 pcs in packs of 50");
  assert.equal(requirements[0].detail, "4 × 1200 mm cut from 2 × 3 m bars");
});

test("plan: pieces of the same profile share bars across items, and repeated SKUs add up", () => {
  const { requirements } = plan({
    items: [
      { type: "extrusion", sku: "A", profile: "40x40", length: 2400, qty: 1 },
      { type: "extrusion", sku: "B", profile: "40x40", length: 500, qty: 1 },
      { type: "plate", sku: "PL-100", qty: 1 },
      { type: "plate", sku: "PL-100", qty: 2 },
    ],
  });
  assert.deepEqual(requirements.map(({ sku, qty }) => [sku, qty]), [["BAR-4040-CLR", 1], ["PL-100", 3]]);
});

test("plan: unknown profiles and too-short pieces are warned about, not checked", () => {
  const { requirements, warnings } = plan({
    items: [
      { type: "extrusion", sku: "X", profile: "30x30", length: 500, qty: 1 },
      { type: "extrusion", sku: "Y", profile: "40x40", length: 20, qty: 1 },
    ],
  });
  assert.deepEqual(requirements, []);
  assert.equal(warnings.length, 2);
});

test("parseDesign reports every problem at once", () => {
  assert.throws(() => parseDesign({ items: [] }), ValidationError);
  try {
    parseDesign({ items: [{ type: "plate", sku: "bad sku", qty: 0 }, { type: "extrusion", sku: "EX-1", qty: 1 }] });
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    assert.equal(e.problems.length, 4); // sku, qty, profile, length
  }
});
