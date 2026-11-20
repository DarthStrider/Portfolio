import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addFavourite, removeFavourite } from '../api/recipes';
import type { Recipe, RecipeSummary } from '../types/recipe';


//Toggle favourites with optimisitc update
export function useToggleFavourite(recipeId: number) {

    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (makeFavourite: boolean) =>
            makeFavourite ? addFavourite(recipeId) : removeFavourite(recipeId),

        onMutate: async (makeFavourite: boolean) => {
            await queryClient.cancelQueries({ queryKey: ['recipes'] });
            await queryClient.cancelQueries({ queryKey: ['recipe', recipeId] });

            const previousLists = queryClient.getQueriesData<RecipeSummary[]>({ queryKey: ['recipes'] });
            const previousRecipe = queryClient.getQueryData<Recipe>(['recipe', recipeId]);

            queryClient.setQueriesData<RecipeSummary[]>({ queryKey: ['recipes'] }, (old) =>
                old?.map((r) => (r.id === recipeId ? { ...r, isFavourite: makeFavourite } : r)));
            queryClient.setQueryData<Recipe>(['recipe', recipeId], (old) => old ?
                { ...old, isFavourite: makeFavourite } : old);

            return { previousLists, previousRecipe };
        },
        onError: (_error, _makeFavourite, context) => {
            context?.previousLists.forEach(([key, data]) => queryClient.setQueryData(key, data));
            if (context?.previousRecipe) {
                queryClient.setQueryData(['recipe', recipeId], context.previousRecipe);
            }
        },

        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['recipes'] });
            queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
        }
    });
}
