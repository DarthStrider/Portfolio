using AccessLog.Core.Data;
using AccessLog.Core.Model;
using Dapper;
using Microsoft.Data.SqlClient;

namespace AccessLog.Tests;

/// <summary>
/// The same contract on a real SQL Server. Each test gets a brand-new database (schema.sql runs
/// for real) that's dropped afterwards. The server comes from TEST_SQLSERVER, a connection string
/// with no database name; without it these tests are skipped. CI starts SQL Server in a container.
/// </summary>
public sealed class SqlServerRepositoryTests : RepositoryContract
{
    private static readonly string? Server = Environment.GetEnvironmentVariable("TEST_SQLSERVER");
    private readonly string _database = $"AccessLog_Test_{Guid.NewGuid():N}";

    private string ConnectionString => new SqlConnectionStringBuilder(Server) { InitialCatalog = _database }.ConnectionString;

    public override ValueTask InitializeAsync()
    {
        Assert.SkipWhen(Server is null, "Set TEST_SQLSERVER to a SQL Server connection string (no database name) to run these.");
        return base.InitializeAsync();
    }

    protected override async Task<IAccessEventRepository> CreateAsync()
    {
        await SqlServerAccessEventRepository.EnsureDatabaseAsync(ConnectionString);
        return new SqlServerAccessEventRepository(ConnectionString);
    }

    public override async ValueTask DisposeAsync()
    {
        if (Server is null) return;
        SqlConnection.ClearAllPools();
        await using var connection = new SqlConnection(Server);
        await connection.ExecuteAsync($"""
            IF DB_ID('{_database}') IS NOT NULL
            BEGIN
                ALTER DATABASE [{_database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                DROP DATABASE [{_database}];
            END
            """);
    }

    [Fact]
    public async Task The_schema_script_can_run_again_without_errors()
    {
        await SqlServerAccessEventRepository.EnsureDatabaseAsync(ConnectionString);
        Assert.Equal(3, (await Repo.GetDevicesAsync()).Count);
    }

    [Fact]
    public async Task The_check_constraint_refuses_a_badge_swipe_without_a_cardholder()
    {
        await Assert.ThrowsAsync<SqlException>(() => Repo.RecordAsync(new AccessEvent
        {
            OccurredAtUtc = Now, DeviceId = MainDoor.Id, Kind = EventKind.BadgeSwipe, Granted = true,
        }));
    }

    [Fact]
    public async Task The_reports_are_answered_from_the_time_index()
    {
        // Ask SQL Server for the estimated plan of the "denied by door" query and check it uses
        // the index the schema creates for exactly this purpose.
        await using var connection = new SqlConnection(ConnectionString);
        await connection.OpenAsync();
        await connection.ExecuteAsync("SET SHOWPLAN_XML ON;");
        var plan = await connection.ExecuteScalarAsync<string>("""
            SELECT d.Id, COUNT(*) FROM dbo.AccessEvents e JOIN dbo.Devices d ON d.Id = e.DeviceId
             WHERE e.OccurredAtUtc >= DATEADD(HOUR, -24, SYSUTCDATETIME()) AND e.Kind = 0 AND e.Granted = 0
             GROUP BY d.Id;
            """);
        await connection.ExecuteAsync("SET SHOWPLAN_XML OFF;");

        Assert.Contains("IX_AccessEvents_OccurredAt", plan);
    }
}
