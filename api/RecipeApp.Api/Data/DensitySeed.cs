using RecipeApp.Api.Models;

namespace RecipeApp.Api.Data;

// Approximate grams per US cup. Names must be lowercase, like normalized ingredient names.
// Dry ingredients prefer weight in Metric; liquids stay in ml.
public static class DensitySeed
{
    public static readonly IngredientDensity[] All =
    [
        // Flours and powders
        new IngredientDensity { Name = "flour", GramsPerCup = 125, PreferWeight = true },
        new IngredientDensity { Name = "all-purpose flour", GramsPerCup = 125, PreferWeight = true },
        new IngredientDensity { Name = "bread flour", GramsPerCup = 130, PreferWeight = true },
        new IngredientDensity { Name = "whole wheat flour", GramsPerCup = 120, PreferWeight = true },
        new IngredientDensity { Name = "cocoa powder", GramsPerCup = 85, PreferWeight = true },

        // Sugars
        new IngredientDensity { Name = "sugar", GramsPerCup = 200, PreferWeight = true },
        new IngredientDensity { Name = "brown sugar", GramsPerCup = 220, PreferWeight = true },
        new IngredientDensity { Name = "icing sugar", GramsPerCup = 120, PreferWeight = true },

        // Fats and dairy
        new IngredientDensity { Name = "butter", GramsPerCup = 227, PreferWeight = true },
        new IngredientDensity { Name = "milk", GramsPerCup = 245, PreferWeight = false },
        new IngredientDensity { Name = "heavy cream", GramsPerCup = 240, PreferWeight = false },
        new IngredientDensity { Name = "yogurt", GramsPerCup = 245, PreferWeight = false },
        new IngredientDensity { Name = "grated parmesan", GramsPerCup = 100, PreferWeight = true },

        // Liquids
        new IngredientDensity { Name = "water", GramsPerCup = 237, PreferWeight = false },
        new IngredientDensity { Name = "olive oil", GramsPerCup = 216, PreferWeight = false },
        new IngredientDensity { Name = "vegetable oil", GramsPerCup = 218, PreferWeight = false },
        new IngredientDensity { Name = "maple syrup", GramsPerCup = 315, PreferWeight = false },
        new IngredientDensity { Name = "honey", GramsPerCup = 340, PreferWeight = false },

        // Grains, legumes and others
        new IngredientDensity { Name = "rice", GramsPerCup = 185, PreferWeight = true },
        new IngredientDensity { Name = "rolled oats", GramsPerCup = 90, PreferWeight = true },
        new IngredientDensity { Name = "chickpeas", GramsPerCup = 164, PreferWeight = true },
        new IngredientDensity { Name = "chocolate chips", GramsPerCup = 170, PreferWeight = true },
        new IngredientDensity { Name = "peanut butter", GramsPerCup = 258, PreferWeight = true },
        new IngredientDensity { Name = "tahini", GramsPerCup = 240, PreferWeight = true },
    ];
}
