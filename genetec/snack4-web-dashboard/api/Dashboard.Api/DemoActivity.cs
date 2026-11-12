using AccessLog.Core.Data;
using AccessLog.Core.Simulation;

namespace Dashboard.Api;

/// <summary>
/// Seeds the demo building and a day of history if the store is empty, then (unless
/// Demo:LiveEvents is false) records a new event every two seconds, like Snack 2's app does.
/// </summary>
public sealed class DemoActivity(IAccessEventRepository repository, IClock clock, IConfiguration config, ILogger<DemoActivity> log)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!config.GetValue("Demo:Seed", true)) return;

        var simulator = new AccessSimulator(repository, new Random(), clock);
        await simulator.SeedAsync();
        if ((await repository.SearchAsync(new AccessLog.Core.Model.EventQuery { Limit = 1 })).Count == 0)
            await simulator.BackfillAsync(hours: 24, events: 400);
        log.LogInformation("Demo building ready");

        if (!config.GetValue("Demo:LiveEvents", true)) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
            await simulator.StepAsync();
    }
}
