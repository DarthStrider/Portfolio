using System.Globalization;
using SolutionFramework;

namespace AfterHoursAutoLock;

/// <summary>
/// After hours, a door that's unlocked or held open is locked again straight away. The window is
/// set in modules.json (Start and End as HH:mm) and may cross midnight, e.g. 19:00 to 07:00.
/// </summary>
public sealed class AfterHoursAutoLockModule : ISolutionModule
{
    private IModuleContext _context = null!;

    public string Name => "AfterHoursAutoLock";

    public TimeOnly Start { get; private set; } = new(19, 0);
    public TimeOnly End { get; private set; } = new(7, 0);

    public void Initialize(IModuleContext context)
    {
        _context = context;
        Start = ReadTime("Start", Start);
        End = ReadTime("End", End);
        context.Logger.Info($"Locks doors left open between {Start:HH:mm} and {End:HH:mm}");
    }

    /// <summary>Is this time inside the after-hours window? Handles windows that cross midnight.</summary>
    public bool IsAfterHours(TimeOnly time) =>
        Start <= End
            ? time >= Start && time < End          // e.g. 01:00 to 05:00
            : time >= Start || time < End;         // e.g. 19:00 to 07:00

    public void OnEvent(SecurityEvent e)
    {
        if (e.Kind is not (SecurityEventKind.DoorUnlocked or SecurityEventKind.DoorHeldOpen)) return;
        if (!IsAfterHours(TimeOnly.FromDateTime(e.OccurredAt.DateTime))) return;

        _context.Commands.Send(new LockDoorCommand(e.DoorId, $"{e.Kind} after hours at {e.OccurredAt:HH:mm}"));
    }

    private TimeOnly ReadTime(string key, TimeOnly fallback)
    {
        var text = _context.Config.Get(key);
        if (text is null) return fallback;
        return TimeOnly.TryParseExact(text, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)
            ? time
            : throw new InvalidOperationException($"AfterHoursAutoLock: {key} must be HH:mm, not \"{text}\".");
    }
}
