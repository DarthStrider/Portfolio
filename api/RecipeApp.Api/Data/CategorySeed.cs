using RecipeApp.Api.Models;

namespace RecipeApp.Api.Data;

// Built-in categories, created by a migration so every environment has them.
// IDs are fixed (HasData needs them); user-added rows start at 1000 (see AppDbContext).
public static class CategorySeed
{
    public static readonly Cuisine[] Cuisines =
    [
        new Cuisine { Id = 1, Name = "Italian" },
        new Cuisine { Id = 2, Name = "Mexican" },
        new Cuisine { Id = 3, Name = "Indian" },
        new Cuisine { Id = 4, Name = "Japanese" },
        new Cuisine { Id = 5, Name = "Chinese" },
        new Cuisine { Id = 6, Name = "Greek" },
        new Cuisine { Id = 7, Name = "Middle Eastern" },
        new Cuisine { Id = 8, Name = "Canadian" },
        new Cuisine { Id = 9, Name = "American" },
    ];

    public static readonly Meal[] Meals =
    [
        new Meal { Id = 1, Name = "Breakfast" },
        new Meal { Id = 2, Name = "Brunch" },
        new Meal { Id = 3, Name = "Lunch" },
        new Meal { Id = 4, Name = "Dinner" },
        new Meal { Id = 5, Name = "Snack" },
    ];

    public static readonly Course[] Courses =
    [
        new Course { Id = 1, Name = "Appetizer" },
        new Course { Id = 2, Name = "Main" },
        new Course { Id = 3, Name = "Side" },
        new Course { Id = 4, Name = "Soup" },
        new Course { Id = 5, Name = "Salad" },
        new Course { Id = 6, Name = "Dessert" },
        new Course { Id = 7, Name = "Drink" },
    ];
}
