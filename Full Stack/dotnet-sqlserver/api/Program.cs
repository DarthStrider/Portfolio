using System.Net;
using Microsoft.EntityFrameworkCore;
using TaskApi;

var builder = WebApplication.CreateBuilder(args);

// Connection string comes from ConnectionStrings__Default (set by docker-compose / Kubernetes),
// falling back to appsettings.json for running outside containers.
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("Default"),
        sql => sql.EnableRetryOnFailure()));

var app = builder.Build();

await EnsureDatabaseAsync(app);

var api = app.MapGroup("/api");

// Liveness: the process is up. Kubernetes restarts the pod if this fails.
api.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));

// Readiness: the database is reachable. Kubernetes stops sending traffic if this fails.
api.MapGet("/health/ready", async (AppDbContext db) =>
    await db.Database.CanConnectAsync()
        ? Results.Ok(new { status = "ok" })
        : Results.Json(new { status = "database unavailable" }, statusCode: 503));

// Which pod answered. Inside Kubernetes the hostname is the pod name.
api.MapGet("/info", () => Results.Ok(new { hostname = Dns.GetHostName() }));

api.MapGet("/tasks", async (AppDbContext db) =>
    await db.Tasks.OrderBy(t => t.Id).ToListAsync());

api.MapPost("/tasks", async (CreateTaskRequest request, AppDbContext db) =>
{
    if (!IsValidTitle(request.Title))
        return Results.BadRequest(new { error = "title is required (1-200 characters)" });

    var task = new TaskItem { Title = request.Title!.Trim() };
    db.Tasks.Add(task);
    await db.SaveChangesAsync();
    return Results.Created($"/api/tasks/{task.Id}", task);
});

api.MapPatch("/tasks/{id:int}", async (int id, UpdateTaskRequest request, AppDbContext db) =>
{
    if (request.Title is not null && !IsValidTitle(request.Title))
        return Results.BadRequest(new { error = "title must be 1-200 characters" });

    var task = await db.Tasks.FindAsync(id);
    if (task is null)
        return Results.NotFound(new { error = "task not found" });

    if (request.Title is not null) task.Title = request.Title.Trim();
    if (request.Done is not null) task.Done = request.Done.Value;
    await db.SaveChangesAsync();
    return Results.Ok(task);
});

api.MapDelete("/tasks/{id:int}", async (int id, AppDbContext db) =>
{
    var deleted = await db.Tasks.Where(t => t.Id == id).ExecuteDeleteAsync();
    return deleted > 0 ? Results.NoContent() : Results.NotFound(new { error = "task not found" });
});

app.Run();

static bool IsValidTitle(string? title) =>
    !string.IsNullOrWhiteSpace(title) && title.Length <= 200;

// Creates the database and table on first start. SQL Server takes 10-30 seconds to
// boot, so keep retrying rather than crashing while it comes up.
static async Task EnsureDatabaseAsync(WebApplication app, int attempts = 30)
{
    for (var i = 1; ; i++)
    {
        try
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.EnsureCreatedAsync();
            return;
        }
        catch (Exception ex) when (i < attempts)
        {
            app.Logger.LogWarning("Database not ready (attempt {Attempt}/{Max}): {Message}",
                i, attempts, ex.Message);
            await Task.Delay(TimeSpan.FromSeconds(3));
        }
    }
}
