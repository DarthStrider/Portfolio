# Conveyor + Physics

**Stack:** Three.js, TypeScript, cannon-es, Vite  
**Effort:** ~1.5 days  
**Status:** Built

Boxes drop from a hopper onto a moving conveyor, ride it to the end and fall into a bin. Physics
runs on **my own engine** (fixed timestep, axis-aligned box collision, spatial hash, sleeping) or
on **cannon-es**, switchable mid-run. A stress mode drops 500 boxes at a time, up to 4,000, with
live stats to show what each optimisation buys.

## Features

- [x] Own fixed-timestep loop (120 Hz, accumulator, render interpolation, spiral-of-death guard)
- [x] Own AABB collision engine: spatial-hash broad phase, sequential-impulse solver with friction, shock propagation for stacks, sleeping with island wake-up
- [x] The same scene on cannon-es behind the same interface, switchable without losing the boxes
- [x] FPS counter and frame-time graph, plus physics ms/frame, steps/frame, draw calls, pairs tested, contacts, awake bodies
- [x] Stress test with thousands of boxes; toggles to switch each optimisation off and see the difference
- [x] Benchmark script comparing the engines without rendering (`npm run bench`)

## How to run

```powershell
cd vention/snack3-conveyor-physics
npm install
npm run dev        # http://localhost:5173
npm test           # physics, fixed-step and pool tests
npm run bench      # engine benchmark in Node, no rendering
npm run build      # type-check + production build into dist/
```

Try: press **Drop 500** a few times, then untick **Instancing** (watch draw calls and FPS), untick
**Spatial hash** (watch pairs tested and physics ms), tick **Tint sleeping boxes** (grey = asleep, not
simulated), and switch to **cannon-es** to see real rotation and tumbling.

## What was optimised, and what it buys

| Optimisation | Where | Without it | With it |
|---|---|---|---|
| **Instancing** | `BoxRenderer.ts` | One draw call per box per pass (484 draw calls with ~500 boxes visible) | One draw call for all boxes (27 total for the whole scene) |
| **Spatial hash broad phase** | `SpatialHash.ts`, `AabbWorld.broadPhase` | O(n²): 54,735 pair checks per step at 500 boxes, 1.50 ms/step at 1,000 | O(n): ~350 checks per step at 500 boxes, 0.33 ms/step at 1,000 |
| **Half-shell neighbor search** | `HALF_NEIGHBORS` | 27 cells per body, every pair found twice | 13 cells + own cell, every pair found once |
| **Sleeping** | `AabbWorld.updateSleep` / `wake` | Settled piles cost as much as falling ones | Settled bodies skip integration and solving; 3,000 settled boxes cost 0.79 ms/step vs 1.64 ms while falling |
| **Object pooling** | `SlotPool.ts` | Allocate on spawn, garbage-collect on removal | Every per-box array allocated once at 4,096; spawn/remove are O(1) free-list operations |
| **Structure of arrays** | `AabbWorld` | One object per body, scattered in memory | One `Float64Array` per field; tight loops over contiguous memory |
| **Fixed timestep + interpolation** | `FixedStepper.ts` | Physics quality depends on frame rate | Same 120 Hz simulation at any frame rate; rendering blends the last two states with `alpha` |
| **Counting sort of contacts** | `sortPairsBottomUp` | Tall stacks never stop jittering | Bottom-up order + shock propagation settles a 3,000-box pile in ~2 s |

### Benchmark (custom engine, `npm run bench`)

Physics only, Node 22, 120 Hz steps, after a burst of N boxes:

| Boxes | Broad phase | ms/step while falling | ms/step once settled | Headroom at 60 fps |
|---:|---|---:|---:|---:|
| 500 | spatial hash | 0.12 | 0.05 | 67× |
| 500 | all pairs | 0.42 | 0.21 | 20× |
| 1,000 | spatial hash | 0.33 | 0.15 | 25× |
| 1,000 | all pairs | 1.50 | 0.81 | 5.5× |
| 2,000 | spatial hash | 0.87 | 0.44 | 9.6× |
| 3,000 | spatial hash | 1.64 | 0.79 | 5.1× |

