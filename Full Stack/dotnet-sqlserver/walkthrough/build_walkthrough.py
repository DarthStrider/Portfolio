"""Builds "Task Tracker, Line by Line: ASP.NET Core and SQL Server" (task-tracker-dotnet-book.pdf) from the real source.

Run from anywhere: python3 "Full Stack/dotnet-sqlserver/walkthrough/build_walkthrough.py"  (needs reportlab and the
DejaVu fonts). Line numbers are computed from the files at build time, so rebuild after changing the code; a listing
whose anchor text has gone stops the build.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "..", "walkthrough-kit"))

from bookkit import Book, M  # noqa: E402
import frontend  # noqa: E402
from reportlab.graphics.shapes import Drawing  # noqa: E402

WF = "../../.github/workflows/fullstack-dotnet-sqlserver.yml"
DB = "../../.github/dependabot.yml"
T = "tests/TaskApi.Tests/"


def arch(b):
    d = Drawing(486, 120)
    b.box(d, 0, 30, 90, 60, "Browser", ["React page", "calls /api/..."])
    b.box(d, 125, 30, 100, 60, "web", ["nginx", "page + /api proxy"])
    b.box(d, 260, 30, 100, 60, "api  (×2)", ["ASP.NET Core 10", "EF Core"])
    b.box(d, 395, 30, 91, 60, "sqlserver", ["SQL Server 2022", "TaskDb.Tasks"])
    b.arrow(d, 90, 60, 125, 60, label=":8081")
    b.arrow(d, 225, 60, 260, 60, label="api:8080")
    b.arrow(d, 360, 60, 395, 60, label=":1433")
    return d


def part0(b):
    b.PART("Part 0", "The big picture",
           "The same task tracker as the Node version, with the backend in C#: an ASP.NET Core minimal API using "
           "Entity Framework Core and SQL Server. Same React page, same REST contract, same containers and manifests.")
    b.H1("0.1 The pieces")
    b.figure(arch(b), "Figure 0.1. The browser asks nginx; nginx forwards /api to the API; EF Core talks to SQL Server.")
    b.T([["Piece", "Built with", "Job"],
         ["web", "React 19, Vite, nginx", "Serves the page; forwards " + M("/api/") + " to the API"],
         ["api", ".NET 10, ASP.NET Core minimal APIs, EF Core 10", "REST endpoints, validation, data access"],
         ["sqlserver", "SQL Server 2022 (Linux container)", "Stores tasks in a volume"]], [1.0, 2.6, 3.15])
    b.H1("0.2 The API")
    b.T([["Method and path", "Does", "Answers"],
         ["GET /api/tasks", "List tasks, oldest first", "200 + array"],
         ["POST /api/tasks", "Create from " + M("{ title }"), "201 + Location + task; 400"],
         ["PATCH /api/tasks/{id:int}", "Change " + M("title") + " and/or " + M("done"), "200 + task; 400; 404"],
         ["DELETE /api/tasks/{id:int}", "Delete", "204; 404"],
         ["GET /api/health/live", "Is the process up?", "200"],
         ["GET /api/health/ready", "Can it reach the database?", "200 or 503"],
         ["GET /api/info", "Which pod answered", "200 + " + M("{ hostname }")]], [2.0, 2.45, 2.3])
    b.P("The routes, fields and status codes match the Node version, which is why the two can share a front end. "
        "One small difference: a non-numeric id like " + M("/api/tasks/abc") + " is a 404 here (the route doesn't "
        "match) and a 400 in Node (the handler rejects it).")
    b.H1("0.3 The layout")
    b.T([["Path", "What's there"],
         [M("api/"), "Program.cs (all endpoints and startup), TaskItem.cs (entity, requests, rules), AppDbContext.cs"],
         [M("tests/TaskApi.Tests/"), "xUnit v3: the title rule, and every endpoint against a real SQL Server"],
         [M("TaskApi.slnx") + ", " + M("global.json"), "The solution, and the SDK and test runner it needs"],
         [M("frontend/"), "React app, its tests, nginx.conf and Dockerfile"],
         [M("k8s/") + ", " + M("docker-compose.yml"), "Kubernetes manifests and local Compose"],
         [M("walkthrough/"), "This book and the script that builds it"]], [2.3, 4.45])
    b.CALL("This book is generated from the source by " + M("walkthrough/build_walkthrough.py") + ". Every listing "
           "is the real file with its real line numbers, and the bold \"Line n\" notes refer to them.")


def part1(b):
    b.PART("Part 1", "The API",
           "Three C# files. The entity and its rules, the database context, and Program.cs, which is the whole web "
           "app: configuration, startup and every endpoint, in about ninety lines.")
    b.H1("1.1 The project file")
    b.whole("api/TaskApi.csproj", "xml")
    b.notes("api/TaskApi.csproj", [
        ("<Project Sdk=\"Microsoft.NET.Sdk.Web\">", "The Web SDK brings in ASP.NET Core and its implicit usings "
         "(" + M("WebApplication") + ", " + M("Results") + " and so on)."),
        ("<Nullable>enable</Nullable>", "Nullable reference types: " + M("string") + " can't be null, "
         + M("string?") + " can, and the compiler warns where you mix them up."),
        ("<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>", "Write " + M("packages.lock.json") +
         ": NuGet's lock file. Part 5 covers it."),
        ("Version=\"10.0.15\"", "One package. It brings EF Core, the SQL Server provider and " +
         M("Microsoft.Data.SqlClient") + " with it."),
    ])
    b.H1("1.2 TaskItem.cs: the entity and its rules")
    b.whole("api/TaskItem.cs", "cs")
    b.notes("api/TaskItem.cs", [
        ("public int Id { get; set; }", "EF Core's convention: a property called " + M("Id") + " is the primary key, "
         "and an " + M("int") + " key becomes an " + M("IDENTITY") + " column."),
        ("[MaxLength(TaskRules.MaxTitleLength)]", "The column becomes " + M("nvarchar(200)") + ". Without it, "
         + M("nvarchar(max)") + ", which can't be indexed. The same constant drives the validation."),
        ("public required string Title { get; set; }", M("required") + ": code that creates a " + M("TaskItem") +
         " must set " + M("Title") + ", or it doesn't compile. Non-nullable, so the column is NOT NULL."),
        ("public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;", M("DateTimeOffset") + " keeps "
         "the offset, so the instant is unambiguous; SQL Server stores it as " + M("datetimeoffset") + "."),
        ("public record CreateTaskRequest(string? Title);", "Request bodies as <b>records</b>: one line each. "
         + M("Title") + " is nullable because a client can leave it out."),
        ("public record UpdateTaskRequest(string? Title, bool? Done);", M("bool?") + " tells \"not sent\" (null) apart "
         "from " + M("false") + "."),
        ("public static bool IsValidTitle(string? title) =>", "Pulled out of Program.cs in 1.1.0 so it could be "
         "unit-tested without starting the app."),
    ])
    b.H1("1.3 AppDbContext.cs")
    b.whole("api/AppDbContext.cs", "cs")
    b.notes("api/AppDbContext.cs", [
        ("public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)", "A <b>primary "
         "constructor</b> (C# 12): the options go straight to the base class. Which database and connection string "
         "is decided by whoever creates it, in Program.cs."),
        ("public DbSet<TaskItem> Tasks => Set<TaskItem>();", "A " + M("DbSet") + " is a queryable table. LINQ on it "
         "(" + M("db.Tasks.OrderBy(t => t.Id)") + ") is translated to SQL."),
    ])
    b.H1("1.4 Program.cs: setup")
    b.code("api/Program.cs", "var builder = WebApplication.CreateBuilder(args);", "cs", end="var api = app.MapGroup(\"/api\");")
    b.notes("api/Program.cs", [
        ("builder.Services.AddDbContext<AppDbContext>(options =>", "Registers the context with <b>dependency "
         "injection</b>, one instance per request. Handlers ask for it by type."),
        ("builder.Configuration.GetConnectionString(\"Default\"),", "Reads " + M("ConnectionStrings:Default") +
         ". appsettings.json has a localhost default; the environment variable " + M("ConnectionStrings__Default") +
         " (double underscore for the colon) overrides it in Compose and Kubernetes."),
        ("sql => sql.EnableRetryOnFailure()));", "Retry transient SQL Server errors (a dropped connection, a failover) "
         "automatically, with back-off."),
        ("await EnsureDatabaseAsync(app);", "Create the database before accepting requests."),
        ("var api = app.MapGroup(\"/api\");", "A <b>route group</b>: every endpoint below is under " + M("/api") + "."),
    ])
    b.H1("1.5 Program.cs: endpoints")
    b.code("api/Program.cs", "// Liveness", "cs", end="api.MapGet(\"/info\"")
    b.notes("api/Program.cs", [
        ("api.MapGet(\"/health/live\"", "Liveness doesn't touch the database, so a database outage doesn't make "
         "Kubernetes restart the API."),
        ("await db.Database.CanConnectAsync()", "Readiness does: 503 while the database is unreachable, and "
         "Kubernetes sends traffic elsewhere."),
    ])
    b.code("api/Program.cs", "api.MapGet(\"/tasks\"", "cs", end="ToListAsync());")
    b.P("A minimal API handler is a lambda. ASP.NET Core looks at its parameters: " + M("AppDbContext") + " is a "
        "registered service, so it comes from dependency injection. The returned list is serialized to JSON, in camelCase.")
    b.code("api/Program.cs", "api.MapPost(\"/tasks\"", "cs", end="});")
    b.notes("api/Program.cs", [
        ("api.MapPost(\"/tasks\", async (CreateTaskRequest request, AppDbContext db) =>", "A complex type with no "
         "other source binds from the JSON body. Malformed JSON never reaches the handler: the framework answers 400."),
        ("var task = new TaskItem { Title = request.Title!.Trim() };", "The " + M("!") + " is safe because "
         + M("IsValidTitle") + " just returned true; the compiler can't see across that call."),
        ("await db.SaveChangesAsync();", "EF Core sends the INSERT and reads back the new " + M("IDENTITY") + " value "
         "into " + M("task.Id") + "."),
        ("return Results.Created($\"/api/tasks/{task.Id}\", task);", "201 with a " + M("Location") + " header pointing "
         "at the new task. A test checks the header."),
    ])
    b.code("api/Program.cs", "api.MapPatch(\"/tasks/{id:int}\"", "cs", end="});")
    b.notes("api/Program.cs", [
        ("api.MapPatch(\"/tasks/{id:int}\"", "A <b>route constraint</b>: " + M("{id:int}") + " only matches integers, "
         "so " + M("/tasks/abc") + " is a 404 before the handler runs."),
        ("var task = await db.Tasks.FindAsync(id);", "Load by key. EF Core now <b>tracks</b> the object..."),
        ("if (request.Title is not null) task.Title = request.Title.Trim();", "...so changing its properties is enough..."),
        ("await db.SaveChangesAsync();", "...and this writes an UPDATE of just the changed columns."),
    ])
    b.code("api/Program.cs", "api.MapDelete(\"/tasks/{id:int}\"", "cs", end="});")
    b.P(M("ExecuteDeleteAsync") + " (EF Core 7+) sends one " + M("DELETE ... WHERE Id = @id") + " and returns the "
        "number of rows deleted, without loading the task first. 0 rows means 404.")
    b.H1("1.6 Program.cs: starting up")
    b.code("api/Program.cs", "static async Task EnsureDatabaseAsync", "cs")
    b.notes("api/Program.cs", [
        ("using var scope = app.Services.CreateScope();", "The context is scoped (one per request). Outside a request "
         "you make a scope to get one."),
        ("await db.Database.EnsureCreatedAsync();", "Creates the database and tables from the model if they don't "
         "exist. Fine for a demo; a real app would use migrations, which can change an existing schema."),
        ("catch (Exception ex) when (i < attempts)", "An <b>exception filter</b>: on the last attempt the filter is "
         "false, the exception isn't caught, and startup fails loudly."),
    ])
    b.code("api/Program.cs", "public partial class Program { }", "cs", end="public partial class Program { }")
    b.P("Top-level statements compile into an internal " + M("Program") + " class. Declaring it public lets the "
        "test project write " + M("WebApplicationFactory<Program>") + ".")
    b.H1("1.7 Interview questions")
    b.QA("What does EF Core change tracking do in the PATCH handler?",
         "FindAsync returns a tracked entity; EF Core remembers its original values, so SaveChangesAsync can generate "
         "an UPDATE for just the properties that changed.")
    b.QA("EnsureCreated or migrations?",
         "EnsureCreated builds the schema only when the database doesn't exist and can't change it later. Migrations "
         "record each schema change and apply it to existing databases; that's what production needs.")
    b.QA("Where does a minimal API handler's argument come from?",
         "Route values and query strings for simple types, the JSON body for one complex type, and DI for registered "
         "services. Attributes like [FromQuery] override the inference.")
    b.QA("Why bool? for Done?",
         "So the API can tell \"don't change it\" (absent, null) from \"set it to false\".")


def part3(b):
    b.PART("Part 3", "Containers and Kubernetes",
           "The same shape as the Node version: three images, Compose locally, Kubernetes manifests applied with "
           "kustomize. SQL Server brings a few needs of its own: memory, a password policy, and a slow start.")
    b.H1("3.1 The API image")
    b.whole("api/Dockerfile", "docker")
    b.notes("api/Dockerfile", [
        ("COPY TaskApi.csproj packages.lock.json ./", "The project and lock file first, so the restore layer is "
         "cached until dependencies change."),
        ("RUN dotnet restore --locked-mode", "Restore exactly what the lock records, or fail."),
        ("FROM mcr.microsoft.com/dotnet/aspnet:10.0", "The runtime image: no SDK, no compiler, much smaller."),
        ("USER $APP_UID", "Microsoft's .NET images define a non-root user and set the port to 8080, which a non-root "
         "process is allowed to bind."),
    ])
    b.H1("3.2 Docker Compose")
    b.whole("docker-compose.yml", "yaml")
    b.notes("docker-compose.yml", [
        ("ACCEPT_EULA: \"Y\"", "SQL Server won't start without accepting the licence. The Developer edition is the default."),
        ("MSSQL_SA_PASSWORD: \"Tasks-dev-Passw0rd\"", "It must meet SQL Server's complexity rules, or the container exits."),
        ("start_period: 20s", "SQL Server takes a while to boot; failed checks in the first 20 seconds don't count."),
        ("ConnectionStrings__Default:", "Overrides appsettings.json. " + M("Server=db") + ": the Compose service name."),
        ("- \"8081:80\"", "8081, so it can run beside the Node version on 8080."),
    ])
    b.H1("3.3 Kubernetes")
    b.code("k8s/sqlserver.yaml", "kind: StatefulSet", "yaml", end="storage: 2Gi")
    b.notes("k8s/sqlserver.yaml", [
        ("fsGroup: 10001", "SQL Server's container runs as user 10001. " + M("fsGroup") + " makes the volume writable "
         "by that group; without it, SQL Server can't create its files."),
        ("- /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P \"$MSSQL_SA_PASSWORD\" -C -Q \"SELECT 1\"", "Ready "
         "when it answers a query. " + M("-C") + " trusts the server's self-signed certificate."),
        ("requests: { cpu: 250m, memory: 2Gi }", "SQL Server needs 2 GB to start. Docker Desktop's Kubernetes needs "
         "that much memory available."),
    ])
    b.code("k8s/api.yaml", "containers:", "yaml", end="limits: { memory: 512Mi }")
    b.notes("k8s/api.yaml", [
        ("- name: ConnectionStrings__Default", "One setting carries the whole connection string, read from the Secret."),
        ("startupProbe:", "Up to 150 seconds to start while " + M("EnsureDatabaseAsync") + " waits for SQL Server; "
         "liveness takes over afterwards."),
    ])
    b.whole("k8s/db-secret.yaml", "yaml")
    b.P("The same Kubernetes ideas as the Node book: headless Service plus StatefulSet for the database, a Deployment "
        "with two replicas for the API, a LoadBalancer Service for the page, and a namespace (" + M("tasks-dotnet") +
        ") that holds it all.")
    b.H1("3.4 Interview questions")
    b.QA("Why does the API retry on startup when Compose already waits for the database?",
         "Kubernetes doesn't order startup between pods, and a database can restart while the API is running. "
         "Retries and probes handle both.")
    b.QA("What would change for production?",
         "A managed database or a properly sized StatefulSet with backups, a dedicated SQL login instead of sa, "
         "secrets from a secret manager, EF Core migrations, and images from a registry with pinned tags.")


def part4(b):
    b.PART("Part 4", "Tests",
           "xUnit v3. Nine fast tests for the title rule, and twelve that run the real API end to end, through HTTP, "
           "EF Core and a real SQL Server database created for each test and dropped after.")
    b.H1("4.1 The test project")
    b.whole(T + "TaskApi.Tests.csproj", "xml")
    b.notes(T + "TaskApi.Tests.csproj", [
        ("<OutputType>Exe</OutputType>", "xUnit v3 test projects are programs: each one can run on its own."),
        ("Include=\"Microsoft.AspNetCore.Mvc.Testing\"", "Provides " + M("WebApplicationFactory") + "."),
        ("<ProjectReference Include=\"..\\..\\api\\TaskApi.csproj\" />", "The tests reference the real app."),
        ("<Using Include=\"Xunit\" />", "A global " + M("using Xunit;") + " for every file."),
    ])
    b.whole("global.json", "json")
    b.notes("global.json", [
        ("\"rollForward\": \"latestFeature\"", "Any .NET 10 SDK from 10.0.100 up."),
        ("\"runner\": \"Microsoft.Testing.Platform\"", "Current xUnit v3 runs on Microsoft.Testing.Platform. On the "
         ".NET 10 SDK, " + M("dotnet test") + " must be told so, and then takes " + M("--solution") + " or "
         + M("--project") + ". Without it, the first CI run failed with \"Testing with VSTest target is no longer supported\"."),
    ])
    b.H1("4.2 Unit tests: the title rule")
    b.code(T + "TaskRulesTests.cs", "public class TaskRulesTests", "cs")
    b.P("A " + M("[Theory]") + " runs once per " + M("[InlineData]") + " row. The boundaries are tested exactly: "
        "200 characters passes, 201 doesn't. These run anywhere, with nothing installed.")
    b.H1("4.3 A real app with a throwaway database")
    b.code(T + "SqlServerApiFactory.cs", "public sealed class SqlServerApiFactory", "cs")
    b.notes(T + "SqlServerApiFactory.cs", [
        ("public static readonly string? SqlServer = Environment.GetEnvironmentVariable(\"TEST_SQLSERVER\");", "A "
         "connection string to a server, without a database. (Named " + M("SqlServer") + " because the base class "
         "already has a " + M("Server") + "; reusing the name was a compile warning, and CI fails on warnings.)"),
        ("private readonly string _database = $\"TaskDb_Test_{Guid.NewGuid():N}\";", "A new, uniquely named database "
         "for every factory, so tests can't see each other's data."),
        ("builder.UseSetting(\"ConnectionStrings:Default\", ConnectionString);", "Overrides the app's connection "
         "string. When the app starts, " + M("EnsureDatabaseAsync") + " creates this database."),
        ("SqlConnection.ClearAllPools();", "The app's pooled connections keep the database in use, and in-use "
         "databases can't be dropped..."),
        ("ALTER DATABASE [{_database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;", "...so also disconnect anything "
         "left, then drop it."),
    ])
    b.code(T + "TasksApiTests.cs", "public sealed class TasksApiTests : IAsyncLifetime", "cs", end="private static CancellationToken Ct")
    b.notes(T + "TasksApiTests.cs", [
        ("Assert.SkipWhen(SqlServerApiFactory.SqlServer is null,", "xUnit v3 can skip at run time. Without "
         + M("TEST_SQLSERVER") + " these tests are reported as skipped, with this message, not failed."),
        ("_factory = new SqlServerApiFactory();", "xUnit creates a new instance of the class for every test, so every "
         "test gets its own app and database."),
        ("private static CancellationToken Ct => TestContext.Current.CancellationToken;", "xUnit's analyzer "
         + M("xUnit1051") + " asks async calls to take the test's token, so a cancelled run stops promptly. With "
         + M("-warnaserror") + " in CI, leaving it out fails the build."),
    ])
    b.code(T + "TasksApiTests.cs", "public async Task Post_creates_a_trimmed_task_with_a_location_header()", "cs")
    b.code(T + "TasksApiTests.cs", "public async Task Patch_rejects_a_blank_title_and_leaves_the_task_alone()", "cs")
    b.P("Not only the 400, but that the stored task didn't change. " + M("Assert.Single") + " also checks there's "
        "exactly one task.")
    b.code(T + "TasksApiTests.cs", "public async Task A_non_numeric_id_does_not_match_the_route()", "cs")
    b.H1("4.4 Running them")
    b.T([["Command", "Runs"],
         [M("dotnet test --solution TaskApi.slnx"), "All 21; the 12 HTTP tests skip without a server"],
         [M("docker compose up -d db") + " (with " + M("ports: [\"1433:1433\"]") + " added under db)", "A SQL Server to test against"],
         [M("$env:TEST_SQLSERVER = \"Server=localhost,1433;User Id=sa;Password=...;TrustServerCertificate=True\""),
          "PowerShell; then " + M("dotnet test") + " runs all 21"],
         [M("npm test") + " in frontend/", "The 6 client tests"]], [4.0, 2.75])
    b.H1("4.5 Interview questions")
    b.QA("What does WebApplicationFactory give you?",
         "The real app, started in memory with its real configuration and DI, plus an HttpClient wired to it with no "
         "network. You can override settings and services per test.")
    b.QA("Why a real SQL Server instead of EF Core's in-memory provider?",
         "The in-memory provider isn't a relational database: no SQL, no constraints, different behaviour for "
         "strings and transactions. Tests against it can pass while the real query fails.")
    b.QA("Why skip rather than fail without a database?",
         "So " + M("dotnet test") + " works on any machine. CI runs them both ways, so a test that wrongly fails "
         "without a database, and one that silently skips with it, are both caught.")


def part5(b):
    b.PART("Part 5", "Keeping it working",
           "Lock files for NuGet and npm, versions that mean something, and CI that tests against a real SQL Server "
           "on every push. Plus one real vulnerability the checks found.")
    b.H1("5.1 NuGet lock files")
    b.P(M("packages.lock.json") + " sits beside each project and records every package, direct and transitive, "
        "with its exact version and content hash. " + M("dotnet restore --locked-mode") + " installs exactly that "
        "and fails if the project asks for something else: NuGet's " + M("npm ci") + ".")
    b.P("It has one gap: a project with no lock file at all restores without complaint. So CI checks first that "
        "every project has one:")
    b.code(WF, "- name: Every project has a committed lock file", "yaml", end="exit $missing")
    b.H1("5.2 A vulnerable package nobody chose")
    b.P("Version 1.0.0 referenced EF Core 10.0.0. Restoring it warned " + M("NU1903") + ": "
        + M("System.Security.Cryptography.Pkcs") + " had a known high-severity vulnerability. The project never "
        "mentions Pkcs; it arrives through EF Core's SQL Server provider and " + M("Microsoft.Data.SqlClient") +
        ": a <b>transitive dependency</b>.")
    b.P("The fix was EF Core 10.0.15, a <b>patch</b> release whose dependencies include a fixed Pkcs. Under "
        "Semantic Versioning a patch changes nothing you rely on, so the app needed no other change, and the "
        "changelog records it under 1.1.0. To keep it from happening quietly again:")
    b.code(WF, "- name: Vulnerable packages", "yaml", end="! grep -q -E")
    b.P("If no patched version of the direct dependency exists, the other fix is to reference the patched transitive "
        "package directly. NuGet picks the lowest version that satisfies every request, so the direct reference wins. "
        "That's what the Genetec Access Event Log does.")
    b.H1("5.3 Semantic Versioning")
    b.P(M("CHANGELOG.md") + " defines the contract: the REST API (routes, request and response fields) and how the "
        "app is run (images, environment variables). Breaking either is a major version. 1.1.0 added tests, "
        + M("TaskRules") + " and " + M("public partial class Program") + ", and patched EF Core, with no change in "
        "behaviour: a minor version.")
    b.H1("5.4 The workflow")
    b.code(WF, "  api:", "yaml", end="! grep -q -E", doc=False)
    b.notes(WF, [
        ("image: mcr.microsoft.com/mssql/server:2022-latest", "A real SQL Server as a <b>service container</b>, "
         "reachable on " + M("localhost:1433") + " once its health check passes."),
        ("global-json-file: Full Stack/dotnet-sqlserver/global.json", "CI installs the SDK " + M("global.json") + " asks for."),
        ("- run: dotnet build TaskApi.slnx --no-restore -c Release -warnaserror", "Warnings fail the build."),
        ("- name: Tests without a database (HTTP tests skip)", "Run once without " + M("TEST_SQLSERVER") + ": the HTTP "
         "tests must skip, as on a laptop..."),
        ("- name: Tests against SQL Server", "...and once with it: all 21 must pass."),
    ])
    b.code(WF, "  frontend:", "yaml", end="- run: docker compose build", doc=False)
    b.P("The front end's tests, build and " + M("npm audit") + ", and a " + M("docker compose build") + " to catch a "
        "broken Dockerfile. All on every push to any branch and every pull request.")
    b.H1("5.5 Dependabot")
    b.code(DB, "  - package-ecosystem: nuget", "yaml", end="update-types: [\"version-update:semver-major\"]", doc=False)
    b.P("Weekly NuGet updates for this project, minor and patch bundled into one pull request. Major versions of "
        "Microsoft's packages are skipped: EF Core and ASP.NET Core 11 need .NET 11, so they arrive with a deliberate "
        "move of the whole project, not as a package bump. The front end's npm packages and the Dockerfiles' base "
        "images (" + M("dotnet/sdk:10.0") + ", " + M("dotnet/aspnet:10.0") + ", " + M("nginx") + ") have entries of "
        "their own. Every pull request runs the workflow, against SQL Server.")
    b.H2("A green build that wouldn't start")
    b.P("Dependabot's first run offered " + M("dotnet/sdk:11.0") + " and " + M("dotnet/aspnet:11.0") + " for the "
        "Dockerfile. CI built the image, passed, and they were merged. But the project still targets "
        + M("net10.0") + ", and the .NET runtime only rolls forward to newer <i>minor</i> versions by default: a .NET 10 "
        "app on the .NET 11 runtime image stops at once with \"You must install or update .NET to run this "
        "application\". The image built fine; it just couldn't run.")
    b.P("Nothing in CI started the container, so nothing noticed. The images went back to 10.0, and Dependabot now "
        "skips majors of the " + M("dotnet/*") + " images. A smoke test would have caught it: start the container in CI "
        "and request " + M("/api/health/live") + " (exercise below).")
    b.H1("5.6 Interview questions")
    b.QA("What does packages.lock.json add when the .csproj has exact versions?",
         "The transitive graph and content hashes. The project pins only what it references directly.")
    b.QA("How do you find where a transitive package comes from?",
         M("dotnet list package --include-transitive") + ", or " + M("dotnet nuget why <project> <package>") +
         " on recent SDKs, which prints the dependency path.")
    b.QA("CI built the Docker image and passed, but the container won't start. How?",
         "Building only proves it compiles and packages. Here the runtime image was a newer .NET major than the app "
         "targets, which the runtime won't run by default. Start the container in CI and hit a health endpoint, and "
         "keep the SDK, runtime image and TargetFramework on the same major.")
    b.QA("Why run the tests twice in CI?",
         "Once to prove they skip cleanly without a database, once to prove they pass with one.")
    b.H1("5.7 Exercise")
    b.EX("Smoke-test the image", "Add a CI step that runs the API's image and checks it answers.",
         M("docker compose up -d --wait") + " with the database, then " + M("curl -f localhost:8081/api/health/live") +
         ". Try it against " + M("dotnet/aspnet:11.0") + " to watch it catch the problem in 5.5.")


book = Book(ROOT, accent="#5b3d99", highlight="#e8a33d")
book.cover("Task Tracker, Line by Line",
           "React, ASP.NET Core and SQL Server in Docker and Kubernetes",
           "The dotnet-sqlserver task tracker explained file by file: the minimal API and EF Core, the React page, the "
           "containers and manifests, end-to-end tests against SQL Server, and the CI that runs them on every push.",
           [["0. The big picture", "The pieces, the API, the layout"],
            ["1. The API", "Entity and rules, EF Core, minimal API endpoints, startup"],
            ["2. The front end", "React, a typed API client, nginx, client tests"],
            ["3. Containers and Kubernetes", "Dockerfiles, Compose, SQL Server in a StatefulSet, probes"],
            ["4. Tests", "xUnit v3, WebApplicationFactory, a database per test"],
            ["5. Keeping it working", "NuGet lock files, a vulnerable transitive package, CI with SQL Server"]])
ONLY = set(sys.argv[1:])
for i, part in enumerate([part0, part1, lambda bk: frontend.write(bk, 2, "React · ASP.NET Core · SQL Server", 8081),
                          part3, part4, part5]):
    if not ONLY or str(i) in ONLY:
        part(book)
book.build(os.path.join(HERE, "task-tracker-dotnet-book.pdf"), "Task Tracker, Line by Line — ASP.NET Core and SQL Server",
           "Task Tracker, Line by Line · .NET")
