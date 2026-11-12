using AccessLog.Core.Data;
using AccessLog.Core.Model;
using AccessLog.Core.Simulation;

namespace AccessLog.Tests;

public class AccessSimulatorTests
{
    private static readonly DateTime Now = new(2026, 11, 12, 15, 0, 0, DateTimeKind.Utc);

    private static async Task<(AccessSimulator, InMemoryAccessEventRepository)> Seeded(int seed = 1)
    {
        var repo = new InMemoryAccessEventRepository();
        var simulator = new AccessSimulator(repo, new Random(seed), new FixedClock(Now));
        await simulator.SeedAsync();
        return (simulator, repo);
    }

    [Fact]
    public async Task Seeding_adds_the_demo_building_once()
    {
        var (simulator, repo) = await Seeded();
        await simulator.SeedAsync();

        Assert.Equal(SampleData.Devices().Count(), (await repo.GetDevicesAsync()).Count);
        Assert.Equal(SampleData.Cardholders().Count(), (await repo.GetCardholdersAsync()).Count);
    }

    [Fact]
    public async Task Stepping_before_seeding_is_an_error()
    {
        var simulator = new AccessSimulator(new InMemoryAccessEventRepository(), new Random(1), new FixedClock(Now));
        await Assert.ThrowsAsync<InvalidOperationException>(simulator.StepAsync);
    }

    [Fact]
    public async Task Steps_record_valid_swipes_at_doors_and_status_changes_at_cameras()
    {
        var (simulator, repo) = await Seeded();
        for (var i = 0; i < 300; i++) await simulator.StepAsync();

        var devices = (await repo.GetDevicesAsync()).ToDictionary(d => d.Id);
        var events = await repo.SearchAsync(new EventQuery { Limit = 1000 });

        Assert.Equal(300, events.Count);
        Assert.All(events, e =>
        {
            Assert.Equal(Now, e.OccurredAtUtc);
            if (e.Kind == EventKind.BadgeSwipe)
            {
                Assert.Equal(DeviceKind.Door, devices[e.DeviceId].Kind);
                Assert.NotNull(e.CardholderName);
            }
            else
            {
                Assert.Equal(DeviceKind.Camera, devices[e.DeviceId].Kind);
                Assert.Matches("^(Online|Offline|Alarm) → (Online|Offline|Alarm)$", e.Detail);
            }
        });
        Assert.Contains(events, e => e.Kind == EventKind.StatusChange);
        Assert.Contains(events, e => e.Granted == false);
        Assert.True(events.Count(e => e.Granted == true) > events.Count(e => e.Granted == false), "most swipes are granted");
    }

    [Fact]
    public async Task Revoked_badges_are_always_refused()
    {
        var (simulator, repo) = await Seeded();
        for (var i = 0; i < 500; i++) await simulator.StepAsync();

        var revoked = (await repo.GetCardholdersAsync())
            .Where(c => AccessSimulator.RevokedBadges.Contains(c.BadgeNumber)).Select(c => c.Name).ToHashSet();
        var theirSwipes = (await repo.SearchAsync(new EventQuery { Limit = 1000 }))
            .Where(e => e.CardholderName is not null && revoked.Contains(e.CardholderName)).ToList();

        Assert.NotEmpty(theirSwipes);
        Assert.All(theirSwipes, e => Assert.False(e.Granted));
    }

    [Fact]
    public async Task Status_changes_follow_on_from_the_previous_status_of_each_camera()
    {
        var (simulator, repo) = await Seeded(seed: 5);
        for (var i = 0; i < 400; i++) await simulator.StepAsync();

        var changes = (await repo.SearchAsync(new EventQuery { Kind = EventKind.StatusChange, Limit = 1000 }))
            .OrderBy(e => e.Id).GroupBy(e => e.DeviceId);
        foreach (var camera in changes)
        {
            var previous = "Online";
            foreach (var change in camera)
            {
                var parts = change.Detail!.Split(" → ");
                Assert.Equal(previous, parts[0]);
                Assert.NotEqual(parts[0], parts[1]);
                previous = parts[1];
            }
        }
    }

    [Fact]
    public async Task Backfill_spreads_events_over_the_requested_hours()
    {
        var (simulator, repo) = await Seeded();
        await simulator.BackfillAsync(hours: 24, events: 200);

        var events = await repo.SearchAsync(new EventQuery { Limit = 1000 });

        Assert.Equal(200, events.Count);
        Assert.All(events, e => Assert.InRange(e.OccurredAtUtc, Now.AddHours(-24), Now));
        Assert.True(events.Max(e => e.OccurredAtUtc) - events.Min(e => e.OccurredAtUtc) > TimeSpan.FromHours(12));
    }
}
