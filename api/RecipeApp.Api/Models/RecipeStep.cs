namespace RecipeApp.Api.Models;

public class RecipeStep
{
    public int Id { get; set; }
    public int RecipeId { get; set; } //Foreign Key
    public Recipe Recipe { get; set; } = null!;
    public int StepNumber { get; set; }
    public string Text { get; set; } = string.Empty;
}