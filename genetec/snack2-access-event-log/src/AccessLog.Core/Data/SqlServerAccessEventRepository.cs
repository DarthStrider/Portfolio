using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using AccessLog.Core.Model;
using Dapper;
using Microsoft.Data.SqlClient;

namespace AccessLog.Core.Data;

/// <summary>
/// The repository on SQL Server, with Dapper: each method is one hand-written SQL statement, and
/// Dapper maps the result columns onto the model's properties by name.
/// </summary>
public sealed class SqlServerAccessEventRepository(string connectionString) : IAccessEventRepository
{
    // SQL Server error numbers for constraint violations.
    private const int ForeignKeyViolation = 547;

    private SqlConnection Open() => new(connectionString);

    /// <summary>Creates the database if it's missing, then the tables and indexes (schema.sql).</summary>
    public static async Task EnsureDatabaseAsync(string connectionString)
    {
        var builder = new SqlConnectionStringBuilder(connectionString);
        var database = builder.InitialCatalog;
        if (string.IsNullOrEmpty(database))
            throw new ArgumentException("The connection string needs a database name (Database=...).");

        // CREATE DATABASE has to run from another database, so connect to master first.
        builder.InitialCatalog = "master";
        using (var master = new SqlConnection(builder.ConnectionString))
        {
            // EXEC() only takes strings and variables, so build the statement first. QUOTENAME
            // brackets the name, so it can't be used to inject SQL.
            await master.ExecuteAsync(
                """
                DECLARE @create NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(@database);
                IF DB_ID(@database) IS NULL EXEC (@create);
                """,
                new { database });
        }

        using var connection = new SqlConnection(connectionString);
        await connection.ExecuteAsync(ReadSchema());
    }

