using Microsoft.EntityFrameworkCore;
using RecipeApp.Api.Dtos;
using RecipeApp.Api.Services;
using System.Text.Json;

namespace RecipeApp.Api.Data;

public static class SeedData
{
    public static async Task SeedAsync(AppDbContext dbContext, IRecipeService recipes)
    {
        //1. Already have data? Do nothing, so it never seeds twice
        if (await dbContext.Recipes.AnyAsync())
            return;

        //2. Create each sample recipe through the service
        foreach (CreateRecipeRequest request in SampleRecipes())
        {
            await recipes.CreateAsync(request);
        }
    }

    private static List<CreateRecipeRequest> SampleRecipes()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "Data", "seed-recipes.json");
        string json = File.ReadAllText(path);

        //Web defaults = camelcase property names, same as the Api Uses
        JsonSerializerOptions options = new(JsonSerializerDefaults.Web);

        return JsonSerializer.Deserialize<List<CreateRecipeRequest>>(json, options)
            ?? throw new InvalidOperationException("Seed file is empty or invalid");
    }
}