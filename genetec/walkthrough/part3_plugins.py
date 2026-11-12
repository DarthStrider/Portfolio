"""Part 3: Mini Plugin Framework."""
from bookkit import M
from reportlab.graphics.shapes import Drawing

S3 = "snack3-plugin-framework/"
ABS = S3 + "src/SolutionFramework.Abstractions/"
COM = S3 + "src/SolutionFramework.Common/"
HOST = S3 + "src/SolutionFramework.Host/"
MODS = S3 + "modules/"
TESTS = S3 + "tests/SolutionFramework.Tests/"


def alc_diagram(b):
    d = Drawing(486, 190)
    b.box(d, 0, 110, 486, 70, "Default load context (the host)", ["solution-host.dll · SolutionFramework.Common.dll",
                                                                  "SolutionFramework.Abstractions.dll  ← the one copy of ISolutionModule"])
    b.box(d, 20, 0, 210, 80, "PluginLoadContext: DoorForcedEmail", ["DoorForcedEmail.dll", "its own dependencies, if any", "Abstractions? → falls back to host"])
    b.box(d, 256, 0, 210, 80, "PluginLoadContext: AfterHoursAutoLock", ["AfterHoursAutoLock.dll", "its own dependencies, if any", "Abstractions? → falls back to host"])
    b.arrow(d, 125, 80, 125, 110, dash=[2, 2], label="fallback")
    b.arrow(d, 361, 80, 361, 110, dash=[2, 2], label="fallback")
    return d


