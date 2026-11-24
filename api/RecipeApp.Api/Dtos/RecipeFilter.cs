using System.ComponentModel.DataAnnotations;

namespace RecipeApp.Api.Dtos;

//Client sends (GET /api/recipes?cuising=#&meal=#&course=&)
//Each list is optional, several values in one list = OR different list - AND
public record RecipeFilter(
    List<int>? Cuisine,
    List<int>? Meal,
    List<int>? Course,
    [MaxLength(100)] string? Search,
    bool? Favourites);
