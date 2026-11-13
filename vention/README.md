# Vention projects

A set of small projects mirroring Vention's stack: browser-based 3D design and robot simulation in TypeScript, React UI wired to a live scene, and real-time performance in WebGL.

| # | Project | Stack | Effort | Status |
|---|---|---|---|---|
| 1 | [Robot Arm in the Browser](snack1-robot-arm/) | Three.js, TypeScript, glTF | ~1.5 days | Built |
| 2 | [React Control Panel](snack2-control-panel/) | React, TypeScript, Three.js | ~1 day | Built |
| 3 | [Conveyor + Physics](snack3-conveyor-physics/) | Three.js, custom physics, cannon-es | ~1.5 days | Built |
| 4 | [Legacy Refactor Kata](snack4-refactor-kata/) | TypeScript, unit tests | ~0.5 day | Built |
| 5 | [Parts Inventory](snack5-inventory/) | Node.js, React, PostgreSQL or MongoDB, Docker, Kubernetes | ~1 day | Built |

**Walkthrough:** [Five Snacks, Line by Line](walkthrough/vention-snacks-book.pdf) (PDF, 578 pages) explains every project line by line, with concepts, diagrams, interview questions and exercises, including the robot arm's shapes, conveyor belts, rule-driven splitters, mergers, joining machines, connection points, and bins that catch items, feed belts or machines, and load many items at once by list or by rule. Appendix C, *Keeping Snack 1 working*, covers dependency management, semantic versioning and breaking changes, and the tests and CI that check every change. Appendix D, *Picking things up*, covers pick and place: inverse kinematics, the roll joint, and robot programs planned before they run. Appendix E, *Building conveyor lines*, builds belts into lines one section at a time: straights dragged to length, curves, corner transfers, and whole-line edits saved all or none, on a 20 m floor with camera controls.

Each snack also has its own walkthrough, the same chapter with its own contents and page numbers:

| Snack | Walkthrough | Pages |
|---|---|---|
| 1 | [Robot Arm in the Browser](walkthrough/snack1-robot-arm-walkthrough.pdf) (includes Appendices C and D) | 244 |
| 2 | [React Control Panel](walkthrough/snack2-control-panel-walkthrough.pdf) | 59 |
| 3 | [Conveyor + Physics](walkthrough/snack3-conveyor-physics-walkthrough.pdf) | 70 |
| 4 | [Legacy Refactor Kata](walkthrough/snack4-refactor-kata-walkthrough.pdf) | 46 |
| 5 | [Parts Inventory](walkthrough/snack5-inventory-walkthrough.pdf) | 157 |

## Run all five with one command

From this folder, with Docker Desktop running:

```
npm start
```

| Snack | What starts | Where |
|---|---|---|
| 5 | Parts inventory: database, API and page, in Docker | http://localhost:8081 |
| 4 | No app: prints a sample quote and runs its tests, once | in the terminal |
| 1 | Robot arm (saves to Snack 5) | http://localhost:5173 |
| 2 | React control panel | http://localhost:5174 |
| 3 | Conveyor + physics | http://localhost:5175 |

The first run installs each snack's packages and builds the inventory's Docker images, which takes a few
minutes; after that it's quick. Each line of output is tagged with the snack it came from.

- `npm run start:open` does the same and opens the pages in your browser.
- `npm run start:mongo` uses MongoDB for Snack 5 instead of PostgreSQL.
- <kbd>Ctrl</kbd>+<kbd>C</kbd> stops the web servers. The database keeps running, so the next start is
  fast; `npm run stop` stops it.

It's [`start-all.mjs`](start-all.mjs): plain Node with no packages of its own. After pulling changes,
run `npm ci` in a snack's folder if its dependencies changed (the launcher only installs a snack's packages
the first time). To work on one snack, use its own commands, listed in its README.

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
