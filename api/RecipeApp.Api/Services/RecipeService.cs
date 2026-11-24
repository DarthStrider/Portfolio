using Microsoft.EntityFrameworkCore;
using RecipeApp.Api.Data;
using RecipeApp.Api.Dtos;
using RecipeApp.Api.Migrations;
using RecipeApp.Api.Models;
using System.Linq.Expressions;

namespace RecipeApp.Api.Services;

public class RecipeService(AppDbContext db) : IRecipeService
{
    public async Task<List<RecipeSummaryDto>> GetAllAsync(RecipeFilter? filter = null)
    {
        IQueryable<Recipe> query = db.Recipes.AsNoTracking();

        //WHERE: each filter that was sent
        if (filter?.Cuisine is { Count: > 0 })
        {
            List<int> cuisines = filter.Cuisine;
            query = query.Where(r => r.CuisineId != null && cuisines.Contains(r.CuisineId.Value));
        }

        if (filter?.Meal is { Count: > 0 })
        {
            List<int> meals = filter.Meal;
            query = query.Where(r => r.Meals.Any(m => meals.Contains(m.Id)));
        }

        if (filter?.Course is { Count: > 0 })
        {
            List<int> courses = filter.Course;
            query = query.Where(r => r.Courses.Any(c => courses.Contains(c.Id)));
        }

        //Search title, description or any ingredient contains the text (case-insensitive)
        if (!string.IsNullOrWhiteSpace(filter?.Search))
        {
            string pattern = $"%{EscapeLike(IngredientNames.Normalize(filter.Search))}%";
            query = query.Where(r =>
            EF.Functions.ILike(r.Title, pattern) ||
            (r.Description != null && EF.Functions.ILike(r.Description, pattern)) ||
            r.Ingredients.Any(ri => EF.Functions.ILike(ri.Ingredient.Name, pattern)));
        }

        if (filter?.Favourites == true)
        {
            query = query.Where(r => r.IsFavourite);
        }

        return await ToSummariesAsync(query);
    }

    public async Task<RecipeDto?> GetByIdAsync(int id)
    {
        Recipe? recipe = await db.Recipes
            .AsNoTracking()                                  // 1. read-only
            .Include(r => r.Ingredients)                     // 2. load the ingredient lines...
                .ThenInclude(ri => ri.Ingredient)            //    ...and each line's Ingredient (for its Name)
            .Include(r => r.Steps)                           // 3. load the steps
            .Include(r => r.Cuisine)
            .Include(r => r.Meals)
            .Include(r => r.Courses)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == id);           // 4. one recipe, or null
        if (recipe is null) return null;
        return ToDto(recipe, await LoadDensitiesAsync(recipe));       // 5. not found -> null; found -> DTO
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
        await ApplyCategoriesAsync(recipe, request.CuisineId, request.MealIds, request.CourseIds);
        // 3. Save: one INSERT for the recipe, plus its lines, steps, and any new ingredients
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();

        // 4. Return the saved recipe (now with its database Id)
        return ToDto(recipe, await LoadDensitiesAsync(recipe));
    }

    public async Task<bool> UpdateAsync(int id, UpdateRecipeRequest request)
    {
        // load the existing recipe WITH its lines and steps
        // (no AsNoTracking: we want EF to track changes so it can save them)
        Recipe? recipe = await db.Recipes
            .Include(r => r.Ingredients)
            .Include(r => r.Steps)
            .Include(r => r.Meals)
            .Include(r => r.Courses)
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
        await ApplyCategoriesAsync(recipe, request.CuisineId, request.MealIds, request.CourseIds);
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

    public async Task<bool> SetFavouriteAsync(int id, bool isFavourite)
    {
        int updated = await db.Recipes
            .Where(r => r.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.IsFavourite, isFavourite));

        return updated > 0;
    }

    //Helpers

    // Converts an entity (database shape) into a DTO (API shape)


    //Recipe -> card Summary
    private static readonly Expression<Func<Recipe, RecipeSummaryDto>> ToSummary = r => new RecipeSummaryDto(
        r.Id,
        r.Title,
        r.Servings,
        (r.PrepTime ?? 0) + (r.CookTime ?? 0),
        r.Cuisine != null ? r.Cuisine.Name : null,
        r.Meals.OrderBy(m => m.Id).Select(m => m.Name).ToList(),
        r.Courses.OrderBy(c => c.Id).Select(c => c.Name).ToList(),
        r.IsFavourite);

    private static Task<List<RecipeSummaryDto>> ToSummariesAsync(IQueryable<Recipe> query) =>
        query
        .OrderByDescending(r => r.CreatedAt)
        .Select(ToSummary)
        .ToListAsync();

    private static RecipeDto ToDto(Recipe r, Dictionary<string, IngredientDensity> densities) => new(
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
            .Select(ri =>
            {
                densities.TryGetValue(ri.Ingredient.Name, out IngredientDensity? density);
                return new RecipeIngredientLineDto(
                    ri.Ingredient.Name, ri.Quantity, ri.Unit, ri.Note, ri.Section,
                    density?.GramsPerCup, density?.PreferWeight ?? false);
            })
            .ToList(),
        Steps: r.Steps
            .OrderBy(s => s.StepNumber)
            .Select(s => new RecipeStepLineDto(s.StepNumber, s.Text))
            .ToList(),
        Cuisine: r.Cuisine is null ? null : new CategoryDto(r.Cuisine.Id, r.Cuisine.Name),
        Meals: r.Meals.OrderBy(m=>m.Id).Select(m=> new CategoryDto(m.Id, m.Name)).ToList(),
        Courses: r.Courses.OrderBy(c=>c.Id).Select(c => new CategoryDto(c.Id, c.Name)).ToList(),
        IsFavourite: r.IsFavourite
        );

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

    private async Task ApplyCategoriesAsync(Recipe recipe, int? cuisineId, List<int>? mealIds, List<int>? courseIds)
    {
        recipe.CuisineId = cuisineId;
        recipe.Cuisine = cuisineId is null ? null : await db.Cuisines.FindAsync(cuisineId);

        List<int> meals = (mealIds ?? []).Distinct().ToList();
        recipe.Meals.Clear();
        recipe.Meals.AddRange(await db.Meals.Where(m => meals.Contains(m.Id)).ToListAsync());

        List<int> courses = (courseIds ?? []).Distinct().ToList();
        recipe.Courses.Clear();
        recipe.Courses.AddRange(await db.Courses.Where(c => courses.Contains(c.Id)).ToListAsync());
    }

    private static string EscapeLike(string text) =>
        text.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private async Task<Dictionary<string, IngredientDensity>> LoadDensitiesAsync(Recipe recipe)
    {
        List<string> names = recipe.Ingredients.Select(ri => ri.Ingredient.Name).Distinct().ToList();
        return await db.IngredientDensities
            .AsNoTracking()
            .Where(d => names.Contains(d.Name))
            .ToDictionaryAsync(d => d.Name);
    }
}
