import { FIXED_STEP, MAX_BODIES, MAX_SUBSTEPS } from "./layout";
import { AabbWorld } from "./physics/AabbWorld";
import { FixedStepper } from "./physics/FixedStepper";
import type { PhysicsBackend } from "./physics/types";
import { BoxRenderer } from "./render/BoxRenderer";
import { createStage } from "./render/stage";
import { buildWorkcell } from "./render/Workcell";
import { BoxFlow } from "./sim/BoxFlow";
import { createHud, type EngineKind } from "./ui/hud";

const STATS_INTERVAL = 0.25; // s between stat readouts
const BURST_SIZE = 500;

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const { renderer, scene, camera, controls } = createStage(canvas);
const workcell = buildWorkcell(scene);

const boxes = new BoxRenderer(MAX_BODIES);
scene.add(boxes.group);

const flow = new BoxFlow(new AabbWorld(MAX_BODIES));
const stepper = new FixedStepper(FIXED_STEP, MAX_SUBSTEPS);
let spatialHash = true;
let switching = false;

const hud = createHud({
  onEngine: (kind) => void setEngine(kind),
  onSpatialHash: (on) => {
    spatialHash = on;
    if (flow.backend instanceof AabbWorld) flow.backend.useSpatialHash = on;
  },
  onInstancing: (on) => (boxes.mode = on ? "instanced" : "meshes"),
  onTintSleeping: (on) => (boxes.tintSleeping = on),
  onTarget: (n) => (flow.target = n),
  onRate: (r) => (flow.rate = r),
  onBeltSpeed: (v) => (flow.backend.beltSpeed = v),
  onBurst: () => hud.setTarget(flow.burst(BURST_SIZE)),
  onClear: () => {
    flow.clear();
    flow.target = 0;
    hud.setTarget(0);
  },
});
hud.setEngine("custom");

/**
 * Swaps the physics engine mid-run, carrying every box over at its current position.
 * cannon-es is loaded on demand (a separate chunk), so the page starts without it.
 */
async function setEngine(kind: EngineKind) {
  if (switching) return;
  switching = true;
  try {
    let next: PhysicsBackend;
    if (kind === "cannon") {
      const { CannonWorld } = await import("./physics/CannonWorld");
      next = new CannonWorld(MAX_BODIES);
    } else {
      const custom = new AabbWorld(MAX_BODIES);
      custom.useSpatialHash = spatialHash;
      next = custom;
    }
    flow.switchBackend(next);
    hud.setEngine(kind);
  } catch (err) {
    console.error(err);
    hud.showMessage("Couldn't load cannon-es. Run npm install, then reload.");
  } finally {
    switching = false;
  }
}

// ---- Frame loop ----

let last = performance.now();
let sample = { time: 0, frames: 0, physics: 0, steps: 0 };

renderer.setAnimationLoop((now) => {
  const frameMs = now - last;
  last = now;
  const dt = Math.min(frameMs / 1000, 0.25); // after a hidden tab, don't try to simulate minutes

  flow.update(dt);

  // Physics: fixed 1/120 s steps, timed so the panel can show what physics costs per frame.
  const t0 = performance.now();
  const steps = stepper.advance(dt, () => {
    flow.backend.savePrevious(flow.pool);
    flow.backend.step(FIXED_STEP, flow.pool);
  });
  const physicsMs = performance.now() - t0;

  workcell.update(dt, flow.backend.beltSpeed);
  boxes.update(flow, stepper.alpha); // draw between the last two physics states
  controls.update();
  renderer.render(scene, camera);

  hud.pushFrame(frameMs);
  sample.time += dt;
  sample.frames++;
  sample.physics += physicsMs;
  sample.steps += steps;
  if (sample.time >= STATS_INTERVAL) {
    const s = flow.backend.stats;
    hud.showStats({
      fps: sample.frames / sample.time,
      frameMs: (sample.time * 1000) / sample.frames,
      physicsMs: sample.physics / sample.frames,
      stepsPerFrame: sample.steps / sample.frames,
      boxes: flow.count,
      awake: s.awake,
      drawCalls: renderer.info.render.calls,
      pairsTested: s.pairsTested,
      contacts: s.contacts,
      droppedMs: stepper.droppedTime * 1000,
    });
    sample = { time: 0, frames: 0, physics: 0, steps: 0 };
  }
});
