namespace RecipeApp.Api.Models;

public class Recipe
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int Servings { get; set; }
    public int? PrepTime { get; set; }
    public int? CookTime { get; set; }
    public List<RecipeStep> Steps { get; set; } = [];
    public string? SourceUrl { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<RecipeIngredient> Ingredients { get; set; } = [];
    public int? CuisineId { get; set; }
    public Cuisine? Cuisine { get; set; }
    public List<Course> Courses { get; set;  } = [];
    public List<Meal> Meals { get; set; } = [];
    public bool IsFavourite { get; set; }
}
