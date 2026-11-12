namespace SolutionFramework.Common;

public enum LogLevel
{
    Info,
    Warn,
    Error,
}

public sealed record LogEntry(DateTimeOffset At, LogLevel Level, string Source, string Message, Exception? Exception);

/// <summary>Where log entries go. The host writes to the console; tests keep them in memory.</summary>
public interface ILogSink
{
    void Write(LogEntry entry);
}

public sealed class ConsoleLogSink(TextWriter? output = null) : ILogSink
{
    private readonly TextWriter _output = output ?? Console.Out;
    private readonly Lock _gate = new();

    public void Write(LogEntry entry)
    {
        var line = $"{entry.At:HH:mm:ss} {entry.Level.ToString().ToUpperInvariant(),-5} [{entry.Source}] {entry.Message}";
        if (entry.Exception is not null) line += $" ({entry.Exception.GetType().Name}: {entry.Exception.Message})";
        lock (_gate) _output.WriteLine(line);
    }
}

public sealed class MemoryLogSink : ILogSink
{
    private readonly Lock _gate = new();
    private readonly List<LogEntry> _entries = [];

    public IReadOnlyList<LogEntry> Entries
    {
        get { lock (_gate) return _entries.ToList(); }
    }

    public void Write(LogEntry entry)
    {
        lock (_gate) _entries.Add(entry);
    }
}

/// <summary>A logger that stamps every entry with its source (the module name) and the time.</summary>
public sealed class SourceLogger(string source, ILogSink sink, TimeProvider time) : IModuleLogger
{
    public void Info(string message) => Write(LogLevel.Info, message, null);
    public void Warn(string message) => Write(LogLevel.Warn, message, null);
    public void Error(string message, Exception? exception = null) => Write(LogLevel.Error, message, exception);

    private void Write(LogLevel level, string message, Exception? exception) =>
        sink.Write(new LogEntry(time.GetLocalNow(), level, source, message, exception));
}
