using System.Collections.ObjectModel;
using System.Windows.Input;
using CameraMonitor.Core.Devices;
using CameraMonitor.Core.Mvvm;

namespace CameraMonitor.Core.ViewModels;

/// <summary>
/// Everything the window shows and does. The window only binds to these properties and commands,
/// so all the behaviour (filtering, counts, acknowledging, thread hand-off) is tested without it.
/// </summary>
public sealed class MainViewModel : ObservableObject
{
    public const int MaxRecentChanges = 50;

    private readonly IDeviceSource _source;
    private readonly IUiDispatcher _dispatcher;
    private readonly Dictionary<string, DeviceViewModel> _byId;
    private string _filterText = "";
    private DeviceViewModel? _selectedDevice;
    private readonly RelayCommand _acknowledgeAlarm;

    public MainViewModel(IDeviceSource source, IUiDispatcher dispatcher)
    {
        _source = source;
        _dispatcher = dispatcher;
        AllDevices = source.Devices.Select(d => new DeviceViewModel(d)).ToList();
        _byId = AllDevices.ToDictionary(d => d.Id);
        _acknowledgeAlarm = new RelayCommand(AcknowledgeSelected, () => SelectedDevice?.IsAlarm == true);
        ClearFilterCommand = new RelayCommand(() => FilterText = "", () => FilterText.Length > 0);
        ApplyFilter();

        // The source raises this on its own thread; hop to the UI thread before touching anything bound.
        _source.StatusChanged += (_, change) => _dispatcher.Post(() => Apply(change));
    }

    public IReadOnlyList<DeviceViewModel> AllDevices { get; }

    /// <summary>The rows the list shows: AllDevices narrowed by the filter, in the same order.</summary>
    public ObservableCollection<DeviceViewModel> VisibleDevices { get; } = [];

    /// <summary>Newest first, capped at <see cref="MaxRecentChanges"/>.</summary>
    public ObservableCollection<string> RecentChanges { get; } = [];

    public string FilterText
    {
        get => _filterText;
        set
        {
            if (!SetProperty(ref _filterText, value ?? "")) return;
            ApplyFilter();
            ClearFilterCommand.RaiseCanExecuteChanged();
        }
    }

    public DeviceViewModel? SelectedDevice
    {
        get => _selectedDevice;
        set
        {
            if (SetProperty(ref _selectedDevice, value)) _acknowledgeAlarm.RaiseCanExecuteChanged();
        }
    }

    public ICommand AcknowledgeAlarmCommand => _acknowledgeAlarm;

    public RelayCommand ClearFilterCommand { get; }

    public int OnlineCount => AllDevices.Count(d => d.Status == DeviceStatus.Online);
    public int OfflineCount => AllDevices.Count(d => d.Status == DeviceStatus.Offline);
    public int AlarmCount => AllDevices.Count(d => d.Status == DeviceStatus.Alarm);

    public void Start() => _source.Start();

    private void AcknowledgeSelected()
    {
        if (SelectedDevice is { IsAlarm: true } device) _source.Acknowledge(device.Id);
    }

    /// <summary>Applies one change from the source. Always called on the UI thread.</summary>
    private void Apply(StatusChange change)
    {
        if (!_byId.TryGetValue(change.DeviceId, out var device)) return;
        device.Status = change.To;
        device.LastChanged = change.At;

        RecentChanges.Insert(0, $"{change.At:HH:mm:ss}  {device.Name} ({device.Id}): {change.From} → {change.To}");
        while (RecentChanges.Count > MaxRecentChanges) RecentChanges.RemoveAt(RecentChanges.Count - 1);

        OnPropertyChanged(nameof(OnlineCount));
        OnPropertyChanged(nameof(OfflineCount));
        OnPropertyChanged(nameof(AlarmCount));
        _acknowledgeAlarm.RaiseCanExecuteChanged();

        // A status change can move a device in or out of a filter like "alarm".
        if (FilterText.Length > 0) ApplyFilter();
    }

    /// <summary>Updates VisibleDevices in place, so the list keeps its selection and scroll position.</summary>
    private void ApplyFilter()
    {
        var wanted = AllDevices.Where(d => d.Matches(FilterText)).ToList();
        for (var i = VisibleDevices.Count - 1; i >= 0; i--)
            if (!wanted.Contains(VisibleDevices[i])) VisibleDevices.RemoveAt(i);
        for (var i = 0; i < wanted.Count; i++)
        {
            if (i < VisibleDevices.Count && VisibleDevices[i] == wanted[i]) continue;
            VisibleDevices.Insert(i, wanted[i]);
        }
        if (SelectedDevice is not null && !VisibleDevices.Contains(SelectedDevice)) SelectedDevice = null;
    }
}
