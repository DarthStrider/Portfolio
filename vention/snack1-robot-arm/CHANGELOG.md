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

### Added

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
