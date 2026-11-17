import { apiGet } from './client';
import type { Recipe, RecipeSummary } from '../types/recipe';

export function getRecipes(): Promise<RecipeSummary[]> { 
    return apiGet<RecipeSummary[]>('/api/recipes');
}

export function getRecipe(id: number): Promise<Recipe> {
    return apiGet<Recipe>(`/api/recipes/${id}`);
}
