# Changelog

Notable changes to the node-postgres task tracker. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The public contract is the REST API (routes, request
and response fields) plus how the app is run (Docker images, environment variables): breaking either
means a new major version.

## [1.1.0] - 2026-11-12

### Added

- The API's storage is behind a `TaskStore` interface (`src/store.ts`), and the Express app is built
  by `createApp(store)`, so tests can run the real routes against an in-memory store. Behaviour is
  unchanged.
- Tests: validation, every route over HTTP, and one store contract run against memory and
  PostgreSQL (`npm test`); the front end's API client (`npm test` in `frontend/`).
- `npm run typecheck` and `npm run check` in both packages; `engines` and `.nvmrc` pin Node 22.
- CI (`.github/workflows/fullstack-node-postgres.yml`) and Dependabot.

### Changed

- `package-lock.json` for the API and the front end, and Dockerfiles that install with `npm ci`.

## [1.0.0] - 2026-11-08

### Added

- Task tracker: React front end, REST API, database, Docker Compose and Kubernetes manifests.
