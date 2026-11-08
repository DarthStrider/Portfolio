# Robot Arm in the Browser

**Stack:** Three.js, TypeScript, glTF, Vite  
**Effort:** ~1.5 days  
**Status:** Built

A 4-joint robot arm rendered in the browser, with live forward kinematics computed two ways and
checked against each other every frame.

## Features

- [x] 4-joint arm (base yaw, shoulder, elbow, wrist) built as an `Object3D` hierarchy; each joint rotates on its own axis, within its limits
- [x] Forward kinematics: the tool center point's world position shown live, from the scene graph **and** from a hand-written FK function, with the difference between them
- [x] Gripper loaded as glTF; its finger nodes are found by name and animated open/closed
- [x] Orbit camera, grid floor, soft shadows, hemisphere + directional lighting
- [x] Demo mode, a trail of the tool's path, click-to-select joints, keyboard and touch controls
- [x] Shapes: create boxes, cylinders, spheres and cones, place and move them on the floor with the mouse, and see which ones the arm can reach. They're saved in the inventory database (Snack 5), PostgreSQL or MongoDB
- [x] Conveyor belts: build your own (length, width, height, speed, angle), place them with the mouse, then **Run** them: shapes on a belt ride along, fall off the end, and can land on another belt. Stop saves where everything ended up

## How to run

Requires Node.js 20 or newer.

```powershell
cd vention/snack1-robot-arm
npm install
npm run dev        # http://localhost:5173
npm test           # forward-kinematics unit tests
npm run build      # type-check + production build into dist/
```

`npm run build:gripper` regenerates `public/models/gripper.glb` from `scripts/build-gripper.ts`.

### Shapes (needs Snack 5's API)

The Shapes panel on the right saves to the inventory API, so start that first:

```powershell
cd vention/snack5-inventory
docker compose --profile postgres up --build     # or --profile mongo; API at http://localhost:8081
```

Then run this app as above. Without the API the arm works as before and the panel says it's offline.
To use the API without Docker (`DB=memory npm start` in `snack5-inventory/api`, port 8080), start this
app with `$env:VITE_INVENTORY_API="http://localhost:8080"; npm run dev`.

