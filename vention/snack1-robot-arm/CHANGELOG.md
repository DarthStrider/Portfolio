# Changelog

All notable changes to the robot arm are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version in `package.json`
follows [Semantic Versioning](https://semver.org/): MAJOR for changes that can break how someone
runs or uses the project, MINOR for new features, PATCH for fixes.

## [Unreleased]

### Changed

- **Breaking:** requires Node.js 22 or newer (was 20). Node 20 reached end of life in April 2026,
  and `npm test` passes a quoted glob (`"tests/**/*.test.ts"`) that only Node 21+ expands itself.
  Because this can stop the project running for someone on Node 20, the next release is 2.0.0.
- `npm run build` type-checks through the new `typecheck` script.
- Build tools upgraded through Dependabot: Vite 6 → 8 and TypeScript 5.9 → 7.0. Both are major
  versions of development tools only, so nothing changes for anyone using the app.
- CI runs on every push to any branch and every pull request, not only on changes to this folder.
- New shapes default to 10 cm instead of 20 cm, so a new box fits in the gripper.
- **In reach** now means the arm can pick the shape up from above, with the gripper pointing
  straight down. That's less far than before (about 0.8 m instead of 1.05 m at floor level), which
  assumed the whole arm stretched out with the gripper at any angle. The blue ring shrinks to match.
- Five joints in the panel, so keys <kbd>1</kbd>–<kbd>5</kbd> select them.

### Added

- Conveyor lines. Select a belt and extend it one section at a time: a straight of a typed length
  or dragged out with the mouse, a 45° or 90° curve, or a square corner transfer, each placed
  exactly at the end of the last. Move, turn and reverse act on the whole line; deleting a middle
  section splits it. Items go round curves at a constant radius and change direction on
  transfers. Stations (splitters, mergers, machines, bins) stay on straight sections.
  Needs Snack 5's API with conveyor sections.
- `src/conveyors/sections.ts` and `tests/sections.test.ts`.
- Pick and place. **Pick** on a shape, click where it should go, and the arm does it: inverse
  kinematics (from Snack 2) for a gripper pointing straight down, a plan checked for reach and
  joint limits before anything moves, then descend, grip, lift, carry, lower, let go and return
  home. The new position is saved. <kbd>Q</kbd> / <kbd>E</kbd> turn the shape on the way.
- A fifth joint, **Roll**, turning the gripper about its own axis. It lines the fingers up with a
  box's sides and turns what's being carried. It doesn't move the tool center point, so forward
  kinematics is unchanged.
- The gripper can be set to an exact gap (it closes on the shape it's picking) and opens wider:
  12.6 cm between the pads (was 9.6 cm).
- `tests/ik.test.ts` and `tests/pick.test.ts`.
- `npm start`: starts the inventory database and API (Snack 5) in Docker, waits until they're
  ready, then the arm. `npm run start:mongo` does the same with MongoDB, and `npm run db:down`
  stops the containers.
- `npm run typecheck`, `npm run test:coverage` (coverage of `src/`) and `npm run check`
  (type-check and tests, what to run before pushing).
- `.nvmrc` pinning Node 22, matching the new `engines` field in `package.json`.
- `tests/dependencies.test.ts`: the lock file matches `package.json`, every locked version is
  inside its declared range, `three` and `@types/three` are on the same release, and `.nvmrc`
  agrees with `engines`.
- GitHub Actions workflow (`.github/workflows/snack1-robot-arm.yml` at the repository root):
  type-check, tests with coverage and a production build on Node 22 and 24, plus `npm audit` of
  the runtime dependencies.
- Dependabot (`.github/dependabot.yml`): weekly update pull requests, with `three` and
  `@types/three` grouped together and minor/patch tool updates grouped into one.

## [1.0.0] - 2026-11-08

### Added

- 4-joint arm as an `Object3D` hierarchy, with forward kinematics computed from the scene graph
  and by hand, compared every frame.
- Gripper loaded as glTF and generated from code.
- Shapes, conveyor belts, splitters, mergers, joining machines, bins and connection points,
  saved through the Snack 5 inventory API.
