# Changelog

Notable changes to the dotnet-sqlserver task tracker. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The public contract is the REST API (routes, request
and response fields) plus how the app is run (Docker images, environment variables): breaking either
means a new major version.

## [1.1.0] - 2026-11-12

### Added

- `TaskRules.IsValidTitle` (was a local function in Program.cs) so it can be unit-tested, and
  `public partial class Program` so `WebApplicationFactory<Program>` can start the app in tests.
- xUnit v3 tests: the title rule, and every endpoint against a real SQL Server database (skipped
  without one); `TaskApi.slnx` and `global.json`.
- The front end's API client tests, and `typecheck`, `test` and `check` scripts; `.nvmrc` pins Node 22.
- CI (`.github/workflows/fullstack-dotnet-sqlserver.yml`) and Dependabot.

### Changed

- `packages.lock.json` for the API and the tests, restored with `--locked-mode` in Docker and CI, and
  `frontend/package-lock.json` installed with `npm ci`.
- EF Core 10.0.0 → 10.0.15. 10.0.0 depends on a `System.Security.Cryptography.Pkcs` with a known
  high-severity vulnerability; the patch release depends on a fixed one. A patch bump: nothing
  else changes.

## [1.0.0] - 2026-11-08

### Added

- Task tracker: React front end, REST API, database, Docker Compose and Kubernetes manifests.
