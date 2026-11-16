using Microsoft.EntityFrameworkCore; // DbContext, DbSet, ModelBuilder
using RecipeApp.Api.Models;  //Recipe, Ingredient, RecipeIngredient

namespace RecipeApp.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    //Tables
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<Ingredient> Ingredients => Set<Ingredient>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();
    public DbSet<RecipeStep> RecipeSteps => Set<RecipeStep>();

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
            //No Id Column: the key is the pair (recipeId, IngredientId).
            ri.HasKey(x => new { x.RecipeId, x.IngredientId });

            //Up to 7 digits before the decimal point, 3 after (ex. 0.333).
            ri.Property(x => x.Quantity).HasPrecision(10, 3);
            ri.Property(x => x.Unit).HasMaxLength(50);
            ri.Property(x => x.Note).HasMaxLength(200);

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