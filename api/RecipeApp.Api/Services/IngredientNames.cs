using System.Text.RegularExpressions;

namespace RecipeApp.Api.Services;

public static class IngredientNames
{
    /// <summary>
    /// Cleans an ingredient name so the same ingredient is always stored
    /// and searched the same way: "  Olive   OIL " -> "olive oil".
    /// </summary>
    public static string Normalize(string name)
    {
        //1. Guard: null or only spaces -? empty string (validation will be rejected later)
        if (string.IsNullOrWhiteSpace(name))
        {
            return string.Empty;
        }

        //2. Remove Spaces at the start and end
        string trimmed = name.Trim();

        //3. Lowercase, the same on every computer
        string lower = trimmed.ToLowerInvariant();

        //4. Turn any run of whitespaces (spaces, tabs) into a single space
        return Regex.Replace(lower, @"\s+", " ");
    }

    /// <summary>
    /// Returns names that appear more than once after normalizing,
    /// e.g. ["Flour", "flour ", "Eggs"] -> ["flour"].
    /// </summary>
    public static List<string> FindDuplicates(IEnumerable<string> names) =>
        names
            .Select(Normalize)               // "Flour", "flour " -> "flour", "flour"
            .GroupBy(n => n)                 // group identical names together
            .Where(g => g.Count() > 1)       // keep groups with more than one
            .Select(g => g.Key)              // the name itself
            .ToList();


    ///<summary>
    ///Returns ingredients listed more than once within the SAME section.
    ///Sugar in batter and sugar in iciing is fine, but twice in Batter is not.
    /// </summary>

    public static List<(string? Section, string Name)> FindDuplicatesBySection(
        IEnumerable<(string? Section, string Name)> lines) =>
        lines
            .Select(l => (
                Section: string.IsNullOrWhiteSpace(l.Section) ? null : l.Section.Trim(),
                Name: Normalize(l.Name)))
        .GroupBy(l => (Section: l.Section?.ToLowerInvariant(), l.Name))
        .Where(g => g.Count() > 1)
        .Select(g => g.First())
        .ToList();
}
