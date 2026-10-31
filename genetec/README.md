# Genetec projects

A set of small projects mirroring Genetec's stack: desktop security software in C#/WPF, SQL Server, and extensible solution frameworks.

| # | Project | Stack | Effort | Status |
|---|---|---|---|---|
| 1 | [Camera Status Monitor](snack1-camera-status-monitor/) | WPF, MVVM | ~1.5 days | Not started |
| 2 | [Access Event Log](snack2-access-event-log/) | WPF, SQL Server, .NET Framework 4.8 | ~1.5 days | Not started |
| 3 | [Mini Plugin Framework](snack3-plugin-framework/) | C#, reflection | ~1 day | Not started |
| 4 | [Web Dashboard](snack4-web-dashboard/) _(optional)_ | ASP.NET Core, React, TypeScript | ~0.5 day | Not started |

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
