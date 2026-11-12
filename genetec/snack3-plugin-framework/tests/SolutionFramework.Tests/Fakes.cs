using SolutionFramework.Common;
using SolutionFramework.Host;

namespace SolutionFramework.Tests;

public sealed class FakeContext(string json = "{}", string module = "Test") : IModuleContext
{
    private readonly string _module = module;

    public MemoryLogSink Log { get; } = new();
    public List<DeviceCommand> Sent { get; } = [];

    public IModuleLogger Logger => new SourceLogger(_module, Log, Time);
    public IModuleConfig Config { get; } = ModuleSettings.Parse(json).For(module);
    public ICommandSink Commands => new Sink(Sent);
    public TimeProvider Time { get; } = new ManualTimeProvider(new DateTimeOffset(2026, 11, 12, 12, 0, 0, TimeSpan.Zero));

    private sealed class Sink(List<DeviceCommand> sent) : ICommandSink
    {
        public void Send(DeviceCommand command) => sent.Add(command);
    }
}

/// <summary>A module the test scripts: records what it sees, and can throw or send commands.</summary>
public sealed class ScriptedModule(string name) : ISolutionModule
{
    public string Name { get; } = name;
    public List<SecurityEvent> Seen { get; } = [];
    public Func<SecurityEvent, bool> ThrowWhen { get; set; } = _ => false;
    public Func<SecurityEvent, DeviceCommand?> Reply { get; set; } = _ => null;
    public bool ThrowOnInitialize { get; set; }
    private IModuleContext? _context;

    public void Initialize(IModuleContext context)
    {
        if (ThrowOnInitialize) throw new InvalidOperationException("bad config");
        _context = context;
    }

    public void OnEvent(SecurityEvent e)
    {
        Seen.Add(e);
        if (ThrowWhen(e)) throw new InvalidOperationException("module bug");
        if (Reply(e) is { } command) _context!.Commands.Send(command);
    }
}

public sealed class RecordingDoors : IDoorController
{
    public List<DeviceCommand> Executed { get; } = [];

    public SecurityEvent? Execute(DeviceCommand command)
    {
        Executed.Add(command);
        return command is LockDoorCommand
            ? new SecurityEvent(SecurityEventKind.DoorLocked, command.DoorId, "Door", "Floor", DateTimeOffset.UnixEpoch)
            : null;
    }
}

public static class Events
{
    public static SecurityEvent At(SecurityEventKind kind, string time, string door = "DOOR-01") =>
        new(kind, door, "Server room", "Floor 2", DateTimeOffset.Parse($"2026-11-12T{time}:00+00:00"));
}
