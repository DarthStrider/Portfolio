using Microsoft.AspNetCore.Mvc;
using RecipeApp.Api.Dtos;
using RecipeApp.Api.Services;

namespace RecipeApp.Api.Controllers;

[ApiController]
[Route("api/recipes")]
public class RecipesController(IRecipeService recipes): ControllerBase
{

    //HTTP Get for all the recipe summaries
    [HttpGet]
    public async Task<ActionResult<List<RecipeSummaryDto>>> GetAll()
    {
        return await recipes.GetAllAsync();
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
        RecipeDto createdRecipe =  await recipes.CreateAsync(request);
        return CreatedAtAction(nameof(GetById), new { id = createdRecipe.Id }, createdRecipe);
    }

    //HTTP Put for Updating Recipe
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, UpdateRecipeRequest request)
    {
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
}
