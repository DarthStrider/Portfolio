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
    [MinLength(1)]List<RecipeStepLineRequest> Steps,
    int? CuisineId,
    List<int>? MealIds,
    List<int>? CourseIds,
    [Range(65,550)] int? OvenTemperature,
    [RegularExpression("^[FC]$", ErrorMessage = "Oven Temperature unit must be F or C")] string? OvenTemperatureUnit); 
    

//Client sends (PUT /api/recipes/{id}); the id comes from the URL
public record UpdateRecipeRequest(
    [Required, MaxLength(200)] string Title,
    [MaxLength(1000)] string? Description,
    [Range(1, 100)] int Servings,
    [Range(0, 1440)] int? PrepTime,
    [Range(0, 1440)] int? CookTime,
    [Url, MaxLength(2048)] string? SourceUrl,
    [MinLength(1)] List<RecipeIngredientLineRequest> Ingredients,
    [MinLength(1)] List<RecipeStepLineRequest> Steps,
    int? CuisineId,
    List<int>? MealIds,
    List<int>? CourseIds,
    [Range(65, 550)] int? OvenTemperature,
    [RegularExpression("^[FC]$", ErrorMessage = "Oven Temperature unit must be F or C")] string? OvenTemperatureUnit);


//API Sends
public record RecipeDto(
    int Id,
    string Title,
    string? Description,
    int Servings,
    int? PrepTime,
    int? CookTime,
    int? OvenTemperature,
    string? OvenTemperatureUnit,
    string? SourceUrl,
    DateTime CreatedAt,
    List<RecipeIngredientLineDto> Ingredients,
    List<RecipeStepLineDto> Steps,
    CategoryDto? Cuisine,
    List<CategoryDto> Meals,
    List<CategoryDto> Courses,
    bool IsFavourite);

//API sends back (GET list): light version for cards
public record RecipeSummaryDto(
    int Id,
    string Title,
    int Servings,
    int? TotalTime,
    string? Cuisine,
    List<string> Meals,
    List<string> Courses,
    bool IsFavourite);
