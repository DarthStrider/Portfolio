export type UnitKind = 'volume' | 'weight' | 'count';
export type UnitSystem = 'original' | 'metric' | 'us';

interface UnitInfo {
    kind: UnitKind;
    system: 'metric' | 'us' | null;
    toBase: number;
}

export const UNITS: Record<string, UnitInfo> = {
    //volume base = ml
    tsp: { kind: 'volume', system: 'us', toBase: 4.9292 },
    tbsp: { kind: 'volume', system: 'us', toBase: 14.787 },
    'fl oz': { kind: 'volume', system: 'us', toBase: 29.574 },
    cup: { kind: 'volume', system: 'us', toBase: 236.588 },
    ml: { kind: 'volume', system: 'metric', toBase: 1 },
    l: { kind: 'volume', system: 'metric', toBase: 1000 },

    //Weight, base = g
    oz: { kind: 'weight', system: 'us', toBase: 28.35 },
    lb: { kind: 'weight', system: 'us', toBase: 453.592 },
    g: { kind: 'weight', system: 'metric', toBase: 1 },
    kg: { kind: 'weight', system: 'metric', toBase: 1000 },

    //Counts never converted
    clove: { kind: 'count', system: null, toBase: 0 },
    can: { kind: 'count', system: null, toBase: 0 },
    pinch: { kind: 'count', system: null, toBase: 0 },
    piece: { kind: 'count', system: null, toBase: 0 },
    slice: { kind: 'count', system: null, toBase: 0 },
    bunch: { kind: 'count', system: null, toBase: 0 },
};

//Other spellings peeople (and imported recipes) use -> the cataglogue name
// Other spellings people (and imported recipes) use -> the catalogue name
const ALIASES: Record<string, string> = {
    teaspoon: 'tsp', teaspoons: 'tsp',
    tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
    cups: 'cup',
    'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
    ounce: 'oz', ounces: 'oz',
    pound: 'lb', pounds: 'lb', lbs: 'lb',
    gram: 'g', grams: 'g',
    kilogram: 'kg', kilograms: 'kg',
    milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml',
    liter: 'l', litre: 'l', liters: 'l', litres: 'l',
    cloves: 'clove', cans: 'can', pinches: 'pinch', pieces: 'piece', slices: 'slice', bunches: 'bunch',
};

//Tablespoons -> tbsp; uknown units come back lowercased and trimmed
export function normalizeUnit(unit: string): string {
    const key = unit.trim().toLocaleLowerCase();
    return ALIASES[key] ?? key;
}

const PLURALS: Record<string, string> = {
    cup: 'cups',
    pinch: 'pinches',
    bunch: 'bunches',
    clove: 'cloves',
    can: 'cans',
    piece: 'pieces',
    slice: 'slices'
}

export function pluralizeUnit(unit: string): string {
    return PLURALS[normalizeUnit(unit)] ?? unit;
}

//Units offered in the recipe form, grouped for the dropdown
export const UNIT_GROUPS: { label: string; units: string[] }[] = [
    { label: 'US', units: ['tsp', 'tbsp', 'cup', 'fl oz', 'oz', 'lb' ]},
    { label: 'Metric', units: ['ml', 'l', 'g', 'kg'] },
    {label: 'Oher', units: ['clove', 'can', 'pinch', 'piece', 'slice', 'bunch']}
]
 

