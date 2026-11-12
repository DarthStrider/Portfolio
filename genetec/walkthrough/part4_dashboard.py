"""Part 4: Web Dashboard (ASP.NET Core minimal API + React)."""
from bookkit import M

S4 = "snack4-web-dashboard/"
API = S4 + "api/Dashboard.Api/"
TESTS = S4 + "tests/Dashboard.Api.Tests/"
WEB = S4 + "web/"


def write(b):
    b.PART("Part 4", "Web Dashboard",
           "Snack 2's events on a web page: an ASP.NET Core minimal API that reuses Snack 2's repository unchanged, "
           "and a React page with a status filter. Small on purpose; the interesting parts are reuse, validation at "
           "the edge, and tests that control the world the API sees.")

    b.H1("4.1 What it does")
    b.P("The API serves the events, filtered by outcome and search text, and both of Snack 2's reports, as JSON. The "
        "page shows them, refreshes every three seconds, and filters with a row of buttons (all, granted, denied, "
        "status changes) and a search box. Pointed at Snack 2's database, it shows exactly what the WPF app shows; "
        "on its own, it seeds an in-memory store with a demo day and keeps adding events.")

    b.H1("4.2 Minimal APIs and dependency injection")
    b.P("A <b>minimal API</b> maps a route straight to a function: " + M("api.MapGet(\"/events\", handler)") + ". "
        "ASP.NET Core inspects the handler's parameters and fills them: from the query string for simple types "
        "(" + M("string? outcome") + ", " + M("int? limit") + "), and from the <b>dependency injection</b> container for "
        "registered services (" + M("IAccessEventRepository repo") + "). No controllers, no attributes.")
    b.P("The container is set up before " + M("builder.Build()") + ": " + M("AddSingleton<IClock, SystemClock>()") +
        " says \"when something asks for " + M("IClock") + ", give it the one " + M("SystemClock") + "\". Tests use the "
        "same mechanism to swap in a fixed clock and a store they filled themselves.")

    b.H1("4.3 Reuse: one project reference")
    b.whole(API + "Dashboard.Api.csproj", "xml")
    b.P("The whole of Snack 2's data layer comes in through one project reference. " + M("AccessLog.Core") + " targets "
        + M("net48") + " and " + M("net10.0") + "; this project is " + M("net10.0") + ", so it gets that build. The SQL, "
        "the reports and the in-memory store are the same code the WPF app runs.")

    b.H1("4.4 Program.cs")
    b.code(API + "Program.cs", "var connection = builder.Configuration.GetConnectionString(\"AccessLog\");", "cs",
           end="builder.Services.AddSingleton<StoreInfo>(new StoreInfo(\"SQL Server\"));")
    b.notes(API + "Program.cs", [
        ("var connection = builder.Configuration.GetConnectionString(\"AccessLog\");", "Reads "
         + M("ConnectionStrings:AccessLog") + " from appsettings.json, or the environment variable "
         + M("ConnectionStrings__AccessLog") + " (the double underscore stands for the colon), which wins."),
        ("builder.Services.AddSingleton<IAccessEventRepository>(_ => new SqlServerAccessEventRepository(connection));",
         "A factory registration, because the constructor needs a string the container can't provide."),
    ])
    b.code(API + "Program.cs", "builder.Services.AddHostedService<DemoActivity>();", "cs", end="app.UseStaticFiles();")
    b.notes(API + "Program.cs", [
        ("JsonStringEnumConverter", "Enums go out as text: " + M("\"BadgeSwipe\"") + " rather than " + M("0") + ". The "
         "JSON reads well, and the TypeScript types can be string unions."),
        ("await SqlServerAccessEventRepository.EnsureDatabaseAsync(connection);", "Same schema script as the WPF app, "
         "so either can create the database first."),
        ("app.UseDefaultFiles();", "Serves " + M("index.html") + " for " + M("/") + "; with " + M("UseStaticFiles") +
         ", the built React app in " + M("wwwroot") + " is served from the same origin as the API."),
    ])
    b.code(API + "Program.cs", "api.MapGet(\"/events\"", "cs", end="});")
    b.notes(API + "Program.cs", [
        ("if (!Filters.TryParseOutcome(outcome, out var filter))", "<b>Validation at the edge</b>: bad input is "
         "rejected here, with a message, before it reaches the repository."),
        ("if (limit is < 1 or > 500)", "A relational pattern on " + M("int?") + ": null (not given) matches neither "
         "branch, so the default applies; 0 or 501 is refused. Capping the limit stops one request asking for a million rows."),
        ("return Results.Ok(await repo.SearchAsync(query));", "Snack 2's " + M("AccessEventView") + " objects, "
         "serialized as camelCase JSON, including the computed " + M("Outcome") + "."),
    ])
    b.code(API + "Program.cs", "api.MapGet(\"/reports/denied-by-door\"", "cs", end="top ?? 5)));")
    b.P("The same shape for both reports. Errors always use one shape, " + M("{ \"error\": \"...\" }") + ", so the "
        "page can show the message as it is.")
    b.code(API + "Program.cs", "public sealed record StoreInfo", "cs", end="public partial class Program { }")
    b.P("Top-level statements compile into a class called " + M("Program") + " that's internal; declaring it "
        + M("public partial") + " lets the test project name it in " + M("WebApplicationFactory<Program>") + ".")

    b.H1("4.5 Filters and the demo")
    b.code(API + "Filters.cs", "public static bool TryParseOutcome", "cs")
    b.P(M("Enum.TryParse") + " also accepts numbers: \"7\" parses into a value with no name. "
        + M("Enum.IsDefined") + " rejects it, so only the four names are valid. A test checks exactly this case.")
    b.code(API + "DemoActivity.cs", "protected override async Task ExecuteAsync", "cs")
    b.notes(API + "DemoActivity.cs", [
        ("if (!config.GetValue(\"Demo:Seed\", true)) return;", "Switchable from configuration; the tests turn it off "
         "so they control every row."),
        ("using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));", M("PeriodicTimer") + " is the async timer: "
         "each tick is awaited, so a slow step can't overlap the next, and the " + M("stoppingToken") + " ends the loop "
         "cleanly when the app shuts down."),
    ])
    b.P("A " + M("BackgroundService") + " runs alongside the web server for the app's lifetime. Here it reuses "
        "Snack 2's simulator, so the web demo and the WPF demo produce the same kind of events.")

    b.H1("4.6 The page")
    b.whole(WEB + "src/types.ts", "ts")
    b.P("TypeScript types mirroring the JSON. Because enums arrive as text, " + M("kind") + " is a union of two "
        "strings: a typo in a comparison is a compile error.")
    b.code(WEB + "src/filters.ts", "export function eventsQuery", "ts")
    b.P(M("URLSearchParams") + " builds the query string and encodes it (spaces become " + M("+") + ", " + M("&") +
        " becomes " + M("%26") + "), so a search for \"a&b\" can't add a parameter. Defaults are left out to keep "
        "URLs short.")
    b.code(WEB + "src/filters.ts", "export function relativeTime", "ts")
    b.P("The API sends UTC; this treats a time without a zone as UTC too, so the page and the database agree no "
        "matter where the browser is.")
    b.code(WEB + "src/App.tsx", "const load = useCallback(async () => {", "tsx", end="}, [load]);")
    b.notes(WEB + "src/App.tsx", [
        ("await Promise.all([api.events(outcome, search), api.deniedByDoor(), api.noisiest()]);", "Three requests in "
         "parallel; the page updates once all three are back."),
        ("}, [outcome, search]);", M("useCallback") + " makes a new " + M("load") + " only when the filters change..."),
        ("const timer = setInterval(load, REFRESH_MS);", "...and this effect depends on " + M("load") + ", so changing "
         "a filter reloads at once and restarts the timer. The cleanup function clears the old timer, so there's never more than one."),
    ])
    b.code(WEB + "src/App.tsx", "<div className=\"segmented\" role=\"radiogroup\"", "tsx", end="</div>", doc=False)
    b.P("A row of buttons acting as one choice. " + M("role=\"radiogroup\"") + " and " + M("aria-checked") + " tell "
        "screen readers it's a single-choice control, which a plain row of buttons wouldn't.")
    b.whole(WEB + "vite.config.ts", "ts")
    b.P("In development, Vite's proxy forwards " + M("/api") + " to the API, so the page and the API look like one "
        "origin and there's no CORS to set up. " + M("npm run build") + " writes the page into the API's "
        + M("wwwroot") + ", so in production they really are one origin.")

    b.H1("4.7 Tests that control the world")
    b.code(TESTS + "DashboardApiTests.cs", "_factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>", "cs", end="_client = _factory.CreateClient();")
    b.notes(TESTS + "DashboardApiTests.cs", [
        ("b.UseSetting(\"Demo:Seed\", \"false\");", "No random demo data: the test's four events are the only ones."),
        ("services.AddSingleton<IAccessEventRepository>(_repo);", "Registered after the app's own registrations, so "
         "it wins: the API reads the store the test filled."),
        ("services.AddSingleton<IClock>(new FixedClock());", "\"The last 24 hours\" is measured from a fixed instant, "
         "so a 30-hour-old event is always outside it."),
    ])
    b.code(TESTS + "DashboardApiTests.cs", "public async Task Events_are_newest_first_in_camel_case_with_enums_as_text()", "cs")
    b.P("This tests the JSON <i>contract</i>, not just the data: property names in camelCase, enums as text, null as "
        "null. Those are what the TypeScript types rely on, so a serializer setting changed by accident would fail here "
        "rather than in the browser.")
    b.code(TESTS + "DashboardApiTests.cs", "[InlineData(\"/api/events?outcome=maybe\")]", "cs", end="TryGetProperty(\"error\", out _));")
    b.code(WEB + "tests/filters.test.ts", "test(\"eventsQuery encodes characters", "ts", end="});")
    b.P("The page's logic is tested in Node with " + M("node:test") + ", the same way as the robot arm, with no "
        "browser. " + M("tests/api.test.ts") + " replaces " + M("fetch") + " to check the URLs the client calls and "
        "that an error response throws the API's own message.")

    b.H1("4.8 Interview questions")
    b.QA("How does a minimal API handler get its arguments?",
         "By parameter: simple types bind from the route and query string, complex types from the JSON body, and "
         "registered services from dependency injection. Optional query values are nullable parameters.")
    b.QA("How do you test an ASP.NET Core API end to end without a server?",
         "WebApplicationFactory runs the real app in memory with an in-memory HTTP client. You can override settings and "
         "services (here: no demo data, a filled store, a fixed clock) and assert on real HTTP responses.")
    b.QA("Why send enums as strings?",
         "Readable JSON, stable when enum members are reordered, and TypeScript can model them as string unions. Numbers "
         "silently change meaning if someone inserts a member in the middle of the enum.")
    b.QA("Why serve the React build from the API?",
         "One origin: no CORS configuration, one deployment, relative URLs work everywhere. In development the Vite "
         "proxy gives the same effect.")
    b.QA("What would make this production-ready?",
         "Authentication (operators only), paging instead of a fixed limit, server-sent events or SignalR instead of "
         "polling every three seconds, and output caching for the reports.")

    b.H1("4.9 Exercises")
    b.EX("Live updates", "Replace polling with server-sent events.",
         "An endpoint returning " + M("text/event-stream") + "; the simulator or the repository raises an event when "
         "something is recorded. " + M("EventSource") + " in the page.")
    b.EX("Date range", "Add from/to pickers to the page.", "The API passes them to " + M("EventQuery.FromUtc/ToUtc") +
         "; convert the browser's local dates to UTC before sending, and validate from &lt; to at the edge.")
    b.EX("A device page", "Click a device to see its history and both reports for it alone.",
         "Add " + M("/api/devices/{id}/events") + "; " + M("EventQuery.DeviceId") + " already exists, and the "
         "device index makes it fast.")
