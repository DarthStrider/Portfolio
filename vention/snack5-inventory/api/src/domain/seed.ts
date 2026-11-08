import type { SeedPart } from "./types.ts";

/**
 * Starting stock. SKUs match the ones Snack 4's quote calculator prices, plus the 3 m
 * bars extrusions are cut from. A few parts start at or below their reorder level so
 * the low-stock view has something to show.
 */
export const SEED_PARTS: readonly SeedPart[] = [
  { sku: "BAR-2020-CLR", name: "20x20 extrusion, clear anodized", category: "extrusion", unit: "bar (3 m)", onHand: 40, reorderLevel: 10, location: "A-01-1" },
  { sku: "BAR-2020-BLK", name: "20x20 extrusion, black anodized", category: "extrusion", unit: "bar (3 m)", onHand: 12, reorderLevel: 8, location: "A-01-2" },
  { sku: "BAR-4040-CLR", name: "40x40 extrusion, clear anodized", category: "extrusion", unit: "bar (3 m)", onHand: 36, reorderLevel: 12, location: "A-02-1" },
  { sku: "BAR-4040-BLK", name: "40x40 extrusion, black anodized", category: "extrusion", unit: "bar (3 m)", onHand: 7, reorderLevel: 8, location: "A-02-2" },
  { sku: "BAR-4080-CLR", name: "40x80 extrusion, clear anodized", category: "extrusion", unit: "bar (3 m)", onHand: 18, reorderLevel: 6, location: "A-03-1" },
  { sku: "BAR-4080-BLK", name: "40x80 extrusion, black anodized", category: "extrusion", unit: "bar (3 m)", onHand: 9, reorderLevel: 4, location: "A-03-2" },
  { sku: "PL-100", name: "Mounting plate, 100 mm", category: "plate", unit: "plate", onHand: 60, reorderLevel: 20, location: "B-01-1" },
  { sku: "PL-200", name: "Mounting plate, 200 mm", category: "plate", unit: "plate", onHand: 45, reorderLevel: 20, location: "B-01-2" },
  { sku: "PL-300", name: "Mounting plate, 300 mm", category: "plate", unit: "plate", onHand: 8, reorderLevel: 10, location: "B-01-3" },
  { sku: "BR-90", name: "90° corner bracket", category: "plate", unit: "piece", onHand: 140, reorderLevel: 50, location: "B-02-1" },
  { sku: "M6-BOLT", name: "M6 × 12 bolt", category: "fastener", unit: "pack of 50", onHand: 80, reorderLevel: 25, location: "C-01-1" },
  { sku: "M5-BOLT", name: "M5 × 10 bolt", category: "fastener", unit: "pack of 50", onHand: 22, reorderLevel: 25, location: "C-01-2" },
  { sku: "SRV-400", name: "Servo motor, 400 W", category: "motor", unit: "piece", onHand: 9, reorderLevel: 4, location: "D-01-1" },
  { sku: "LA-300", name: "Linear actuator, 300 mm stroke", category: "actuator", unit: "piece", onHand: 6, reorderLevel: 4, location: "D-02-1" },
  { sku: "MC-1", name: "Motion controller", category: "controller", unit: "piece", onHand: 4, reorderLevel: 2, location: "D-03-1" },
  { sku: "GR-1", name: "Two-finger gripper", category: "gripper", unit: "piece", onHand: 3, reorderLevel: 1, location: "D-04-1" },
];
