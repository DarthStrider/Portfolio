using RecipeApp.Api.Dtos;

namespace RecipeApp.Api.Services;

public interface IRecipeService
{
    Task<List<RecipeSummaryDto>> GetAllAsync();
    Task<RecipeDto?> GetByIdAsync(int id); //null = not found
    Task<RecipeDto> CreateAsync(CreateRecipeRequest request);
    Task<bool> UpdateAsync(int id, UpdateRecipeRequest request); //false = not found
    Task<bool> DeleteAsync(int id);  //false = not found
}