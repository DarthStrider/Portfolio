namespace RecipeApp.Api.Models;

public class IngredientDensity
{
    public string Name { get; set; } = string.Empty;
    public decimal GramsPerCup { get; set; }
    public bool PreferWeight { get; set; }
}
