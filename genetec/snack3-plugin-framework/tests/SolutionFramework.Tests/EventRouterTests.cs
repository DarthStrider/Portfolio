using SolutionFramework.Common;
using SolutionFramework.Host;

namespace SolutionFramework.Tests;

public class EventRouterTests
{
    private readonly MemoryLogSink _log = new();
    private readonly RecordingDoors _doors = new();
    private readonly EventRouter _router;

    public EventRouterTests() =>
        _router = new EventRouter(_log, TimeProvider.System, ModuleSettings.Parse("""{ "A": { "Greeting": "hi" } }"""), _doors);

    [Fact]
    public void Every_module_receives_every_event_in_order()
    {
        var a = new ScriptedModule("A");
        var b = new ScriptedModule("B");
        _router.Add(a);
        _router.Add(b);
        var first = Events.At(SecurityEventKind.AccessGranted, "08:00");
        var second = Events.At(SecurityEventKind.AccessDenied, "08:01");

        _router.Publish(first);
        _router.Publish(second);

        Assert.Equal(new[] { first, second }, a.Seen);
        Assert.Equal(new[] { first, second }, b.Seen);
    }

    [Fact]
    public void A_module_that_throws_does_not_stop_the_others()
    {
        var broken = new ScriptedModule("Broken") { ThrowWhen = _ => true };
        var healthy = new ScriptedModule("Healthy");
        _router.Add(broken);
        _router.Add(healthy);

        _router.Publish(Events.At(SecurityEventKind.DoorForced, "22:00"));

        Assert.Single(healthy.Seen);
        Assert.Contains(_log.Entries, e => e.Level == LogLevel.Error && e.Source == "host" && e.Message.StartsWith("Broken failed"));
    }

    [Fact]
    public void A_module_that_fails_three_times_in_a_row_is_switched_off()
    {
        var broken = new ScriptedModule("Broken") { ThrowWhen = _ => true };
        _router.Add(broken);
        _router.Add(new ScriptedModule("Healthy"));

        for (var i = 0; i < 5; i++) _router.Publish(Events.At(SecurityEventKind.AccessGranted, "09:00"));

        Assert.Equal(EventRouter.MaxConsecutiveFailures, broken.Seen.Count);
        Assert.Equal(new[] { "Healthy" }, _router.RunningModules);
        Assert.Equal(new[] { "Broken" }, _router.DisabledModules);
    }

    [Fact]
    public void A_success_resets_the_failure_count()
    {
        var flaky = new ScriptedModule("Flaky");
        var calls = 0;
        flaky.ThrowWhen = _ => ++calls % 2 == 1; // fails, succeeds, fails, succeeds...
        _router.Add(flaky);

        for (var i = 0; i < 10; i++) _router.Publish(Events.At(SecurityEventKind.AccessGranted, "09:00"));

        Assert.Equal(new[] { "Flaky" }, _router.RunningModules);
    }

    [Fact]
    public void A_module_whose_initialize_throws_is_not_added()
    {
        Assert.False(_router.Add(new ScriptedModule("Bad") { ThrowOnInitialize = true }));
        Assert.Empty(_router.RunningModules);
        Assert.Contains(_log.Entries, e => e.Message.Contains("Bad failed to initialize"));
    }

    [Fact]
    public void Commands_run_after_every_module_has_seen_the_event_and_their_result_is_published()
    {
        var locker = new ScriptedModule("Locker")
        {
            Reply = e => e.Kind == SecurityEventKind.DoorUnlocked ? new LockDoorCommand(e.DoorId, "after hours") : null,
        };
        var watcher = new ScriptedModule("Watcher");
        _router.Add(locker);
        _router.Add(watcher);

        _router.Publish(Events.At(SecurityEventKind.DoorUnlocked, "23:00"));

        var command = Assert.Single(_doors.Executed);
        Assert.Equal("after hours (requested by Locker)", command.Reason);
        Assert.Equal(new[] { SecurityEventKind.DoorUnlocked, SecurityEventKind.DoorLocked }, watcher.Seen.Select(e => e.Kind));
    }

    [Fact]
    public void Each_module_gets_its_own_settings_section_and_named_logger()
    {
        IModuleContext? seen = null;
        var module = new ContextGrabber("A", c => seen = c);
        _router.Add(module);

        Assert.Equal("hi", seen!.Config.Get("Greeting"));
        seen.Logger.Info("hello");
        Assert.Contains(_log.Entries, e => e.Source == "A" && e.Message == "hello");
    }

    private sealed class ContextGrabber(string name, Action<IModuleContext> grab) : ISolutionModule
    {
        public string Name { get; } = name;
        public void Initialize(IModuleContext context) => grab(context);
        public void OnEvent(SecurityEvent securityEvent) { }
    }
}
