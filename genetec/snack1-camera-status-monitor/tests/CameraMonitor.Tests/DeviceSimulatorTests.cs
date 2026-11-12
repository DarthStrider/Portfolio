using CameraMonitor.Core.Devices;

namespace CameraMonitor.Tests;

public class DeviceSimulatorTests
{
    private static DeviceSimulator Seeded(int seed = 42) =>
        new(SampleDevices.Create(), new Random(seed), TimeSpan.FromHours(1));

    [Fact]
    public void Every_tick_changes_exactly_one_device_to_a_different_status()
    {
        var simulator = Seeded();
        for (var i = 0; i < 200; i++)
        {
            var before = simulator.Devices.ToDictionary(d => d.Id, d => d.Status);

            var change = simulator.Tick();

            Assert.NotEqual(change.From, change.To);
            Assert.Equal(before[change.DeviceId], change.From);
            var changed = simulator.Devices.Where(d => d.Status != before[d.Id]).ToList();
            Assert.Equal(change.DeviceId, Assert.Single(changed).Id);
        }
    }

    [Fact]
    public void The_same_seed_produces_the_same_changes()
    {
        var a = Seeded(7);
        var b = Seeded(7);
        for (var i = 0; i < 50; i++)
        {
            var x = a.Tick();
            var y = b.Tick();
            Assert.Equal((x.DeviceId, x.From, x.To), (y.DeviceId, y.From, y.To));
        }
    }

    [Fact]
    public void Alarms_happen_but_are_the_rarest_status()
    {
        var simulator = Seeded();
        var counts = Enumerable.Range(0, 3000).Select(_ => simulator.Tick().To)
            .GroupBy(s => s).ToDictionary(g => g.Key, g => g.Count());

        Assert.True(counts[DeviceStatus.Alarm] > 0);
        Assert.True(counts[DeviceStatus.Alarm] < counts[DeviceStatus.Offline]);
        Assert.True(counts[DeviceStatus.Alarm] < counts[DeviceStatus.Online]);
    }

    [Fact]
    public void Tick_raises_status_changed()
    {
        var simulator = Seeded();
        StatusChange? raised = null;
        simulator.StatusChanged += (_, c) => raised = c;

        var change = simulator.Tick();

        Assert.Equal(change, raised);
    }

    [Fact]
    public void Acknowledging_an_alarm_brings_the_device_back_online_and_raises_a_change()
    {
        var devices = new[] { new Device("D1", "Door", DeviceType.Door, "Lobby", DeviceStatus.Alarm) };
        var simulator = new DeviceSimulator(devices, new Random(1), TimeSpan.FromHours(1));
        var raised = new List<StatusChange>();
        simulator.StatusChanged += (_, c) => raised.Add(c);

        simulator.Acknowledge("D1");

        Assert.Equal(DeviceStatus.Online, devices[0].Status);
        var change = Assert.Single(raised);
        Assert.Equal((DeviceStatus.Alarm, DeviceStatus.Online), (change.From, change.To));
    }

    [Fact]
    public void Acknowledging_a_device_that_is_not_in_alarm_does_nothing()
    {
        var devices = new[] { new Device("D1", "Door", DeviceType.Door, "Lobby", DeviceStatus.Offline) };
        var simulator = new DeviceSimulator(devices, new Random(1), TimeSpan.FromHours(1));
        var raised = 0;
        simulator.StatusChanged += (_, _) => raised++;

        simulator.Acknowledge("D1");
        simulator.Acknowledge("no-such-device");

        Assert.Equal(DeviceStatus.Offline, devices[0].Status);
        Assert.Equal(0, raised);
    }

    [Fact]
    public async Task Start_raises_changes_on_a_timer_without_anyone_calling_tick()
    {
        using var simulator = new DeviceSimulator(SampleDevices.Create(), new Random(3), TimeSpan.FromMilliseconds(20));
        var count = 0;
        var three = new TaskCompletionSource();
        simulator.StatusChanged += (_, _) =>
        {
            if (Interlocked.Increment(ref count) == 3) three.TrySetResult();
        };

        simulator.Start();
        simulator.Start(); // a second Start doesn't create a second timer

        await three.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
    }
}
