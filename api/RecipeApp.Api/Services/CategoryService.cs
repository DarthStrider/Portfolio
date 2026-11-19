using Microsoft.EntityFrameworkCore;
using RecipeApp.Api.Data;
using RecipeApp.Api.Dtos;

namespace RecipeApp.Api.Services;

public class CategoryService(AppDbContext db) : ICategoryService
{
    public async Task<CategoriesDto> GetAllAsync()
    {
        //Cuisine A-Z; meals and courses in their natural order
        List<CategoryDto> cuisines = await db.Cuisines.AsNoTracking()
            .OrderBy(c => c.Id)
            .Select(c => new CategoryDto(c.Id, c.Name))
            .ToListAsync();

        List<CategoryDto> meals = await db.Meals.AsNoTracking()
            .OrderBy(m => m.Id)
            .Select(m => new CategoryDto(m.Id, m.Name))
            .ToListAsync();

        //Cuisine A-Z; meals and courses in their natural order
        List<CategoryDto> courses = await db.Courses.AsNoTracking()
            .OrderBy(c => c.Name)
            .Select(c => new CategoryDto(c.Id, c.Name))
            .ToListAsync();
        return new CategoriesDto(cuisines, meals, courses);
    }

    public async Task<List<string>> FindProblemAsync(int? cuisineId, List<int>? mealIds, List<int>? courseIds)
    {
        List<string> problems = [];

        if(cuisineId is not null && !await db.Cuisines.AnyAsync(c=> c.Id == cuisineId))
        {
            problems.Add($"Cuisine {cuisineId} does not exist");
        }

        List<int> meals = (mealIds ?? []).Distinct().ToList();
        if(await db.Meals.CountAsync(m=> meals.Contains(m.Id)) != meals.Count)
        {
            problems.Add("One or more meals do not exist.");
        }

        List<int> courses = (courseIds ?? []).Distinct().ToList();
        if (await db.Courses.CountAsync(c => courses.Contains(c.Id)) != courses.Count)
        {
            problems.Add("One or more courses do not exist.");
        }

        return problems;
    }
}
