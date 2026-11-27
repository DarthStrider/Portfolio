import { useToggleFavourite } from '../hooks/useToggleFavourite';
import { Heart } from 'lucide-react';
interface FavouriteButtonProps {
    recipeId: number;
    isFavourite: boolean;
}

export function FavouriteButton({ recipeId, isFavourite }: FavouriteButtonProps) {
    const toggle = useToggleFavourite(recipeId);

    return (
        <button type="button" className={`favourite-button${isFavourite ? ' on' : ''}`}
            aria-pressed={isFavourite}
            aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => toggle.mutate(!isFavourite)}>
            <Heart size={22} fill={isFavourite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
    );
}
