//Common cooking fractions, as Unicode characters
const FRACTIONS: [number, string][] = [
    [1 / 8, '⅛'],
    [1 / 4, '¼'],
    [1 / 3, '⅓'],
    [3 / 8, '⅜'],
    [1 / 2, '½'],
    [5 / 8, '⅝'],
    [2 / 3, '⅔'],
    [3 / 4, '¾'],
    [7 / 8, '⅞'],
];

//How close a decimal must be to a count as a that fraction (0.33 -> ⅓)
const TOLERANCE = 0.02;

/**
 * Formats a quantity the way recipes usually show it:
 * 0.5 → "½", 1.5 → "1½", 0.33 → "⅓", 2 → "2", 200 → "200", 0.4 → "0.4"
 */
export function formatQuantity(value: number): string {
    const whole = Math.floor(value);
    const remainder = value - whole;

    //Whole number (or close enough): no fractions needed
    if (remainder < TOLERANCE) return String(whole);
    if (1 - remainder < TOLERANCE) return String(whole + 1);

    //find matching common fraction
    const match = FRACTIONS.find(([fraction]) => Math.abs(remainder - fraction) < TOLERANCE);

    if (match) {
        const symbol = match[1];
        return whole > 0 ? `${whole}${symbol}` : symbol;

    }

    //No Common fraction fits (e.g. 0.4) show a tidy decimal
    return String(Math.round(value * 100) / 100);
}
