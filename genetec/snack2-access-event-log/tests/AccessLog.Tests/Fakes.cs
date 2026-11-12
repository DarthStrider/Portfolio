using AccessLog.Core.Simulation;

namespace AccessLog.Tests;

public sealed class FixedClock(DateTime utcNow) : IClock
{
    public DateTime UtcNow { get; set; } = utcNow;
}
