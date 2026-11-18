using Microsoft.EntityFrameworkCore;
using RecipeApp.Api.Data;
using RecipeApp.Api.Dtos;
using RecipeApp.Api.Models;

namespace RecipeApp.Api.Services;

public class RecipeService(AppDbContext db) : IRecipeService
{
    public async Task<List<RecipeSummaryDto>> GetAllAsync()
    {
        return await db.Recipes
            .AsNoTracking()                                   // 1. read-only query
            .OrderByDescending(r => r.CreatedAt)              // 2. newest first
            .Select(r => new RecipeSummaryDto(                // 3. shape into the DTO
                r.Id,
                r.Title,
                r.Servings,
                (r.PrepTime ?? 0) + (r.CookTime ?? 0)))       // 4. total time
            .ToListAsync();                                   // 5. run it
    }

    public async Task<RecipeDto?> GetByIdAsync(int id)
    {
        var recipe = await db.Recipes
            .AsNoTracking()                                  // 1. read-only
            .Include(r => r.Ingredients)                     // 2. load the ingredient lines...
                .ThenInclude(ri => ri.Ingredient)            //    ...and each line's Ingredient (for its Name)
            .Include(r => r.Steps)                           // 3. load the steps
            .FirstOrDefaultAsync(r => r.Id == id);           // 4. one recipe, or null

        return recipe is null ? null : ToDto(recipe);        // 5. not found -> null; found -> DTO
    }
    public async Task<RecipeDto> CreateAsync(CreateRecipeRequest request)
    {
        // 1. Build the recipe from the simple fields
        Recipe recipe = new Recipe
        {
            Title = request.Title.Trim(),
            Description = request.Description,
            Servings = request.Servings,
            PrepTime = request.PrepTime,
            CookTime = request.CookTime,
            SourceUrl = request.SourceUrl
            // Id and CreatedAt are set automatically
        };

        // 2. Add ingredient lines and steps (shared with UpdateAsync)
        await ApplyLinesAsync(recipe, request.Ingredients, request.Steps);

        // 3. Save: one INSERT for the recipe, plus its lines, steps, and any new ingredients
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();

        // 4. Return the saved recipe (now with its database Id)
        return ToDto(recipe);
    }

    public async Task<bool> UpdateAsync(int id, UpdateRecipeRequest request)
    {
        // load the existing recipe WITH its lines and steps
        // (no AsNoTracking: we want EF to track changes so it can save them)
        Recipe? recipe = await db.Recipes
            .Include(r => r.Ingredients)
            .Include(r => r.Steps)
            .FirstOrDefaultAsync(r => r.Id == id);

        if (recipe is null)
            return false;                                   // controller turns this into 404

        // overwrite the simple fields (same as Create, but on an existing object)
        recipe.Title = request.Title.Trim();
        recipe.Description = request.Description;
        recipe.Servings = request.Servings;
        recipe.PrepTime = request.PrepTime;
        recipe.CookTime = request.CookTime;
        recipe.SourceUrl = request.SourceUrl;
        // Id and CreatedAt stay as they were

        //clear the old lists, then rebuild them
        recipe.Ingredients.Clear();
        recipe.Steps.Clear();
        await ApplyLinesAsync(recipe, request.Ingredients, request.Steps);

        // No db.Recipes.Add(...): EF already knows about this recipe
        await db.SaveChangesAsync();
        return true;                                        // controller turns this into 204
    }

    public async Task<bool> DeleteAsync(int id)
    {
        // 1. Look up the recipe by its primary key
        Recipe? recipe = await db.Recipes.FindAsync(id);

        // 2. Not found -> tell the controller (it returns 404)
        if (recipe is null)
            return false;

        // 3. Mark it for deletion
        db.Recipes.Remove(recipe);

        // 4. Send the DELETE to the database
        await db.SaveChangesAsync();

        // 5. Success -> controller returns 204 No Content
        return true;
    }


    //Helpers

    // Converts an entity (database shape) into a DTO (API shape)
    private static RecipeDto ToDto(Recipe r) => new(
        Id: r.Id,
        Title: r.Title,
        Description: r.Description,
        Servings: r.Servings,
        PrepTime: r.PrepTime,
        CookTime: r.CookTime,
        SourceUrl: r.SourceUrl,
        CreatedAt: r.CreatedAt,
        Ingredients: r.Ingredients
            .OrderBy(ri => ri.Position)
            .Select(ri => new RecipeIngredientLineDto(ri.Ingredient.Name, ri.Quantity, ri.Unit, ri.Note, ri.Section))
            .ToList(),
        Steps: r.Steps
            .OrderBy(s => s.StepNumber)
            .Select(s => new RecipeStepLineDto(s.StepNumber, s.Text))
            .ToList());

    // Turns request lines into entities on the recipe.
    // Reuses existing Ingredient rows and numbers steps 1..n.
    private async Task ApplyLinesAsync(
        Recipe recipe,
        List<RecipeIngredientLineRequest> ingredientLines,
        List<RecipeStepLineRequest> stepLines)
    {
        // --- Ingredients ---
        // Normalize every name once: "  Flour " -> "flour"
        List<string> names = ingredientLines
            .Select(l => IngredientNames.Normalize(l.Name))
            .Distinct()
            .ToList();

        // ONE query: fetch all of these that already exist in the database
        Dictionary<string, Ingredient> existing = await db.Ingredients
            .Where(i => names.Contains(i.Name))
            .ToDictionaryAsync(i => i.Name);

        for (int i = 0; i < ingredientLines.Count(); i++)
        {
            RecipeIngredientLineRequest line = ingredientLines[i];
            string name = IngredientNames.Normalize(line.Name);

            // Reuse it if we have it; otherwise create it once and remember it
            if (!existing.TryGetValue(name, out var ingredient))
            {
                ingredient = new Ingredient { Name = name };
                existing[name] = ingredient;
            }

            recipe.Ingredients.Add(new RecipeIngredient
            {
                Ingredient = ingredient,
                Section = CleanSection(line.Section),
                Position = i,
                Quantity = line.Quantity,
                Unit = line.Unit?.Trim(),
                Note = line.Note?.Trim()
            });
        }

        // --- Steps: the server numbers them 1, 2, 3... in the order sent ---
        for (int i = 0; i < stepLines.Count; i++)
        {
            recipe.Steps.Add(new RecipeStep
            {
                StepNumber = i + 1,
                Text = stepLines[i].Text.Trim()
            });
        }
    }

    // Trim a section name; treat empty/whitespace as "no section"
    private static string? CleanSection(string? section) =>
        string.IsNullOrWhiteSpace(section) ? null : section.Trim();

}
