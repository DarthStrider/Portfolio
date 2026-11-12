using System.Reflection;

namespace SolutionFramework.Host;

public sealed record LoadedModule(ISolutionModule Module, string AssemblyPath, PluginLoadContext Context);

public sealed record LoadResult(IReadOnlyList<LoadedModule> Modules, IReadOnlyList<string> Problems);

/// <summary>
/// Finds modules by convention: every subfolder of the modules folder holds one module, built as
/// &lt;folder&gt;/&lt;folder&gt;.dll. Every public, non-abstract class in it that implements
/// ISolutionModule and has a parameterless constructor is created. Problems (a missing DLL, a
/// constructor that throws) are reported, not fatal: one broken module shouldn't stop the building.
/// </summary>
public static class ModuleLoader
{
    public static LoadResult LoadFrom(string modulesFolder)
    {
        var modules = new List<LoadedModule>();
        var problems = new List<string>();

        if (!Directory.Exists(modulesFolder))
            return new LoadResult(modules, [$"Modules folder not found: {modulesFolder}"]);

        foreach (var folder in Directory.GetDirectories(modulesFolder).OrderBy(f => f, StringComparer.Ordinal))
        {
            var name = Path.GetFileName(folder);
            var dll = Path.Combine(folder, name + ".dll");
            if (!File.Exists(dll))
            {
                problems.Add($"{name}: expected {name}.dll in its folder");
                continue;
            }

            var context = new PluginLoadContext(dll);
            Assembly assembly;
            try
            {
                assembly = context.LoadFromAssemblyPath(dll);
            }
            catch (Exception e) when (e is BadImageFormatException or FileLoadException)
            {
                problems.Add($"{name}: not a .NET assembly ({e.Message})");
                context.Unload();
                continue;
            }

            var found = 0;
            foreach (var type in ModuleTypes(assembly))
            {
                try
                {
                    modules.Add(new LoadedModule((ISolutionModule)Activator.CreateInstance(type)!, dll, context));
                    found++;
                }
                catch (Exception e)
                {
                    problems.Add($"{name}: couldn't create {type.FullName} ({(e.InnerException ?? e).Message})");
                }
            }
            if (found == 0) problems.Add($"{name}: no public ISolutionModule with a parameterless constructor");
        }

        return new LoadResult(modules, problems);
    }

    private static IEnumerable<Type> ModuleTypes(Assembly assembly)
    {
        Type?[] types;
        try
        {
            types = assembly.GetExportedTypes();
        }
        catch (ReflectionTypeLoadException e)
        {
            types = e.Types;
        }
        return types.OfType<Type>().Where(t =>
            t is { IsClass: true, IsAbstract: false } &&
            typeof(ISolutionModule).IsAssignableFrom(t) &&
            t.GetConstructor(Type.EmptyTypes) is not null);
    }

    /// <summary>
    /// The default modules folder: "modules" next to the host, or, when running from source,
    /// the artifacts/modules folder that building the modules fills.
    /// </summary>
    public static string DefaultFolder()
    {
        var beside = Path.Combine(AppContext.BaseDirectory, "modules");
        if (Directory.Exists(beside)) return beside;
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "artifacts", "modules");
            if (Directory.Exists(candidate)) return candidate;
        }
        return beside;
    }
}
