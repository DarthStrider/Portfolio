import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router'
import { deleteRecipe, getRecipe } from '../api/recipes'
import { ApiError } from '../api/client'
import { formatDuration } from '../utils/formatDuration'
import { formatIngredient } from '../utils/formatIngredient'
import { NotFound } from '../components/NotFound';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { groupBySection } from '../utils/groupBySection';
import { CategoryChips } from '../components/CategoryChips';
import { listPath } from '../utils/listReturn';
import { useUnitSystem } from '../hooks/useUnitSystem';
import type { UnitSystem } from '../utils/units';
import { FavouriteButton } from '../components/FavouriteButton';
import { useOvenScale } from '../hooks/useOvenScale';
import { formatOvenTemperature, formatStepTemperatures, type OvenScale } from '../utils/temperature';
import { formatQuantity } from '../utils/formatQuantity';

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
    const [unitSystem, setUnitSystem] = useUnitSystem();
    const [ovenScale, setOvenScale] = useOvenScale();
    const [searchParams, setSearchParams] = useSearchParams();

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

    //Scaling
    const requested = Number(searchParams.get('servings'));
    const servings = Number.isInteger(requested * 2) && requested >= 0.5 && requested <= 100 ? requested : recipe.servings;
    const factor = servings / recipe.servings;

    //Change Servings
    const setServings = (next: number) => {
        const clamped = Math.min(100, Math.max(0.5, Math.round(next * 2) / 2));   // steps of ½, from ½ to 100        
        setSearchParams((prev) => {
            const params = new URLSearchParams(prev);
            if (clamped === recipe.servings) params.delete('servings');
            else params.set('servings', String(clamped));
            return params;
        }, { replace: true });
    };

    return (
        <article className="recipe-detail">
            <div className="page-header">
                <Link to={listPath()} className="back-link">← Back to recipes</Link>
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
                <li> Serves: {formatQuantity(servings)}</li>
                {recipe.prepTime != null && <li>Prep Time: {formatDuration(recipe.prepTime)}</li>}
                {recipe.cookTime != null && <li>Cook Time: {formatDuration(recipe.cookTime)}</li>}
                {(recipe.prepTime ?? 0) > 0 && (recipe.cookTime ?? 0) > 0 && <li>Total Time: {formatDuration(totalTime)}</li>}
                {recipe.ovenTemperature != null && recipe.ovenTemperatureUnit && (<li>Bake: {formatOvenTemperature(recipe.ovenTemperature, recipe.ovenTemperatureUnit, ovenScale)}</li>)}
            </ul>

            <div className="recipe-body">
                <section>
                    <div className="ingredients-header">
                        <h2>Ingredients</h2>
                        <div className="unit-toggle" role="group" aria-label="Units">
                            {(['original', 'metric', 'us'] as UnitSystem[]).map((s) => (
                                <button key={s} type="button"
                                    className={unitSystem === s ? 'on' : ''}
                                    aria-pressed={unitSystem === s}
                                    onClick={() => setUnitSystem(s)}>
                                    {s === 'original' ? 'Original' : s === 'metric' ? 'Metric' : 'US'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="scale-controls">
                        <div className="servings-stepper">
                            <span>Serves</span>
                            <button type="button" className="icon-button" aria-label="Fewer servings"
                                onClick={() => setServings(servings - 1)} disabled={servings <= 0.5}>−</button>
                            <span className="servings-count" aria-live="polite">{formatQuantity(servings)}</span>
                            <button type="button" className="icon-button" aria-label="More servings"
                                onClick={() => setServings(servings + 1)} disabled={servings >= 100}>+</button>
                        </div>

                        <div className="unit-toggle" role="group" aria-label="Scale recipe">
                            {[0.5, 1, 2, 3].map((s) => (
                                <button key={s} type="button"
                                    className={factor === s ? 'on' : ''}
                                    aria-pressed={factor === s}
                                    disabled={recipe.servings * s > 100}
                                    onClick={() => setServings(recipe.servings * s)}>
                                    {s === 0.5 ? '½×' : `${s}×`}
                                </button>
                            ))}
                        </div>
                    </div>

                    {factor !== 1 && (
                        <p className="scale-note">
                            Scaled from {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'} ·{' '}
                            <button type="button" className="link-button" onClick={() => setServings(recipe.servings)}>
                                Reset
                            </button>
                        </p>)}

                    {groupBySection(recipe.ingredients).map((group, groupIndex) => (
                        <div key={group.section ?? `group-${groupIndex}`} className="ingredient-group">
                            {group.section && <h3>{group.section}</h3>}
                            <ul className="ingredients">
                                {group.lines.map((line, lineIndex) => (
                                    <li key={`${line.name}-${lineIndex}`}>
                                        {formatIngredient(line, unitSystem, factor)}
                                        {line.note && <span className="note">, {line.note}</span>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </section>

                <section>
                    <div className="panel-header">
                        <h2>Steps</h2>
                        <div className="unit-toggle" role="group" aria-label="Oven temperature">
                            {(['original', 'F', 'C'] as OvenScale[]).map((s) => (
                                <button key={s} type="button"
                                    className={ovenScale === s ? 'on' : ''}
                                    aria-pressed={ovenScale === s}
                                    onClick={() => setOvenScale(s)}>
                                    {s === 'original' ? 'As written' : `°${s}`}
                                </button>))}
                        </div>
                    </div>

                    {factor !== 1 && (
                        <p className="scale-hint">
                            Scaled recipe: cooking times, pan sizes and oven temperatures aren't changed and may need adjusting.
                        </p>
                    )}

                    <ol className="steps">
                        {recipe.steps.map((step) => (
                            <li key={step.stepNumber}>{formatStepTemperatures(step.text, ovenScale)}</li>
                        ))}
                    </ol>
                </section>
            </div>
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
