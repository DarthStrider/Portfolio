export interface RecipeSummary {
    id: number;
    title: string;
    servings: number;
    totalTime: number | null;
    cuisine: string | null;
    meals: string[];
    courses: string[];
    isFavourite: boolean;
}

//Matches RecipeIngredientLineDto
export interface RecipeIngredientLine {
    name: string;
    quantity: number | null;
    unit: string | null;
    note: string | null;
    section: string | null;
}

export interface RecipeStepLineRequest {
    text: string;
}

//Matches RecipeLineDto
export interface RecipeStep {
    stepNumber: number;
    text: string;
}

//Matches CreateRecipeRequest and UpdateRecipeRequest
export interface RecipeRequest {
    title: string;
    description: string | null;
    servings: number;
    prepTime: number | null;
    cookTime: number | null;
    sourceUrl: string | null;
    ingredients: RecipeIngredientLine[];
    steps: RecipeStepLineRequest[];
    cuisineId: number | null;
    mealIds: number[];
    courseIds: number[];
}

//Matches RecipeDto
export interface Recipe {
    id: number;
    title: string;
    description: string | null;
    servings: number;
    prepTime: number | null;
    cookTime: number | null;
    sourceUrl: string | null;
    createdAt: string;
    ingredients: RecipeIngredientLine[];
    steps: RecipeStep[];
    cuisine: Category | null;
    meals: Category[];
    courses: Category[];
    isFavourite: boolean;
}

export interface Category {
    id: number;
    name: string;
}

export interface Categories {
    cuisines: Category[];
    meals: Category[];
    courses: Category[];
}
