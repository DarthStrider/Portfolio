import { formatQuantity } from './formatQuantity';
import { convertAmount } from './convertUnits';
import type { UnitSystem } from './units';
import type { RecipeIngredientLine } from '../types/recipe';

/**
 * "1½ cup flour", "2 eggs", "a pinch of salt", "a bunch of parsley", "salt"
 */
export function formatIngredient(line: RecipeIngredientLine, system: UnitSystem = 'original'): string {
    if (line.quantity != null) {
        const { quantity, unit } = line.unit ? convertAmount(line.quantity, line.unit, system) : { quantity: line.quantity, unit: null };
        const amount = formatQuantity(quantity);
        return unit ? `${amount} ${unit} ${line.name}` : `${amount} ${line.name}`;
    }

    // No quantity: "a pinch of salt", or just "salt"
    return line.unit ? `a ${line.unit} of ${line.name}` : line.name;
}
