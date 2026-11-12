using System;

namespace AccessLog.Core.Model;

public enum DeviceKind
{
    Door = 0,
    Camera = 1,
}

/// <summary>What happened at a device. Stored as a number in AccessEvents.Kind.</summary>
public enum EventKind
{
    /// <summary>A cardholder presented a badge. <see cref="AccessEvent.Granted"/> says what the door decided.</summary>
    BadgeSwipe = 0,

    /// <summary>A device went online, offline or into alarm (Snack 1's status changes).</summary>
    StatusChange = 1,
}

/// <summary>A row of the Devices table.</summary>
public sealed class Device
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public DeviceKind Kind { get; set; }
    public string Location { get; set; } = "";
}

/// <summary>A row of the Cardholders table: someone with a badge.</summary>
public sealed class Cardholder
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string BadgeNumber { get; set; } = "";
}

/// <summary>A row of the AccessEvents table. Times are always UTC.</summary>
public sealed class AccessEvent
{
    public long Id { get; set; }
    public DateTime OccurredAtUtc { get; set; }
    public int DeviceId { get; set; }

    /// <summary>Who swiped. Null for status changes.</summary>
    public int? CardholderId { get; set; }

    public EventKind Kind { get; set; }

    /// <summary>Access granted (true) or denied (false). Null for status changes.</summary>
    public bool? Granted { get; set; }

    /// <summary>Free text, e.g. "Online → Alarm" for a status change.</summary>
    public string? Detail { get; set; }
}

/// <summary>An event joined with its device and cardholder, as the event list shows it.</summary>
public sealed class AccessEventView
{
    public long Id { get; set; }
    public DateTime OccurredAtUtc { get; set; }
    public int DeviceId { get; set; }
    public string DeviceName { get; set; } = "";
    public string Location { get; set; } = "";
    public int? CardholderId { get; set; }
    public string? CardholderName { get; set; }
    public EventKind Kind { get; set; }
    public bool? Granted { get; set; }
    public string? Detail { get; set; }

    /// <summary>"Granted", "Denied" or the status change, for display.</summary>
    public string Outcome => Granted switch
    {
        true => "Granted",
        false => "Denied",
        null => Detail ?? "",
    };
}

/// <summary>One row of "denied access by door".</summary>
public sealed class DeniedByDoorRow
{
    public int DeviceId { get; set; }
    public string DeviceName { get; set; } = "";
    public string Location { get; set; } = "";
    public int Denied { get; set; }
}

/// <summary>One row of "noisiest devices": the most events of any kind.</summary>
public sealed class NoisyDeviceRow
{
    public int DeviceId { get; set; }
    public string DeviceName { get; set; } = "";
    public DeviceKind Kind { get; set; }
    public int Events { get; set; }
}

/// <summary>Which events to list. Every filter is optional.</summary>
public sealed class EventQuery
{
    public DateTime? FromUtc { get; set; }
    public DateTime? ToUtc { get; set; }
    public int? DeviceId { get; set; }
    public int? CardholderId { get; set; }
    public EventKind? Kind { get; set; }
    public bool? Granted { get; set; }

    /// <summary>Matches device name, location or cardholder name (case-insensitive).</summary>
    public string? Text { get; set; }

    /// <summary>Newest events first, at most this many.</summary>
    public int Limit { get; set; } = 200;
}
