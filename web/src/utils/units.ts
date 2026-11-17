
//Unit offered in the recipe form, grouped for the dropdown
//The Metric/US conversion issiue will extend this into a full units catalogue.
export const UNIT_GROUPS: { label: string, units: string[] }[] = [
    { label: 'US', units: ['tsp', 'tbsp', 'cup', 'fl oz', 'oz', 'lb'] },
    { label: 'Metric', units: ['ml', 'l', 'g', 'kg'] },
    { label: 'Other', units: ['clove', 'can', 'pinch', 'piece', 'slice', 'bunch'] },
];
