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
- [x] Splitters: diverter gates on a belt that send each item left, right or straight on by rules you write (shape kind, color, size, name, SKU, or the inventory part's category, location and stock). Rules are stored in the database, and inventory changes apply to the next item through the gate
- [x] Mergers: a feeder belt joining a main belt at a point, or a Y where two belts become one. Feeder items queue and wait for a gap; choose main belt first, feeders first, or take turns
- [x] Joining machines: a station on a belt holds one item of each of two kinds and joins them at their connection points; the joined object carries on down the line. Each join is saved as an assembly that uses up the parts from stock
- [x] Bins that hold the kinds of object you choose (one or several, with optional accept conditions): they catch items falling off belts and splitters, and feed them back onto a belt or straight into a joining machine. Loading a bin takes parts from stock
- [x] Connection points per kind of object (inventory part or plain shape kind), edited by typing positions or clicking on the object

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

### Splitters (rules saved by Snack 5's API)

The **Splitters** tab puts diverter gates on belts and decides what each one separates.

- Pick a belt and a distance **along** it (cm from the belt's start), then **Add on belt**. Or use **Click a belt** and click the spot.
- Select a splitter to edit its **rules**. Each rule is one or more conditions (all must hold) and an exit: **← left**, **↑ straight** or **right →**, as seen facing the way the belt runs. The first rule that matches wins, so use ↑ ↓ to order them; **Anything else goes** catches the rest.
- Conditions can test the shape (kind, color, name, SKU, width/height/depth in cm, whether it's an inventory part) or its inventory part (category, location, name, on hand, available, low on stock).
- **Items in the scene at this gate** previews where every shape would go under the rules you're editing, before you save.
- While the belts run, the gate's flap swings across to guide items out, and the panel shows the last decision.

Rules live in the database, so you can change them from the API (`PATCH /api/splitters/{id}`) or straight in PostgreSQL/MongoDB. Part fields are read live: change a part's category (`PATCH /api/parts/{sku}`) or its stock, and the next item of that part through a gate follows the new value. The tab re-reads splitters and parts every 3 s, even while the line runs.

### Connection points (Shapes tab)

Select a shape and the **Connection points** section appears under the list. Points belong to the shape's *kind*: every
PL-200 plate shares them, as does every plain cylinder. Until you change them, every kind has **top** and **bottom**.

- Positions are percentages of the object's size from its center: x and z sideways, y = 50 is the top, −50 the bottom. So one set of points fits every size.
- **+ Add point** and type the position, or **Click on object** and click anywhere on a shape of that kind to put a point there.
- Points show as dots on every object of that kind (orange is the highlighted one). **Save points** stores them; **Back to defaults** removes yours.

### Mergers and joining machines (Machines tab)

**Mergers**
- **Side**: a feeder belt joins a main belt at a point (cm along it). **Y**: two feeder belts come together into the start of an output belt.
- Tick **Move the feeder belts into place** and the feeders are turned and moved to meet the main belt (side) or angled in at ±35° (Y).
- Feeder items stop at the end of the feeder and queue behind each other until the merge point is clear: nothing within **gap** cm of it on the main belt. Then they slide onto the main belt's centerline.
- **Priority**: *Main belt first* (the main belt never stops), *Feeders first* (main-belt items stop a gap short while a feeder item waits), *Take turns*. A Y's two feeders always take turns.
- The post's light is green when the merge point is clear, red while it's holding something; the amber patch on the belt is the gap it keeps clear.

**Joining machines**
- Pick the belt and where on it, the **base** object and its point (it stays on the belt) and the object **joined onto it** and its point, plus how long a join takes.
- While running, the machine holds the first base and the first attach item to arrive; items it doesn't need, or doesn't need yet, pass under it. With both, the press comes down, the attach item is joined so its point meets the base's point, and the base carries it on.
- On **Stop**, each join is saved as an **assembly**: the joined shape is attached to its base in the database (it moves with it from then on), and each part is used up from stock once, with a ledger entry. If a part is short, that join is refused and nothing changes for it.
- Recent assemblies are listed at the bottom of the tab.

### Bins (Bins tab)

- **Holds**: tick the kinds of object it takes (inventory parts and plain shape kinds, as many as you like). Add **conditions** (like a splitter rule's: color, size, part category…) to be pickier.
- Put it where items fall: at the end of a belt, or beside a splitter exit. An item that comes to rest inside a bin is stored if it's one of its kinds, meets the conditions and there's room; anything else is left lying there. A joined object goes in as one, if its base is one of the bin's kinds.
- **Feeds**: nothing, **a belt** at a point along it (*whenever there's room*, or *only when a machine needs one*: when a joining machine further along that belt has an empty slot for this kind and none is already on its way), or **a machine** directly (an item is put into the machine whenever it has an empty slot for that item's kind). A bin with several kinds sends its oldest item that's wanted.
- **Load** fills the bin with new items of the kind you pick; for a part they're **taken from stock** (one ledger line), and you can't load more than is available or than fits. **Unload** takes plain items out and gives parts back to stock.
- The label over each bin shows how full it is; the dashed line shows what it feeds. As always, nothing is saved until **Stop**: then items that left bins are put back on the floor, and items that ended up in bins are stored (a part that hadn't left stock yet is taken as it goes in, and refused if there isn't enough).

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
├── conveyors/
│   ├── types.ts         a belt as the API stores it
│   ├── transport.ts     what a belt does to a shape: ride, fall, land (pure math, unit-tested)
│   ├── ConveyorLayer.ts belt models, the scrolling chevron texture, the placement preview
│   └── controller.ts    the Conveyors tab, Run / Stop, saving positions after a run
├── splitters/
│   ├── types.ts         a splitter and its rules, as the API stores them
│   ├── rules.ts         which exit a rule list picks for a shape and its part (pure, unit-tested)
│   ├── SplitterLayer.ts the gate model: gantry and swinging flaps
│   └── controller.ts    the Splitters tab: placing gates, the rule editor, the live preview
└── line/
    ├── types.ts         connection points, mergers, machines, assemblies, as the API stores them
    ├── joints.ts        where points are, where to put a joined object, poses through joins (pure)
    ├── stations.ts      what mergers and machines do each step: hold, release, queue, join (pure)
    ├── LineLayer.ts     merger posts and machine portals, with their lights and press
    ├── PointEditor.ts   the connection point editor and its markers
    ├── BinLayer.ts      bin models: walls, fill level, count label, the line to what it feeds
    ├── BinPanel.ts      the Bins tab
    └── controller.ts    the Machines tab, and saving assemblies after a run
tests/kinematics.test.ts FK tests (node:test)
tests/reach.test.ts      reach tests
tests/transport.test.ts  belt tests: riding, falling off, hand-over between belts, gravity timing
tests/splitters.test.ts  rule matching, and gates sending items left, right or straight
tests/stations.test.ts   mergers (gaps, queues, priorities, a Y taking turns), joining geometry, machines, bins (catching, feeding)
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
