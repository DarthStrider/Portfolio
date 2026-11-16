namespace RecipeApp.Api.Dtos;

//Client Sends
public record CreateRecipeRequest(
    string Title,
    string? Description,
    int Servings,
    int? PrepTime,
    int? CookTime,
    string? SourceUrl,
    List<RecipeIngredientLineRequest> Ingredients,
    List<RecipeStepLineRequest> Steps);

//Client sends (PUT /api/recipes/{id}); the id comes from the URL
public record UpdateRecipeRequest(
    string Title,
    string? Description,
    int Servings,
    int? PrepTime,
    int? CookTime,
    string? SourceUrl,
    List<RecipeIngredientLineRequest> Ingredients,
    List<RecipeStepLineRequest> Steps);


//API Sends
public record RecipeDto(
    int Id,
    string Title,
    string? Description,
    int Servings,
    int? PrepTime,
    int? CookTime,
    string? SourceUrl,
    DateTime CreatedAt,
    List<RecipeIngredientLineDto> Ingredients,
    List<RecipeStepLineDto> Steps);

//API sends back (GET list): light version for cards
public record RecipeSummaryDto(
    int Id,
    string Title,
    int Servings,
    int? TotalTime);