import { useToggleFavourite } from '../hooks/useToggleFavourite';

interface FavouriteButtonProps {
    recipeId: number;
    isFavourite: boolean;
}

export function FavouriteButton({ recipeId, isFavourite }: FavouriteButtonProps) {
    const toggle = useToggleFavourite(recipeId);

    return (
        <button type="button" className={`favourite-button${isFavourite ? ' on' : ''}`}
            aria-aria-pressed={isFavourite}
            aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => toggle.mutate(!isFavourite)}>
            {isFavourite ? '♥' : '♡'}
        </button>
    );
}
