using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AccessLog.Core.Model;

namespace AccessLog.Core.Data;

/// <summary>
/// The repository in memory: LINQ over lists, behind a lock. Used by the tests, and by the app when
/// no SQL Server is reachable. The contract tests hold it to exactly the SQL Server behaviour.
/// </summary>
public sealed class InMemoryAccessEventRepository : IAccessEventRepository
{
    private readonly object _gate = new();
    private readonly List<Device> _devices = [];
    private readonly List<Cardholder> _cardholders = [];
    private readonly List<AccessEvent> _events = [];
    private long _nextEventId = 1;

    public Task<int> AddDeviceAsync(Device device)
    {
        lock (_gate)
        {
            device.Id = _devices.Count + 1;
            _devices.Add(Copy(device));
            return Task.FromResult(device.Id);
        }
    }

    public Task<int> AddCardholderAsync(Cardholder cardholder)
    {
        lock (_gate)
        {
            if (_cardholders.Any(c => c.BadgeNumber == cardholder.BadgeNumber))
                throw new InvalidOperationException($"Badge {cardholder.BadgeNumber} is already issued.");
            cardholder.Id = _cardholders.Count + 1;
            _cardholders.Add(new Cardholder { Id = cardholder.Id, Name = cardholder.Name, BadgeNumber = cardholder.BadgeNumber });
            return Task.FromResult(cardholder.Id);
        }
    }

    public Task<IReadOnlyList<Device>> GetDevicesAsync()
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<Device>>(_devices.Select(Copy).ToList());
    }

    public Task<IReadOnlyList<Cardholder>> GetCardholdersAsync()
    {
        lock (_gate)
            return Task.FromResult<IReadOnlyList<Cardholder>>(_cardholders
                .Select(c => new Cardholder { Id = c.Id, Name = c.Name, BadgeNumber = c.BadgeNumber }).ToList());
    }

    public Task<long> RecordAsync(AccessEvent accessEvent)
    {
        lock (_gate)
        {
            if (_devices.All(d => d.Id != accessEvent.DeviceId) ||
                (accessEvent.CardholderId is int c && _cardholders.All(x => x.Id != c)))
                throw new UnknownReferenceException($"No device {accessEvent.DeviceId} or cardholder {accessEvent.CardholderId}.");
            CheckShape(accessEvent);

            accessEvent.Id = _nextEventId++;
            _events.Add(new AccessEvent
            {
                Id = accessEvent.Id,
                OccurredAtUtc = Utc(accessEvent.OccurredAtUtc),
                DeviceId = accessEvent.DeviceId,
                CardholderId = accessEvent.CardholderId,
                Kind = accessEvent.Kind,
                Granted = accessEvent.Granted,
                Detail = accessEvent.Detail,
            });
            return Task.FromResult(accessEvent.Id);
        }
    }

    public Task<IReadOnlyList<AccessEventView>> SearchAsync(EventQuery query)
    {
        lock (_gate)
        {
            var text = string.IsNullOrWhiteSpace(query.Text) ? null : query.Text!.Trim();
            var rows = Views()
                .Where(e => query.FromUtc is not DateTime start || e.OccurredAtUtc >= Utc(start))
                .Where(e => query.ToUtc is not DateTime end || e.OccurredAtUtc < Utc(end))
                .Where(e => query.DeviceId is null || e.DeviceId == query.DeviceId)
                .Where(e => query.CardholderId is null || e.CardholderId == query.CardholderId)
                .Where(e => query.Kind is null || e.Kind == query.Kind)
                .Where(e => query.Granted is null || e.Granted == query.Granted)
                .Where(e => text is null || Contains(e.DeviceName, text) || Contains(e.Location, text) || Contains(e.CardholderName, text))
                .OrderByDescending(e => e.OccurredAtUtc).ThenByDescending(e => e.Id)
                .Take(Math.Max(0, query.Limit))
                .ToList();
            return Task.FromResult<IReadOnlyList<AccessEventView>>(rows);
        }
    }

    public Task<IReadOnlyList<DeniedByDoorRow>> DeniedByDoorAsync(DateTime sinceUtc)
    {
        lock (_gate)
        {
            var since = Utc(sinceUtc);
            var rows = Views()
                .Where(e => e.OccurredAtUtc >= since && e.Kind == EventKind.BadgeSwipe && e.Granted == false)
                .GroupBy(e => e.DeviceId)
                .Select(g => new DeniedByDoorRow { DeviceId = g.Key, DeviceName = g.First().DeviceName, Location = g.First().Location, Denied = g.Count() })
                .OrderByDescending(r => r.Denied).ThenBy(r => r.DeviceName, StringComparer.Ordinal)
                .ToList();
            return Task.FromResult<IReadOnlyList<DeniedByDoorRow>>(rows);
        }
    }

    public Task<IReadOnlyList<NoisyDeviceRow>> NoisiestDevicesAsync(DateTime sinceUtc, int top)
    {
        lock (_gate)
        {
            var since = Utc(sinceUtc);
            var rows = _events
                .Where(e => e.OccurredAtUtc >= since)
                .GroupBy(e => e.DeviceId)
                .Select(g =>
                {
                    var device = _devices.First(d => d.Id == g.Key);
                    return new NoisyDeviceRow { DeviceId = device.Id, DeviceName = device.Name, Kind = device.Kind, Events = g.Count() };
                })
                .OrderByDescending(r => r.Events).ThenBy(r => r.DeviceName, StringComparer.Ordinal)
                .Take(Math.Max(0, top))
                .ToList();
            return Task.FromResult<IReadOnlyList<NoisyDeviceRow>>(rows);
        }
    }

    public const string ShapeRule = "A badge swipe needs a cardholder and a decision; a status change has neither.";

    /// <summary>Same rule as the CHECK constraint in schema.sql.</summary>
    private static void CheckShape(AccessEvent e)
    {
        var ok = e.Kind == EventKind.BadgeSwipe
            ? e.CardholderId is not null && e.Granted is not null
            : e.CardholderId is null && e.Granted is null;
        if (!ok) throw new InvalidOperationException(ShapeRule);
    }

    private IEnumerable<AccessEventView> Views() =>
        from e in _events
        join d in _devices on e.DeviceId equals d.Id
        join c in _cardholders on e.CardholderId equals (int?)c.Id into cs
        from c in cs.DefaultIfEmpty()
        select new AccessEventView
        {
            Id = e.Id,
            OccurredAtUtc = e.OccurredAtUtc,
            DeviceId = d.Id,
            DeviceName = d.Name,
            Location = d.Location,
            CardholderId = e.CardholderId,
            CardholderName = c?.Name,
            Kind = e.Kind,
            Granted = e.Granted,
            Detail = e.Detail,
        };

    private static bool Contains(string? value, string text) =>
        value is not null && value.IndexOf(text, StringComparison.OrdinalIgnoreCase) >= 0;

    private static Device Copy(Device d) => new() { Id = d.Id, Name = d.Name, Kind = d.Kind, Location = d.Location };

    // SQL Server's DATETIME2(3) keeps milliseconds; match it so both stores return the same values.
    private static DateTime Utc(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        return new DateTime(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
    }
}
