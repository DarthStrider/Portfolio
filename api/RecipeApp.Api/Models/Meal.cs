namespace RecipeApp.Api.Models;

public class Meal
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public List<Recipe> Recipes { get; set; } = [];
}
