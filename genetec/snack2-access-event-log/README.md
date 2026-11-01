# Access Event Log

**Stack:** WPF, SQL Server, Dapper or EF Core, .NET Framework 4.8  
**Effort:** ~1.5 days  
**Status:** Not started

Extends Snack 1 so every status change or badge swipe is saved and searchable.

## Features

- [ ] Tables: `Devices`, `Cardholders`, `AccessEvents` (timestamp, device, cardholder, granted/denied)
- [ ] Repository interface + SQL Server implementation; in-memory implementation for tests
- [ ] Report screen: "denied access by door, last 24 h" and "top 5 noisiest devices", written as real SQL with `GROUP BY` and an index
- [ ] Targets .NET Framework 4.8

## Talking point

Mirrors the L3Harris grading/replay queries.

## How to run

_To come._

## Design decisions

_To come._
