using SolutionFramework;

namespace DoorForcedEmail;

/// <summary>
/// Emails the security desk when a door is forced open. "Emails" means logs, for the demo: the
/// line shows exactly what would be sent. A forced door often reports several times in a row, so
/// the same door doesn't send again within the quiet period.
/// </summary>
public sealed class DoorForcedEmailModule : ISolutionModule
{
    private IModuleContext _context = null!;
    private string _to = "";
    private TimeSpan _quiet;
    private readonly Dictionary<string, DateTimeOffset> _lastSent = new();

    public string Name => "DoorForcedEmail";

    /// <summary>Emails "sent" so far, for tests and for the summary.</summary>
    public int Sent { get; private set; }

    public void Initialize(IModuleContext context)
    {
        _context = context;
        _to = context.Config.Get("To") ?? throw new InvalidOperationException("DoorForcedEmail needs a \"To\" address in modules.json.");
        _quiet = TimeSpan.FromSeconds(context.Config.Get("QuietSeconds", 300));
        context.Logger.Info($"Will email {_to} when a door is forced (at most once per door every {_quiet.TotalMinutes:0} min)");
    }

    public void OnEvent(SecurityEvent e)
    {
        if (e.Kind != SecurityEventKind.DoorForced) return;

        if (_lastSent.TryGetValue(e.DoorId, out var last) && e.OccurredAt - last < _quiet)
        {
            _context.Logger.Info($"{e.DoorName} forced again; already emailed at {last:HH:mm}");
            return;
        }

        _lastSent[e.DoorId] = e.OccurredAt;
        Sent++;
        _context.Logger.Warn($"EMAIL to {_to}: \"Door forced: {e.DoorName} ({e.Location}) at {e.OccurredAt:HH:mm}\"");
    }
}
