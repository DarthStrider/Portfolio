using SolutionFramework.Common;

namespace SolutionFramework.Host;

/// <summary>
/// Delivers every event to every running module, one at a time and in order. Each module is
/// fenced off: an exception is logged and the next module still gets the event, and a module that
/// fails <see cref="MaxConsecutiveFailures"/> times in a row is switched off (a circuit breaker).
/// Commands modules send while handling an event are carried out after every module has seen it.
/// </summary>
public sealed class EventRouter
{
    public const int MaxConsecutiveFailures = 3;

    private readonly List<Slot> _slots = [];
    private readonly ILogSink _log;
    private readonly TimeProvider _time;
    private readonly ModuleSettings _settings;
    private readonly IDoorController _doors;
    private readonly IModuleLogger _hostLog;
    private readonly Queue<DeviceCommand> _pending = new();

    public EventRouter(ILogSink log, TimeProvider time, ModuleSettings settings, IDoorController doors)
    {
        _log = log;
        _time = time;
        _settings = settings;
        _doors = doors;
        _hostLog = new SourceLogger("host", log, time);
    }

    public IReadOnlyList<string> RunningModules => _slots.Where(s => s.Enabled).Select(s => s.Module.Name).ToList();
    public IReadOnlyList<string> DisabledModules => _slots.Where(s => !s.Enabled).Select(s => s.Module.Name).ToList();

    /// <summary>Initializes the module and adds it. A module whose Initialize throws is not added.</summary>
    public bool Add(ISolutionModule module)
    {
        var context = new ModuleContext(
            new SourceLogger(module.Name, _log, _time),
            _settings.For(module.Name),
            new CommandSink(module.Name, _pending),
            _time);
        try
        {
            module.Initialize(context);
        }
        catch (Exception e)
        {
            _hostLog.Error($"{module.Name} failed to initialize and won't receive events", e);
            return false;
        }
        _slots.Add(new Slot(module));
        _hostLog.Info($"Loaded {module.Name}");
        return true;
    }

    public void Publish(SecurityEvent securityEvent)
    {
        foreach (var slot in _slots.Where(s => s.Enabled))
        {
            try
            {
                slot.Module.OnEvent(securityEvent);
                slot.ConsecutiveFailures = 0;
            }
            catch (Exception e)
            {
                slot.ConsecutiveFailures++;
                _hostLog.Error($"{slot.Module.Name} failed on {securityEvent.Kind} at {securityEvent.DoorId}", e);
                if (slot.ConsecutiveFailures >= MaxConsecutiveFailures)
                {
                    slot.Enabled = false;
                    _hostLog.Warn($"{slot.Module.Name} failed {MaxConsecutiveFailures} times in a row and has been switched off");
                }
            }
        }

        // Carry out commands now, after every module has seen the event. A command can produce a
        // new event (a door locking); that's published too, so modules see the effect of each other.
        while (_pending.TryDequeue(out var command))
        {
            var result = _doors.Execute(command);
            if (result is not null) Publish(result);
        }
    }

    private sealed class Slot(ISolutionModule module)
    {
        public ISolutionModule Module { get; } = module;
        public bool Enabled { get; set; } = true;
        public int ConsecutiveFailures { get; set; }
    }

    private sealed record ModuleContext(IModuleLogger Logger, IModuleConfig Config, ICommandSink Commands, TimeProvider Time) : IModuleContext;

    private sealed class CommandSink(string module, Queue<DeviceCommand> pending) : ICommandSink
    {
        public void Send(DeviceCommand command)
        {
            ArgumentNullException.ThrowIfNull(command);
            pending.Enqueue(command with { Reason = $"{command.Reason} (requested by {module})" });
        }
    }
}

/// <summary>Carries out commands on doors. Returns the event the door reports back, if any.</summary>
public interface IDoorController
{
    SecurityEvent? Execute(DeviceCommand command);
}