"Headroom" is how many times the physics would fit in a 16.7 ms frame at two steps per frame. Run
`npm run bench` to add cannon-es to the table on your machine. Numbers vary by CPU.

## How it's built

```
src/
├── main.ts               frame loop: spawn, fixed steps, render, stats
├── layout.ts             every dimension and static collider (physics and visuals both use it)
├── physics/
│   ├── types.ts          PhysicsBackend: the interface both engines implement
│   ├── FixedStepper.ts   accumulator loop, alpha, dropped-time guard
│   ├── SpatialHash.ts    uniform grid in a hash table, flat Int32Array linked lists
│   ├── AabbWorld.ts      the custom engine
│   └── CannonWorld.ts    cannon-es adapter (loaded on demand)
├── sim/
│   ├── SlotPool.ts       fixed-capacity slots with a free list and a packed live list
│   └── BoxFlow.ts        spawn, recycle oldest, burst, out-of-bounds, engine switch
├── render/
│   ├── stage.ts          renderer, camera, lights, floor
│   ├── Workcell.ts       conveyor, rails, bin (drawn from layout.ts) and decoration
│   └── BoxRenderer.ts    InstancedMesh, or one Mesh per box for comparison
└── ui/hud.ts             stats, frame-time graph, controls (plain DOM)
```

## Design decisions

- **Physics never depends on the frame rate.** `FixedStepper` runs 1/120 s steps, carrying leftover
  time between frames, and the renderer interpolates between the previous and current state. If a
  frame needs more than 8 steps, the backlog is dropped and counted instead of being chased (which
  would make the next frame even slower).
- **The conveyor is a friction surface, not a script.** The belt collider never moves; it has a
  surface velocity, and contact friction against it accelerates boxes to belt speed. Jams, slipping
  and boxes piling up behind each other all fall out of the same rule. In cannon-es the same idea is
  a kinematic body with a velocity that's put back in place every step.
- **Axis-aligned boxes, on purpose.** The custom engine skips rotation, which makes collision a few
  comparisons and the solver simple enough to read in one file. Switching to cannon-es shows what
  full rigid-body dynamics adds (tumbling, rotation) and what it costs.
- **Sequential impulses, with two fixes for stacking.** Contacts are solved several times per step,
  pushing boxes apart and cancelling closing velocity with Coulomb friction. Tall piles need two
  standard tricks: contacts are solved bottom-up (an O(n) counting sort by height), and the last pass
  uses shock propagation (the lower box in a vertical contact is treated as immovable). Without them,
  a 3,000-box pile stayed jittering forever; with them it's asleep in about 2 seconds.
- **Sleeping with islands.** Bodies that stay slow for 0.4 s stop being simulated. Waking one (an
  impact, or the box under it being removed) wakes everything touching it, transitively, so nothing
  is left floating. Boxes on a running belt never sleep, and changing the belt speed wakes everything.
- **One interface, two engines.** `PhysicsBackend` is small: add, remove, step, read transforms.
  Both engines are stepped by the same fixed-step loop on the same scene, so the comparison is fair,
  and switching engines carries every box over at its current position.
- **cannon-es is loaded on demand** with a dynamic `import()`, so it's a separate chunk that
  isn't downloaded until you switch to it.
- **No allocation in the hot paths.** Pools, typed arrays, reused vectors and matrices, a
  preallocated pair buffer, and DOM text only written when it changes.
- **Tested in plain Node.** The physics, the step loop and the pool have no Three.js dependency.
  Tests cover free fall against the integrator's exact formula, resting and sleeping, stacks and a
  ten-box tower, belt friction, jams on a running belt, the hash finding exactly the same pairs as
  brute force, and the wake-up cascade.

## Unity / console comparison

The same toolbox as optimising for Quest or PSVR2, in a browser: batch draw calls (GPU instancing),
avoid per-frame allocation (pools, typed arrays), keep simulation at a fixed rate and interpolate
rendering, and let things that aren't moving stop costing anything (sleeping).

## Next

- Rotation in the custom engine (oriented boxes, separating-axis test)
- Move physics into a Web Worker so it can't block rendering, sharing state through a SharedArrayBuffer
- Rapier (Rust compiled to WebAssembly) as a third backend
