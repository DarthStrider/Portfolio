using System;
using System.Threading.Tasks;
using System.Windows.Threading;
using AccessLog.Core.Data;
using AccessLog.Core.Simulation;
using AccessLog.Core.ViewModels;

namespace AccessLog.App.Services;

/// <summary>
/// Builds the app once: chooses where events are stored, seeds the demo building, and starts a
/// timer that records a new event every 1.5 seconds and refreshes the window.
/// </summary>
public sealed class ViewModelLocator
{
    /// <summary>Matches docker-compose.yml in this folder. Override with ACCESSLOG_CONNECTION.</summary>
    public const string DefaultConnection =
        "Server=localhost,1433;Database=AccessLog;User Id=sa;Password=AccessLog-dev-Passw0rd;TrustServerCertificate=True;Connect Timeout=3";

    private readonly Lazy<EventLogViewModel> _main = new(Create);

    public EventLogViewModel Main => _main.Value;

    private static EventLogViewModel Create()
    {
        var clock = new SystemClock();
        // Startup work runs on a pool thread and is waited for here, so the async database
        // calls never need the UI thread (waiting on it from the UI thread would deadlock).
        var (repository, description) = Task.Run(() => ChooseStoreAsync()).GetAwaiter().GetResult();
        var simulator = new AccessSimulator(repository, new Random(), clock);
        Task.Run(async () =>
        {
            await simulator.SeedAsync();
            if ((await repository.SearchAsync(new Core.Model.EventQuery { Limit = 1 })).Count == 0)
                await simulator.BackfillAsync(hours: 24, events: 400);
        }).GetAwaiter().GetResult();

        var viewModel = new EventLogViewModel(repository, clock, description);
        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
        timer.Tick += async (_, _) =>
        {
            await simulator.StepAsync();
            await viewModel.RefreshAsync();
        };
        timer.Start();
        _ = viewModel.RefreshAsync();
        return viewModel;
    }

    /// <summary>SQL Server if it answers within a few seconds, otherwise memory (and say so).</summary>
    private static async Task<(IAccessEventRepository, string)> ChooseStoreAsync()
    {
        var connection = Environment.GetEnvironmentVariable("ACCESSLOG_CONNECTION") ?? DefaultConnection;
        try
        {
            await SqlServerAccessEventRepository.EnsureDatabaseAsync(connection);
            var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
            return (new SqlServerAccessEventRepository(connection), $"SQL Server: {builder.InitialCatalog} on {builder.DataSource}");
        }
        catch (Exception e)
        {
            return (new InMemoryAccessEventRepository(), $"In memory (SQL Server not reachable: {e.Message})");
        }
    }
}
