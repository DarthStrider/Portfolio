import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from 'react-router'
import { deleteRecipe, getRecipe } from '../api/recipes'
import { ApiError } from '../api/client'
import { formatDuration } from '../utils/formatDuration'
import { formatIngredient } from '../utils/formatIngredient'
import { NotFound } from '../components/NotFound';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { groupBySection } from '../utils/groupBySection';
import { CategoryChips } from '../components/CategoryChips';
import { listPath } from '../utils/listReturn';
import { FavouriteButton } from '../components/FavouriteButton';

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

    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [confirmOpen, setConfirmOpen] = useState(false);

    const deleteMutation = useMutation({
        mutationFn: () => deleteRecipe(recipeId),
        onSuccess: () => {
            queryClient.removeQueries({ queryKey: ['recipe', recipeId] });
            queryClient.invalidateQueries({ queryKey: ['recipes'] });
            navigate(listPath());
        }
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
                <Link to={ listPath()} className="back-link">← Back to recipes</Link>
                <div className="form-actions">
                    <Link to={`/recipes/${recipe.id}/edit`} className="button secondary">Edit</Link>
                    <button type="button" className="danger" onClick={() => setConfirmOpen(true)}>Delete</button>
                </div>
            </div>

            <ConfirmDialog
                open={confirmOpen}
                title={`Delete ${recipe.title}?`}
                message="This recipe will be permanently deleted. This can't be undone."
                confirmLabel="Delete"
                isWorking={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutate()}
                onCancel={() => setConfirmOpen(false)}
            />

            {deleteMutation.isError && (
                <p className="status error">Couldn't delete the recipe: {deleteMutation.error?.message}</p>)}

            <div className="title-row">
                <h1>{recipe.title}</h1>
                <FavouriteButton recipeId={recipe.id} isFavourite={recipe.isFavourite} />
            </div>

            {recipe.description && <p className="description">{recipe.description}</p>}

            <CategoryChips names={[
                recipe.cuisine?.name ?? null,
                ...recipe.meals.map((m) => m.name),
                ...recipe.courses.map((c) => c.name),
            ]} />

            <ul className="recipe-meta">
                <li> Serves: {recipe.servings}</li>
                {recipe.prepTime != null && <li>Prep Time: {formatDuration(recipe.prepTime)}</li>}
                {recipe.cookTime != null && <li>Cook Time: {formatDuration(recipe.cookTime)}</li>}
                {(recipe.prepTime ?? 0) > 0 && (recipe.cookTime ?? 0) > 0 && <li>Total Time: {formatDuration(totalTime)}</li>}
            </ul>

            <div className="recipe-body">
                <section>
                    <h2>Ingredients</h2>
                    {groupBySection(recipe.ingredients).map((group, groupIndex) => (
                        <div key={group.section ?? `group-${groupIndex}`} className="ingredient-group">
                            {group.section && <h3>{group.section}</h3>}
                            <ul className="ingredients">
                                {group.lines.map((line, lineIndex) => (
                                    <li key={`${line.name}-${lineIndex}`}>
                                        {formatIngredient(line)}
                                        {line.note && <span className="note">, {line.note}</span>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </section>

                <section>
                    <h2>Steps</h2>
                    <ol className="steps">
                        {recipe.steps.map((step) => (
                            <li key={step.stepNumber}>{step.text}</li>
                        ))}
                    </ol>
                </section>
            </div >

            {
                recipe.sourceUrl && (
                    <p className="source">
                        Source: <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">{recipe.sourceUrl}</a>
                    </p>
                )
            }

        </article >
    );
}
