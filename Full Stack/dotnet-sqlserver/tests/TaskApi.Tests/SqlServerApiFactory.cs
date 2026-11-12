using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;

namespace TaskApi.Tests;

/// <summary>
/// Starts the real API in memory (WebApplicationFactory), pointed at a brand-new SQL Server
/// database that's dropped afterwards. The server comes from the TEST_SQLSERVER environment
/// variable, a connection string without a database name; CI starts one in a container.
/// Without it, the HTTP tests are skipped rather than failing.
/// </summary>
public sealed class SqlServerApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static readonly string? Server = Environment.GetEnvironmentVariable("TEST_SQLSERVER");

    private readonly string _database = $"TaskDb_Test_{Guid.NewGuid():N}";

    private string ConnectionString =>
        new SqlConnectionStringBuilder(Server) { InitialCatalog = _database }.ConnectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Program reads ConnectionStrings:Default; this setting wins over appsettings.json.
        builder.UseSetting("ConnectionStrings:Default", ConnectionString);
    }

    public ValueTask InitializeAsync() => ValueTask.CompletedTask;

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (Server is null) return;

        // Drop the throwaway database. SINGLE_USER closes pooled connections still holding it open.
        SqlConnection.ClearAllPools();
        await using var connection = new SqlConnection(Server);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            IF DB_ID('{_database}') IS NOT NULL
            BEGIN
                ALTER DATABASE [{_database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                DROP DATABASE [{_database}];
            END
            """;
        await command.ExecuteNonQueryAsync();
    }
}
