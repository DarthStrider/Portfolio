using AccessLog.Core.Data;
using AccessLog.Core.Model;
using AccessLog.Core.Simulation;
using AccessLog.Core.ViewModels;

namespace AccessLog.Tests;

public class EventLogViewModelTests : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 11, 12, 15, 0, 0, DateTimeKind.Utc);
    private readonly InMemoryAccessEventRepository _repo = new();
    private readonly FixedClock _clock = new(Now);
    private EventLogViewModel _vm = null!;
    private Device _door = null!, _camera = null!;
    private Cardholder _alice = null!;

    public async ValueTask InitializeAsync()
    {
        _door = new Device { Name = "Server room", Kind = DeviceKind.Door, Location = "Floor 2" };
        _camera = new Device { Name = "Roof access", Kind = DeviceKind.Camera, Location = "Roof" };
        await _repo.AddDeviceAsync(_door);
        await _repo.AddDeviceAsync(_camera);
        _alice = new Cardholder { Name = "Alice Martin", BadgeNumber = "B-1" };
        await _repo.AddCardholderAsync(_alice);

        await Record(EventKind.BadgeSwipe, _door, granted: true, Now.AddMinutes(-3));
        await Record(EventKind.BadgeSwipe, _door, granted: false, Now.AddMinutes(-2));
        await Record(EventKind.StatusChange, _camera, granted: null, Now.AddMinutes(-1));
        await Record(EventKind.BadgeSwipe, _door, granted: false, Now.AddHours(-30)); // outside the report window

        _vm = new EventLogViewModel(_repo, _clock, "In memory");
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private Task Record(EventKind kind, Device device, bool? granted, DateTime at) =>
        _repo.RecordAsync(new AccessEvent
        {
            OccurredAtUtc = at,
            DeviceId = device.Id,
            Kind = kind,
            CardholderId = kind == EventKind.BadgeSwipe ? _alice.Id : null,
            Granted = granted,
            Detail = kind == EventKind.StatusChange ? "Online → Alarm" : null,
        });

    [Fact]
    public async Task Refresh_loads_the_events_newest_first_and_both_reports()
    {
        await _vm.RefreshAsync();

        Assert.Equal(4, _vm.Events.Count);
        Assert.Equal(EventKind.StatusChange, _vm.Events[0].Kind);
        Assert.Equal(1, Assert.Single(_vm.DeniedByDoor).Denied); // the 30-hour-old denial is outside 24 h
        Assert.Equal(new[] { "Server room", "Roof access" }, _vm.NoisiestDevices.Select(d => d.DeviceName));
        Assert.Equal(Now, _vm.LastRefreshedUtc);
        Assert.Contains("4 events shown", _vm.Status);
    }

    [Theory]
    [InlineData(OutcomeFilter.All, 4)]
    [InlineData(OutcomeFilter.Granted, 1)]
    [InlineData(OutcomeFilter.Denied, 2)]
    [InlineData(OutcomeFilter.StatusChanges, 1)]
    public async Task The_outcome_filter_narrows_the_list(OutcomeFilter outcome, int expected)
    {
        _vm.Outcome = outcome;
        await _vm.RefreshAsync();
        Assert.Equal(expected, _vm.Events.Count);
    }

    [Fact]
    public async Task Search_text_narrows_the_list_and_clear_resets_everything()
    {
        _vm.SearchText = "roof";
        _vm.Outcome = OutcomeFilter.StatusChanges;
        await _vm.RefreshAsync();
        Assert.Equal("Roof access", Assert.Single(_vm.Events).DeviceName);

        _vm.ClearFiltersCommand.Execute(null);
        await _vm.RefreshAsync();

        Assert.Equal("", _vm.SearchText);
        Assert.Equal(OutcomeFilter.All, _vm.Outcome);
        Assert.Equal(4, _vm.Events.Count);
    }

    [Fact]
    public void The_current_query_describes_the_filters()
    {
        _vm.SearchText = "  server ";
        _vm.Outcome = OutcomeFilter.Denied;

        var query = _vm.CurrentQuery();

        Assert.Equal("server", query.Text);
        Assert.Equal(EventKind.BadgeSwipe, query.Kind);
        Assert.False(query.Granted);
    }

    [Fact]
    public async Task Overlapping_refreshes_run_one_after_another_and_end_with_the_latest_filter()
    {
        var first = _vm.RefreshAsync();
        _vm.Outcome = OutcomeFilter.Granted; // asks for another refresh while the first is running
        await first;
        await _vm.RefreshAsync();

        Assert.Single(_vm.Events);
        Assert.True(_vm.Events[0].Granted);
    }

    [Fact]
    public async Task A_failing_store_shows_a_message_instead_of_crashing()
    {
        var vm = new EventLogViewModel(new BrokenRepository(), _clock, "Broken");
        await vm.RefreshAsync();
        Assert.StartsWith("Couldn't load events: database is down", vm.Status);
    }

    private sealed class BrokenRepository : IAccessEventRepository
    {
        private static Exception Down() => new InvalidOperationException("database is down");
        public Task<int> AddDeviceAsync(Device device) => throw Down();
        public Task<int> AddCardholderAsync(Cardholder cardholder) => throw Down();
        public Task<IReadOnlyList<Device>> GetDevicesAsync() => throw Down();
        public Task<IReadOnlyList<Cardholder>> GetCardholdersAsync() => throw Down();
        public Task<long> RecordAsync(AccessEvent accessEvent) => throw Down();
        public Task<IReadOnlyList<AccessEventView>> SearchAsync(EventQuery query) => throw Down();
        public Task<IReadOnlyList<DeniedByDoorRow>> DeniedByDoorAsync(DateTime sinceUtc) => throw Down();
        public Task<IReadOnlyList<NoisyDeviceRow>> NoisiestDevicesAsync(DateTime sinceUtc, int top) => throw Down();
    }
}
