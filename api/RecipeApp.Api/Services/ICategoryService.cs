using RecipeApp.Api.Dtos;

namespace RecipeApp.Api.Services;

public interface ICategoryService
{
    Task<CategoriesDto> GetAllAsync();

    //Problems with the IDs a recipe was sent with (empty + list = all fine)
    Task<List<string>> FindProblemAsync(int? cuisineId, List<int>? mealIds, List<int>? courseIds);
}
