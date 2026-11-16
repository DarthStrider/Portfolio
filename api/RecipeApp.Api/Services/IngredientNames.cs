using System.Text.RegularExpressions;

namespace RecipeApp.Api.Services;

public static class IngredientNames
{
    /// <summary>
    /// Cleans an ingredient name so the same ingredient is always stored
    /// and searched the same way: "  Olive   OIL " -> "olive oil".
    /// </summary>
    public static string Normalize(string  name)
    {
        //1. Guard: null or only spaces -? empty string (validation will be rejected later)
        if(string.IsNullOrWhiteSpace(name))
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
}