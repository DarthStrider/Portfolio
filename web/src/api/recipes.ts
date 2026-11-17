import { apiGet } from './client';
import type { RecipeSummary } from '../types/recipe';

export function getRecipes(): Promise<RecipeSummary[]> { 
    return apiGet<RecipeSummary[]>('/api/recipes');
}
