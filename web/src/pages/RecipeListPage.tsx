import { useQuery } from '@tanstack/react-query';
import { getRecipes } from '../api/recipes'
import { RecipeCard } from '../components/RecipeCard';

export function RecipeListPage() {
    const { data: recipes, isPending, isError, error } = useQuery({
        queryKey: ['recipes'],
        queryFn: getRecipes,
    });

    if (isPending) {
        return <p className="status">Loading recipes...</p>;
    }
    if (isError) {
        return <p className="status error"> Couldn't load recipes: {error.message}</p>;
    }
    if (recipes.length == 0) {
        return <p className="status">No recipes yet.</p>;
        }

    return (
        <section>
            <h1>Recipes</h1>
            <div className="recipe-grid">
                {recipes.map((recipe) => (
                    <RecipeCard key={recipe.id} recipe={recipe} />
                ))}
            </div>
        </section>
        )
}