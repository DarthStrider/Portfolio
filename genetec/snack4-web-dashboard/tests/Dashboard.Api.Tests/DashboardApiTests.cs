using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccessLog.Core.Data;
using AccessLog.Core.Model;
using AccessLog.Core.Simulation;
using Dashboard.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Api.Tests;

/// <summary>
/// The API over HTTP, in memory, with a store the test fills itself (the demo seeding is switched
/// off) and a fixed clock, so every answer is known in advance.
/// </summary>
public sealed class DashboardApiTests : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 11, 12, 15, 0, 0, DateTimeKind.Utc);
    private readonly InMemoryAccessEventRepository _repo = new();
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    private sealed class FixedClock : IClock
    {
        public DateTime UtcNow => Now;
    }

    public async ValueTask InitializeAsync()
    {
        var door = new Device { Name = "Server room", Kind = DeviceKind.Door, Location = "Floor 2" };
        var camera = new Device { Name = "Roof access", Kind = DeviceKind.Camera, Location = "Roof" };
        await _repo.AddDeviceAsync(door);
        await _repo.AddDeviceAsync(camera);
        var alice = new Cardholder { Name = "Alice Martin", BadgeNumber = "B-1" };
        await _repo.AddCardholderAsync(alice);
        async Task Swipe(bool granted, DateTime at) => await _repo.RecordAsync(new AccessEvent
            { OccurredAtUtc = at, DeviceId = door.Id, CardholderId = alice.Id, Kind = EventKind.BadgeSwipe, Granted = granted });
        await Swipe(true, Now.AddMinutes(-3));
        await Swipe(false, Now.AddMinutes(-2));
        await Swipe(false, Now.AddHours(-30));
        await _repo.RecordAsync(new AccessEvent
            { OccurredAtUtc = Now.AddMinutes(-1), DeviceId = camera.Id, Kind = EventKind.StatusChange, Detail = "Online → Alarm" });

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Seed", "false");
            b.UseSetting("ConnectionStrings:AccessLog", "");
            b.ConfigureServices(services =>
            {
                services.AddSingleton<IAccessEventRepository>(_repo);
                services.AddSingleton<IClock>(new FixedClock());
            });
        });
        _client = _factory.CreateClient();
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private async Task<JsonElement> GetJson(string url)
    {
        var response = await _client.GetAsync(url, Ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
    }

    [Fact]
    public async Task Health_reports_the_store()
    {
        var health = await GetJson("/api/health");
        Assert.Equal("ok", health.GetProperty("status").GetString());
        Assert.StartsWith("In memory", health.GetProperty("store").GetString());
    }

    [Fact]
    public async Task Events_are_newest_first_in_camel_case_with_enums_as_text()
    {
        var events = await GetJson("/api/events");

        Assert.Equal(4, events.GetArrayLength());
        var newest = events[0];
        Assert.Equal("Roof access", newest.GetProperty("deviceName").GetString());
        Assert.Equal("StatusChange", newest.GetProperty("kind").GetString());
        Assert.Equal("Online → Alarm", newest.GetProperty("outcome").GetString());
        Assert.Equal(JsonValueKind.Null, newest.GetProperty("granted").ValueKind);
    }

    [Theory]
    [InlineData("all", 4)]
    [InlineData("granted", 1)]
    [InlineData("DENIED", 2)]
    [InlineData("status", 1)]
    public async Task The_outcome_filter_narrows_the_events(string outcome, int expected)
    {
        Assert.Equal(expected, (await GetJson($"/api/events?outcome={outcome}")).GetArrayLength());
    }

    [Fact]
    public async Task Search_and_limit_are_applied()
    {
        Assert.Equal(1, (await GetJson("/api/events?search=roof")).GetArrayLength());
        Assert.Equal(2, (await GetJson("/api/events?limit=2")).GetArrayLength());
    }

    [Theory]
    [InlineData("/api/events?outcome=maybe")]
    [InlineData("/api/events?limit=0")]
    [InlineData("/api/events?limit=501")]
    [InlineData("/api/reports/denied-by-door?hours=0")]
    [InlineData("/api/reports/noisiest?top=100")]
    public async Task Bad_parameters_get_400_with_a_message(string url)
    {
        var response = await _client.GetAsync(url, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await response.Content.ReadFromJsonAsync<JsonElement>(Ct)).TryGetProperty("error", out _));
    }

    [Fact]
    public async Task Denied_by_door_uses_the_last_24_hours_by_default()
    {
        var rows = await GetJson("/api/reports/denied-by-door");
        Assert.Equal(1, rows[0].GetProperty("denied").GetInt32());

        var wider = await GetJson("/api/reports/denied-by-door?hours=48");
        Assert.Equal(2, wider[0].GetProperty("denied").GetInt32());
    }

    [Fact]
    public async Task Noisiest_lists_devices_by_event_count()
    {
        var rows = await GetJson("/api/reports/noisiest?top=1");
        var top = Assert.Single(rows.EnumerateArray());
        Assert.Equal("Server room", top.GetProperty("deviceName").GetString());
        Assert.Equal(2, top.GetProperty("events").GetInt32());
        Assert.Equal("Door", top.GetProperty("kind").GetString());
    }
}

public class FiltersTests
{
    [Theory]
    [InlineData(null, Outcome.All)]
    [InlineData("", Outcome.All)]
    [InlineData("Granted", Outcome.Granted)]
    [InlineData("status", Outcome.Status)]
    public void Parses_known_outcomes_ignoring_case(string? text, Outcome expected)
    {
        Assert.True(Filters.TryParseOutcome(text, out var outcome));
        Assert.Equal(expected, outcome);
    }

    [Theory]
    [InlineData("maybe")]
    [InlineData("7")]
    public void Rejects_unknown_outcomes_including_numbers(string text) =>
        Assert.False(Filters.TryParseOutcome(text, out _));

    [Fact]
    public void Denied_means_badge_swipes_that_were_refused()
    {
        var query = Filters.ToQuery(Outcome.Denied, "  server ", 50);
        Assert.Equal((EventKind.BadgeSwipe, false, "server", 50), (query.Kind, query.Granted, query.Text, query.Limit));
    }
}
