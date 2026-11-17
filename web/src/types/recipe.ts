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
}

//Matches RecipeLineDto
export interface RecipeStep {
    stepNumber: number;
    text: string;
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
