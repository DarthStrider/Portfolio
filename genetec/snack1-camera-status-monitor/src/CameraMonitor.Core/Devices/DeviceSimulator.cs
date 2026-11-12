namespace CameraMonitor.Core.Devices;

/// <summary>Where device status changes come from: the simulator here, real hardware in a real product.</summary>
public interface IDeviceSource : IDisposable
{
    IReadOnlyList<Device> Devices { get; }

    /// <summary>Raised on a background thread. Listeners that touch the UI must marshal to it.</summary>
    event EventHandler<StatusChange>? StatusChanged;

    void Start();

    /// <summary>Records that an operator acknowledged an alarm: the device goes back online.</summary>
    void Acknowledge(string deviceId);
}

/// <summary>
/// Flips a random device's status every few seconds on a thread-pool timer, the way real devices
/// report changes whenever they like. <see cref="Tick"/> is public so tests can drive it without
/// waiting, and the random source can be seeded so a test sees the same changes every run.
/// </summary>
public sealed class DeviceSimulator(IReadOnlyList<Device> devices, Random random, TimeSpan interval) : IDeviceSource
{
    private readonly Lock _gate = new();
    private Timer? _timer;

    public DeviceSimulator() : this(SampleDevices.Create(), new Random(), TimeSpan.FromSeconds(2)) { }

    public IReadOnlyList<Device> Devices { get; } = devices;

    public event EventHandler<StatusChange>? StatusChanged;

    public void Start() => _timer ??= new Timer(_ => Tick(), null, interval, interval);

    /// <summary>Changes one device. Alarms are rare (1 in 6), as they should be.</summary>
    public StatusChange Tick()
    {
        StatusChange change;
        lock (_gate)
        {
            var device = Devices[random.Next(Devices.Count)];
            var next = random.Next(6) switch
            {
                0 => DeviceStatus.Alarm,
                1 or 2 => DeviceStatus.Offline,
                _ => DeviceStatus.Online,
            };
            if (next == device.Status)
                next = device.Status == DeviceStatus.Online ? DeviceStatus.Offline : DeviceStatus.Online;
            change = Set(device, next);
        }
        StatusChanged?.Invoke(this, change);
        return change;
    }

    public void Acknowledge(string deviceId)
    {
        StatusChange? change = null;
        lock (_gate)
        {
            var device = Devices.FirstOrDefault(d => d.Id == deviceId);
            if (device is { Status: DeviceStatus.Alarm })
                change = Set(device, DeviceStatus.Online);
        }
        if (change is not null) StatusChanged?.Invoke(this, change);
    }

    private static StatusChange Set(Device device, DeviceStatus to)
    {
        var change = new StatusChange(device.Id, device.Status, to, DateTimeOffset.Now);
        device.Status = to;
        return change;
    }

    public void Dispose()
    {
        _timer?.Dispose();
        _timer = null;
    }
}
