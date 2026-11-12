# Changelog

All notable changes to the Genetec snacks are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version (`<Version>` in
`Directory.Build.props`, shared by every project) follows [Semantic Versioning](https://semver.org/):
MAJOR for changes that can break someone's code or setup, MINOR for new features, PATCH for fixes.

What counts as breaking here:

- **Snack 3:** any change to `SolutionFramework.Abstractions` that existing modules would have to
  follow, such as adding a member to `ISolutionModule` or renaming an event kind.
- **Snack 2:** a schema change that existing databases can't take as they are, or a change to
  `IAccessEventRepository`, which Snack 4 depends on.
- **Snack 4:** removing or renaming an API route, parameter or JSON field.
- **All:** raising the required .NET SDK or Windows version.

## [1.0.0] - 2026-11-12

### Added

- Snack 1, Camera Status Monitor: WPF + MVVM on .NET 10, a background simulator marshalled to the
  UI thread, filter and acknowledge commands, no code-behind; 28 ViewModel and simulator tests.
- Snack 2, Access Event Log: SQL Server schema with constraints and report indexes, Dapper and
  in-memory repositories under one contract, both reports, a .NET Framework 4.8 WPF app.
- Snack 3, Mini Plugin Framework: modules loaded from folders into their own load contexts, a fault
  isolating event router, commands, shared logging and per-module settings, two sample modules.
- Snack 4, Web Dashboard: ASP.NET Core minimal API over Snack 2's repository and a React page.
- `packages.lock.json` for every project, restored with `--locked-mode` in CI.
- GitHub Actions (`.github/workflows/genetec.yml`): Windows build and tests, SQL Server tests on
  Linux, the web page's tests and build, and a check for vulnerable packages.
- Dependabot for NuGet and npm, with xUnit's packages and React's grouped.
