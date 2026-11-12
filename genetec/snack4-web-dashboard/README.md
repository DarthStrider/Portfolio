# Web Dashboard

**Stack:** ASP.NET Core 10 minimal API, React 19, TypeScript, Vite  
**Effort:** ~0.5 day  
**Status:** Built

A web view of the access events from Snack 2.

## Features

- [x] Tiny ASP.NET Core minimal API serving the events from Snack 2 (its repository, unchanged)
- [x] React + TS page listing them with a status filter (all, granted, denied, status changes) and search
- [x] Both Snack 2 reports, refreshed every 3 seconds
- [x] Runs on Snack 2's SQL Server database, or on its own with in-memory demo data

## How to run

Needs the [.NET 10 SDK](https://dotnet.microsoft.com/download) and Node.js 22+. From
`genetec/snack4-web-dashboard/`:

```powershell
# 1. The API on http://localhost:5080 (in-memory demo data, new events every 2 s)
dotnet run --project api/Dashboard.Api

# 2. In a second terminal: the page on http://localhost:5173, forwarding /api to the API
cd web
npm ci
npm run dev
```

To serve everything from the API on one port instead, run `npm run build` in `web/` (it writes into
the API's `wwwroot`) and open http://localhost:5080.

To show Snack 2's real database, start its SQL Server (`docker compose up -d` in
`snack2-access-event-log/`) and set the connection string before starting the API:

```powershell
$env:ConnectionStrings__AccessLog = "Server=localhost,1433;Database=AccessLog;User Id=sa;Password=AccessLog-dev-Passw0rd;TrustServerCertificate=True"
```

### API

| Path | Query | Result |
|---|---|---|
| `GET /api/events` | `outcome` = all, granted, denied, status; `search`; `limit` (1-500) | Events, newest first |
| `GET /api/reports/denied-by-door` | `hours` (1-168, default 24) | Denied swipes per door |
| `GET /api/reports/noisiest` | `hours`, `top` (1-50, default 5) | Busiest devices |
| `GET /api/health` | | Which store is in use |

Bad parameters get `400` with `{ "error": "..." }`.

### Tests

```powershell
dotnet test --project tests/Dashboard.Api.Tests   # the API over HTTP, in memory, fixed clock
cd web; npm test                                   # query building, colours, times, the API client
```

## Design decisions

- **Reuse, don't rewrite.** The API references `AccessLog.Core` from Snack 2 (which also targets
  .NET 10 for this reason): same model, same SQL, same reports. The API itself is about 60 lines.
- **Validation at the edge.** Every parameter is checked before it reaches the repository, and
  errors use one shape, so the page can show the message as it is.
- **Enums as text.** `JsonStringEnumConverter` sends `"BadgeSwipe"` rather than `0`, so the
  TypeScript types can be string unions that read well and can't drift silently.
- **Tests with a known world.** The test host switches the demo seeding off and replaces the store
  and the clock, so every count in every assertion is known in advance.
- **One origin in production.** The Vite build goes into the API's `wwwroot`, so there's no CORS to
  configure; in development, Vite's proxy does the same job.
