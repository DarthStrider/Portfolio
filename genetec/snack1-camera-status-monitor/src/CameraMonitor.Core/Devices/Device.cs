namespace CameraMonitor.Core.Devices;

public enum DeviceType
{
    Camera,
    Door,
}

public enum DeviceStatus
{
    Online,
    Offline,
    Alarm,
}

/// <summary>A camera or door as the simulator knows it. The UI wraps it in a DeviceViewModel.</summary>
public sealed class Device(string id, string name, DeviceType type, string location, DeviceStatus status = DeviceStatus.Online)
{
    public string Id { get; } = id;
    public string Name { get; } = name;
    public DeviceType Type { get; } = type;
    public string Location { get; } = location;
    public DeviceStatus Status { get; set; } = status;
}

/// <summary>One status change, raised by the simulator on its own thread.</summary>
public sealed record StatusChange(string DeviceId, DeviceStatus From, DeviceStatus To, DateTimeOffset At);

/// <summary>The devices in the demo building.</summary>
public static class SampleDevices
{
    public static IReadOnlyList<Device> Create() =>
    [
        new("CAM-01", "Lobby entrance", DeviceType.Camera, "Ground floor"),
        new("CAM-02", "Parking level 1", DeviceType.Camera, "P1"),
        new("CAM-03", "Server room", DeviceType.Camera, "Floor 2"),
        new("CAM-04", "Loading dock", DeviceType.Camera, "Ground floor"),
        new("CAM-05", "Roof access", DeviceType.Camera, "Roof", DeviceStatus.Offline),
        new("DOOR-01", "Main entrance", DeviceType.Door, "Ground floor"),
        new("DOOR-02", "Server room", DeviceType.Door, "Floor 2"),
        new("DOOR-03", "Stairwell B", DeviceType.Door, "Floor 3"),
        new("DOOR-04", "Loading dock", DeviceType.Door, "Ground floor"),
    ];
}
