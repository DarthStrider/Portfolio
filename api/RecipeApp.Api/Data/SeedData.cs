using Microsoft.EntityFrameworkCore;
using RecipeApp.Api.Dtos;
using RecipeApp.Api.Services;

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

    private static List<CreateRecipeRequest> SampleRecipes() =>
        [
            new CreateRecipeRequest(
            Title: "Spaghetti Aglio e Olio",
            Description: "Classic Italian garlic and olive oil pasta, ready in 20 minutes.",
            Servings: 2,
            PrepTime: 5,
            CookTime: 15,
            SourceUrl: null,
            Ingredients:
            [
                new("spaghetti", 200, "g", null),
                new("olive oil", 0.33m, "cup", null),
                new("garlic", 6, "clove", "thinly sliced"),
                new("red pepper flakes", 0.5m, "tsp", null),
                new("parsley", 2, "tbsp", "chopped"),
                new("salt", null, null, "to taste")
            ],
            Steps:
            [
                new("Cook the spaghetti in salted boiling water until al dente; reserve 1/2 cup pasta water."),
                new("Gently fry the garlic in olive oil over low heat until golden."),
                new("Add red pepper flakes, then toss in the drained pasta with a splash of pasta water."),
                new("Finish with parsley and season with salt.")
            ]),
        ];
}