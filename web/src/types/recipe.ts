export interface RecipeSummary {
    id: number;
    title: string;
    servings: number;
    totalTime: number | null;
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
}
