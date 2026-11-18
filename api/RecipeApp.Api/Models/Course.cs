namespace RecipeApp.Api.Models;

public class Course
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public List<Recipe> Recipes { get; set; } = [];
}
