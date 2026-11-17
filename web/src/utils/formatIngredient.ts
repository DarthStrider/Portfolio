import { formatQuantity } from './formatQuantity';
import type { RecipeIngredientLine } from '../types/recipe';

/**
 * "1½ cup flour", "2 eggs", "a pinch of salt", "a bunch of parsley", "salt"
 */
export function formatIngredient(line: RecipeIngredientLine): string {
    if (line.quantity != null) {
        const amount = formatQuantity(line.quantity);
        return line.unit ? `${amount} ${line.unit} ${line.name}` : `${amount} ${line.name}`;
    }

    // No quantity: "a pinch of salt", or just "salt"
    return line.unit ? `a ${line.unit} of ${line.name}` : line.name;
}
