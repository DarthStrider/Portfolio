namespace RecipeApp.Api.Models;

public class RecipeIngredient
{
    public int RecipeId { get; set; } //Foreign Key
    public Recipe Recipe { get; set; } = null!;
    public int IngredientId { get; set; } //Foreign Key
    public Ingredient Ingredient { get; set; } = null!;
    public decimal? Quantity { get; set; }
    public string? Unit { get; set; } 
    public string? Note { get; set; }
}