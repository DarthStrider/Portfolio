using Microsoft.AspNetCore.Mvc;
using RecipeApp.Api.Dtos;
using RecipeApp.Api.Services;

namespace RecipeApp.Api.Controllers;


[ApiController]
[Route("api/categories")]
public class CategoriesController(ICategoryService categories): ControllerBase
{
    //HTTP Get, cuisines, meals and courses for the form and filters
    [HttpGet]
    public async Task<ActionResult<CategoriesDto>> GetAll()
    {
        return await categories.GetAllAsync();
    }
}
