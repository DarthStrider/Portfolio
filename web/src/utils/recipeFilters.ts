export type FilterKey = 'cuisine' | 'meal' | 'course';
export const FILTER_KEYS: FilterKey[] = ['cuisine', 'meal', 'course'];

export interface RecipeFilters {
    cuisine: number[];
    meal: number[];
    course: number[];
    search: string;
    favourites: boolean;
}

//URL -> filters. Ignore anything that isn't a hole mumber (?meal=abd)
export function readFilters(params: URLSearchParams): RecipeFilters {
    const ids = (key: FilterKey) => params.getAll(key).map(Number).filter(Number.isInteger);
    return { cuisine: ids('cuisine'), meal: ids('meal'), course: ids('course'), search: params.get('search') ?? '', favourites: params.get('favourites') === 'true', };
}

//Filters -> ""cuisine=3&meal=4&meal=5"
export function toQueryString(filters: RecipeFilters): string {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
        for (const id of filters[key]) {
            params.append(key, String(id));
        }
    }

    if (filters.search.trim() !== '') {
        params.set('search', filters.search.trim());
    }

    if (filters.favourites) {
        params.set('favourites', 'true');
    }

    return params.toString();
}

//Tick/untick one value: return new Params
export function toggleFilter(params: URLSearchParams, key: FilterKey, id: number): URLSearchParams {
    const next = new URLSearchParams(params);
    const current = next.getAll(key);
    const value = String(id);
    const updated = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];

    next.delete(key);
    updated.forEach((v) => next.append(key, v));
    return next;
}

export function countFilters(filters: RecipeFilters): number {
    return filters.cuisine.length + filters.meal.length + filters.course.length;
}
