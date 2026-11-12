using SolutionFramework.Common;

namespace SolutionFramework.Host;

/// <summary>
/// A pretend building: a few doors producing events on a simulated clock that runs fast, so an
/// evening's worth of activity (including after hours) happens in seconds. It's also the door
/// controller: a lock command locks the door and reports a DoorLocked event.
/// </summary>
public sealed class SimulatedBuilding(Random random, ManualTimeProvider time, ILogSink log) : IDoorController
{
    private readonly ManualTimeProvider _time = time;
    private readonly SourceLogger _log = new("doors", log, time);

    public static readonly (string Id, string Name, string Location)[] Doors =
    [
        ("DOOR-01", "Main entrance", "Ground floor"),
        ("DOOR-02", "Server room", "Floor 2"),
        ("DOOR-03", "Stairwell B", "Floor 3"),
        ("DOOR-04", "Loading dock", "Ground floor"),
    ];

    private readonly HashSet<string> _unlocked = [];

    public IReadOnlyCollection<string> UnlockedDoors => _unlocked;

    /// <summary>Moves the clock forward a few minutes and returns what happened at a random door.</summary>
    public SecurityEvent Next()
    {
        _time.Advance(TimeSpan.FromMinutes(random.Next(2, 12)));
        var door = Doors[random.Next(Doors.Length)];
        var roll = random.Next(100);
        var kind = roll switch
        {
            < 55 => SecurityEventKind.AccessGranted,
            < 70 => SecurityEventKind.AccessDenied,
            < 85 => SecurityEventKind.DoorUnlocked,
            < 93 => SecurityEventKind.DoorHeldOpen,
            _ => SecurityEventKind.DoorForced,
        };
        if (kind == SecurityEventKind.DoorUnlocked) _unlocked.Add(door.Id);
        return new SecurityEvent(kind, door.Id, door.Name, door.Location, _time.GetLocalNow());
    }

    public SecurityEvent? Execute(DeviceCommand command)
    {
        var door = Doors.FirstOrDefault(d => d.Id == command.DoorId);
        if (door.Id is null)
        {
            _log.Warn($"Ignored {command.GetType().Name}: no door {command.DoorId}");
            return null;
        }
        switch (command)
        {
            case LockDoorCommand:
                _unlocked.Remove(door.Id);
                _log.Info($"{door.Name} locked: {command.Reason}");
                return new SecurityEvent(SecurityEventKind.DoorLocked, door.Id, door.Name, door.Location, _time.GetLocalNow());
            default:
                _log.Warn($"Ignored unknown command {command.GetType().Name}");
                return null;
        }
    }
}

/// <summary>A clock the simulation moves by hand. Time zone is the computer's.</summary>
public sealed class ManualTimeProvider(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;

    public override DateTimeOffset GetUtcNow() => _now.ToUniversalTime();
    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;

    public void Advance(TimeSpan by) => _now += by;
}
