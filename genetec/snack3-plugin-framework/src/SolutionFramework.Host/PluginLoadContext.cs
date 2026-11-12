using System.Reflection;
using System.Runtime.Loader;

namespace SolutionFramework.Host;

/// <summary>
/// One load context per module. A module's own dependencies resolve from its folder (using its
/// .deps.json), so two modules can use different versions of the same library. Anything the
/// module's folder doesn't have, notably SolutionFramework.Abstractions, falls back to the host's
/// copy, which is what makes ISolutionModule the same type for the host and every module.
/// </summary>
public sealed class PluginLoadContext(string mainAssemblyPath)
    : AssemblyLoadContext(Path.GetFileNameWithoutExtension(mainAssemblyPath), isCollectible: true)
{
    private readonly AssemblyDependencyResolver _resolver = new(mainAssemblyPath);

    protected override Assembly? Load(AssemblyName assemblyName)
    {
        // Never load a second copy of the contract, even if a module shipped one by mistake.
        if (assemblyName.Name == typeof(ISolutionModule).Assembly.GetName().Name) return null;

        var path = _resolver.ResolveAssemblyToPath(assemblyName);
        return path is null ? null : LoadFromAssemblyPath(path);
    }

    protected override IntPtr LoadUnmanagedDll(string unmanagedDllName)
    {
        var path = _resolver.ResolveUnmanagedDllToPath(unmanagedDllName);
        return path is null ? IntPtr.Zero : LoadUnmanagedDllFromPath(path);
    }
}
