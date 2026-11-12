# Access Event Log

**Stack:** WPF on .NET Framework 4.8, SQL Server, Dapper, C#  
**Effort:** ~1.5 days  
**Status:** Built

Extends Snack 1 so every status change or badge swipe is saved and searchable.

## Features

- [x] Tables: `Devices`, `Cardholders`, `AccessEvents` (timestamp, device, cardholder, granted/denied), with foreign keys and a `CHECK` that a badge swipe has a cardholder and a decision
- [x] Repository interface + SQL Server implementation (Dapper); in-memory implementation for tests
- [x] Report screen: "denied access by door, last 24 h" and "top 5 noisiest devices", written as real SQL with `GROUP BY` and an index
- [x] Targets .NET Framework 4.8 (the shared library also targets .NET 10, for tests and Snack 4)
- [x] Search by door, camera, location or cardholder, filter by outcome
- [x] The same contract tests run against both stores; the SQL Server run checks the query plan uses the index

## Talking point

Mirrors the L3Harris grading/replay queries.

## How to run

Needs Windows, the [.NET 10 SDK](https://dotnet.microsoft.com/download) (it builds .NET Framework
projects too) and, for SQL Server, Docker Desktop. From `genetec/snack2-access-event-log/`:

```powershell
docker compose up -d          # SQL Server 2022 on localhost:1433
dotnet run --project src/AccessLog.App
```

The app creates the `AccessLog` database on first run, seeds the demo building and a day of
history, then records a new event every 1.5 seconds. The status bar says which store it's using.
Without Docker it falls back to an in-memory store and says so.

To use another server (LocalDB, say), set the connection string first:

```powershell
$env:ACCESSLOG_CONNECTION = "Server=(localdb)\MSSQLLocalDB;Database=AccessLog;Integrated Security=True"
```

### Tests

```powershell
dotnet test --project tests/AccessLog.Tests                      # in-memory contract, ViewModel, simulator
$env:TEST_SQLSERVER = "Server=localhost,1433;User Id=sa;Password=AccessLog-dev-Passw0rd;TrustServerCertificate=True"
dotnet test --project tests/AccessLog.Tests                      # + the same contract on SQL Server
```

The SQL Server tests create a throwaway database per test and drop it afterwards, so they never
touch `AccessLog`. Without `TEST_SQLSERVER` they're reported as skipped.

## How it's built

```
src/
├── AccessLog.Core/                net48 + net10.0
│   ├── Model/Model.cs             Device, Cardholder, AccessEvent, the report rows, EventQuery
│   ├── Data/schema.sql            tables, constraints and the two indexes (embedded resource)
│   ├── Data/IAccessEventRepository.cs
│   ├── Data/SqlServerAccessEventRepository.cs   Dapper, one SQL statement per method
│   ├── Data/InMemoryAccessEventRepository.cs    LINQ, same behaviour
│   ├── Simulation/AccessSimulator.cs            badge swipes and camera status changes
│   ├── Mvvm/Mvvm.cs               ObservableObject, AsyncRelayCommand
│   └── ViewModels/EventLogViewModel.cs
└── AccessLog.App/                 net48 WPF: MainWindow.xaml (Events and Reports tabs), the locator
tests/AccessLog.Tests/             RepositoryContract + InMemory/SqlServer runs, ViewModel, simulator
docker-compose.yml                 SQL Server for local runs
```

## Design decisions

- **Dapper, not EF Core.** The reports are the point of this snack, so they're SQL you can read:
  `GROUP BY` the door, filter on a time window. EF Core 3+ doesn't support .NET Framework anyway.
- **The index matches the reports.** Both reports filter on `OccurredAtUtc` and group by device, so
  `IX_AccessEvents_OccurredAt` is keyed on time and `INCLUDE`s `DeviceId`, `Granted` and `Kind`:
  "the last 24 h" is a range seek and the table itself is never read. A test asks SQL Server for
  the plan and checks the index is in it.
- **One search statement.** Every filter is written `(@x IS NULL OR column = @x)`, with
  `OPTION (RECOMPILE)` so SQL Server plans for the filters actually given each time instead of
  reusing a plan made for different ones.
- **Contract tests.** `RepositoryContract` holds every rule (ordering, time windows inclusive at the
  start and exclusive at the end, text search ignoring case and treating `%` literally, reports).
  It runs against both stores, which is what lets the in-memory one stand in for SQL Server in the
  ViewModel tests.
- **UTC everywhere.** `DATETIME2` has no time zone, so events are stored in UTC and marked UTC when
  read back. Only the window converts to local time.
- **Multi-targeting.** `AccessLog.Core` builds for `net48` (the app) and `net10.0` (tests and
  Snack 4's web API), so it sticks to APIs both have.
- **A vulnerable transitive package, overridden.** `Microsoft.Data.SqlClient` depends on versions of
  `System.Security.Cryptography.Pkcs` with known vulnerabilities; referencing a patched version
  directly makes NuGet use it instead. CI fails if a high or critical advisory comes back.
