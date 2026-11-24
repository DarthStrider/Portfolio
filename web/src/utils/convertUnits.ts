import { normalizeUnit, UNITS, type UnitSystem } from './units';

export interface Amount {
    quantity: number,
    unit: string
}

export interface Density {
    gramsPerCup: number;
    preferWeight: boolean;
}
/**
 * Converts an amount for display. Original mode, count units, unknown units
 * and amounts already in the chosen system come back unchanged.
 *   1.5 cup  -> metric -> 355 ml
 *   200 g    -> us     -> 7 oz
 *   1200 g   -> metric -> unchanged (already metric)
 *   6 clove  -> any    -> unchanged
 */
export function convertAmount(quantity: number, unit: string, system: UnitSystem, density?: Density| null): Amount {
    const unchanged = { quantity, unit };
    if (system === 'original') return unchanged;

    const info = UNITS[normalizeUnit(unit)];
    if (!info || info.kind === 'count' || info.system === system) return unchanged;

    // 1. To the base unit (ml or g)
    const base = quantity * info.toBase;

    if (density) {
        if (system === 'metric' && info.kind === 'volume' && density.preferWeight) {
            const grams = (base / UNITS.cup.toBase) * density.gramsPerCup;
            return toTarget(grams, 'weight', system);
        }
        if (system === 'us' && info.kind === 'weight') {
            const ml = (base / density.gramsPerCup) * UNITS.cup.toBase;
            return toTarget(ml, 'volume', system);
        }
    }

    return toTarget(base, info.kind, system);
}

function toTarget(base: number, kind: 'volume' | 'weight', system: 'metric' | 'us'): Amount {
    const target = pickTarget(base, kind, system);
    const value = base / UNITS[target].toBase;
    return { quantity: system === 'metric' ? roundMetric(value, target) : roundUs(value, target), unit: target }
}

function pickTarget(base: number, kind: 'volume' | 'weight', system: 'metric' | 'us') {
    if (system === 'metric') {
        if (kind === 'volume') {
            return base >= 1000 ? 'l' : 'ml';
        }
        return base >= 1000 ? 'kg' : 'g';
    }
    if (kind === 'volume') {
        if (base >= UNITS.cup.toBase / 4) return 'cup';
        if (base >= UNITS.tbsp.toBase) return 'tbsp';
        return 'tsp';
    }
    return base >= UNITS.lb.toBase ? 'lb' : 'oz';
}

function roundMetric(value: number, unit: string): number {
    if (unit === 'l' || unit === 'kg') return Math.round(value * 100) / 100;
    if (value >= 10) return Math.round(value/5) * 5;
    return Math.round(value * 2) / 2;
}

function roundUs(value: number, unit: string): number {
    if (unit === 'oz') return Math.round(value * 2) / 2;
    if (value >= 10) return Math.round(value);

    const whole = Math.floor(value);
    const fractions = [0, 1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 5 / 8, 2 / 3, 3 / 4, 7 / 8, 1];
    const nearest = fractions.reduce((best, f) =>
        Math.abs(value - whole - f) < Math.abs(value - whole - best) ? f : best);
    return whole + nearest;
}
