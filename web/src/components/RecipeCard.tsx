import { Link } from 'react-router';
import type { RecipeSummary } from '../types/recipe';
import { formatDuration } from '../utils/formatDuration';
import { CategoryChips } from './CategoryChips';
import { FavouriteButton } from './FavouriteButton';
import { Timer, UtensilsCrossed } from 'lucide-react';
interface RecipeCardProps{ recipe: RecipeSummary; }

export function RecipeCard({ recipe }: RecipeCardProps) {
    return (
        <article className="recipe-card">
            <div className="card-top">
                <h2>
                    <Link to={`/recipes/${recipe.id}`} className="card-link">{ recipe.title}</Link>
                </h2>
                <FavouriteButton recipeId={recipe.id} isFavourite={recipe.isFavourite} />
            </div>

            <p className="card-meta">
                {recipe.totalTime ? (
                    <span className="icon-text">
                        <Timer size={16} aria-hidden="true" />
                        <span className="visually-hidden">Total time </span>
                        {formatDuration(recipe.totalTime)}
                    </span>
                ) : null}
                <span className="icon-text">
                    <UtensilsCrossed size={16} aria-hidden="true" />
                    <span className="visually-hidden">Serves </span>
                    {recipe.servings}
                </span>
            </p>

            <CategoryChips names={ [recipe.cuisine, ...recipe.meals, ...recipe.courses]} />
        </article>
    );
}
