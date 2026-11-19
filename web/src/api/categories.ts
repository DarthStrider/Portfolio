import { apiGet } from './client';
import type { Categories } from '../types/recipe';


export function getCategories(): Promise<Categories> {
    return apiGet<Categories>('/api/categories');
}
