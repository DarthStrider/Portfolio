using AfterHoursAutoLock;
using DoorForcedEmail;
using SolutionFramework.Common;

namespace SolutionFramework.Tests;

public class DoorForcedEmailTests
{
    private static (DoorForcedEmailModule, FakeContext) Create(string json = """{ "DoorForcedEmail": { "To": "desk@example.com", "QuietSeconds": 300 } }""")
    {
        var context = new FakeContext(json, "DoorForcedEmail");
        var module = new DoorForcedEmailModule();
        module.Initialize(context);
        return (module, context);
    }

    [Fact]
    public void A_forced_door_sends_one_email_to_the_configured_address()
    {
        var (module, context) = Create();

        module.OnEvent(Events.At(SecurityEventKind.DoorForced, "22:15"));

        Assert.Equal(1, module.Sent);
        Assert.Contains(context.Log.Entries, e => e.Level == LogLevel.Warn && e.Message.StartsWith("EMAIL to desk@example.com"));
    }

    [Fact]
    public void Other_events_send_nothing()
    {
        var (module, _) = Create();
        foreach (var kind in Enum.GetValues<SecurityEventKind>().Where(k => k != SecurityEventKind.DoorForced))
            module.OnEvent(Events.At(kind, "22:15"));
        Assert.Equal(0, module.Sent);
    }

    [Fact]
    public void The_same_door_does_not_email_again_within_the_quiet_period()
    {
        var (module, _) = Create();

        module.OnEvent(Events.At(SecurityEventKind.DoorForced, "22:00"));
        module.OnEvent(Events.At(SecurityEventKind.DoorForced, "22:04"));              // within 5 min: no
        module.OnEvent(Events.At(SecurityEventKind.DoorForced, "22:02", door: "DOOR-02")); // another door: yes
        module.OnEvent(Events.At(SecurityEventKind.DoorForced, "22:05"));              // 5 min later: yes

        Assert.Equal(3, module.Sent);
    }

    [Fact]
    public void Without_an_address_initialize_fails_with_a_clear_message()
    {
        var error = Assert.Throws<InvalidOperationException>(() => Create("{}"));
        Assert.Contains("\"To\"", error.Message);
    }
}

public class AfterHoursAutoLockTests
{
    private static (AfterHoursAutoLockModule, FakeContext) Create(string start = "19:00", string end = "07:00")
    {
        var context = new FakeContext($$"""{ "AfterHoursAutoLock": { "Start": "{{start}}", "End": "{{end}}" } }""", "AfterHoursAutoLock");
        var module = new AfterHoursAutoLockModule();
        module.Initialize(context);
        return (module, context);
    }

    [Theory]
    [InlineData("18:59", false)]
    [InlineData("19:00", true)]
    [InlineData("23:30", true)]
    [InlineData("00:00", true)]
    [InlineData("06:59", true)]
    [InlineData("07:00", false)]
    [InlineData("12:00", false)]
    public void A_window_that_crosses_midnight(string time, bool afterHours)
    {
        var (module, _) = Create();
        Assert.Equal(afterHours, module.IsAfterHours(TimeOnly.Parse(time)));
    }

    [Theory]
    [InlineData("00:59", false)]
    [InlineData("01:00", true)]
    [InlineData("04:59", true)]
    [InlineData("05:00", false)]
    public void A_window_within_one_day(string time, bool afterHours)
    {
        var (module, _) = Create("01:00", "05:00");
        Assert.Equal(afterHours, module.IsAfterHours(TimeOnly.Parse(time)));
    }

    [Theory]
    [InlineData(SecurityEventKind.DoorUnlocked)]
    [InlineData(SecurityEventKind.DoorHeldOpen)]
    public void A_door_left_open_after_hours_is_locked(SecurityEventKind kind)
    {
        var (module, context) = Create();

        module.OnEvent(Events.At(kind, "21:30", door: "DOOR-04"));

        var command = Assert.IsType<LockDoorCommand>(Assert.Single(context.Sent));
        Assert.Equal("DOOR-04", command.DoorId);
        Assert.Contains("after hours at 21:30", command.Reason);
    }

    [Fact]
    public void During_the_day_and_for_other_events_nothing_is_sent()
    {
        var (module, context) = Create();

        module.OnEvent(Events.At(SecurityEventKind.DoorUnlocked, "10:00"));
        module.OnEvent(Events.At(SecurityEventKind.AccessGranted, "22:00"));
        module.OnEvent(Events.At(SecurityEventKind.DoorForced, "22:00"));

        Assert.Empty(context.Sent);
    }

    [Fact]
    public void A_badly_written_time_fails_initialize_with_a_clear_message()
    {
        var error = Assert.Throws<InvalidOperationException>(() => Create(start: "7pm"));
        Assert.Contains("Start must be HH:mm", error.Message);
    }
}

public class ModuleSettingsTests
{
    [Fact]
    public void Each_module_sees_only_its_section_and_keys_ignore_case()
    {
        var settings = ModuleSettings.Parse("""
            {
              // comments are allowed
              "A": { "Url": "x", "Retries": 3 },
              "B": { "Url": "y" },
            }
            """);

        Assert.Equal("x", settings.For("a").Get("url"));
        Assert.Equal(3, settings.For("A").Get("Retries", 0));
        Assert.Null(settings.For("B").Get("Retries"));
        Assert.Null(settings.For("Missing").Get("Url"));
    }

    [Fact]
    public void Typed_values_fall_back_to_the_default_when_missing_or_unparsable()
    {
        var config = ModuleSettings.Parse("""{ "A": { "Count": "lots" } }""").For("A");
        Assert.Equal(5, config.Get("Count", 5));
        Assert.Equal(2.5, config.Get("Other", 2.5));
    }

    [Fact]
    public void A_missing_file_means_no_settings()
    {
        Assert.Null(ModuleSettings.Load(Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".json")).For("A").Get("x"));
    }
}
