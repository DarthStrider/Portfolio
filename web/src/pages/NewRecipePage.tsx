import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { createRecipe } from '../api/recipes';
import { RecipeForm } from '../components/RecipeForm';
import { FormErrors } from '../components/FormErrors';
import { listPath } from '../utils/listReturn';

export function NewRecipePage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: createRecipe,
        onSuccess: (created) => {
            //The list is now out of date: refetch it next time it's shown
            queryClient.invalidateQueries({ queryKey: ['recipes'] });
            // Go to the new recipe's page
            navigate(`/recipes/${created.id}`);
        }
    })

    return (
        <section>
            <Link to="/" className="back-link">← Back to recipes</Link>
            <h1>New recipe</h1>
            <FormErrors error={mutation.error} />
            <RecipeForm
                submitLabel="Create recipe"
                isSaving={mutation.isPending}
                onSubmit={(request) => mutation.mutate(request)}
                cancelTo={listPath()}
            />
        </section>
    );
}
