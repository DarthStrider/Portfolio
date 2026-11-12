using SolutionFramework.Common;
using SolutionFramework.Host;

// solution-host [--modules <folder>] [--config <modules.json>] [--events <count>] [--seed <n>]
//
// Loads every module, then plays a simulated evening at the building (from 17:30, a few minutes per
// event) through them. Each module's log lines are prefixed with its name.
var options = Options.Parse(args);
var log = new ConsoleLogSink();
var time = new ManualTimeProvider(new DateTimeOffset(2026, 11, 12, 17, 30, 0, TimeSpan.Zero));
var building = new SimulatedBuilding(new Random(options.Seed), time, log);
var router = new EventRouter(log, time, ModuleSettings.Load(options.Config), building);

Console.WriteLine($"Modules folder: {options.Modules}");
var loaded = ModuleLoader.LoadFrom(options.Modules);
foreach (var problem in loaded.Problems) Console.WriteLine($"  problem: {problem}");
foreach (var module in loaded.Modules) router.Add(module.Module);
if (router.RunningModules.Count == 0)
{
    Console.WriteLine("No modules loaded. Build the solution first (dotnet build), which copies them into the modules folder.");
    return 1;
}

for (var i = 0; i < options.Events; i++) router.Publish(building.Next());

Console.WriteLine();
Console.WriteLine($"Done: {options.Events} events. Running: {string.Join(", ", router.RunningModules)}." +
                  (router.DisabledModules.Count > 0 ? $" Switched off: {string.Join(", ", router.DisabledModules)}." : ""));
return 0;

internal sealed record Options(string Modules, string Config, int Events, int Seed)
{
    public static Options Parse(string[] args)
    {
        string? Value(string name)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }
        return new Options(
            Value("--modules") ?? ModuleLoader.DefaultFolder(),
            Value("--config") ?? Path.Combine(AppContext.BaseDirectory, "modules.json"),
            int.TryParse(Value("--events"), out var events) ? events : 60,
            int.TryParse(Value("--seed"), out var seed) ? seed : 2026);
    }
}
