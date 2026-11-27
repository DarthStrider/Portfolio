import { formatQuantity } from './formatQuantity';
import { convertAmount, tidyAmount } from './convertUnits';
import { pluralizeUnit, type UnitSystem } from './units';
import type { RecipeIngredientLine } from '../types/recipe';

/**
 * "1½ cup flour", "2 eggs", "a pinch of salt", "a bunch of parsley", "salt"
 */
export function formatIngredient(line: RecipeIngredientLine, system: UnitSystem = 'original', factor = 1): string {
    if (line.quantity != null) {
        const scaled = line.quantity * factor;

        let quantity = scaled;
        let unit: string | null = null;

        if (line.unit) {
            const density = line.gramsPerCup != null ? { gramsPerCup: line.gramsPerCup, preferWeight: line.preferWeight ?? false } : null;
            const converted = convertAmount(scaled, line.unit, system, density);
            const tidied = factor !== 1 && converted.unit === line.unit ? tidyAmount(converted.quantity, converted.unit) : converted;

            quantity = tidied.quantity;
            unit = tidied.unit;
        }
        const amount = formatQuantity(quantity);
        const shownUnit = unit && quantity > 1 && amount !== '1' ? pluralizeUnit(unit) : unit;
        return shownUnit ? `${amount} ${shownUnit} ${line.name}` : `${ amount} ${ line.name}`;
    }
    return line.unit ? `a ${line.unit} of ${line.name}` : line.name;
}
