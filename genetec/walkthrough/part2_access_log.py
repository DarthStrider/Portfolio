"""Part 2: Access Event Log (SQL Server, Dapper, .NET Framework 4.8 WPF)."""
from bookkit import M
from reportlab.graphics.shapes import Drawing

S2 = "snack2-access-event-log/"
CORE = S2 + "src/AccessLog.Core/"
APP = S2 + "src/AccessLog.App/"
TESTS = S2 + "tests/AccessLog.Tests/"


def schema_diagram(b):
    d = Drawing(486, 150)
    b.box(d, 0, 40, 140, 90, "Devices", ["Id (PK)", "Name, Kind, Location", "Kind: 0 door, 1 camera"])
    b.box(d, 173, 20, 140, 120, "AccessEvents", ["Id (PK, bigint)", "OccurredAtUtc", "DeviceId (FK)", "CardholderId (FK, null)",
                                                "Kind, Granted, Detail", "CHECK: swipe vs status"])
    b.box(d, 346, 40, 140, 90, "Cardholders", ["Id (PK)", "Name", "BadgeNumber (UNIQUE)"])
    b.arrow(d, 173, 85, 140, 85, label="many to one")
    b.arrow(d, 313, 85, 346, 85, label="many to one")
    return d


def write(b):
    b.PART("Part 2", "Access Event Log",
           "Snack 1's events, saved and searchable: a SQL Server schema with constraints and indexes, two reports "
           "written as real SQL, a repository with a Dapper implementation and an in-memory one held to the same "
           "contract, and a WPF app on .NET Framework 4.8.")

    b.H1("2.1 What it does")
    b.P("Every badge swipe and every camera status change is recorded. The Events tab lists them newest first, "
        "with a search box (door, camera, location or cardholder) and an outcome filter (granted, denied, status "
        "changes). The Reports tab answers two questions an operator actually asks: <i>which doors denied access "
        "in the last 24 hours, and how often</i>, and <i>which five devices are the noisiest</i>. A simulator records "
        "a new event every 1.5 seconds, so both tabs move while you watch.")
    b.P("The app stores events in SQL Server when it can reach one, and falls back to an in-memory store when it "
        "can't, saying which in the status bar.")

    b.H1("2.2 The schema")
    b.figure(schema_diagram(b), "Figure 2.1. Three tables. An event always has a device; only badge swipes have a cardholder.")
    b.P("<b>Constraints</b> make bad data impossible rather than unlikely. Foreign keys stop an event pointing at a "
        "device that doesn't exist; a unique constraint stops two people having the same badge; a " + M("CHECK") +
        " constraint states that a badge swipe has a cardholder and a decision while a status change has neither. "
        "The application checks too, but the database is the last line of defence, and it protects against every "
        "client, not just this one.")
    b.P("<b>Indexes</b> are the other half. Without one, \"denied in the last 24 hours\" reads every row ever "
        "recorded. An index is a sorted copy of some columns that lets SQL Server jump to the start of the time range "
        "and read only what's in it (a <i>seek</i> instead of a <i>scan</i>). If the index also <i>includes</i> the "
        "other columns the query needs, SQL Server never visits the table at all: a <b>covering index</b>.")

    b.H1("2.3 Repository, Dapper and contract tests")
    b.P("A <b>repository</b> is an interface describing storage in the application's terms (record an event, search, "
        "run a report) rather than the database's. Code above it doesn't know where data lives, so the same "
        "ViewModel runs on SQL Server or in memory, and tests use the in-memory one.")
    b.P("<b>Dapper</b> is a micro-ORM: you write the SQL, it opens nothing for you, and it maps result columns onto "
        "object properties by name. That suits this snack, whose point is the SQL. Entity Framework would generate "
        "the SQL instead (and EF Core doesn't run on .NET Framework).")
    b.P("Two implementations of one interface can drift: the in-memory one might sort differently or forget a rule. "
        "<b>Contract tests</b> prevent that. The tests are written once, against the interface, in an abstract base "
        "class; one subclass runs them on the in-memory store, another on a real SQL Server. If they disagree, a test fails.")

    b.H1("2.4 One library, two frameworks")
    b.whole(CORE + "AccessLog.Core.csproj", "xml")
    b.notes(CORE + "AccessLog.Core.csproj", [
        ("<TargetFrameworks>net48;net10.0</TargetFrameworks>", "Plural " + M("TargetFrameworks") + ": the project "
         "compiles twice. " + M("net48") + " for the WPF app the README asks for; " + M("net10.0") + " for the tests "
         "and for Snack 4's web API. The code may only use what both frameworks have, so there's no "
         + M("string.Contains(string, StringComparison)") + " or " + M("Lock") + " in this project."),
        ("System.Security.Cryptography.Pkcs", "A <b>transitive dependency override</b>. SqlClient depends on Pkcs; the "
         "versions it asked for had known vulnerabilities, so CI's restore warned. Referencing a patched version "
         "directly makes NuGet pick it. Part 5 tells the story."),
        ("Microsoft.NETFramework.ReferenceAssemblies", "The .NET Framework's reference assemblies as a package, so "
         + M("net48") + " compiles on machines (and CI runners) without the targeting pack installed. "
         + M("PrivateAssets=\"all\"") + " keeps it out of anything that references this project."),
        ("<EmbeddedResource Include=\"Data\\schema.sql\" />", "The schema ships inside the DLL, so the app can create "
         "its database wherever it runs, with no file to deploy alongside."),
    ])

    b.H1("2.5 The model")
    b.code(CORE + "Model/Model.cs", "public enum EventKind", "cs")
    b.code(CORE + "Model/Model.cs", "public sealed class AccessEvent", "cs")
    b.P("Plain classes with settable properties, not records: Dapper fills them by setting properties, and records "
        "with " + M("init") + " setters need a compiler helper type that .NET Framework doesn't have. " + M("Granted") +
        " is " + M("bool?") + " because a status change has no decision: null means \"not applicable\", which a plain "
        + M("bool") + " can't say.")
    b.code(CORE + "Model/Model.cs", "public sealed class AccessEventView", "cs")
    b.notes(CORE + "Model/Model.cs", [
        ("public string Outcome => Granted switch", "A switch on " + M("bool?") + " covers all three cases, so the "
         "list and the web page show the same words without either deciding."),
    ])
    b.code(CORE + "Model/Model.cs", "public sealed class EventQuery", "cs")
    b.P("One object carries every filter, all optional. Adding a filter later is a new property, not a new method "
        "on the interface, so neither implementation's callers break.")

    b.H1("2.6 The repository interface")
    b.code(CORE + "Data/IAccessEventRepository.cs", "public interface IAccessEventRepository", "cs")
    b.P("Everything is " + M("async") + ": database calls wait on the network, and an async method lets the UI "
        "thread keep drawing meanwhile. The comments are the contract: \"newest first\", \"doors with none are left "
        "out\", \"most first\". The contract tests check exactly these sentences.")
    b.code(CORE + "Data/IAccessEventRepository.cs", "public sealed class UnknownReferenceException", "cs", end="UnknownReferenceException(string message)")
    b.P("Both implementations translate their own failure (a SQL foreign-key error, a missing list entry) into this "
        "one exception, so callers handle one thing.")

    b.H1("2.7 schema.sql")
    b.code(S2 + "src/AccessLog.Core/Data/schema.sql", "IF OBJECT_ID(N'dbo.Devices'", "sql", end=");")
    b.notes(CORE + "Data/schema.sql", [
        ("IF OBJECT_ID(N'dbo.Devices', N'U') IS NULL", "<b>Idempotent</b>: safe to run on every start. "
         + M("OBJECT_ID") + " returns null if no user table (" + M("'U'") + ") has that name."),
        ("CONSTRAINT CK_Devices_Kind CHECK (Kind IN (0, 1))", "The enum's values, enforced. Naming constraints "
         "(" + M("CK_...") + ") makes error messages and later changes readable."),
    ])
    b.code(CORE + "Data/schema.sql", "IF OBJECT_ID(N'dbo.AccessEvents'", "sql", end="(Kind = 1 AND CardholderId IS NULL AND Granted IS NULL))")
    b.notes(CORE + "Data/schema.sql", [
        ("Id            BIGINT IDENTITY", M("BIGINT") + ": events accumulate forever; an " + M("INT") + " runs out "
         "at about two billion."),
        ("OccurredAtUtc DATETIME2(3)", "Millisecond precision, no time zone: the column name says it's UTC."),
        ("CONSTRAINT CK_AccessEvents_Shape CHECK (", "The rule from Figure 2.1 as SQL. A badge swipe (Kind 0) must have "
         "a cardholder and a decision; a status change (Kind 1) must have neither."),
    ])
    b.code(CORE + "Data/schema.sql", "-- Both reports filter on a time window", "sql", end="IX_AccessEvents_Device_OccurredAt ON", doc=False)
    b.notes(CORE + "Data/schema.sql", [
        ("CREATE INDEX IX_AccessEvents_OccurredAt", "Keyed on time, so a time range is a seek. The " + M("INCLUDE") +
         " columns ride along in the index's leaf pages without being part of its order: enough to answer both "
         "reports from the index alone."),
        ("CREATE INDEX IX_AccessEvents_Device_OccurredAt", "For the event list filtered to one device, newest first: "
         "the index is already in the order the query wants."),
    ])

    b.H1("2.8 SQL Server with Dapper")
    b.code(CORE + "Data/SqlServerAccessEventRepository.cs", "public static async Task EnsureDatabaseAsync", "cs")
    b.notes(CORE + "Data/SqlServerAccessEventRepository.cs", [
        ("builder.InitialCatalog = \"master\";", "You can't create a database while connected to it, so this "
         "connects to " + M("master") + " first."),
        ("DECLARE @create NVARCHAR(300)", M("EXEC()") + " accepts only strings and variables, not a function call, so "
         "the statement is built first. (The first version passed " + M("QUOTENAME(...)") + " straight to "
         + M("EXEC") + "; CI's SQL Server job failed every database test until it was fixed.)"),
        ("QUOTENAME(@database)", "Brackets the name and escapes any " + M("]") + " in it, so a database name can't "
         "smuggle SQL in. The name itself arrives as a parameter, never pasted into the string."),
    ])
    b.code(CORE + "Data/SqlServerAccessEventRepository.cs", "public async Task<long> RecordAsync", "cs")
    b.notes(CORE + "Data/SqlServerAccessEventRepository.cs", [
        ("OUTPUT INSERTED.Id", "Returns the new identity value from the same statement: no second round trip, and no "
         + M("SCOPE_IDENTITY()") + " pitfalls."),
        ("Kind = (byte)accessEvent.Kind,", "The column is " + M("TINYINT") + "; passing a " + M("byte") + " makes "
         "the parameter's type match it exactly."),
        ("catch (SqlException e) when (e.Number == ConstraintViolation && e.Message.Contains(\"FOREIGN KEY\"))",
         "An exception <b>filter</b>: only this error is caught and translated; anything else propagates untouched, "
         "stack trace intact. SQL Server uses the same number, 547, for every constraint conflict, so the filter also "
         "checks which kind. The first version translated every 547 into \"unknown device\", and the contract test "
         "for the CHECK rule caught it on CI's SQL Server."),
        ("catch (SqlException e) when (e.Number == ConstraintViolation && e.Message.Contains(\"CK_AccessEvents_Shape\"))",
         "The CHECK constraint becomes the same exception, with the same message, as the in-memory store's rule."),
    ])
    b.code(CORE + "Data/SqlServerAccessEventRepository.cs", "public async Task<IReadOnlyList<AccessEventView>> SearchAsync", "cs")
    b.notes(CORE + "Data/SqlServerAccessEventRepository.cs", [
        ("WHERE (@FromUtc IS NULL      OR e.OccurredAtUtc >= @FromUtc)", "The \"optional filter\" pattern: when a "
         "parameter is null the condition is always true. One statement serves every combination of filters."),
        ("OPTION (RECOMPILE)", "Without it, SQL Server caches one plan for this statement, made for whichever filters "
         "the first call used, and reuses it for very different ones. Recompiling costs a little CPU per call and gets a "
         "plan for the actual values."),
        ("Text = string.IsNullOrWhiteSpace(query.Text) ? null : \"%\" + EscapeLike", "The pattern is built in C# and "
         "sent as a parameter, still never pasted into the SQL."),
        ("return rows.Select(AsUtc).ToList();", M("DATETIME2") + " has no time zone, so values come back as "
         + M("DateTimeKind.Unspecified") + "; they're marked UTC before anyone can mistake them for local times."),
    ])
    b.code(CORE + "Data/SqlServerAccessEventRepository.cs", "public async Task<IReadOnlyList<DeniedByDoorRow>> DeniedByDoorAsync", "cs")
    b.P("The first report, as SQL you could paste into SQL Server Management Studio. " + M("WHERE") + " narrows to "
        "denied badge swipes in the window (a range seek on the time index); " + M("GROUP BY") + " makes one row per "
        "door; " + M("COUNT(*)") + " counts each group. Every non-aggregated column in the " + M("SELECT") + " is in the "
        + M("GROUP BY") + ", which SQL requires. The ordering tie-break on name makes the result deterministic.")
    b.code(CORE + "Data/SqlServerAccessEventRepository.cs", "public async Task<IReadOnlyList<NoisyDeviceRow>> NoisiestDevicesAsync", "cs")
    b.P(M("TOP (@top)") + " with parentheses accepts a parameter. Every kind of event counts here, so a flapping "
        "camera shows up as noisy, which is the point of the report.")
    b.code(CORE + "Data/SqlServerAccessEventRepository.cs", "private static string EscapeLike", "cs", end="Replace(\"_\", \"[_]\");")
    b.P("In a " + M("LIKE") + " pattern, " + M("%") + " and " + M("_") + " are wildcards. Wrapping them in brackets "
        "makes them literal, so searching for \"_\" finds underscores instead of everything. A contract test checks it.")

    b.H1("2.9 The in-memory twin")
    b.code(CORE + "Data/InMemoryAccessEventRepository.cs", "public Task<long> RecordAsync", "cs")
    b.notes(CORE + "Data/InMemoryAccessEventRepository.cs", [
        ("throw new UnknownReferenceException", "The foreign keys, in code: same exception as SQL Server's translation."),
        ("CheckShape(accessEvent);", "The " + M("CHECK") + " constraint, in code."),
        ("OccurredAtUtc = Utc(accessEvent.OccurredAtUtc),", "Stored the way SQL Server would store it: UTC, to the "
         "millisecond (see " + M("Utc") + " at the bottom of the file)."),
    ])
    b.code(CORE + "Data/InMemoryAccessEventRepository.cs", "public Task<IReadOnlyList<AccessEventView>> SearchAsync", "cs")
    b.P("The same filters as the SQL, in LINQ, with the same ordering (time, then id, both descending). The text "
        "match uses " + M("IndexOf(..., OrdinalIgnoreCase)") + " because .NET Framework has no case-insensitive "
        + M("Contains") + "; SQL Server's default collation is case-insensitive too.")
    b.code(CORE + "Data/InMemoryAccessEventRepository.cs", "private IEnumerable<AccessEventView> Views()", "cs", end="};")
    b.P("A LINQ <b>left join</b>: " + M("join ... into cs") + " groups the matching cardholders, and "
        + M("DefaultIfEmpty()") + " yields a single null when there are none, so status changes survive the join. "
        "The " + M("(int?)c.Id") + " cast is needed because " + M("CardholderId") + " is nullable and the two sides of "
        + M("equals") + " must have the same type.")

    b.H1("2.10 The simulator")
    b.code(CORE + "Simulation/AccessSimulator.cs", "public interface IClock", "cs")
    b.P("The current time behind an interface, so tests can freeze it. Code that calls " + M("DateTime.UtcNow") +
        " directly can't be tested at \"exactly 24 hours ago\".")
    b.code(CORE + "Simulation/AccessSimulator.cs", "private AccessEvent Swipe(DateTime atUtc)", "cs")
    b.notes(CORE + "Simulation/AccessSimulator.cs", [
        ("Math.Min(random.Next(_doors.Count) , random.Next(_doors.Count))", "The smaller of two random picks favours "
         "the first doors, so the noisiest-device report has a clear winner instead of a tie."),
        ("!RevokedBadges.Contains(cardholder.BadgeNumber)", "Two badges are always refused, so the denied report "
         "always has something to show; a test checks they're never granted."),
    ])
    b.code(CORE + "Simulation/AccessSimulator.cs", "private AccessEvent StatusChange(DateTime atUtc)", "cs")
    b.P("Each camera remembers its last status, so the history reads like Snack 1's: \"Online → Alarm\", then "
        "\"Alarm → Offline\", never two \"from\" values that don't follow on. A test walks every camera's history to "
        "check it.")

    b.H1("2.11 The ViewModel")
    b.code(CORE + "Mvvm/Mvvm.cs", "public sealed class AsyncRelayCommand(", "cs")
    b.notes(CORE + "Mvvm/Mvvm.cs", [
        ("public bool CanExecute(object? parameter) => !_running;", "The button disables itself while its query runs, "
         "so a double-click can't send the same query twice."),
        ("public async void Execute(object? parameter) => await ExecuteAsync();", M("async void") + " is only acceptable "
         "for event-handler-like entry points such as " + M("ICommand.Execute") + ", which must return void. Tests "
         "call " + M("ExecuteAsync") + " and await it."),
    ])
    b.code(CORE + "ViewModels/EventLogViewModel.cs", "public EventQuery CurrentQuery()", "cs", end="Limit = 200,")
    b.P("The filters as a query object, separate from running it, so a test can check the translation without a "
        "database: \"Denied\" means badge swipes with " + M("Granted = false") + ".")
    b.code(CORE + "ViewModels/EventLogViewModel.cs", "public Task RefreshAsync()", "cs")
    b.code(CORE + "ViewModels/EventLogViewModel.cs", "private async Task RefreshLoopAsync()", "cs")
    b.notes(CORE + "ViewModels/EventLogViewModel.cs", [
        ("if (_refreshing is { IsCompleted: false })", "Typing \"server\" sets the search five times in a row. Rather "
         "than run five overlapping queries (whose answers could arrive out of order, leaving the list showing an "
         "older filter), a refresh that arrives mid-query just asks for one more pass."),
        ("} while (_refreshAgain);", "The loop runs again if anything asked while it was busy, so the last filter "
         "always wins and queries never overlap."),
        ("Status = \"Couldn't load events: \" + e.Message;", "A database outage becomes a message in the status bar, "
         "not a crashed app. A test with a broken repository checks it."),
    ])

    b.H1("2.12 The .NET Framework 4.8 app")
    b.whole(APP + "AccessLog.App.csproj", "xml")
    b.P("An SDK-style project targeting " + M("net48") + ": the modern project format, built by the .NET 10 SDK, "
        "producing an app for .NET Framework 4.8. No " + M("ImplicitUsings") + " here: on .NET Framework they include "
        + M("System.Net.Http") + ", which isn't referenced by default, and the build fails.")
    b.code(APP + "Services/ViewModelLocator.cs", "private static EventLogViewModel Create()", "cs")
    b.notes(APP + "Services/ViewModelLocator.cs", [
        ("Task.Run(() => ChooseStoreAsync()).GetAwaiter().GetResult();", "Waiting on async code from the UI thread "
         "deadlocks if the async code needs the UI thread to continue (it captures the UI's synchronization context). "
         + M("Task.Run") + " moves the work to a pool thread, which has no such context, so waiting is safe. It's "
         "acceptable once, at startup; never in an event handler."),
        ("var timer = new DispatcherTimer", "A " + M("DispatcherTimer") + " ticks on the UI thread, so its handler can "
         "update bound collections directly; no dispatcher hop needed, unlike Snack 1's thread-pool timer."),
    ])
    b.code(APP + "Services/ViewModelLocator.cs", "private static async Task<(IAccessEventRepository, string)> ChooseStoreAsync()", "cs")
    b.P("SQL Server if it answers (the connection string has " + M("Connect Timeout=3") + "), otherwise memory, and "
        "the status bar says which and why. A demo that starts on any machine is worth more than one that crashes "
        "without Docker.")
    b.code(APP + "MainWindow.xaml", "<!-- Reports -->", "xaml", end="</TabItem>", doc=False)
    b.P("Two " + M("DataGrid") + "s side by side, each bound to one report collection. "
        + M("AutoGenerateColumns=\"False\"") + " with explicit columns keeps the headers human and the order fixed.")

    b.H1("2.13 The contract tests")
    b.code(TESTS + "RepositoryContract.cs", "public abstract class RepositoryContract", "cs", end="public virtual ValueTask DisposeAsync()")
    b.notes(TESTS + "RepositoryContract.cs", [
        ("protected static readonly DateTime Now", "Whole seconds on a fixed date: SQL Server keeps milliseconds, so "
         "finer times wouldn't come back equal, and a fixed date makes failures reproducible."),
        ("protected abstract Task<IAccessEventRepository> CreateAsync();", "The only thing a subclass provides: a "
         "fresh, empty store. Every " + M("[Fact]") + " below runs once per subclass."),
    ])
    b.code(TESTS + "RepositoryContract.cs", "public async Task Denied_by_door_counts_only_denied_swipes_in_the_window_most_first()", "cs")
    b.P("Each line of setup is there to be excluded for a reason the comment gives: granted, too old, not a swipe. "
        "If the SQL's " + M("WHERE") + " or the LINQ's " + M("Where") + " forgets one condition, this test fails for that store.")
    b.code(TESTS + "SqlServerRepositoryTests.cs", "public override ValueTask InitializeAsync()", "cs")
    b.code(TESTS + "SqlServerRepositoryTests.cs", "public async Task The_reports_are_answered_from_the_time_index()", "cs")
    b.P("A test of a performance decision. " + M("SET SHOWPLAN_XML ON") + " makes SQL Server return its execution "
        "plan instead of running the query; the test checks the plan names the index. If someone drops the index "
        "or rewrites the report so it can't use it, this fails. The 20,000 rows matter: the first version of this test "
        "ran on a table of a dozen rows, where reading the whole table <i>is</i> the cheapest plan, and SQL Server "
        "rightly ignored the index. Testing an optimizer decision needs data shaped like production.")
    b.T([["Class", "Runs", "What it adds"],
         ["InMemoryRepositoryTests", "20 contract tests", "the contract on the in-memory store"],
         ["SqlServerRepositoryTests", "20 contract tests + 2", "the schema re-runs cleanly; the plan uses the index"],
         ["EventLogViewModelTests", "9", "refresh, filters, clear, overlapping refreshes, a failing store"],
         ["AccessSimulatorTests", "6", "seeding once, valid events, revoked badges, status sequences, backfill"]], [1.9, 1.6, 3.25])

    b.H1("2.14 Interview questions")
    b.QA("Why put a CHECK constraint in the database when the code already validates?",
         "The database is shared by every client and every future version of this one. A constraint makes invalid rows "
         "impossible regardless of who writes them; validation in code only protects the code that runs it.")
    b.QA("What's a covering index, and why does the report need one?",
         "An index containing every column a query uses, either as keys or as INCLUDE columns, so the query is answered "
         "from the index without reading the table. The report filters on time and needs DeviceId, Kind and Granted; "
         "keying on time makes the window a seek, and including the rest makes it covering.")
    b.QA("What does OPTION (RECOMPILE) fix in the search query?",
         "Parameter sniffing: SQL Server caches one plan per statement, made for the first parameter values it saw. With "
         "\"optional filter\" predicates, a plan made for \"no filters\" is terrible for \"one device\", and vice versa. "
         "Recompiling makes a plan for the actual values each time.")
    b.QA("How do you stop SQL injection with a search box?",
         "Never build SQL from input: the text goes in as a parameter. The LIKE pattern is assembled in C# (with % and _ "
         "escaped) and passed as a parameter too. The database name in CREATE DATABASE is passed as a parameter and "
         "bracketed with QUOTENAME.")
    b.QA("Why store UTC?",
         "Local time is ambiguous (the hour repeated when clocks go back) and differs between sites. UTC is one timeline; "
         "convert to local only for display.")
    b.QA("Why Dapper and not Entity Framework here?",
         "The reports are the deliverable, so readable SQL matters, and EF Core doesn't support .NET Framework. Dapper "
         "does the tedious part (parameters, mapping) and nothing else.")
    b.QA("How do you know the in-memory repository behaves like SQL Server?",
         "The same contract tests run against both. Any difference in ordering, filtering or reporting fails a test for "
         "one of them.")

    b.H1("2.15 Exercises")
    b.EX("Paging", "Add \"load more\" to the event list without OFFSET scanning millions of rows.",
         "Keyset paging: pass the last row's (OccurredAtUtc, Id) and ask for rows before it; the existing ordering "
         "and indexes make that a seek. Add it to the contract.")
    b.EX("Retention", "Delete events older than 90 days without blocking the app.",
         "Delete in batches of a few thousand in a loop (" + M("DELETE TOP (5000) ... WHERE OccurredAtUtc < @cutoff") +
         "); the time index makes each batch cheap.")
    b.EX("Denied by hour", "A third report: denials per hour of the day over the last week.",
         M("DATEPART(HOUR, OccurredAtUtc)") + " in the GROUP BY; decide whether the hours are UTC or local and say so in the UI.")
    b.EX("Migrations", "Add a column (the door's zone) to a database that already has data.",
         "Write schema changes as numbered scripts and record which ran in a table; or adopt a tool such as DbUp.")
