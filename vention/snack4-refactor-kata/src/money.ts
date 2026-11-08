/**
 * Rounds to the cent. This is exactly the legacy formula, so every result stays
 * identical; that's what the old "DO NOT TOUCH THE ROUNDING" comment protects.
 * (Rounding half-cents of floating-point values isn't perfect; changing it would
 * be a behaviour change for finance to sign off, not part of a refactor.)
 */
export function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}