def write(b):
    b.PART("Part 3", "Mini Plugin Framework",
           "A host that knows one interface and nothing else, modules found in folders at run time, each in its own "
           "assembly load context, and an event router that keeps one broken module from taking down the rest. This is "
           "the \"framework so each project doesn't start from scratch\" idea from Genetec's job ad, in miniature.")

    b.H1("3.1 What it does")
    b.P("" + M("solution-host") + " scans a modules folder, loads every module it finds, and plays a simulated "
        "evening at a building through them: badge swipes, doors unlocked, held open and forced. Two sample modules "
        "react. <b>DoorForcedEmail</b> \"emails\" the security desk (it logs the email) when a door is forced, at most "
        "once per door every five minutes. <b>AfterHoursAutoLock</b> asks the host to lock any door left unlocked or "
        "held open between 19:00 and 07:00. The host carries out the lock and reports a " + M("DoorLocked") +
        " event back to every module.")
    b.P("Neither the host nor the other module knows these modules exist. Adding a third means building a DLL and "
        "copying its folder.")

    b.H1("3.2 Plugins, reflection and load contexts")
    b.P("<b>Reflection</b> lets a program inspect types at run time: load an assembly from a path, list its public "
        "types, ask whether one implements an interface, and create it. That's all a plugin host needs to find code "
        "it was never compiled against.")
    b.P("<b>Assembly load contexts</b> (ALCs) are .NET's way of keeping plugins apart. Every assembly lives in one; "
        "the app's own are in the default context. Loading each plugin into its own context means each plugin's "
        "dependencies are resolved from its own folder, so two plugins can use different versions of the same "
        "library, and a context can be unloaded.")
    b.P("There's one trap. A type's identity is its name <i>plus</i> the assembly instance it came from. If a plugin "
        "loaded its own copy of the contract assembly, its " + M("ISolutionModule") + " would be a different type from "
        "the host's, and the host's cast would fail with a baffling " + M("InvalidCastException") + " between two "
        "types with the same name. So the contract must exist exactly once, in the host's context, and every plugin "
        "must use that copy.")
    b.figure(alc_diagram(b), "Figure 3.1. One context per module; the contract resolves to the host's copy.")

    b.H1("3.3 The contract")
    b.whole(ABS + "SolutionFramework.Abstractions.csproj", "xml")
    b.code(ABS + "Contracts.cs", "public interface ISolutionModule", "cs")
    b.P("Three members, as the README specifies. The doc comment is part of the contract: modules are created with a "
        "parameterless constructor, initialized once, then sent events.")
    b.code(ABS + "Contracts.cs", "public interface IModuleContext", "cs", end="public enum SecurityEventKind")
    b.notes(ABS + "Contracts.cs", [
        ("TimeProvider Time { get; }", M("TimeProvider") + " (.NET 8) is the framework's abstraction of the clock. Modules "
         "that ask it for the time can be tested at 18:59 and 19:00 without waiting."),
        ("T Get<T>(string key, T defaultValue) where T : IParsable<T>;", "A generic setting reader constrained to "
         "types that can parse themselves (" + M("int") + ", " + M("double") + ", " + M("TimeSpan") + "...), using "
         "<b>static abstract interface members</b>: " + M("T.TryParse") + " is called on the type itself."),
        ("public interface ICommandSink", "Modules never touch hardware. They ask, and the host decides how and when."),
    ])
    b.code(ABS + "Contracts.cs", "public enum SecurityEventKind", "cs", end="public sealed record LockDoorCommand")
    b.P("Events and commands are records: immutable, compared by value, with a readable " + M("ToString") + ". "
        + M("DeviceCommand") + " is an abstract record so the host can accept any command and switch on its type.")

    b.H1("3.4 Shared logging and configuration")
    b.code(COM + "Logging.cs", "public interface ILogSink", "cs")
    b.code(COM + "Logging.cs", "public sealed class SourceLogger(", "cs")
    b.P("Every module gets a logger stamped with its own name, so the console reads "
        + M("21:42:00 WARN  [DoorForcedEmail] EMAIL to ...") + ". Where log entries go (console, memory for tests) is a "
        "sink chosen by the host. The time comes from the same " + M("TimeProvider") + " as everything else, so log "
        "lines show simulated time.")
    b.code(COM + "Configuration.cs", "public static ModuleSettings Parse(string json)", "cs")
    b.notes(COM + "Configuration.cs", [
        ("CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true", "modules.json is edited by people, "
         "so comments and a stray trailing comma are allowed."),
        ("new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);", "Section and key "
         "names ignore case, so \"to\" and \"To\" are the same setting."),
        ("setting.Value.GetRawText()", "Non-string values (numbers, booleans) are kept as their JSON text and parsed "
         "on request by " + M("Get<T>") + "."),
    ])
    b.code(COM + "Configuration.cs", "private sealed class SectionConfig(", "cs")
    b.P("Each module receives only its own section. It can't read, or come to depend on, another module's settings.")
    b.whole(HOST + "modules.json", "json")

    b.H1("3.5 Loading a module")
    b.whole(HOST + "PluginLoadContext.cs", "cs")
    b.notes(HOST + "PluginLoadContext.cs", [
        ("isCollectible: true", "A collectible context can be unloaded once nothing references its types, which is "
         "what hot-reloading a module would need."),
        ("new(mainAssemblyPath);", M("AssemblyDependencyResolver") + " reads the module's " + M(".deps.json") +
         " to know which of its dependencies are in its folder."),
        ("if (assemblyName.Name == typeof(ISolutionModule).Assembly.GetName().Name) return null;", "Returning "
         + M("null") + " means \"not mine\": the runtime falls back to the default context, the host's copy. This "
         "line makes the guarantee explicit even if a module ships a copy by mistake."),
    ])
    b.code(HOST + "ModuleLoader.cs", "public static LoadResult LoadFrom(string modulesFolder)", "cs")
    b.notes(HOST + "ModuleLoader.cs", [
        ("var dll = Path.Combine(folder, name + \".dll\");", "Convention over configuration: the folder's name is the "
         "DLL's name, so there's no manifest to keep in sync."),
        ("catch (Exception e) when (e is BadImageFormatException or FileLoadException)", "A file that isn't a .NET "
         "assembly becomes a reported problem. The context is unloaded so the failed attempt doesn't linger."),
        ("modules.Add(new LoadedModule((ISolutionModule)Activator.CreateInstance(type)!", M("Activator") +
         " calls the parameterless constructor. The cast works only because of the shared contract."),
        ("problems.Add($\"{name}: couldn't create", "A constructor that throws arrives wrapped in "
         + M("TargetInvocationException") + "; the inner exception is the useful message."),
    ])
    b.code(HOST + "ModuleLoader.cs", "private static IEnumerable<Type> ModuleTypes(Assembly assembly)", "cs")
    b.P(M("GetExportedTypes") + " lists public types. If some of an assembly's types can't load (a missing "
        "dependency), it throws " + M("ReflectionTypeLoadException") + ", whose " + M("Types") + " array still holds "
        "the ones that did, with nulls for the rest; " + M("OfType<Type>()") + " drops the nulls.")

    b.H1("3.6 Building modules into a folder")
    b.whole(MODS + "DoorForcedEmail/DoorForcedEmail.csproj", "xml")
    b.notes(MODS + "DoorForcedEmail/DoorForcedEmail.csproj", [
        ("<EnableDynamicLoading>true</EnableDynamicLoading>", "Marks the project as a plugin: it gets a "
         + M(".deps.json") + " and copies its dependencies to its output, everything the resolver needs."),
        ("<Private>false</Private>", "Don't copy the contract's DLL into the module's output..."),
        ("<ExcludeAssets>runtime</ExcludeAssets>", "...and don't list it as a runtime dependency. Compile against it, "
         "load the host's."),
    ])
    b.whole(MODS + "Directory.Build.targets", "xml")
    b.P("MSBuild imports " + M("Directory.Build.targets") + " into every project below its folder, so every module "
        "gets this step without repeating it. After each build, the module's output lands in "
        + M("artifacts/modules/<Name>/") + ", which is the folder the host searches when run from source.")

    b.H1("3.7 Routing events")
    b.code(HOST + "EventRouter.cs", "public bool Add(ISolutionModule module)", "cs")
    b.P("Each module gets its own context: a logger with its name, its own settings section, and a command sink that "
        "remembers who sent what. A module whose " + M("Initialize") + " throws (a missing setting, say) is logged and "
        "left out, and the rest load normally.")
    b.code(HOST + "EventRouter.cs", "public void Publish(SecurityEvent securityEvent)", "cs")
    b.notes(HOST + "EventRouter.cs", [
        ("foreach (var slot in _slots.Where(s => s.Enabled))", "Every running module, in the order they were added. "
         "Sequential delivery keeps reasoning simple: a module never sees two events at once."),
        ("slot.ConsecutiveFailures = 0;", "One success resets the count, so a module that fails occasionally keeps running."),
        ("if (slot.ConsecutiveFailures >= MaxConsecutiveFailures)", "A <b>circuit breaker</b>: three failures in a row "
         "and the module is switched off, so a broken module can't flood the log with the same exception forever."),
        ("while (_pending.TryDequeue(out var command))", "Commands run only after every module has seen the event, so "
         "no module sees the world change halfway through a delivery."),
        ("if (result is not null) Publish(result);", "The door's answer (" + M("DoorLocked") + ") is published like any "
         "event, so modules see each other's effects without knowing about each other."),
    ])
    b.code(HOST + "EventRouter.cs", "private sealed class CommandSink(", "cs")
    b.P(M("command with { Reason = ... }") + " copies the record with one property changed: the host appends which "
        "module asked, which shows up in the door's log line.")

    b.H1("3.8 The two modules")
    b.code(MODS + "DoorForcedEmail/DoorForcedEmailModule.cs", "public void Initialize(IModuleContext context)", "cs")
    b.P("A module validates its own configuration and fails " + M("Initialize") + " with a message that says what to "
        "fix. The router turns that into a log line and leaves the module out.")
    b.code(MODS + "DoorForcedEmail/DoorForcedEmailModule.cs", "public void OnEvent(SecurityEvent e)", "cs")
    b.P("A forced door often reports several times in a row. The module remembers when it last emailed about each "
        "door and stays quiet for " + M("QuietSeconds") + ": the alert people actually want, not one per sensor bounce.")
    b.code(MODS + "AfterHoursAutoLock/AfterHoursAutoLockModule.cs", "public bool IsAfterHours(TimeOnly time)", "cs")
    b.P("The classic bug in after-hours rules is the window that crosses midnight. 19:00 to 07:00 isn't \"after 19:00 "
        "<i>and</i> before 07:00\" (no time is both) but \"after 19:00 <i>or</i> before 07:00\". The method handles both "
        "shapes, and tests check 18:59, 19:00, midnight, 06:59 and 07:00 for one and a same-day window for the other.")
    b.code(MODS + "AfterHoursAutoLock/AfterHoursAutoLockModule.cs", "public void OnEvent(SecurityEvent e)", "cs")
    b.P(M("e.Kind is not (A or B)") + " is a combined pattern: the module only cares about unlocked and held-open doors.")

    b.H1("3.9 The host program")
    b.code(HOST + "SimulatedBuilding.cs", "public sealed class ManualTimeProvider", "cs")
    b.P("The simulation's clock: it only moves when told. " + M("SimulatedBuilding.Next") + " advances it two to "
        "eleven minutes per event, so an evening from 17:30 passes in a second and the 19:00 rule kicks in partway.")
    b.code(HOST + "Program.cs", "var options = Options.Parse(args);", "cs", end="return 0;")
    b.P("Top-level statements: the whole program, no " + M("Main") + " method. Problems loading modules are printed, "
        "not thrown. With no modules at all, the exit code is 1 and the message says how to get some.")

    b.H1("3.10 Testing a framework")
    b.code(TESTS + "ModuleLoaderTests.cs", "public void Modules_share_the_hosts_copy_of_the_contract()", "cs")
    b.P("The type-identity guarantee from 3.2 as a test: every loaded module implements the host's "
        + M("ISolutionModule") + ", the contract lives in the default context, and no module folder ships a copy.")
    b.code(TESTS + "ModuleLoaderTests.cs", "public void Problems_are_reported_without_stopping_the_load()", "cs")
    b.code(TESTS + "EventRouterTests.cs", "public void A_module_that_fails_three_times_in_a_row_is_switched_off()", "cs")
    b.code(TESTS + "ModuleLoaderTests.cs", "public void An_evening_at_the_building_end_to_end()", "cs")
    b.P("The end-to-end test runs the whole host as " + M("Program.cs") + " does (real module folders, the shipped "
        + M("modules.json") + ", the simulator) for 200 events, and checks an email went out, a door was locked at a "
        "module's request, and nothing logged an error.")

    b.H1("3.11 Interview questions")
    b.QA("Why does the contract live in its own assembly?",
         "So it can be shared by exactly one copy. If the host and a module each loaded their own, ISolutionModule would "
         "be two different types and casting a module to it would fail. A small, separate contract assembly that modules "
         "compile against but don't ship makes that impossible.")
    b.QA("What does an AssemblyLoadContext give you that Assembly.LoadFrom doesn't?",
         "Isolation and control: each module's dependencies resolve from its own folder (so modules can use different "
         "versions of a library), you decide which assemblies are shared, and a collectible context can be unloaded.")
    b.QA("A module throws on every event. What happens?",
         "Each exception is logged and the other modules still get the event. After three failures in a row the router "
         "switches the module off. A single success resets the count.")
    b.QA("Why commands instead of letting the module lock the door itself?",
         "The host stays in control of hardware: it can validate, log, rate-limit or refuse. Modules stay testable (a "
         "test checks the command, no door needed), and the result is published as an event other modules can see.")
    b.QA("Is adding a method to ISolutionModule a breaking change?",
         "Yes. Every existing module fails to load (it doesn't implement the new member) or to compile. Under Semantic "
         "Versioning that's a new major version of the contract. Default interface methods, or a second optional "
         "interface, are the usual ways to extend without breaking.")
    b.QA("How would you hot-reload a module?",
         "Watch the folder; when it changes, remove the module from the router, drop every reference to its types, "
         "unload its collectible context, and load the new build into a new context.")

    b.H1("3.12 Exercises")
    b.EX("A third module", "Write a module that counts denied swipes per door and warns after five in ten minutes.",
         "Copy DoorForcedEmail's project; keep a queue of timestamps per door. Test it with " + M("FakeContext") + ".")
    b.EX("Module versions", "Have each module declare which contract version it was built for, and refuse to load "
         "modules built for a newer one.", "An assembly attribute in the contract, read by the loader with "
         + M("GetCustomAttribute") + "; compare major versions.")
    b.EX("Hot reload", "Reload a module when its folder changes, without restarting the host.",
         M("FileSystemWatcher") + ", " + M("AssemblyLoadContext.Unload") + ", and a test that the old context is "
         "collected (a " + M("WeakReference") + " to it goes dead after " + M("GC.Collect") + ").")
    b.EX("Async modules", "Real email sending is async. Add " + M("OnEventAsync") + " without breaking existing modules.",
         "A default interface method that calls " + M("OnEvent") + ", or a separate " + M("IAsyncSolutionModule") +
         " the router checks for. Which one is a minor version, and which a major?")
