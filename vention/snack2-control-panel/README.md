# React Control Panel

**Stack:** React 19, TypeScript, Three.js, Vite  
**Effort:** ~1 day  
**Status:** Built

A React control panel driving the robot arm from [Snack 1](../snack1-robot-arm/) through a
pick-and-place program: move above the part, descend, grip, lift, carry it to a platform, set it
down, and return home. Loop it and the part shuttles back and forth.

## Features

- [x] Sidebar with a slider per joint, plus Play/Pause/Reset, speed and loop for a scripted pick → move → place program
- [x] Program shown as a step list (MoveJ / MoveL / Grip) with the current step and its progress highlighted
- [x] Inverse kinematics, so the program is written as tool positions in space, not joint angles
- [x] The part is really picked up: re-parented to the gripper, carried, released, and it drops onto whatever is below
- [x] State lives outside React in a small store; the 3D scene reads it every frame and React re-renders only when the store publishes
- [x] Stats line comparing 3D frames rendered with panel re-renders, to show the decoupling

## How to run

Requires Node.js 20 or newer.

```powershell
cd vention/snack2-control-panel
npm install
npm run dev        # http://localhost:5173
npm test           # IK and program tests
npm run build      # type-check + production build into dist/
```

Press **Play**. Drag any joint slider to take over (the program pauses, like grabbing a robot's
teach pendant); **Resume** carries on from wherever you left the arm.

## How it's built

```
src/
├── main.tsx, App.tsx      React entry; one Simulation shared by the panel and the 3D view
├── sim/
│   ├── program.ts         the robot program (steps) and work-cell layout
│   ├── SequencePlayer.ts  runs the program: interpolation, IK per step, looping
│   └── Simulation.ts      the store: live state + throttled snapshots for React
├── arm/
│   ├── ik.ts              closed-form inverse kinematics for a top-down grasp
│   ├── kinematics.ts      forward kinematics (from Snack 1)
│   ├── jointSpecs.ts      dimensions, joint limits, home pose
│   ├── RobotArm.ts        the Object3D hierarchy (from Snack 1)
│   └── Gripper.ts         loads gripper.glb, sets the finger gap
├── scene/
│   ├── Viewer.ts          owns the Three.js scene and the frame loop
│   ├── Workcell.ts        platform, part, grab/release, gravity
│   └── stage.ts           renderer, camera, lights, floor; sized to its container
└── ui/
    ├── useSimulation.ts   useSyncExternalStore hook
    ├── Viewport.tsx       mounts/disposes the Viewer
    └── ControlPanel.tsx   program, joints, gripper, TCP, stats
```

### How state flows

```
             commands (play, setJoint, ...)
ControlPanel ─────────────────────────────►  Simulation  ◄──── tick(dt), every frame ──── Viewer
     ▲                                     (state, player)                                │
     │  snapshot, ≤15×/s while moving                                                     │ reads sim.state
     └──────────────── useSyncExternalStore ◄───────┘                                     ▼
                                                                                Three.js scene, 60 fps
```

## Design decisions

- **The 3D scene never waits for React.** The `Viewer` runs its own `setAnimationLoop`, calls
  `sim.tick(dt)` and reads `sim.state` directly. React isn't in the per-frame path at all.
- **React subscribes to a store, not the other way round.** `Simulation` implements the
  `subscribe` / `getSnapshot` contract for `useSyncExternalStore`. Each publish creates a new
  immutable snapshot, so React's change detection is a reference comparison.
- **Publishing is throttled.** Immediately on discrete changes (status, step), at most 15 times a
  second while the arm moves, and once when it stops. At 60 fps that's about 4× fewer renders than
  frames, and zero renders while idle. The stats line shows the two counts side by side.
- **Plain Three.js instead of react-three-fiber.** Keeps the bridge explicit and small (one
  `useEffect` in `Viewport.tsx`) and lets the arm code from Snack 1 be reused unchanged. With R3F,
  the same idea would be `useFrame` reading the store instead of React state.
- **StrictMode-safe.** In development React mounts, unmounts and remounts effects. The stage creates
  its own canvas and `dispose()` tears everything down (loop, observers, controls, GPU resources,
  canvas), so the remount starts clean.
- **The program is data in tool space.** Steps say where the tool should go (`moveJ` / `moveL`
  to a point) and `ik.ts` turns that into joint angles. Fixing the tool vertical makes IK closed
  form: base yaw from `atan2`, a two-link law-of-cosines solve for shoulder and elbow, and the wrist
  takes whatever keeps the angles summing to 180°.
- **MoveJ vs MoveL, like a real robot.** MoveJ interpolates joints (fast, curved tool path) for big
  moves; MoveL interpolates the tool position and solves IK every frame (straight line) for the
  final approach and retreat, where a curve could hit the part.
- **The player has no Three.js or React dependency**, so the tests run the whole program in plain
  Node: two full looping cycles, checking the gripper closes exactly on the part at each station,
  never goes into the floor or platform, pause holds, resume doesn't jump, and speed scales time.
- **Grabbing is re-parenting.** `gripper.attach(part)` keeps the part's world transform while making
  it a child of the gripper (Unity's `SetParent(parent, worldPositionStays: true)`). Releasing does
  `scene.attach(part)`, then a few lines of gravity drop it onto the platform or floor.

## Next

- Let the user edit the program: add, reorder and retarget steps, and save programs as JSON
- Collision checking of the links against the platform, not just the tool
- [Snack 3](../snack3-conveyor-physics/): conveyor and physics
