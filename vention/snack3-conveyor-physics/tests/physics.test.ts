import { test } from "node:test";
import assert from "node:assert/strict";
import { AabbWorld } from "../src/physics/AabbWorld";
import { FixedStepper } from "../src/physics/FixedStepper";
import { SlotPool } from "../src/sim/SlotPool";
import { FIXED_STEP, GRAVITY, type StaticCollider } from "../src/layout";

const FLOOR: StaticCollider = { name: "floor", min: { x: -5, y: -1, z: -5 }, max: { x: 5, y: 0, z: 5 } };
const H = 0.05; // half extent of the test boxes

function setup(statics: StaticCollider[] = [FLOOR], capacity = 64) {
  const world = new AabbWorld(capacity, statics);
  const pool = new SlotPool(capacity);
  const add = (x: number, y: number, z: number, h = H) => {
    const slot = pool.alloc();
    world.add(slot, { x, y, z, hx: h, hy: h, hz: h });
    return slot;
  };
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += FIXED_STEP) {
      world.savePrevious(pool);
      world.step(FIXED_STEP, pool);
    }
  };
  return { world, pool, add, run };
}

test("free fall matches semi-implicit Euler (and is close to the exact parabola)", () => {
  const { world, add, run } = setup([]);
  const slot = add(0, 5, 0);
  const steps = 60;
  run(steps * FIXED_STEP - 1e-9);
  // Semi-implicit Euler: y_n = y0 + g·dt²·n(n+1)/2
  const expected = 5 + (GRAVITY * FIXED_STEP * FIXED_STEP * steps * (steps + 1)) / 2;
  assert.ok(Math.abs(world.py[slot] - expected) < 1e-9, `${world.py[slot]} vs ${expected}`);
  const exact = 5 + 0.5 * GRAVITY * 0.5 * 0.5;
  assert.ok(Math.abs(world.py[slot] - exact) < 0.03);
});

test("a dropped box lands on the floor, comes to rest and falls asleep", () => {
  const { world, add, run } = setup();
  const slot = add(0, 1, 0);
  run(3);
  assert.ok(Math.abs(world.py[slot] - H) < 0.002, `resting at ${world.py[slot]}`);
  assert.ok(world.isAsleep(slot));
});

test("a stack of three boxes stays stacked", () => {
  const { world, add, run } = setup();
  const slots = [add(0, H, 0), add(0, 3 * H + 0.001, 0), add(0, 5 * H + 0.002, 0)];
  run(3);
  slots.forEach((s, k) => {
    assert.ok(Math.abs(world.py[s] - (2 * k + 1) * H) < 0.003, `box ${k} at ${world.py[s]}`);
    assert.ok(Math.abs(world.px[s]) < 1e-6 && Math.abs(world.pz[s]) < 1e-6, `box ${k} drifted sideways`);
  });
});

test("a ten-box tower settles and falls asleep (shock propagation)", () => {
  const { world, add, run } = setup();
  const slots = Array.from({ length: 10 }, (_, k) => add(0, (2 * k + 1) * H + k * 0.001, 0));
  run(3);
  slots.forEach((s, k) => {
    // Each contact may overlap by up to SLOP (0.5 mm) before correction kicks in,
    // so box k can sit up to (k + 1) slops low. Allow that plus a little.
    const allowed = (k + 1) * 0.0006 + 0.001;
    assert.ok(Math.abs(world.py[s] - (2 * k + 1) * H) < allowed, `box ${k} at ${world.py[s]}`);
    assert.ok(world.isAsleep(s), `box ${k} still awake, vy = ${world.vy[s]}`);
  });
});

test("the conveyor's friction brings a box up to belt speed", () => {
  const belt: StaticCollider = {
    name: "belt", min: { x: -5, y: 0.55, z: -0.25 }, max: { x: 5, y: 0.6, z: 0.25 }, conveyor: true,
  };
  const { world, add, run } = setup([FLOOR, belt]);
  world.beltSpeed = 0.8;
  const slot = add(0, 0.6 + H, 0);
  run(1.5);
  assert.ok(Math.abs(world.vx[slot] - 0.8) < 0.02, `vx = ${world.vx[slot]}`);
  assert.ok(world.px[slot] > 0.6, `moved only ${world.px[slot]} m`);
  assert.ok(!world.isAsleep(slot), "a box riding the belt must not fall asleep");
});

