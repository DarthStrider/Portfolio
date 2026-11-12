using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AccessLog.Core.Data;
using AccessLog.Core.Model;

namespace AccessLog.Core.Simulation;

/// <summary>The current time, injectable so tests can fix it.</summary>
public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

/// <summary>
/// Generates the building's activity: badge swipes at doors (mostly granted; a few badges are
/// always refused) and camera status changes, the same kind Snack 1 shows live. Every event goes
/// through the repository, so it's saved and searchable.
/// </summary>
public sealed class AccessSimulator(IAccessEventRepository repository, Random random, IClock clock)
{
    private IReadOnlyList<Device> _doors = [];
    private IReadOnlyList<Device> _cameras = [];
    private IReadOnlyList<Cardholder> _cardholders = [];
    private readonly Dictionary<int, string> _cameraStatus = new();

    /// <summary>Badge numbers that are always refused (expired or revoked).</summary>
    public static readonly string[] RevokedBadges = ["B-1009", "B-1010"];

    /// <summary>Adds the demo devices and cardholders if the store is empty, then loads them.</summary>
    public async Task SeedAsync()
    {
        if ((await repository.GetDevicesAsync()).Count == 0)
        {
            foreach (var device in SampleData.Devices()) await repository.AddDeviceAsync(device);
            foreach (var cardholder in SampleData.Cardholders()) await repository.AddCardholderAsync(cardholder);
        }

        var devices = await repository.GetDevicesAsync();
        _doors = devices.Where(d => d.Kind == DeviceKind.Door).ToList();
        _cameras = devices.Where(d => d.Kind == DeviceKind.Camera).ToList();
        _cardholders = await repository.GetCardholdersAsync();
    }

    /// <summary>Fills the last <paramref name="hours"/> with history, so the reports have something to show.</summary>
    public async Task BackfillAsync(int hours, int events)
    {
        var start = clock.UtcNow.AddHours(-hours);
        var times = Enumerable.Range(0, events)
            .Select(_ => start.AddSeconds(random.NextDouble() * hours * 3600))
            .OrderBy(t => t);
        foreach (var at in times) await StepAsync(at);
    }

    /// <summary>Records one event, now.</summary>
    public Task<AccessEvent> StepAsync() => StepAsync(clock.UtcNow);

    private async Task<AccessEvent> StepAsync(DateTime atUtc)
    {
        if (_doors.Count == 0) throw new InvalidOperationException("Call SeedAsync first.");

        var accessEvent = random.Next(100) < 85 ? Swipe(atUtc) : StatusChange(atUtc);
        await repository.RecordAsync(accessEvent);
        return accessEvent;
    }

    private AccessEvent Swipe(DateTime atUtc)
    {
        // Some doors are busier than others: pick from the first doors more often.
        var door = _doors[Math.Min(random.Next(_doors.Count) , random.Next(_doors.Count))];
        var cardholder = _cardholders[random.Next(_cardholders.Count)];
        var granted = !RevokedBadges.Contains(cardholder.BadgeNumber) && random.Next(100) < 92;
        return new AccessEvent
        {
            OccurredAtUtc = atUtc,
            DeviceId = door.Id,
            CardholderId = cardholder.Id,
            Kind = EventKind.BadgeSwipe,
            Granted = granted,
            Detail = granted ? null : "Badge refused",
        };
    }

    private AccessEvent StatusChange(DateTime atUtc)
    {
        var camera = _cameras[random.Next(_cameras.Count)];
        var from = _cameraStatus.TryGetValue(camera.Id, out var current) ? current : "Online";
        var options = new[] { "Online", "Offline", "Alarm" }.Where(s => s != from).ToArray();
        var to = options[random.Next(options.Length)];
        _cameraStatus[camera.Id] = to;
        return new AccessEvent
        {
            OccurredAtUtc = atUtc,
            DeviceId = camera.Id,
            Kind = EventKind.StatusChange,
            Detail = $"{from} → {to}",
        };
    }
}

/// <summary>The demo building: the same devices as Snack 1, plus the people who badge in.</summary>
public static class SampleData
{
    public static IEnumerable<Device> Devices() =>
    [
        new Device { Name = "Main entrance", Kind = DeviceKind.Door, Location = "Ground floor" },
        new Device { Name = "Server room", Kind = DeviceKind.Door, Location = "Floor 2" },
        new Device { Name = "Stairwell B", Kind = DeviceKind.Door, Location = "Floor 3" },
        new Device { Name = "Loading dock", Kind = DeviceKind.Door, Location = "Ground floor" },
        new Device { Name = "Lobby entrance", Kind = DeviceKind.Camera, Location = "Ground floor" },
        new Device { Name = "Parking level 1", Kind = DeviceKind.Camera, Location = "P1" },
        new Device { Name = "Server room camera", Kind = DeviceKind.Camera, Location = "Floor 2" },
        new Device { Name = "Roof access", Kind = DeviceKind.Camera, Location = "Roof" },
    ];

    public static IEnumerable<Cardholder> Cardholders() =>
    [
        new Cardholder { Name = "Amélie Tremblay", BadgeNumber = "B-1001" },
        new Cardholder { Name = "Jonathan Roy", BadgeNumber = "B-1002" },
        new Cardholder { Name = "Priya Natarajan", BadgeNumber = "B-1003" },
        new Cardholder { Name = "Marc-André Gagnon", BadgeNumber = "B-1004" },
        new Cardholder { Name = "Sofia Rossi", BadgeNumber = "B-1005" },
        new Cardholder { Name = "Daniel Okafor", BadgeNumber = "B-1006" },
        new Cardholder { Name = "Chloé Bouchard", BadgeNumber = "B-1007" },
        new Cardholder { Name = "Kevin Nguyen", BadgeNumber = "B-1008" },
        new Cardholder { Name = "Former contractor", BadgeNumber = "B-1009" },
        new Cardholder { Name = "Lost badge", BadgeNumber = "B-1010" },
    ];
}
