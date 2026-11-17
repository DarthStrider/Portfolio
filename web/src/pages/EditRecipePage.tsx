import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { getRecipe, updateRecipe } from '../api/recipes';
import type { RecipeRequest } from '../types/recipe';
import { RecipeForm } from '../components/RecipeForm';
import { FormErrors } from '../components/FormErrors';
import { NotFound } from '../components/NotFound';
export function EditRecipePage() {
    const { id } = useParams();
    const recipeId = Number(id);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    //Load the recipe to pre-fill the form (same cache key as the detail page)
    const { data: recipe, isPending, isError } = useQuery({
        queryKey: ['recipe', recipeId],
        queryFn: () => getRecipe(recipeId),
        enabled: Number.isInteger(recipeId),
    });

    const mutation = useMutation({
        mutationFn: (request: RecipeRequest) => updateRecipe(recipeId, request),
        onSuccess: () => {
            //Both the list and this recipe changed
            queryClient.invalidateQueries({ queryKey: ['recipes'] });
            queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
            navigate(`/recipes/${recipeId}`);
        },
    });

    if (!Number.isInteger(recipeId) || isError) {
        return <NotFound />
    }

    if (isPending) {
        return <p className="status">Loading recipe...</p>;
    }

    return (
        <section>
            <Link to={`/recipes/${recipeId}`} className="back-link">← Back to recipes</Link>
            <h1> Edit recipe</h1>
            <FormErrors error={mutation.error} />
            <RecipeForm
                initialRecipe={recipe}
                submitLabel="Save changes"
                isSaving={mutation.isPending}
                onSubmit={(request) => mutation.mutate(request)}
                cancelTo={ `/recipes/${recipeId}`}
            />
        </section>
    );
}
