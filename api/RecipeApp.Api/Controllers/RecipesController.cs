using Microsoft.AspNetCore.Mvc;
using RecipeApp.Api.Dtos;
using RecipeApp.Api.Services;

namespace RecipeApp.Api.Controllers;

[ApiController]
[Route("api/recipes")]
public class RecipesController(IRecipeService recipes, ICategoryService categories): ControllerBase
{

    //HTTP Get for all the recipe summaries
    [HttpGet]
    public async Task<ActionResult<List<RecipeSummaryDto>>> GetAll([FromQuery] RecipeFilter filter)
    {
        return await recipes.GetAllAsync(filter);
    }

    //Http Get Recipe by Id
    [HttpGet("{id:int}")]
    public async Task<ActionResult<RecipeDto>> GetById(int id)
    {
        RecipeDto? recipeDto = await recipes.GetByIdAsync(id);
        return recipeDto is null ? NotFound() : Ok(recipeDto);
    }

    //HTTP Post for creation of a recipe
    [HttpPost]
    public async Task<ActionResult<RecipeDto>> Create(CreateRecipeRequest request)
    {
        HasDuplicateIngredients(request.Ingredients);
        await AddCategoryErrorsAsync(request.CuisineId, request.MealIds, request.CourseIds);
        AddOvenTemperatureErrors(request.OvenTemperature, request.OvenTemperatureUnit);

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        RecipeDto createdRecipe =  await recipes.CreateAsync(request);
        return CreatedAtAction(nameof(GetById), new { id = createdRecipe.Id }, createdRecipe);
    }

    //HTTP Put for Updating Recipe
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, UpdateRecipeRequest request)
    {
        HasDuplicateIngredients(request.Ingredients);
        await AddCategoryErrorsAsync(request.CuisineId, request.MealIds, request.CourseIds);
        AddOvenTemperatureErrors(request.OvenTemperature, request.OvenTemperatureUnit);

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        bool updated = await recipes.UpdateAsync(id, request);
        return updated ? NoContent() : NotFound();
    }

    //Http Delete to delete a recipe
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        bool deleted = await recipes.DeleteAsync(id);
        return deleted ? NoContent() : NotFound();
    }

    [HttpPut("{id:int}/favourite")]
    public async Task<IActionResult> AddFavourite(int id)
    {
        bool found = await recipes.SetFavouriteAsync(id, true);
        return found ? NoContent() : NotFound();
    }

    [HttpDelete("{id:int}/favourite")]
    public async Task<IActionResult> RemoveFavourite(int id)
    {
        bool found = await recipes.SetFavouriteAsync(id, false);
        return found? NoContent() : NotFound();
    }

    private bool HasDuplicateIngredients(List<RecipeIngredientLineRequest> ingredients)
    {
        List<(string? Section, string Name)> duplicates = IngredientNames.FindDuplicatesBySection(ingredients.Select(i => (i.Section, i.Name)));

        foreach ((string? section, string? name) in duplicates)
        {
            string where = section is null ? "" : $" in '{section}'";
            ModelState.AddModelError("Ingredients", $"'{name}' is listed more than once{where}; combine them into one line");
        }
        
        return duplicates.Count > 0;
    }

    private async Task AddCategoryErrorsAsync(int? cuisineId, List<int>? mealIds, List<int>? courseIds)
    {
        foreach (string problem in await categories.FindProblemAsync(cuisineId, mealIds, courseIds))
        {
            ModelState.AddModelError("Categories", problem);
        }
    }

    private void AddOvenTemperatureErrors(int? temperature, string? unit)
    {
        if (temperature is null && unit is null) return;
        if(temperature is null)
        {
            ModelState.AddModelError("OvenTemperature", "Enter an oven temperature, or remove the unit");
            return;
        }
        if(unit is null)
        {
            ModelState.AddModelError("OvenTemperatureUnit", "Choose °F or °C for the oven temperature.");
            return;
        }

        (int min, int max) = unit == "F" ? (150, 550) : (65, 290);
        if(temperature < min || temperature > max)
        {
            ModelState.AddModelError("OvenTemperature", $"Oven temperature must be between {min} and {max}°{unit}.");

        }
    }
}
