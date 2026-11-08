/** Example designs, in the same format Snack 4's quote calculator takes. */
export const SAMPLES: { name: string; note: string; design: unknown }[] = [
  {
    name: "Demo machine",
    note: "Snack 4's sample design: fits in stock",
    design: {
      items: [
        { type: "extrusion", sku: "EX-4040", profile: "40x40", length: 1200, qty: 4 },
        { type: "extrusion", sku: "EX-4080", profile: "40x80", length: 2400, qty: 2, finish: "black" },
        { type: "plate", sku: "PL-200", qty: 4 },
        { type: "fastener", sku: "M6-BOLT", qty: 120 },
        { type: "actuator", sku: "LA-300", qty: 2 },
        { type: "controller", sku: "MC-1", qty: 1 },
      ],
    },
  },
  {
    name: "Gantry cell",
    note: "A bigger build: short on black 40x40 bars and actuators",
    design: {
      items: [
        { type: "extrusion", sku: "EX-4080", profile: "40x80", length: 2800, qty: 4, finish: "black" },
        { type: "extrusion", sku: "EX-4040", profile: "40x40", length: 1500, qty: 8, finish: "black" },
        { type: "plate", sku: "PL-300", qty: 6 },
        { type: "fastener", sku: "M6-BOLT", qty: 400 },
        { type: "motor", sku: "SRV-400", qty: 4 },
        { type: "actuator", sku: "LA-300", qty: 8 },
        { type: "controller", sku: "MC-1", qty: 2 },
        { type: "gripper", sku: "GR-1", qty: 1 },
      ],
    },
  },
  {
    name: "Bench frame",
    note: "20x20 frame: shows bars shared between cut lists",
    design: {
      items: [
        { type: "extrusion", sku: "EX-2020", profile: "20x20", length: 800, qty: 6 },
        { type: "extrusion", sku: "EX-2020", profile: "20x20", length: 600, qty: 4 },
        { type: "extrusion", sku: "EX-2020", profile: "20x20", length: 350, qty: 4 },
        { type: "plate", sku: "BR-90", qty: 16 },
        { type: "fastener", sku: "M5-BOLT", qty: 64 },
      ],
    },
  },
];
