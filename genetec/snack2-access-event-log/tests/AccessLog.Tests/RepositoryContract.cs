using AccessLog.Core.Data;
using AccessLog.Core.Model;

namespace AccessLog.Tests;

/// <summary>
/// The behaviour every IAccessEventRepository must have. InMemoryRepositoryTests and
/// SqlServerRepositoryTests inherit these tests, so both stores are held to exactly the same rules,
/// and the in-memory one can stand in for SQL Server everywhere else.
/// </summary>
public abstract class RepositoryContract : IAsyncLifetime
{
    // Whole seconds: SQL Server keeps milliseconds (DATETIME2(3)), so finer times wouldn't round-trip.
    protected static readonly DateTime Now = new(2026, 11, 12, 15, 0, 0, DateTimeKind.Utc);

    protected IAccessEventRepository Repo { get; private set; } = null!;
    protected Device MainDoor { get; private set; } = null!;
    protected Device ServerRoom { get; private set; } = null!;
    protected Device Lobby { get; private set; } = null!;
    protected Cardholder Alice { get; private set; } = null!;
    protected Cardholder Bob { get; private set; } = null!;

    /// <summary>A new, empty store for each test.</summary>
    protected abstract Task<IAccessEventRepository> CreateAsync();

    public virtual async ValueTask InitializeAsync()
    {
        Repo = await CreateAsync();
        MainDoor = new Device { Name = "Main entrance", Kind = DeviceKind.Door, Location = "Ground floor" };
        ServerRoom = new Device { Name = "Server room", Kind = DeviceKind.Door, Location = "Floor 2" };
        Lobby = new Device { Name = "Lobby camera", Kind = DeviceKind.Camera, Location = "Ground floor" };
        foreach (var d in new[] { MainDoor, ServerRoom, Lobby }) await Repo.AddDeviceAsync(d);
        Alice = new Cardholder { Name = "Alice Martin", BadgeNumber = "B-1" };
        Bob = new Cardholder { Name = "Bob Tremblay", BadgeNumber = "B-2" };
        await Repo.AddCardholderAsync(Alice);
        await Repo.AddCardholderAsync(Bob);
    }

    public virtual ValueTask DisposeAsync() => ValueTask.CompletedTask;

    protected Task<long> Swipe(Device door, Cardholder who, bool granted, DateTime at) =>
        Repo.RecordAsync(new AccessEvent
        {
            OccurredAtUtc = at, DeviceId = door.Id, CardholderId = who.Id, Kind = EventKind.BadgeSwipe, Granted = granted,
        });

    protected Task<long> StatusChange(Device device, string detail, DateTime at) =>
        Repo.RecordAsync(new AccessEvent { OccurredAtUtc = at, DeviceId = device.Id, Kind = EventKind.StatusChange, Detail = detail });

    [Fact]
    public async Task Added_devices_and_cardholders_get_ids_and_come_back_in_order()
    {
        var devices = await Repo.GetDevicesAsync();
        Assert.Equal(new[] { "Main entrance", "Server room", "Lobby camera" }, devices.Select(d => d.Name));
        Assert.All(devices, d => Assert.True(d.Id > 0));
        Assert.Equal(DeviceKind.Camera, devices[2].Kind);
        Assert.Equal(new[] { "B-1", "B-2" }, (await Repo.GetCardholdersAsync()).Select(c => c.BadgeNumber));
    }

    [Fact]
    public async Task A_recorded_event_comes_back_joined_with_its_device_and_cardholder()
    {
        var id = await Swipe(ServerRoom, Alice, granted: false, Now);

        var row = Assert.Single(await Repo.SearchAsync(new EventQuery()));

        Assert.Equal(id, row.Id);
        Assert.Equal(Now, row.OccurredAtUtc);
        Assert.Equal(DateTimeKind.Utc, row.OccurredAtUtc.Kind);
        Assert.Equal(("Server room", "Floor 2", "Alice Martin"), (row.DeviceName, row.Location, row.CardholderName));
        Assert.Equal(EventKind.BadgeSwipe, row.Kind);
        Assert.False(row.Granted);
        Assert.Equal("Denied", row.Outcome);
    }

    [Fact]
    public async Task A_status_change_has_no_cardholder_and_shows_its_detail()
    {
        await StatusChange(Lobby, "Online → Alarm", Now);

        var row = Assert.Single(await Repo.SearchAsync(new EventQuery()));

        Assert.Null(row.CardholderName);
        Assert.Null(row.Granted);
        Assert.Equal("Online → Alarm", row.Outcome);
    }

    [Fact]
    public async Task Ids_increase_with_each_event()
    {
        var a = await Swipe(MainDoor, Alice, true, Now);
        var b = await Swipe(MainDoor, Bob, true, Now);
        Assert.True(b > a);
    }

    [Fact]
    public async Task An_event_for_an_unknown_device_is_refused()
    {
        await Assert.ThrowsAsync<UnknownReferenceException>(() => Repo.RecordAsync(new AccessEvent
        {
            OccurredAtUtc = Now, DeviceId = 9999, Kind = EventKind.StatusChange, Detail = "x",
        }));
        Assert.Empty(await Repo.SearchAsync(new EventQuery()));
    }

    [Fact]
    public async Task Search_lists_newest_first_and_respects_the_limit()
    {
        for (var i = 0; i < 5; i++) await Swipe(MainDoor, Alice, true, Now.AddMinutes(i));

        var rows = await Repo.SearchAsync(new EventQuery { Limit = 3 });

        Assert.Equal(new[] { Now.AddMinutes(4), Now.AddMinutes(3), Now.AddMinutes(2) }, rows.Select(r => r.OccurredAtUtc));
    }

