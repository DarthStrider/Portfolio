# Vention projects

A set of small projects mirroring Vention's stack: browser-based 3D design and robot simulation in TypeScript, React UI wired to a live scene, and real-time performance in WebGL.

| # | Project | Stack | Effort | Status |
|---|---|---|---|---|
| 1 | [Robot Arm in the Browser](snack1-robot-arm/) | Three.js, TypeScript, glTF | ~1.5 days | Built |
| 2 | [React Control Panel](snack2-control-panel/) | React, TypeScript, Three.js | ~1 day | Built |
| 3 | [Conveyor + Physics](snack3-conveyor-physics/) | Three.js, custom physics, cannon-es | ~1.5 days | Built |
| 4 | [Legacy Refactor Kata](snack4-refactor-kata/) | TypeScript, unit tests | ~0.5 day | Built |
| 5 | [Parts Inventory](snack5-inventory/) | Node.js, React, PostgreSQL or MongoDB, Docker, Kubernetes | ~1 day | Built |

---

## Snack 1 — Robot arm in the browser (Three.js + TypeScript)

- 3- or 4-joint arm built as an `Object3D` hierarchy; each joint rotates on its own axis
- Forward kinematics: show the end-effector's world position live
- Load one part as glTF (reusing Hoppin World experience)
- Orbit camera, grid floor, simple lighting

**Talking point:** "Same transform hierarchy as Unity; here's what's different in Three.js."

## Snack 2 — React control panel

- Sidebar with a slider per joint, plus Play/Pause for a scripted motion sequence (pick → move → place)
- State lives in React; the 3D scene reads it (react-three-fiber, or a plain Three.js scene with a ref)
- Shows UI state connected to a simulation without re-rendering the whole scene each frame

**Talking point:** echoes MachineLogic, which simulates robot sequences before purchase.

## Snack 3 — Conveyor + physics

- Boxes spawn onto a moving conveyor and fall into a bin
- Own fixed-timestep loop and simple AABB collision, then compared with a library like Rapier or cannon-es
- FPS counter; stress test with 500+ boxes and show what was optimised (instancing, object pooling)

**Talking point:** Quest/PSVR2 optimisation work, applied to WebGL.

## Snack 4 — Legacy refactor kata

- Take a messy ~200-line TypeScript file (written quickly, or a known kata like Gilded Rose in TS)
- Add tests first, then refactor step by step with small commits

**Talking point:** the posting's "modernise legacy code" line, and the PlayFab save-system refactor.

## Snack 5 — Parts inventory (PostgreSQL or MongoDB)

- Stock of the parts the other snacks use, with low-stock alerts and a ledger of every movement
- Check a machine design (Snack 4's format) against stock, including how many 3 m bars a cut list needs, and reserve it for a quote, all or nothing
- One repository interface, implemented for PostgreSQL (transactions, row locks, CHECK constraints) and MongoDB (atomic conditional updates); the same contract tests run on both
- Docker Compose profile per database, Kubernetes overlays, two API replicas

**Talking point:** the same business rules on a relational and a document database, and what each one guarantees under concurrent requests.
