import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRUSION_PIECE_M, lookFor, placedBySku, shapeForPart } from "../src/shapes/fromPart";

test("extrusions: the profile comes from the SKU, black or clear from the suffix", () => {
  const black = lookFor({ sku: "BAR-4080-BLK", category: "extrusion" });
  assert.deepEqual(black.size, { x: EXTRUSION_PIECE_M, y: 0.08, z: 0.04 });
  assert.equal(black.color, "#2b2f36");
  assert.deepEqual(lookFor({ sku: "BAR-2020-CLR", category: "extrusion" }).size, { x: 0.5, y: 0.02, z: 0.02 });
});

test("plates, brackets and actuators take their size from the SKU", () => {
  assert.deepEqual(lookFor({ sku: "PL-300", category: "plate" }).size, { x: 0.3, y: 0.01, z: 0.3 });
  assert.deepEqual(lookFor({ sku: "BR-90", category: "plate" }).size, { x: 0.04, y: 0.04, z: 0.04 }); // 90 is the angle, not a size
  const la = lookFor({ sku: "LA-300", category: "actuator" });
  assert.ok(Math.abs(la.size.x - 0.4) < 1e-12); // 300 mm stroke + 100 mm body
});

test("every category gets a shape, and unknown ones a neutral box", () => {
  for (const category of ["fastener", "motor", "controller", "gripper", "something-new"]) {
    const look = lookFor({ sku: "X-1", category });
    assert.ok(look.size.x > 0 && look.size.y > 0 && look.size.z > 0, category);
  }
  assert.equal(lookFor({ sku: "SRV-400", category: "motor" }).kind, "cylinder");
});

test("a part's shape is linked by SKU and named after the part", () => {
  const s = shapeForPart({ sku: "MC-1", name: "Motion controller", category: "controller", unit: "piece", onHand: 4, available: 4 }, 0.5, -0.3);
  assert.deepEqual([s.sku, s.name, s.position], ["MC-1", "Motion controller", { x: 0.5, z: -0.3 }]);
  assert.deepEqual(placedBySku([{ sku: "MC-1" }, { sku: null }, { sku: "MC-1" }, { sku: "PL-200" }]), new Map([["MC-1", 2], ["PL-200", 1]]));
});