    /// <summary>The schema script, embedded in this assembly.</summary>
    public static string ReadSchema()
    {
        var assembly = typeof(SqlServerAccessEventRepository).Assembly;
        using var stream = assembly.GetManifestResourceStream("AccessLog.Core.Data.schema.sql")
            ?? throw new InvalidOperationException("schema.sql is missing from the assembly.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public async Task<int> AddDeviceAsync(Device device)
    {
        using var connection = Open();
        device.Id = await connection.ExecuteScalarAsync<int>(
            """
            INSERT INTO dbo.Devices (Name, Kind, Location)
            OUTPUT INSERTED.Id
            VALUES (@Name, @Kind, @Location);
            """,
            new { device.Name, Kind = (byte)device.Kind, device.Location });
        return device.Id;
    }

    public async Task<int> AddCardholderAsync(Cardholder cardholder)
    {
        using var connection = Open();
        cardholder.Id = await connection.ExecuteScalarAsync<int>(
            """
            INSERT INTO dbo.Cardholders (Name, BadgeNumber)
            OUTPUT INSERTED.Id
            VALUES (@Name, @BadgeNumber);
            """,
            cardholder);
        return cardholder.Id;
    }

    public async Task<IReadOnlyList<Device>> GetDevicesAsync()
    {
        using var connection = Open();
        var rows = await connection.QueryAsync<Device>("SELECT Id, Name, Kind, Location FROM dbo.Devices ORDER BY Id;");
        return rows.ToList();
    }

    public async Task<IReadOnlyList<Cardholder>> GetCardholdersAsync()
    {
        using var connection = Open();
        var rows = await connection.QueryAsync<Cardholder>("SELECT Id, Name, BadgeNumber FROM dbo.Cardholders ORDER BY Id;");
        return rows.ToList();
    }

    public async Task<long> RecordAsync(AccessEvent accessEvent)
    {
        using var connection = Open();
        try
        {
            accessEvent.Id = await connection.ExecuteScalarAsync<long>(
                """
                INSERT INTO dbo.AccessEvents (OccurredAtUtc, DeviceId, CardholderId, Kind, Granted, Detail)
                OUTPUT INSERTED.Id
                VALUES (@OccurredAtUtc, @DeviceId, @CardholderId, @Kind, @Granted, @Detail);
                """,
                new
                {
                    OccurredAtUtc = Utc(accessEvent.OccurredAtUtc),
                    accessEvent.DeviceId,
                    accessEvent.CardholderId,
                    Kind = (byte)accessEvent.Kind,
                    accessEvent.Granted,
                    accessEvent.Detail,
                });
        }
        catch (SqlException e) when (e.Number == ForeignKeyViolation)
        {
            throw new UnknownReferenceException($"No device {accessEvent.DeviceId} or cardholder {accessEvent.CardholderId}.");
        }
        return accessEvent.Id;
    }

    public async Task<IReadOnlyList<AccessEventView>> SearchAsync(EventQuery query)
    {
        // Each filter is "parameter is null OR condition", so one statement serves every combination.
        // OPTION (RECOMPILE) lets SQL Server plan for the filters actually given each time.
        const string sql = """
            SELECT TOP (@Limit)
                   e.Id, e.OccurredAtUtc, e.DeviceId, d.Name AS DeviceName, d.Location,
                   e.CardholderId, c.Name AS CardholderName, e.Kind, e.Granted, e.Detail
              FROM dbo.AccessEvents e
              JOIN dbo.Devices d          ON d.Id = e.DeviceId
              LEFT JOIN dbo.Cardholders c ON c.Id = e.CardholderId
             WHERE (@FromUtc IS NULL      OR e.OccurredAtUtc >= @FromUtc)
               AND (@ToUtc IS NULL        OR e.OccurredAtUtc <  @ToUtc)
               AND (@DeviceId IS NULL     OR e.DeviceId = @DeviceId)
               AND (@CardholderId IS NULL OR e.CardholderId = @CardholderId)
               AND (@Kind IS NULL         OR e.Kind = @Kind)
               AND (@Granted IS NULL      OR e.Granted = @Granted)
               AND (@Text IS NULL         OR d.Name LIKE @Text OR d.Location LIKE @Text OR c.Name LIKE @Text)
             ORDER BY e.OccurredAtUtc DESC, e.Id DESC
            OPTION (RECOMPILE);
            """;
        using var connection = Open();
        var rows = await connection.QueryAsync<AccessEventView>(sql, new
        {
            Limit = Math.Max(0, query.Limit),
            FromUtc = query.FromUtc.HasValue ? Utc(query.FromUtc.Value) : (DateTime?)null,
            ToUtc = query.ToUtc.HasValue ? Utc(query.ToUtc.Value) : (DateTime?)null,
            query.DeviceId,
            query.CardholderId,
            Kind = query.Kind.HasValue ? (byte)query.Kind.Value : (byte?)null,
            query.Granted,
            Text = string.IsNullOrWhiteSpace(query.Text) ? null : "%" + EscapeLike(query.Text!.Trim()) + "%",
        });
        return rows.Select(AsUtc).ToList();
    }

    public async Task<IReadOnlyList<DeniedByDoorRow>> DeniedByDoorAsync(DateTime sinceUtc)
    {
        // GROUP BY the door; only denied swipes in the window count. The time-keyed index makes the
        // WHERE a range seek, and it includes DeviceId and Granted, so the table itself isn't read.
        const string sql = """
            SELECT d.Id AS DeviceId, d.Name AS DeviceName, d.Location, COUNT(*) AS Denied
              FROM dbo.AccessEvents e
              JOIN dbo.Devices d ON d.Id = e.DeviceId
             WHERE e.OccurredAtUtc >= @sinceUtc
               AND e.Kind = 0
               AND e.Granted = 0
             GROUP BY d.Id, d.Name, d.Location
             ORDER BY Denied DESC, d.Name;
            """;
        using var connection = Open();
        var rows = await connection.QueryAsync<DeniedByDoorRow>(sql, new { sinceUtc = Utc(sinceUtc) });
        return rows.ToList();
    }

    public async Task<IReadOnlyList<NoisyDeviceRow>> NoisiestDevicesAsync(DateTime sinceUtc, int top)
    {
        const string sql = """
            SELECT TOP (@top) d.Id AS DeviceId, d.Name AS DeviceName, d.Kind, COUNT(*) AS Events
              FROM dbo.AccessEvents e
              JOIN dbo.Devices d ON d.Id = e.DeviceId
             WHERE e.OccurredAtUtc >= @sinceUtc
             GROUP BY d.Id, d.Name, d.Kind
             ORDER BY Events DESC, d.Name;
            """;
        using var connection = Open();
        var rows = await connection.QueryAsync<NoisyDeviceRow>(sql, new { sinceUtc = Utc(sinceUtc), top = Math.Max(0, top) });
        return rows.ToList();
    }

    /// <summary>DATETIME2 has no time zone: store UTC, and mark values read back as UTC.</summary>
    private static DateTime Utc(DateTime value) =>
        value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static AccessEventView AsUtc(AccessEventView row)
    {
        row.OccurredAtUtc = DateTime.SpecifyKind(row.OccurredAtUtc, DateTimeKind.Utc);
        return row;
    }

    /// <summary>Makes %, _ and [ in user text match themselves in a LIKE pattern.</summary>
    private static string EscapeLike(string text) =>
        text.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]");
}
