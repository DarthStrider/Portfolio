using CameraMonitor.Core.Devices;
using CameraMonitor.Core.Mvvm;

namespace CameraMonitor.Core.ViewModels;

/// <summary>One row in the device list.</summary>
public sealed class DeviceViewModel(Device device) : ObservableObject
{
    private readonly Device _device = device;
    private DeviceStatus _status = device.Status;
    private DateTimeOffset? _lastChanged;

    public string Id => _device.Id;
    public string Name => _device.Name;
    public DeviceType Type => _device.Type;
    public string Location => _device.Location;

    public DeviceStatus Status
    {
        get => _status;
        set
        {
            if (SetProperty(ref _status, value)) OnPropertyChanged(nameof(IsAlarm));
        }
    }

    public bool IsAlarm => Status == DeviceStatus.Alarm;

    public DateTimeOffset? LastChanged
    {
        get => _lastChanged;
        set => SetProperty(ref _lastChanged, value);
    }

    /// <summary>Does this row match the filter text? Name, location, type and status all count.</summary>
    public bool Matches(string filter) =>
        string.IsNullOrWhiteSpace(filter) ||
        new[] { Name, Location, Id, Type.ToString(), Status.ToString() }
            .Any(field => field.Contains(filter.Trim(), StringComparison.OrdinalIgnoreCase));
}
