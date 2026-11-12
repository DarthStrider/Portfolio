using System.Net;
using System.Net.Http.Json;

namespace TaskApi.Tests;

/// <summary>
/// The API over HTTP, end to end: routing, validation, EF Core and a real SQL Server database.
/// Each test gets its own empty database (a new factory per test), so they can't affect each other.
/// </summary>
public sealed class TasksApiTests : IAsyncLifetime
{
    private SqlServerApiFactory _factory = null!;
    private HttpClient _client = null!;

    private record TaskDto(int Id, string Title, bool Done, DateTimeOffset CreatedAt);

    private record ErrorDto(string Error);

    public ValueTask InitializeAsync()
    {
        Assert.SkipWhen(SqlServerApiFactory.SqlServer is null,
            "Set TEST_SQLSERVER to a SQL Server connection string (no database name) to run the HTTP tests.");
        _factory = new SqlServerApiFactory();
        _client = _factory.CreateClient();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_factory is not null) await _factory.DisposeAsync();
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private async Task<TaskDto> CreateAsync(string title)
    {
        var response = await _client.PostAsJsonAsync("/api/tasks", new { title }, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TaskDto>(Ct))!;
    }

    [Fact]
    public async Task Tasks_start_empty()
    {
        var tasks = await _client.GetFromJsonAsync<List<TaskDto>>("/api/tasks", Ct);
        Assert.Empty(tasks!);
    }

    [Fact]
    public async Task Post_creates_a_trimmed_task_with_a_location_header()
    {
        var response = await _client.PostAsJsonAsync("/api/tasks", new { title = "  Buy milk  " }, Ct);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var task = await response.Content.ReadFromJsonAsync<TaskDto>(Ct);
        Assert.Equal("Buy milk", task!.Title);
        Assert.False(task.Done);
        Assert.Equal($"/api/tasks/{task.Id}", response.Headers.Location?.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Post_rejects_blank_titles(string title)
    {
        var response = await _client.PostAsJsonAsync("/api/tasks", new { title }, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ErrorDto>(Ct);
        Assert.Contains("title", error!.Error);
    }

    [Fact]
    public async Task Post_rejects_a_title_over_200_characters()
    {
        var response = await _client.PostAsJsonAsync("/api/tasks", new { title = new string('x', 201) }, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Tasks_are_listed_in_the_order_they_were_created()
    {
        var first = await CreateAsync("first");
        var second = await CreateAsync("second");

        var tasks = await _client.GetFromJsonAsync<List<TaskDto>>("/api/tasks", Ct);

        Assert.Equal(new[] { first.Id, second.Id }, tasks!.Select(t => t.Id));
    }

    [Fact]
    public async Task Patch_changes_only_the_fields_given()
    {
        var task = await CreateAsync("Draft");

        var done = await _client.PatchAsJsonAsync($"/api/tasks/{task.Id}", new { done = true }, Ct);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);

        var renamed = await _client.PatchAsJsonAsync($"/api/tasks/{task.Id}", new { title = "Final" }, Ct);
        var result = await renamed.Content.ReadFromJsonAsync<TaskDto>(Ct);
        Assert.Equal("Final", result!.Title);
        Assert.True(result.Done);
    }

    [Fact]
    public async Task Patch_rejects_a_blank_title_and_leaves_the_task_alone()
    {
        var task = await CreateAsync("Keep me");

        var response = await _client.PatchAsJsonAsync($"/api/tasks/{task.Id}", new { title = " " }, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var tasks = await _client.GetFromJsonAsync<List<TaskDto>>("/api/tasks", Ct);
        Assert.Equal("Keep me", Assert.Single(tasks!).Title);
    }

    [Fact]
    public async Task Patch_and_delete_of_a_missing_task_return_404()
    {
        var patch = await _client.PatchAsJsonAsync("/api/tasks/99999", new { done = true }, Ct);
        var delete = await _client.DeleteAsync("/api/tasks/99999", Ct);

        Assert.Equal(HttpStatusCode.NotFound, patch.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, delete.StatusCode);
    }

    [Fact]
    public async Task A_non_numeric_id_does_not_match_the_route()
    {
        // {id:int} in the route means "abc" never reaches the handler.
        var response = await _client.DeleteAsync("/api/tasks/abc", Ct);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_returns_204_and_the_task_is_gone()
    {
        var task = await CreateAsync("Temporary");

        var response = await _client.DeleteAsync($"/api/tasks/{task.Id}", Ct);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty((await _client.GetFromJsonAsync<List<TaskDto>>("/api/tasks", Ct))!);
    }

    [Fact]
    public async Task Health_probes_report_ok_when_the_database_is_up()
    {
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/api/health/live", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/api/health/ready", Ct)).StatusCode);
    }
}
