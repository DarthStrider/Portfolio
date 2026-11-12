using CameraMonitor.Core.Devices;
using CameraMonitor.Core.ViewModels;

namespace CameraMonitor.Tests;

/// <summary>Runs every posted action straight away, as if the test were the UI thread.</summary>
public sealed class ImmediateDispatcher : IUiDispatcher
{
    public void Post(Action action) => action();
}

/// <summary>Holds posted actions until <see cref="RunAll"/>, like a UI thread that's busy.</summary>
public sealed class QueuedDispatcher : IUiDispatcher
{
    private readonly Queue<Action> _pending = new();

    public int Pending => _pending.Count;

    public void Post(Action action) => _pending.Enqueue(action);

    public void RunAll()
    {
        while (_pending.TryDequeue(out var action)) action();
    }
}

/// <summary>A device source the test controls: it raises exactly the changes the test asks for.</summary>
public sealed class FakeDeviceSource(params Device[] devices) : IDeviceSource
{
    public IReadOnlyList<Device> Devices { get; } = devices;
    public List<string> Acknowledged { get; } = [];
    public bool Started { get; private set; }

    public event EventHandler<StatusChange>? StatusChanged;

    public void Start() => Started = true;

    public void Acknowledge(string deviceId)
    {
        Acknowledged.Add(deviceId);
        Raise(deviceId, DeviceStatus.Online);
    }

    public void Raise(string deviceId, DeviceStatus to)
    {
        var device = Devices.Single(d => d.Id == deviceId);
        var change = new StatusChange(deviceId, device.Status, to, DateTimeOffset.Now);
        device.Status = to;
        StatusChanged?.Invoke(this, change);
    }

    public void Dispose() { }

    public static FakeDeviceSource Building() => new(
        new Device("CAM-01", "Lobby entrance", DeviceType.Camera, "Ground floor"),
        new Device("CAM-02", "Parking level 1", DeviceType.Camera, "P1", DeviceStatus.Offline),
        new Device("DOOR-01", "Main entrance", DeviceType.Door, "Ground floor"),
        new Device("DOOR-02", "Server room", DeviceType.Door, "Floor 2", DeviceStatus.Alarm));
}
