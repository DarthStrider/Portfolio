using Microsoft.EntityFrameworkCore; // DbContext, DbSet, ModelBuilder
using RecipeApp.Api.Models;
using System.Security.Cryptography.X509Certificates;  //Recipe, Ingredient, RecipeIngredient

namespace RecipeApp.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    //Tables
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<Ingredient> Ingredients => Set<Ingredient>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();
    public DbSet<RecipeStep> RecipeSteps => Set<RecipeStep>();
    public DbSet<Cuisine> Cuisines => Set<Cuisine>();
    public DbSet<Meal> Meals => Set<Meal>();
    public DbSet<Course> Courses => Set<Course>();
    public DbSet<IngredientDensity> IngredientDensities => Set<IngredientDensity>();

    //Rules EF can't guess
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // ------------ Recipe ---------------------
        modelBuilder.Entity<Recipe>(recipe =>
        {
            //Required columns get NOT Null automatically (non-nullable strings).
            // These Just cap the length instead of unlimited text
            recipe.Property(r => r.Title).HasMaxLength(200);
            recipe.Property(r => r.Description).HasMaxLength(1000);
            recipe.Property(r => r.SourceUrl).HasMaxLength(2048);

            //One cuisine per recipe. Restrict: a cuisine can't be delete while recipes use it.
            recipe.HasOne(r => r.Cuisine)
            .WithMany(c => c.Recipes)
            .HasForeignKey(r => r.CuisineId)
            .OnDelete(DeleteBehavior.Restrict);


            // Many meals / courses per recipe. The link tables only hold two IDs, so EF manages them.
            // Named here so they're recipe_meals(recipe_id, meal_id) etc. instead of EF's default names.
            recipe.HasMany(r => r.Meals)
                .WithMany(m => m.Recipes)
                .UsingEntity<Dictionary<string, object>>(
                    "recipe_meals",
                    right => right.HasOne<Meal>().WithMany().HasForeignKey("MealId"),
                    left => left.HasOne<Recipe>().WithMany().HasForeignKey("RecipeId"),
                    join => join.HasKey("RecipeId", "MealId"));

            recipe.HasMany(r => r.Courses)
            .WithMany(m => m.Recipes)
            .UsingEntity<Dictionary<string, object>>(
                "recipe_courses",
                right => right.HasOne<Course>().WithMany().HasForeignKey("CourseId"),
                left => left.HasOne<Recipe>().WithMany().HasForeignKey("RecipeId"),
                join => join.HasKey("RecipeId", "CourseId"));
        });
        // ------------ Ingredient ---------------------
        modelBuilder.Entity<Ingredient>(ingredient =>
        {
            ingredient.Property(i => i.Name).HasMaxLength(100);
            //Make sure Ingredient such as Onion only exists once in the table
            ingredient.HasIndex(i => i.Name).IsUnique();
        });

        // ------------------- RecipeIngredient (link table) ----------------------
        modelBuilder.Entity<RecipeIngredient>(ri =>
        {
            //Up to 7 digits before the decimal point, 3 after (ex. 0.333).
            ri.Property(x => x.Quantity).HasPrecision(10, 3);
            ri.Property(x => x.Unit).HasMaxLength(50);
            ri.Property(x => x.Note).HasMaxLength(200);
            ri.Property(x => x.Section).HasMaxLength(100);
            ri.HasIndex(x => new { x.RecipeId, x.Section, x.IngredientId })
            .IsUnique()
            .AreNullsDistinct(false);

            //Recipe -> its ingredient lines.
            // Deleting a recipe deletes its lines (cascade)
            ri.HasOne(x => x.Recipe)
            .WithMany(r => r.Ingredients)
            .HasForeignKey(x => x.RecipeId)
            .OnDelete(DeleteBehavior.Cascade);

            //Ingtredient -> recipe lines that use it.
            //Can't delete "onion" while a recipe still uses it (restrict)
            ri.HasOne(x => x.Ingredient)
            .WithMany(i => i.RecipeIngredients)
            .HasForeignKey(x => x.IngredientId)
            .OnDelete(DeleteBehavior.Restrict);
        });

        //----------------------------- IngredientDensity (lookup by name) ------------------------------

        modelBuilder.Entity<IngredientDensity>(density =>
        {
            density.HasKey(d => d.Name);
            density.Property(d => d.Name).HasMaxLength(100);
            density.Property(d => d.GramsPerCup).HasPrecision(6, 1);
            density.HasData(DensitySeed.All);
        });

        //------------------------- Cuisine / Meal  / Course (built in lists) ----------//

        modelBuilder.Entity<Cuisine>(cuisine =>
        {
            cuisine.Property(c => c.Id).HasIdentityOptions(startValue: 1000);   // user-added rows start at 1000
            cuisine.Property(c => c.Name).HasMaxLength(50);
            cuisine.HasIndex(c => c.Name).IsUnique();
            cuisine.HasData(CategorySeed.Cuisines);
        });

        modelBuilder.Entity<Meal>(meal =>
        {
            meal.Property(m => m.Id).HasIdentityOptions(startValue: 1000);   // user-added rows start at 1000
            meal.Property(m => m.Name).HasMaxLength(50);
            meal.HasIndex(m => m.Name).IsUnique();
            meal.HasData(CategorySeed.Meals);
        });

        modelBuilder.Entity<Course>(course =>
        {
            course.Property(c => c.Id).HasIdentityOptions(startValue: 1000);   // user-added rows start at 1000
            course.Property(c => c.Name).HasMaxLength(50);
            course.HasIndex(c => c.Name).IsUnique();
            course.HasData(CategorySeed.Courses);
        });

        // ----------- RecipeStep ------------------
        modelBuilder.Entity<RecipeStep>(step =>
        {
            step.Property(s => s.Text).HasMaxLength(1000);

            // Recipe -> its steps; deleting a recipe deletes its steps
            step.HasOne(s => s.Recipe)
            .WithMany(r => r.Steps)
            .HasForeignKey(s => s.RecipeId)
            .OnDelete(DeleteBehavior.Cascade);

            //a recipe can't have two of the same step number
            step.HasIndex(s => new { s.RecipeId, s.StepNumber }).IsUnique();
        });
    }
}