- **Add at X, Z** places the shape at the typed position (centimeters from the arm's base).
- **Place with mouse** shows a see-through preview that follows the pointer; click the floor to drop it. <kbd>Esc</kbd> cancels.
- **Move** on a shape, then click the floor to move it there. Click a shape in the scene or list to select it; <kbd>Delete</kbd> removes it.
- Each shape shows **in reach**, **out of reach**, **too close** or **hits the base**. The blue ring on the floor is how far the gripper reaches at floor level.
- Changes from another browser show up within a few seconds (the panel re-reads the list every 4 s).

### Conveyors (also saved by Snack 5's API)

The **Conveyors** tab, next to Shapes, builds belts.

- Set **length, width, height** (of the belt surface) in cm, a **speed** in cm/s (negative runs it backwards) and a **turn** in degrees, then **Add at X, Z** or **Place with mouse**.
- Each belt in the list has **Move**, **↻ 90°**, **⇄** (reverse) and **✕**. Clicking a belt in the scene selects it.
- A shape placed over a belt sits on top of it. Placing with the mouse snaps onto the belt surface under the pointer.
- **▶ Run belts** (top of the panel) starts the line. Shapes on a belt move at its speed in the direction of the chevrons. Past the end, they fall, keeping their forward speed, onto the floor or onto a lower belt that carries them on. Editing pauses while it runs.
- **■ Stop belts** saves each moved shape's new position to the database (one PATCH per shape). Until then, a run is only a preview.

The model is simple on purpose: shapes don't collide with each other or with a belt's side rails.

### Controls

| Input | Action |
|---|---|
| <kbd>1</kbd>–<kbd>4</kbd>, or click a blue joint | Select a joint |
| <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> (hold), or the ◀ ▶ buttons | Rotate the selected joint |
| <kbd>↑</kbd> <kbd>↓</kbd> | Previous / next joint |
| <kbd>G</kbd> / <kbd>Space</kbd> / <kbd>T</kbd> / <kbd>R</kbd> | Gripper, demo, trail, reset |
| Drag / scroll / right-drag | Orbit / zoom / pan |

## How it's built

```
src/
├── main.ts              wiring: input, demo mode, frame loop
├── arm/
│   ├── jointSpecs.ts    link lengths, joint axes/limits/home pose, demo motion (pure data)
│   ├── kinematics.ts    hand-written forward kinematics (no Three.js import)
│   ├── RobotArm.ts      builds the Object3D hierarchy from the specs
│   └── Gripper.ts       loads gripper.glb, drives the finger nodes
├── scene/
│   ├── stage.ts         renderer, camera, OrbitControls, lights, floor
│   └── Trail.ts         tool-path line on a preallocated buffer
├── ui/panel.ts          joint list, TCP readout, toggles
├── shapes/
│   ├── api.ts           calls the inventory API (/api/shapes, /api/conveyors)
│   ├── reach.ts         can the gripper reach a shape's top? (pure math, unit-tested)
│   ├── ShapeLayer.ts    meshes for the stored shapes, the placement preview, the reach ring
│   └── controller.ts    the Shapes panel and mouse placement
└── conveyors/
    ├── types.ts         a belt as the API stores it
    ├── transport.ts     what a belt does to a shape: ride, fall, land (pure math, unit-tested)
    ├── ConveyorLayer.ts belt models, the scrolling chevron texture, the placement preview
    └── controller.ts    the Conveyors tab, Run / Stop, saving positions after a run
tests/kinematics.test.ts FK tests (node:test)
tests/reach.test.ts      reach tests
tests/transport.test.ts  belt tests: riding, falling off, hand-over between belts, gravity timing
scripts/build-gripper.ts writes the gripper .glb with no dependencies
```

The hierarchy is the same idea as nested Transforms in Unity: each joint is an empty `Object3D`
placed at the end of its parent link, and rotating it carries everything below it.

```
root ─ pedestal
     └ Joint1 (Y) ─ Joint2 (Z) ─ Joint3 (Z) ─ Joint4 (Z) ─ toolMount ─ gripper.glb
                                                                   └ tcp
```

## Design decisions

- **The arm is data.** `jointSpecs.ts` lists each joint's axis, limits and home angle, and
  `RobotArm` builds the hierarchy from it. Changing a limit or link length is a one-line edit, and
  the same data drives the UI panel and the tests.
- **FK twice, on purpose.** `kinematics.ts` computes the tool position by hand (the three pitch
  joints are parallel, so it's a planar chain rotated by the base yaw). `main.ts` compares it with
  `tcp.getWorldPosition()` every frame, and the difference should stay at floating-point rounding level. The tests also check it
  against an independent 4×4 matrix chain over 1,000 random poses.
- **Kinematics has no Three.js dependency**, so it's unit-tested in plain Node with no WebGL or DOM.
- **The tests caught a real bug.** One test sweeps 10 minutes of demo motion and checks the gripper
  stays above the floor; the first set of amplitudes had the fingertips skimming 17 mm above it.
- **The glTF asset is generated from code.** `build-gripper.ts` writes the vertex buffers and GLB
  container by hand, so the model is reproducible and reviewable in a diff. Finger nodes are looked
  up by name and moved in code rather than baked as animation clips, the same way you'd drive a
  real gripper from a control signal.
- **No allocations in the frame loop.** The trail writes into one preallocated `Float32Array` and
  only changes the draw range; vectors are reused; the panel only touches the DOM when text changes.
- **Frame-rate independent motion.** Jogging uses degrees per second × `dt`, and demo easing uses
  `1 - exp(-k·dt)`, so the arm moves the same at 30 Hz and 144 Hz.
- **Graceful fallback.** If the glTF fails to load, a placeholder gripper is shown with a message.

## Unity vs. Three.js: what carries over, what's different

| | Unity | Three.js |
|---|---|---|
| Handedness / up | Left-handed, Y-up | Right-handed, Y-up (same as glTF) |
| Scene node | `GameObject` + `Transform` + components | `Object3D` is both; no component system |
| Rotation | Quaternions; `eulerAngles` in degrees, applied Z then X then Y | `rotation` Euler in **radians**, default order XYZ; `quaternion` also available |
| World matrices | Always current | Updated during `render()`; call `updateMatrixWorld()` / `getWorldPosition()` if you read them before |
| Frame loop | `Update()` with `Time.deltaTime` | Your own `setAnimationLoop` callback; compute `dt` yourself |
| Memory | Managed by the engine | Call `dispose()` on geometries, materials and textures you drop |
| Assets | Imported through the editor | Loaded at runtime (`GLTFLoader`); glTF uses meters and Y-up, so no conversion needed |

## Next

- Inverse kinematics: drag the tool point and solve for the joint angles (CCD or analytic, since
  the pitch joints are planar)
- [Snack 2](../snack2-control-panel/): React control panel driving this arm, with scripted pick-and-place sequences
