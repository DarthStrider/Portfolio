using System.ComponentModel;
using CameraMonitor.Core.Devices;
using CameraMonitor.Core.ViewModels;

namespace CameraMonitor.Tests;

public class MainViewModelTests
{
    private static (MainViewModel vm, FakeDeviceSource source) Create()
    {
        var source = FakeDeviceSource.Building();
        return (new MainViewModel(source, new ImmediateDispatcher()), source);
    }

    private static DeviceViewModel Row(MainViewModel vm, string id) => vm.AllDevices.Single(d => d.Id == id);

    [Fact]
    public void Shows_every_device_with_its_starting_status()
    {
        var (vm, _) = Create();

        Assert.Equal(new[] { "CAM-01", "CAM-02", "DOOR-01", "DOOR-02" }, vm.VisibleDevices.Select(d => d.Id));
        Assert.Equal((2, 1, 1), (vm.OnlineCount, vm.OfflineCount, vm.AlarmCount));
    }

    [Fact]
    public void Start_starts_the_device_source()
    {
        var (vm, source) = Create();
        vm.Start();
        Assert.True(source.Started);
    }

    [Fact]
    public void A_status_change_updates_the_row_the_counts_and_the_log()
    {
        var (vm, source) = Create();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.Raise("CAM-01", DeviceStatus.Alarm);

        Assert.Equal(DeviceStatus.Alarm, Row(vm, "CAM-01").Status);
        Assert.NotNull(Row(vm, "CAM-01").LastChanged);
        Assert.Equal((1, 1, 2), (vm.OnlineCount, vm.OfflineCount, vm.AlarmCount));
        Assert.Contains(nameof(MainViewModel.AlarmCount), changed);
        Assert.Contains("Lobby entrance (CAM-01): Online → Alarm", vm.RecentChanges[0]);
    }

    [Fact]
    public void Changes_from_the_device_thread_wait_for_the_ui_thread()
    {
        // The simulator raises events on a timer thread. Nothing bound to the UI may change until
        // the dispatcher runs the work on the UI thread.
        var source = FakeDeviceSource.Building();
        var dispatcher = new QueuedDispatcher();
        var vm = new MainViewModel(source, dispatcher);

        source.Raise("CAM-01", DeviceStatus.Offline);

        Assert.Equal(1, dispatcher.Pending);
        Assert.Equal(DeviceStatus.Online, Row(vm, "CAM-01").Status);
        Assert.Empty(vm.RecentChanges);

        dispatcher.RunAll();

        Assert.Equal(DeviceStatus.Offline, Row(vm, "CAM-01").Status);
        Assert.Single(vm.RecentChanges);
    }

    [Fact]
    public void A_row_raises_property_changed_for_status_and_is_alarm()
    {
        var (vm, source) = Create();
        var row = Row(vm, "DOOR-01");
        var changed = new List<string?>();
        ((INotifyPropertyChanged)row).PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.Raise("DOOR-01", DeviceStatus.Alarm);

        Assert.Contains(nameof(DeviceViewModel.Status), changed);
        Assert.Contains(nameof(DeviceViewModel.IsAlarm), changed);
    }

    [Theory]
    [InlineData("server", new[] { "DOOR-02" })]
    [InlineData("GROUND", new[] { "CAM-01", "DOOR-01" })]
    [InlineData("camera", new[] { "CAM-01", "CAM-02" })]
    [InlineData("alarm", new[] { "DOOR-02" })]
    [InlineData("  door-01 ", new[] { "DOOR-01" })]
    [InlineData("nothing like this", new string[0])]
    public void Filter_matches_name_location_type_status_and_id_ignoring_case(string filter, string[] expected)
    {
        var (vm, _) = Create();
        vm.FilterText = filter;
        Assert.Equal(expected, vm.VisibleDevices.Select(d => d.Id));
    }

    [Fact]
    public void Clearing_the_filter_shows_every_device_in_the_original_order()
    {
        var (vm, _) = Create();
        vm.FilterText = "door";
        Assert.True(vm.ClearFilterCommand.CanExecute(null));

        vm.ClearFilterCommand.Execute(null);

        Assert.Equal("", vm.FilterText);
        Assert.Equal(new[] { "CAM-01", "CAM-02", "DOOR-01", "DOOR-02" }, vm.VisibleDevices.Select(d => d.Id));
        Assert.False(vm.ClearFilterCommand.CanExecute(null));
    }

    [Fact]
    public void A_device_that_goes_into_alarm_appears_under_an_alarm_filter()
    {
        var (vm, source) = Create();
        vm.FilterText = "alarm";

        source.Raise("CAM-01", DeviceStatus.Alarm);

        Assert.Equal(new[] { "CAM-01", "DOOR-02" }, vm.VisibleDevices.Select(d => d.Id));
    }

    [Fact]
    public void Filtering_out_the_selected_device_clears_the_selection()
    {
        var (vm, _) = Create();
        vm.SelectedDevice = Row(vm, "CAM-01");

        vm.FilterText = "door";

        Assert.Null(vm.SelectedDevice);
    }

    [Fact]
    public void Acknowledge_is_only_enabled_for_a_selected_device_in_alarm()
    {
        var (vm, _) = Create();
        Assert.False(vm.AcknowledgeAlarmCommand.CanExecute(null), "nothing selected");

        vm.SelectedDevice = Row(vm, "CAM-01");
        Assert.False(vm.AcknowledgeAlarmCommand.CanExecute(null), "online device");

        vm.SelectedDevice = Row(vm, "DOOR-02");
        Assert.True(vm.AcknowledgeAlarmCommand.CanExecute(null), "device in alarm");
    }

    [Fact]
    public void Acknowledging_tells_the_source_and_the_row_goes_back_online()
    {
        var (vm, source) = Create();
        vm.SelectedDevice = Row(vm, "DOOR-02");

        vm.AcknowledgeAlarmCommand.Execute(null);

        Assert.Equal(new[] { "DOOR-02" }, source.Acknowledged);
        Assert.Equal(DeviceStatus.Online, Row(vm, "DOOR-02").Status);
        Assert.False(vm.AcknowledgeAlarmCommand.CanExecute(null));
    }

    [Fact]
    public void The_acknowledge_button_is_told_to_recheck_when_the_selected_device_changes_status()
    {
        var (vm, source) = Create();
        vm.SelectedDevice = Row(vm, "CAM-01");
        var rechecks = 0;
        vm.AcknowledgeAlarmCommand.CanExecuteChanged += (_, _) => rechecks++;

        source.Raise("CAM-01", DeviceStatus.Alarm);

        Assert.True(rechecks > 0);
        Assert.True(vm.AcknowledgeAlarmCommand.CanExecute(null));
    }

    [Fact]
    public void The_change_log_keeps_the_newest_entries_first_and_is_capped()
    {
        var (vm, source) = Create();
        for (var i = 0; i < MainViewModel.MaxRecentChanges + 10; i++)
            source.Raise("CAM-01", i % 2 == 0 ? DeviceStatus.Offline : DeviceStatus.Online);

        Assert.Equal(MainViewModel.MaxRecentChanges, vm.RecentChanges.Count);
        Assert.Contains("Online → Offline", vm.RecentChanges[^1]);
        Assert.Contains("Offline → Online", vm.RecentChanges[0]);
    }
}
