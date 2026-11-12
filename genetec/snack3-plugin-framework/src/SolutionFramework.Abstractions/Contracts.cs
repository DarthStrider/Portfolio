namespace SolutionFramework;

/// <summary>
/// A pluggable piece of a security solution. The host finds every public class that implements
/// this in the module folders, creates it, calls <see cref="Initialize"/> once, then passes it every
/// event. A module that throws doesn't stop the others.
/// </summary>
public interface ISolutionModule
{
    /// <summary>Also the name of the module's section in modules.json.</summary>
    string Name { get; }

    void Initialize(IModuleContext context);

    void OnEvent(SecurityEvent securityEvent);
}

/// <summary>What the host gives a module: its logger, its settings, a way to act, and the time.</summary>
public interface IModuleContext
{
    IModuleLogger Logger { get; }
    IModuleConfig Config { get; }
    ICommandSink Commands { get; }
    TimeProvider Time { get; }
}

public interface IModuleLogger
{
    void Info(string message);
    void Warn(string message);
    void Error(string message, Exception? exception = null);
}

/// <summary>A module's own settings (its section of modules.json).</summary>
public interface IModuleConfig
{
    string? Get(string key);
    T Get<T>(string key, T defaultValue) where T : IParsable<T>;
}

/// <summary>Modules ask the host to do things through commands; they never touch hardware themselves.</summary>
public interface ICommandSink
{
    void Send(DeviceCommand command);
}

public enum SecurityEventKind
{
    AccessGranted,
    AccessDenied,
    DoorUnlocked,
    DoorLocked,
    DoorHeldOpen,
    DoorForced,
}

public sealed record SecurityEvent(SecurityEventKind Kind, string DoorId, string DoorName, string Location, DateTimeOffset OccurredAt);

public abstract record DeviceCommand(string DoorId, string Reason);

public sealed record LockDoorCommand(string DoorId, string Reason) : DeviceCommand(DoorId, Reason);
