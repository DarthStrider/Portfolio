import { Link } from 'react-router';
import type { RecipeSummary } from '../types/recipe'

interface RecipeCardProps{ recipe: RecipeSummary; }

export function RecipeCard({ recipe }: RecipeCardProps) {
    return (
        <Link to={`/recipes/${recipe.id}`} className="recipe-card">
            <h2>{recipe.title}</h2>
            <p>
                Serves {recipe.servings}
                {recipe.totalTime ? ` .${recipe.totalTime} min` : ''}
            </p>
        </Link>
    );
}