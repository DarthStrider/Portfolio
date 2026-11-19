import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRecipes } from '../api/recipes'
import { getCategories } from '../api/categories';
import { RecipeCard } from '../components/RecipeCard';
import { FilterPanel } from '../components/FilterPanel';
import { countFilters, FILTER_KEYS, readFilters, toggleFilter, type FilterKey } from '../utils/recipeFilters';


export function RecipeListPage() {
    //1. Filters come from URL
    const [searchParams, setSearchParams] = useSearchParams();
    const filters = readFilters(searchParams);
    const activeCount = countFilters(filters);
    const [filtersOpen, setFiltersOpen] = useState(false);

    //2. Recipes for these filters.
    const { data: recipes, isPending, isError, error } = useQuery({
        queryKey: ['recipes', filters],
        queryFn: () => getRecipes(filters),
        placeholderData: keepPreviousData,
    })

    //3. Names from the filter panel and the active filter chips
    const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: Infinity });

    //replace: true -> ticking boxes does not fill the back history with every step
    const toggle = (key: FilterKey, id: number) => setSearchParams((prev) => toggleFilter(prev, key, id), { replace: true });
    const clearAll = () => setSearchParams({}, { replace: true });

    // Look up a chip's name from its id (e.g. meal 4 -> "Dinner")
    const nameOf = (key: FilterKey, id: number): string => {
        const lists = { cuisine: categories.data?.cuisines, meal: categories.data?.meals, course: categories.data?.courses };
        return lists[key]?.find((c) => c.id === id)?.name ?? `#${id}`;
    };

    if (isPending) {
        return <p className="status">Loading recipes....</p>
    }

    if (isError) {
        return <p className="status error">Couldn't load recipes: {error.message}</p>
    }

    //No recipes at all
    if (recipes.length === 0 && activeCount === 0) {
        return (
            <div className="status">
                <p> No Recipes yet.</p>
                <Link to="/recipes/new" className="button primary"> + Add your first recipe</Link>
            </div>
        );
    }
    return (
        <section>
            <div className="page-header">
                <h1>Recipes</h1>
                <div className="header-actions">
                    <button type="button" className="secondary" onClick={() => setFiltersOpen(true)}>
                        Filters{activeCount > 0 && ` (${activeCount})`}
                    </button>
                    <Link to="/recipes/new" className="button primary">+ Add recipe</Link>
                </div>
            </div>

            {/* Active filters: one chip each, × removes it */}
            {activeCount > 0 && (
                <div className="active-filters">
                    {FILTER_KEYS.flatMap((key) => filters[key].map((id) => (
                        <span key={`${key}-${id}`} className="chip removable">
                            {nameOf(key, id)}
                            <button type="button" aria-label={`Remove ${nameOf(key, id)} filter`}
                                onClick={() => toggle(key, id)}>×</button>
                        </span>
                    )))}
                    <button type="button" className="link-button" onClick={clearAll}>Clear all</button>
                </div>
            )}

            {recipes.length === 0 ? (
                <div className="status">
                    <p>No recipes match these filters.</p>
                    <button type="button" className="secondary" onClick={clearAll}>Clear filters</button>
                </div>
            ) : (
                <div className="recipe-grid">
                    {recipes.map((recipe) => (
                        <RecipeCard key={recipe.id} recipe={recipe} />
                    ))}
                </div>
            )}

            <FilterPanel
                open={filtersOpen}
                categories={categories.data}
                filters={filters}
                resultCount={recipes.length}
                onToggle={toggle}
                onClear={clearAll}
                onClose={() => setFiltersOpen(false)}
            />
        </section>
    );
}




