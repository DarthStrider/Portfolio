import { Link } from 'react-router';
import type { RecipeSummary } from '../types/recipe';
import { formatDuration } from '../utils/formatDuration';
import { CategoryChips } from './CategoryChips';

interface RecipeCardProps{ recipe: RecipeSummary; }

export function RecipeCard({ recipe }: RecipeCardProps) {
    return (
        <Link to={`/recipes/${recipe.id}`} className="recipe-card">
            <h2>{recipe.title}</h2>
            <p>
                Serves {recipe.servings}
                {recipe.totalTime ? ` · ${formatDuration(recipe.totalTime)}` : ''}
            </p>
            <CategoryChips names={[recipe.cuisine, ...recipe.meals, ...recipe.courses]} />
        </Link>
    );
}