    [Fact]
    public async Task Events_at_the_same_moment_are_ordered_by_id_newest_first()
    {
        var first = await Swipe(MainDoor, Alice, true, Now);
        var second = await Swipe(MainDoor, Bob, true, Now);

        var rows = await Repo.SearchAsync(new EventQuery());

        Assert.Equal(new[] { second, first }, rows.Select(r => r.Id));
    }

    [Fact]
    public async Task Search_filters_by_time_window_with_an_inclusive_start_and_exclusive_end()
    {
        await Swipe(MainDoor, Alice, true, Now.AddHours(-2));
        await Swipe(MainDoor, Alice, true, Now.AddHours(-1));
        await Swipe(MainDoor, Alice, true, Now);

        var rows = await Repo.SearchAsync(new EventQuery { FromUtc = Now.AddHours(-1), ToUtc = Now });

        Assert.Equal(Now.AddHours(-1), Assert.Single(rows).OccurredAtUtc);
    }

    [Fact]
    public async Task Search_filters_by_device_cardholder_kind_and_outcome()
    {
        await Swipe(MainDoor, Alice, true, Now);
        await Swipe(ServerRoom, Alice, false, Now.AddSeconds(1));
        await Swipe(ServerRoom, Bob, true, Now.AddSeconds(2));
        await StatusChange(Lobby, "Online → Offline", Now.AddSeconds(3));

        Assert.Equal(2, (await Repo.SearchAsync(new EventQuery { DeviceId = ServerRoom.Id })).Count);
        Assert.Equal(2, (await Repo.SearchAsync(new EventQuery { CardholderId = Alice.Id })).Count);
        Assert.Single(await Repo.SearchAsync(new EventQuery { Kind = EventKind.StatusChange }));
        Assert.Equal(3, (await Repo.SearchAsync(new EventQuery { Kind = EventKind.BadgeSwipe })).Count);
        var denied = Assert.Single(await Repo.SearchAsync(new EventQuery { Granted = false }));
        Assert.Equal(("Server room", "Alice Martin"), (denied.DeviceName, denied.CardholderName));
    }

    [Theory]
    [InlineData("server", 2)]
    [InlineData("SERVER ROOM", 2)]
    [InlineData("ground", 1)]
    [InlineData("tremblay", 1)]
    [InlineData("  bob ", 1)]
    [InlineData("nobody", 0)]
    public async Task Text_search_matches_device_location_and_cardholder_ignoring_case(string text, int expected)
    {
        await Swipe(MainDoor, Alice, true, Now);
        await Swipe(ServerRoom, Alice, false, Now.AddSeconds(1));
        await Swipe(ServerRoom, Bob, true, Now.AddSeconds(2));

        Assert.Equal(expected, (await Repo.SearchAsync(new EventQuery { Text = text })).Count);
    }

    [Fact]
    public async Task Text_search_treats_percent_and_underscore_literally()
    {
        await Swipe(MainDoor, Alice, true, Now);
        Assert.Empty(await Repo.SearchAsync(new EventQuery { Text = "%" }));
        Assert.Empty(await Repo.SearchAsync(new EventQuery { Text = "_" }));
    }

    [Fact]
    public async Task Denied_by_door_counts_only_denied_swipes_in_the_window_most_first()
    {
        await Swipe(ServerRoom, Alice, false, Now.AddHours(-1));
        await Swipe(ServerRoom, Bob, false, Now.AddHours(-2));
        await Swipe(MainDoor, Bob, false, Now.AddHours(-3));
        await Swipe(MainDoor, Alice, true, Now.AddHours(-1));          // granted: doesn't count
        await Swipe(MainDoor, Alice, false, Now.AddHours(-25));        // too old: doesn't count
        await StatusChange(Lobby, "Online → Alarm", Now.AddHours(-1)); // not a swipe

        var rows = await Repo.DeniedByDoorAsync(Now.AddHours(-24));

        Assert.Equal(new[] { ("Server room", 2), ("Main entrance", 1) }, rows.Select(r => (r.DeviceName, r.Denied)));
        Assert.Equal("Floor 2", rows[0].Location);
    }

    [Fact]
    public async Task Denied_by_door_is_empty_when_nothing_was_denied()
    {
        await Swipe(MainDoor, Alice, true, Now);
        Assert.Empty(await Repo.DeniedByDoorAsync(Now.AddHours(-24)));
    }

    [Fact]
    public async Task Noisiest_devices_counts_every_kind_of_event_and_returns_the_top_n()
    {
        for (var i = 0; i < 3; i++) await StatusChange(Lobby, "Online → Offline", Now.AddMinutes(-i));
        for (var i = 0; i < 2; i++) await Swipe(ServerRoom, Bob, i == 0, Now.AddMinutes(-i));
        await Swipe(MainDoor, Alice, true, Now);
        await Swipe(MainDoor, Alice, true, Now.AddDays(-2)); // outside the window

        var top2 = await Repo.NoisiestDevicesAsync(Now.AddHours(-24), top: 2);

        Assert.Equal(new[] { ("Lobby camera", 3), ("Server room", 2) }, top2.Select(r => (r.DeviceName, r.Events)));
        Assert.Equal(DeviceKind.Camera, top2[0].Kind);
    }
}
