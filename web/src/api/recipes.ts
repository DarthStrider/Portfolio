import { apiGet, apiSend } from './client';
import type { Recipe, RecipeRequest, RecipeSummary } from '../types/recipe';
import { toQueryString, type RecipeFilters } from '../utils/recipeFilters';


export function getRecipes(filters?: RecipeFilters): Promise<RecipeSummary[]> {
    const query = filters ? toQueryString(filters) : '';
    return apiGet<RecipeSummary[]>(`/api/recipes${query ? `?${query}` : ''}`);
}

export function getRecipe(id: number): Promise<Recipe> {
    return apiGet<Recipe>(`/api/recipes/${id}`);
}

// .... getRecipes and getRecipe stay as they are ...

export function createRecipe(request: RecipeRequest): Promise<Recipe> {
    return apiSend<Recipe>('POST', '/api/recipes', request);
}

export function updateRecipe(id: number, request: RecipeRequest): Promise<void> {
    return apiSend('PUT', `/api/recipes/${id}`, request);
}

export function deleteRecipe(id: number): Promise<void> {
    return apiSend('DELETE', `/api/recipes/${id}`);
}

export function addFavourite(id: number): Promise<void> {
    return apiSend('PUT', `/api/recipes/${id}/favourite`);
}

export function removeFavourite(id: number): Promise<void> {
    return apiSend('DELETE', `/api/recipes/${id}/favourite`);
}
