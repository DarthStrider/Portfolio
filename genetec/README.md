# Genetec projects

A set of small projects mirroring Genetec's stack: desktop security software in C#/WPF, SQL Server, and extensible solution frameworks.

| # | Project | Stack | Effort | Status |
|---|---|---|---|---|
| 1 | [Camera Status Monitor](snack1-camera-status-monitor/) | WPF, MVVM, .NET 10 | ~1.5 days | Built |
| 2 | [Access Event Log](snack2-access-event-log/) | WPF, SQL Server, Dapper, .NET Framework 4.8 | ~1.5 days | Built |
| 3 | [Mini Plugin Framework](snack3-plugin-framework/) | C#, reflection, AssemblyLoadContext | ~1 day | Built |
| 4 | [Web Dashboard](snack4-web-dashboard/) _(optional)_ | ASP.NET Core, React, TypeScript | ~0.5 day | Built |

## Building and testing

All four snacks are in one solution, `Genetec.slnx`. With the [.NET 10 SDK](https://dotnet.microsoft.com/download)
(Windows for the two WPF apps):

```powershell
cd genetec
dotnet restore --locked-mode   # exactly the versions in each packages.lock.json
dotnet build
dotnet test
```

Each snack's README covers running it. `global.json` pins the SDK (any 10.0 feature band) and opts
into Microsoft.Testing.Platform, which xUnit v3 needs with `dotnet test` on .NET 10.

- **CI:** `.github/workflows/genetec.yml` runs on every push and pull request. It builds everything
  on Windows with warnings as errors, runs all the tests, runs Snack 2's database tests against a
  real SQL Server on Linux, tests and builds Snack 4's page, and fails on high or critical package
  vulnerabilities and on any project without a committed lock file.
- **Versions:** see [CHANGELOG.md](CHANGELOG.md); `Directory.Build.props` holds the version.
- **Updates:** Dependabot opens weekly pull requests for NuGet and npm packages.
- **Walkthrough:** [Four Snacks, Line by Line](walkthrough/genetec-snacks-book.pdf) explains every project.

---

## Snack 1 — Camera Status Monitor (WPF + MVVM)

A desktop dashboard listing fake cameras and doors with live status.

- `ListView` of devices (name, type, location, status), coloured via a converter: green Online, grey Offline, red Alarm
- Background `DeviceSimulator` randomly flips statuses every few seconds; UI updates through the Dispatcher
- Filter box and "Acknowledge alarm" button bound to an `ICommand`
- Zero code-behind except `InitializeComponent()`

**Talking point:** "I kept the view dumb so the same ViewModel could be unit-tested or reused in another plugin."

## Snack 2 — Access Event Log (WPF + SQL Server)

Extends Snack 1 so every status change or badge swipe is saved and searchable.

- Tables: `Devices`, `Cardholders`, `AccessEvents` (timestamp, device, cardholder, granted/denied)
- Repository interface + SQL Server implementation (Dapper or EF Core); in-memory implementation for tests
- Report screen: "denied access by door, last 24 h" and "top 5 noisiest devices", written as real SQL with `GROUP BY` and an index
- Targets .NET Framework 4.8

**Talking point:** mirrors the L3Harris grading/replay queries.

## Snack 3 — Mini plugin framework

Genetec's job ad asks for frameworks so each project doesn't start from scratch. This shows that idea.

- `ISolutionModule` interface (`Name`, `Initialize`, `OnEvent`)
- Host app loads modules from a folder via reflection and routes simulated events to them
- Two sample modules: "email on door forced" (logs only) and "auto-lock after hours"
- Shared logging + config in a common library

**Talking point:** connects to Unreal tools and Python build automation work.

## Snack 4 (optional) — Web dashboard (React + TypeScript)

- Tiny ASP.NET Core minimal API serving the events from Snack 2
- React + TS page listing them with a status filter
- Only if the earlier snacks went to plan; WPF and French matter more
