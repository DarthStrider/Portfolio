using System.Runtime.Loader;
using SolutionFramework.Common;
using SolutionFramework.Host;

namespace SolutionFramework.Tests;

/// <summary>
/// Loads the real modules the way the host does: from artifacts/modules, which building the module
/// projects fills (this test project references them, so they're always built first).
/// </summary>
public class ModuleLoaderTests
{
    private static readonly string ModulesFolder = ModuleLoader.DefaultFolder();

    [Fact]
    public void Finds_and_creates_both_sample_modules()
    {
        var result = ModuleLoader.LoadFrom(ModulesFolder);

        Assert.Empty(result.Problems);
        Assert.Equal(new[] { "AfterHoursAutoLock", "DoorForcedEmail" }, result.Modules.Select(m => m.Module.Name).Order());
    }

    [Fact]
    public void Each_module_lives_in_its_own_load_context()
    {
        var result = ModuleLoader.LoadFrom(ModulesFolder);

        foreach (var loaded in result.Modules)
        {
            var context = AssemblyLoadContext.GetLoadContext(loaded.Module.GetType().Assembly);
            Assert.Same(loaded.Context, context);
            Assert.NotSame(AssemblyLoadContext.Default, context);
        }
        Assert.Equal(2, result.Modules.Select(m => m.Context).Distinct().Count());
    }

    [Fact]
    public void Modules_share_the_hosts_copy_of_the_contract()
    {
        // If a module loaded its own SolutionFramework.Abstractions, its class would implement a
        // different ISolutionModule and the cast in the loader would fail.
        var result = ModuleLoader.LoadFrom(ModulesFolder);
        var contract = typeof(ISolutionModule).Assembly;

        Assert.All(result.Modules, m => Assert.Contains(typeof(ISolutionModule), m.Module.GetType().GetInterfaces()));
        Assert.Same(AssemblyLoadContext.Default, AssemblyLoadContext.GetLoadContext(contract));
        Assert.All(Directory.GetDirectories(ModulesFolder), folder =>
            Assert.False(File.Exists(Path.Combine(folder, contract.GetName().Name + ".dll")), $"{folder} ships its own copy of the contract"));
    }

    [Fact]
    public void Problems_are_reported_without_stopping_the_load()
    {
        var folder = Directory.CreateTempSubdirectory("modules-").FullName;
        try
        {
            Directory.CreateDirectory(Path.Combine(folder, "Empty"));
            Directory.CreateDirectory(Path.Combine(folder, "Junk"));
            File.WriteAllText(Path.Combine(folder, "Junk", "Junk.dll"), "not really a DLL");
            CopyModule("DoorForcedEmail", folder);

            var result = ModuleLoader.LoadFrom(folder);

            Assert.Equal("DoorForcedEmail", Assert.Single(result.Modules).Module.Name);
            Assert.Contains(result.Problems, p => p.StartsWith("Empty: expected Empty.dll"));
            Assert.Contains(result.Problems, p => p.StartsWith("Junk: not a .NET assembly"));
        }
        finally
        {
            try { Directory.Delete(folder, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    [Fact]
    public void A_missing_folder_is_a_problem_not_a_crash()
    {
        var result = ModuleLoader.LoadFrom(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        Assert.Empty(result.Modules);
        Assert.StartsWith("Modules folder not found", Assert.Single(result.Problems));
    }

    [Fact]
    public void An_evening_at_the_building_end_to_end()
    {
        // The whole host: real modules from their folders, the shipped modules.json, the simulator.
        var log = new MemoryLogSink();
        var time = new ManualTimeProvider(new DateTimeOffset(2026, 11, 12, 17, 30, 0, TimeSpan.Zero));
        var building = new SimulatedBuilding(new Random(2026), time, log);
        var router = new EventRouter(log, time, ModuleSettings.Load(Path.Combine(AppContext.BaseDirectory, "modules.json")), building);
        foreach (var loaded in ModuleLoader.LoadFrom(ModulesFolder).Modules) Assert.True(router.Add(loaded.Module));

        for (var i = 0; i < 200; i++) router.Publish(building.Next());

        Assert.Equal(2, router.RunningModules.Count);
        Assert.Contains(log.Entries, e => e.Source == "DoorForcedEmail" && e.Message.StartsWith("EMAIL to security-desk@example.com"));
        Assert.Contains(log.Entries, e => e.Source == "doors" && e.Message.Contains("locked") && e.Message.Contains("requested by AfterHoursAutoLock"));
        Assert.DoesNotContain(log.Entries, e => e.Level == LogLevel.Error);
    }

    private static void CopyModule(string name, string destination)
    {
        var source = Path.Combine(ModulesFolder, name);
        var target = Directory.CreateDirectory(Path.Combine(destination, name)).FullName;
        foreach (var file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)));
    }
}
