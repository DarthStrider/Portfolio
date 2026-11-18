import type { RecipeIngredientLine } from '../types/recipe';

export interface IngredientGroup {
    section: string | null;
    lines: RecipeIngredientLine[];
}

/**
 * Groups ingredient lines by section, in order of first appearance.
 */
export function groupBySection(lines: RecipeIngredientLine[]): IngredientGroup[] {
    const groups: IngredientGroup[] = [];

    for (const line of lines) {
        const key = line.section?.trim().toLowerCase() || null;
        let group = groups.find((g) => (g.section?.toLowerCase() ?? null) === key);

        if (!group) {
            group = { section: line.section?.trim() || null, lines: [] };
            groups.push(group);
        }

        group.lines.push(line);
    }

    return groups;
}
