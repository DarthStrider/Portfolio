using System.Text.Json.Serialization;
using AccessLog.Core.Data;
using AccessLog.Core.Model;
using AccessLog.Core.Simulation;
using Dashboard.Api;

var builder = WebApplication.CreateBuilder(args);

// Where events come from: Snack 2's SQL Server database if a connection string is set
// (ConnectionStrings__AccessLog), otherwise an in-memory store filled with a demo day.
var connection = builder.Configuration.GetConnectionString("AccessLog");
builder.Services.AddSingleton<IClock, SystemClock>();
if (string.IsNullOrWhiteSpace(connection))
{
    builder.Services.AddSingleton<IAccessEventRepository, InMemoryAccessEventRepository>();
    builder.Services.AddSingleton<StoreInfo>(new StoreInfo("In memory (demo data)"));
}
else
{
    builder.Services.AddSingleton<IAccessEventRepository>(_ => new SqlServerAccessEventRepository(connection));
    builder.Services.AddSingleton<StoreInfo>(new StoreInfo("SQL Server"));
}

// Demo:LiveEvents (default true) keeps adding events, so the page has something to update.
builder.Services.AddHostedService<DemoActivity>();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

if (!string.IsNullOrWhiteSpace(connection))
    await SqlServerAccessEventRepository.EnsureDatabaseAsync(connection);

app.UseDefaultFiles();
app.UseStaticFiles(); // the built React app (npm run build in web/ writes to wwwroot)

var api = app.MapGroup("/api");

api.MapGet("/health", (StoreInfo store) => Results.Ok(new { status = "ok", store = store.Description }));

api.MapGet("/events", async (IAccessEventRepository repo, string? outcome, string? search, int? limit) =>
{
    if (!Filters.TryParseOutcome(outcome, out var filter))
        return Results.BadRequest(new { error = "outcome must be all, granted, denied or status" });
    if (limit is < 1 or > 500)
        return Results.BadRequest(new { error = "limit must be between 1 and 500" });

    var query = Filters.ToQuery(filter, search, limit ?? 100);
    return Results.Ok(await repo.SearchAsync(query));
});

api.MapGet("/reports/denied-by-door", async (IAccessEventRepository repo, IClock clock, int? hours) =>
    hours is < 1 or > 168
        ? Results.BadRequest(new { error = "hours must be between 1 and 168" })
        : Results.Ok(await repo.DeniedByDoorAsync(clock.UtcNow.AddHours(-(hours ?? 24)))));

api.MapGet("/reports/noisiest", async (IAccessEventRepository repo, IClock clock, int? hours, int? top) =>
    hours is < 1 or > 168 || top is < 1 or > 50
        ? Results.BadRequest(new { error = "hours must be 1-168 and top 1-50" })
        : Results.Ok(await repo.NoisiestDevicesAsync(clock.UtcNow.AddHours(-(hours ?? 24)), top ?? 5)));

app.MapFallbackToFile("index.html");
app.Run();

public sealed record StoreInfo(string Description);

// Lets the tests start this app with WebApplicationFactory<Program>.
public partial class Program { }