test("the spatial hash finds exactly the same candidate pairs as checking every pair", () => {
  const { world, pool, add } = setup([], 1200);
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  for (let i = 0; i < 1000; i++) add(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1, 0.02 + random() * 0.04);

  const key = ([a, b]: [number, number]) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  world.useSpatialHash = true;
  const fromHash = world.candidatePairs(pool).map(key);
  const hashTested = world.stats.pairsTested;
  world.useSpatialHash = false;
  const fromAll = world.candidatePairs(pool).map(key);
  const allTested = world.stats.pairsTested;

  assert.equal(new Set(fromHash).size, fromHash.length, "the hash reported a pair twice");
  assert.deepEqual([...fromHash].sort(), [...fromAll].sort());
  assert.ok(fromAll.length > 100, "test scene should have plenty of overlaps");
  assert.ok(hashTested * 20 < allTested, `hash tested ${hashTested} pairs vs ${allTested}`);
});

test("removing the bottom of a sleeping stack wakes the boxes above, and they fall", () => {
  const { world, pool, add, run } = setup();
  const [bottom, middle, top] = [add(0, H, 0), add(0, 3 * H + 0.001, 0), add(0, 5 * H + 0.002, 0)];
  run(3);
  assert.ok(world.isAsleep(middle) && world.isAsleep(top), "stack should be asleep first");

  world.remove(bottom); // what BoxFlow does when it retires a box...
  pool.release(bottom); // ...then it hands the slot back

  assert.ok(!world.isAsleep(middle) && !world.isAsleep(top), "both should wake immediately");
  run(2);
  assert.ok(Math.abs(world.py[middle] - H) < 0.003, `middle at ${world.py[middle]}`);
  assert.ok(Math.abs(world.py[top] - 3 * H) < 0.004, `top at ${world.py[top]}`);
});

test("FixedStepper runs whole steps, carries the remainder and drops an impossible backlog", () => {
  const s = new FixedStepper(1 / 120, 8);
  let steps = 0;
  const tick = () => steps++;

  assert.equal(s.advance(1 / 60, tick), 2); // a 60 Hz frame = two 120 Hz steps
  assert.ok(s.alpha < 1e-6);

  assert.equal(s.advance(1 / 240, tick), 0); // half a step: nothing yet...
  assert.ok(Math.abs(s.alpha - 0.5) < 1e-6); // ...but we're halfway to the next one

  const before = steps;
  s.advance(1, tick); // a one-second hitch
  assert.equal(steps - before, 8, "capped at maxSteps");
  assert.ok(s.droppedTime > 0.9, `dropped ${s.droppedTime}`);
  assert.ok(s.alpha >= 0 && s.alpha < 1);
});

test("a box held still on a running belt never sleeps, and restarting the belt moves sleepers", () => {
  const belt: StaticCollider = {
    name: "belt", min: { x: -5, y: 0.55, z: -0.25 }, max: { x: 5, y: 0.6, z: 0.25 }, conveyor: true,
  };
  const wall: StaticCollider = { name: "wall", min: { x: 0.2, y: 0.6, z: -0.3 }, max: { x: 0.3, y: 0.8, z: 0.3 } };
  const { world, add, run } = setup([FLOOR, belt, wall]);
  const slot = add(0, 0.6 + H, 0);
  run(3); // carried into the wall and jammed there
  assert.ok(Math.abs(world.px[slot] - (0.2 - H)) < 0.003, `jammed at x = ${world.px[slot]}`);
  assert.ok(!world.isAsleep(slot), "jammed on a running belt, it should stay awake");

  world.beltSpeed = 0;
  run(2);
  assert.ok(world.isAsleep(slot), "with the belt stopped it can rest");
  world.beltSpeed = -0.8; // reverse
  run(1);
  assert.ok(world.px[slot] < 0, `should be carried back, at x = ${world.px[slot]}`);
});
