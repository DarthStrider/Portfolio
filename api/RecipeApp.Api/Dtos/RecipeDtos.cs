using System.ComponentModel.DataAnnotations;

namespace RecipeApp.Api.Dtos;

//Client Sends
public record CreateRecipeRequest(
    [Required, MaxLength(200)]string Title,
    [MaxLength(1000)]string? Description,
    [Range(1,100)]int Servings,
    [Range(0,1440)]int? PrepTime,
    [Range(0,1440)]int? CookTime,
    [Url, MaxLength(2048)]string? SourceUrl,
    [MinLength(1)]List<RecipeIngredientLineRequest> Ingredients,
    [MinLength(1)]List<RecipeStepLineRequest> Steps);

//Client sends (PUT /api/recipes/{id}); the id comes from the URL
public record UpdateRecipeRequest(
    [Required, MaxLength(200)] string Title,
    [MaxLength(1000)] string? Description,
    [Range(1, 100)] int Servings,
    [Range(0, 1440)] int? PrepTime,
    [Range(0, 1440)] int? CookTime,
    [Url, MaxLength(2048)] string? SourceUrl,
    [MinLength(1)] List<RecipeIngredientLineRequest> Ingredients,
    [MinLength(1)] List<RecipeStepLineRequest> Steps);


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