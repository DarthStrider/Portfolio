# Mini Plugin Framework

**Stack:** C#, .NET 10, reflection, `AssemblyLoadContext`  
**Effort:** ~1 day  
**Status:** Built

Genetec's job ad asks for frameworks so each project doesn't start from scratch. This shows that idea.

## Features

- [x] `ISolutionModule` interface (`Name`, `Initialize`, `OnEvent`)
- [x] Host app loads modules from a folder via reflection and routes simulated events to them
- [x] Two sample modules: "email on door forced" (logs only) and "auto-lock after hours"
- [x] Shared logging + config in a common library
- [x] Each module in its own `AssemblyLoadContext`, sharing the host's copy of the contract
- [x] A module that throws is isolated; three failures in a row switch it off
- [x] Modules act through commands (`LockDoorCommand`), never directly

## Talking point

Connects to Unreal tools and Python build automation work.

## How to run

Needs the [.NET 10 SDK](https://dotnet.microsoft.com/download) (any OS). From
`genetec/snack3-plugin-framework/`:

```powershell
dotnet build ../Genetec.slnx      # builds the modules too, which copies them into artifacts/modules
dotnet run --project src/SolutionFramework.Host
dotnet run --project src/SolutionFramework.Host -- --events 200 --seed 7
dotnet test --project tests/SolutionFramework.Tests
```

The host plays a simulated evening at the building from 17:30, a few minutes per event, so you see
the after-hours rule start at 19:00. Each log line is tagged with the module that wrote it.

## How it's built

```
src/
├── SolutionFramework.Abstractions/   the contract: ISolutionModule, IModuleContext, events, commands
├── SolutionFramework.Common/         logging (sinks, per-module loggers) and modules.json settings
└── SolutionFramework.Host/           solution-host: loader, load context, router, simulated building
    └── modules.json                  one section per module
modules/
├── Directory.Build.targets           copies each built module to artifacts/modules/<Name>/
├── DoorForcedEmail/                  emails (logs) on DoorForced, once per door per quiet period
└── AfterHoursAutoLock/               sends LockDoorCommand for doors left open after hours
tests/SolutionFramework.Tests/        router, loader (real modules, real load contexts), modules, settings, end to end
```

## Design decisions

- **The contract is its own tiny assembly.** Modules reference `SolutionFramework.Abstractions` with
  `Private=false`, so it isn't copied into their folders. At run time each module's load context
  falls back to the host's copy, so `ISolutionModule` is one type everywhere; with two copies the
  host's cast would fail even though the names match. A test checks no module folder ships one.
- **One `AssemblyLoadContext` per module.** A module's own dependencies resolve from its folder
  through its `.deps.json` (`EnableDynamicLoading`), so two modules can use different versions of
  the same library, and the contexts are collectible, so modules could be unloaded.
- **Convention over configuration.** A module is a folder named like its DLL. The loader creates
  every public class implementing the interface, and reports problems (no DLL, not .NET, a
  constructor that throws) instead of stopping.
- **Fault isolation.** The router catches per module. Three consecutive failures switch a module
  off (a circuit breaker), so a bug can't flood the log forever; one success resets the count.
- **Commands, not side effects.** Modules ask the host to act (`ICommandSink.Send`). The host runs
  the commands after every module has seen the event, and publishes what happened (a `DoorLocked`
  event), so modules can react to each other without knowing about each other.
- **Time is injected.** Everything uses `TimeProvider`, so the simulation runs an evening in a
  second and the after-hours rule is tested at 18:59, 19:00 and across midnight.
- **Changing the contract is a breaking change.** Every module compiles against it, so adding a
  member to `ISolutionModule` breaks them all: that would be a major version (see the changelog).
