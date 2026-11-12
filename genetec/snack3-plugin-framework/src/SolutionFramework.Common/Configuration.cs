using System.Globalization;
using System.Text.Json;

namespace SolutionFramework.Common;

/// <summary>
/// modules.json: one section per module, keyed by the module's Name. Each module only ever sees
/// its own section, so modules can't read (or depend on) each other's settings.
/// </summary>
/// <example>{ "DoorForcedEmail": { "To": "security@example.com" } }</example>
public sealed class ModuleSettings
{
    private readonly Dictionary<string, Dictionary<string, string>> _sections;

    private ModuleSettings(Dictionary<string, Dictionary<string, string>> sections) => _sections = sections;

    public static ModuleSettings Empty { get; } = new(new(StringComparer.OrdinalIgnoreCase));

    public static ModuleSettings Load(string path) =>
        File.Exists(path) ? Parse(File.ReadAllText(path)) : Empty;

    public static ModuleSettings Parse(string json)
    {
        using var document = JsonDocument.Parse(json, new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
        var sections = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var section in document.RootElement.EnumerateObject())
        {
            if (section.Value.ValueKind != JsonValueKind.Object) continue;
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var setting in section.Value.EnumerateObject())
                values[setting.Name] = setting.Value.ValueKind == JsonValueKind.String ? setting.Value.GetString()! : setting.Value.GetRawText();
            sections[section.Name] = values;
        }
        return new ModuleSettings(sections);
    }

    public IModuleConfig For(string moduleName) =>
        new SectionConfig(_sections.TryGetValue(moduleName, out var values) ? values : new Dictionary<string, string>());

    private sealed class SectionConfig(Dictionary<string, string> values) : IModuleConfig
    {
        public string? Get(string key) => values.TryGetValue(key, out var value) ? value : null;

        public T Get<T>(string key, T defaultValue) where T : IParsable<T> =>
            values.TryGetValue(key, out var text) && T.TryParse(text, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : defaultValue;
    }
}
