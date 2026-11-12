using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AccessLog.Core.Model;

namespace AccessLog.Core.Data;

/// <summary>
/// Everything the app needs from storage. Two implementations: SQL Server (Dapper) for the real
/// thing, in-memory for tests and for running without a database. The same contract tests run
/// against both, so they behave the same.
/// </summary>
public interface IAccessEventRepository
{
    Task<int> AddDeviceAsync(Device device);
    Task<int> AddCardholderAsync(Cardholder cardholder);
    Task<IReadOnlyList<Device>> GetDevicesAsync();
    Task<IReadOnlyList<Cardholder>> GetCardholdersAsync();

    /// <summary>Saves the event and returns its new id. The device (and cardholder, if any) must exist.</summary>
    Task<long> RecordAsync(AccessEvent accessEvent);

    /// <summary>Events matching the query, newest first, at most <see cref="EventQuery.Limit"/>.</summary>
    Task<IReadOnlyList<AccessEventView>> SearchAsync(EventQuery query);

    /// <summary>Denied badge swipes per door since a time, most denials first. Doors with none are left out.</summary>
    Task<IReadOnlyList<DeniedByDoorRow>> DeniedByDoorAsync(DateTime sinceUtc);

    /// <summary>The devices with the most events of any kind since a time, most first, at most <paramref name="top"/>.</summary>
    Task<IReadOnlyList<NoisyDeviceRow>> NoisiestDevicesAsync(DateTime sinceUtc, int top);
}

/// <summary>A reference to something that doesn't exist, e.g. an event for an unknown device.</summary>
public sealed class UnknownReferenceException(string message) : Exception(message);
