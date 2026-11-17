import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { getRecipe } from '../api/recipes'
import { ApiError } from '../api/client'
import { formatDuration } from '../utils/formatDuration'
import { formatIngredient } from '../utils/formatIngredient'
import { NotFound } from '../components/NotFound';

export function RecipeDetailPage() {
    //1. Read :id from URL
    const { id } = useParams();
    const recipeId = Number(id);

    //2. Fetch this recipe; each if is cached seperatly
    const { data: recipe, isPending, isError, error } = useQuery(
        {
            queryKey: ['recipe', recipeId],
            queryFn: () => getRecipe(recipeId),
            enabled: Number.isInteger(recipeId), //don't call the API for /recipes/abs
        });

    //3. Bad id the URL, ex. recipes/abc
    if (!Number.isInteger(recipeId)) {
        return <NotFound />;
    }

    if (isPending) {
        return <p className="status"> Loading recipe...</p>
    }

    if (isError) {
        //404 from API -> friendly "not found"; anything else -> real error
        if (error instanceof ApiError && error.status == 404) {
            return <NotFound />
        }
        return <p className="status error"> Couldn't load recipe: {error.message}</p>
    }

    //4. Total time only if at least prepTime or cookTime set
    const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0);

    return (
        <article className="recipe-detail">
            <div className="page-header">
                <Link to="/" className="back-link">← Back to recipes</Link>
                <Link to={`/recipes/${recipe.id}/edit`} className="button secondary">Edit</Link>
            </div>


            <h1>{recipe.title}</h1>
            {recipe.description && <p className="description">{recipe.description}</p>}

            <ul className="recipe-meta">
                <li> Serves: {recipe.servings}</li>
                {recipe.prepTime != null && <li>Prep Time: {formatDuration(recipe.prepTime)}</li>}
                {recipe.cookTime != null && <li>Cook Time: {formatDuration(recipe.cookTime)}</li>}
                {(recipe.prepTime ?? 0) > 0 && (recipe.cookTime ?? 0) > 0 && <li>Total Time: {formatDuration(totalTime)}</li>}
            </ul>

            <div className="recipe-body">
                <section>
                    <h2>Ingredients</h2>
                    <ul className="ingredients">
                        {recipe.ingredients.map((line) => (
                            <li key={line.name}>
                                {formatIngredient(line)}
                                {line.note && <span className="note">, {line.note}</span>}
                            </li>
                        ))}
                    </ul>
                </section>

                <section>
                    <h2>Steps</h2>
                    <ol className="steps">
                        {recipe.steps.map((step) => (
                            <li key={step.stepNumber}>{step.text}</li>
                        ))}
                    </ol>
                </section>
            </div>

            {recipe.sourceUrl && (
                <p className="source">
                    Source: <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">{ recipe.sourceUrl}</a>
                </p>
            )}

        </article>
    );
}
