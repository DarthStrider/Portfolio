import { Link } from 'react-router';
import type { RecipeSummary } from '../types/recipe';
import { formatDuration } from '../utils/formatDuration';
import { CategoryChips } from './CategoryChips';
import { FavouriteButton } from './FavouriteButton';

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
            <p>
                Servies {recipe.servings}
                {recipe.totalTime ? ` · ${formatDuration(recipe.totalTime)}` : ''}
            </p>
            <CategoryChips names={ [recipe.cuisine, ...recipe.meals, ...recipe.courses]} />
        </article>
    );
}
