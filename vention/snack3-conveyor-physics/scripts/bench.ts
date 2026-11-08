/**
 * Physics-only benchmark: no rendering, so it measures just the engines.
 * For each box count, drops a burst and times 4 simulated seconds of 120 Hz steps:
 * the first 2 s while boxes fall and pile up, the last 1 s once they've mostly settled.
 *
 *   npm run bench
 */
import { FIXED_STEP, MAX_BODIES } from "../src/layout";
import { AabbWorld } from "../src/physics/AabbWorld";
import type { PhysicsBackend } from "../src/physics/types";
import { BoxFlow } from "../src/sim/BoxFlow";

type Engine = { label: string; make: () => PhysicsBackend; maxBoxes: number };

const engines: Engine[] = [
  { label: "custom, spatial hash", make: () => new AabbWorld(MAX_BODIES), maxBoxes: Infinity },
  {
    label: "custom, all pairs",
    make: () => {
      const w = new AabbWorld(MAX_BODIES);
      w.useSpatialHash = false;
      return w;
    },
    maxBoxes: 1000, // O(n²) gets very slow beyond this
  },
];

try {
  const { CannonWorld } = await import("../src/physics/CannonWorld");
  engines.push({ label: "cannon-es", make: () => new CannonWorld(MAX_BODIES), maxBoxes: Infinity });
} catch {
  console.log("(cannon-es not installed: run npm install to include it)\n");
}

const COUNTS = [250, 500, 1000, 2000, 3000];
const STEPS = Math.round(4 / FIXED_STEP);

// Warm up the JIT on every engine first, so the first row isn't measuring compilation.
for (const engine of engines) {
  const backend = engine.make();
  const flow = new BoxFlow(backend);
  flow.rate = 0;
  flow.burst(500);
  for (let s = 0; s < 240; s++) {
    backend.savePrevious(flow.pool);
    backend.step(FIXED_STEP, flow.pool);
  }
}

const rows: string[][] = [];
for (const n of COUNTS) {
  for (const engine of engines) {
    if (n > engine.maxBoxes) continue;
    const backend = engine.make();
    const flow = new BoxFlow(backend);
    flow.rate = 0;
    flow.burst(n);

    const times: number[] = [];
    for (let s = 0; s < STEPS; s++) {
      const t0 = performance.now();
      backend.savePrevious(flow.pool);
      backend.step(FIXED_STEP, flow.pool);
      times.push(performance.now() - t0);
    }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const falling = avg(times.slice(0, STEPS / 2));
    const settled = avg(times.slice((STEPS * 3) / 4));
    rows.push([
      String(n),
      engine.label,
      falling.toFixed(2),
      settled.toFixed(2),
      String(backend.stats.awake),
      (1000 / 60 / (falling * 2)).toFixed(1) + "×",
    ]);
  }
}

const header = ["boxes", "engine", "ms/step falling", "ms/step settled", "awake at end", "headroom @60fps"];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
console.log(line(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
rows.forEach((r) => console.log(line(r)));
console.log("\nheadroom = how many times over the physics fits in a 60 fps frame (2 steps per frame) while boxes fall.");
