import { useEffect, useRef } from 'react';
import type { Categories, Category } from '../types/recipe';
import type { FilterKey, RecipeFilters } from '../utils/recipeFilters';

interface FilterPanelProps {
    open: boolean;
    categories: Categories | undefined;
    filters: RecipeFilters;
    resultCount: number | undefined;
    onToggle: (key: FilterKey, id: number) => void;
    onClear: () => void;
    onClose: () => void;
}

export function FilterPanel({ open, categories, filters, resultCount, onToggle, onClear, onClose }: FilterPanelProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    // Open/close the native dialog when "open" changes (same idea as ConfirmDialog)
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    const group = (legend: string, key: FilterKey, options: Category[]) => (
        <fieldset className="filter-group">
            <legend>{legend}</legend>
            {options.map((option) => (
                <label key={option.id} className="checkbox">
                    <input type="checkbox"
                        checked={filters[key].includes(option.id)}
                        onChange={() => onToggle(key, option.id)} />
                    {option.name}
                </label>
            ))}
        </fieldset>
    )

    return (
        <dialog ref={dialogRef} className="filter-drawer"
            onCancel={onClose}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} >
            <div className="drawer-header">
                <h2>Filters</h2>
                <button type="button" className="icon-button" aria-label="Close filters" onClick={onClose}>✕</button>
            </div>

            {!categories && <p className="status">Loading filters....</p>}
            {categories && (
                <div className="drawer-body">
                    {group('Cuisine', 'cuisine', categories.cuisines)}
                    {group('Meal', 'meal', categories.meals)}
                    { group('Course', 'course', categories.courses)}
                </div>
            )}

            <div className="drawer-footer">
                <button type="button" className="secondary" onClick={onClear}>Clear All</button>
                <button type="button" className="primary" onClick={onClose}>
                    {resultCount === undefined ? 'Show recipes' : `Show ${resultCount} recipe${resultCount === 1 ? '' : 's'}`}
                </button>
            </div>
        </dialog>
    );
}
