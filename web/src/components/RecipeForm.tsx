import { Link } from 'react-router';
import { useFieldArray, useForm } from 'react-hook-form';
import type { Recipe, RecipeRequest } from '../types/recipe';
import { UNIT_GROUPS } from '../utils/units';


//What the form holds while the user types.
//Input always give back text, so numbers are string here and converted on Sumbit
interface RecipeFormValues {
    title: string;
    description: string;
    servings: string;
    prepTime: string;
    cookTime: string;
    sourceUrl: string;
    ingredients: { name: string; quantity: string; unit: string; note: string; }[];
    steps: { text: string }[];
}

interface RecipeFormProps {
    initialRecipe?: Recipe;                        //given when editing
    submitLabel: string;                           //"Create recipe" / "Save changes"
    isSaving: boolean;                             //disables the button while saving
    cancelTo: string;
    onSubmit: (request: RecipeRequest) => void;    //the page decides what to do with it
}

export function RecipeForm({ initialRecipe, submitLabel, isSaving, cancelTo, onSubmit }: RecipeFormProps) {
    const {
        register,
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<RecipeFormValues>({ defaultValues: toFormValues(initialRecipe) });

    // Dynamic lists: each gives the rows plus add/remove/move helpers
    const ingredients = useFieldArray({ control, name: 'ingredients' });
    const steps = useFieldArray({ control, name: 'steps' });

    return (
        <form className="recipe-form" onSubmit={handleSubmit((values) => onSubmit(toRequest(values)))}>
            {/* ------------------ Basics ------------------- */}
            <label>
                Title
                <input {...register('title', { required: 'Title is required', maxLength: 200 })} />
                {errors.title && <span className="field-error">{errors.title.message}</span>}
            </label>

            <label>
                Description
                <textarea rows={3} {...register('description', { maxLength: 1000 })} />
            </label>

            <div className="form-row">
                <label>
                    Serviing
                    <input type="number" min={1} max={100} {...register('servings', { required: 'Serving is required', min: { value: 1, message: 'At least 1' } })} />
                </label>
                <label>
                    Prep (min)
                    <input type="number" min={0} {...register('prepTime')} />
                </label>
                <label>
                    Cook (min)
                    <input type="number" min={0} {...register('cookTime')} />
                </label>
            </div>

            <label>
                Source URL
                <input type="url" placeholder="https://..." {...register('sourceUrl')} />
            </label>

            {/*----------------------- Ingredients ------------------------------------- */}
            <fieldset>
                <legend>Ingredients</legend>
                {ingredients.fields.map((field, index) => (
                    <div key={field.id} className="ingredient-row">
                        <input type="number" step="any" min={0} placeholder="Qty" aria-label="Quantity"
                            {...register(`ingredients.${index}.quantity`)} />
                        <select aria-label="Unit" {...register(`ingredients.${index}.unit`)}>
                            <option value="">-</option>
                            {UNIT_GROUPS.map((group) => (
                                <optgroup key={group.label} label={group.label}>
                                    {group.units.map((unit) => (
                                        <option key={unit} value={unit}>{unit}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                        <input placeholder="Ingredient" aria-label="Ingredient Name"
                            {...register(`ingredients.${index}.name`, { required: true })} />
                        <input placeholder="Note (optional)" aria-label="Note"
                            {...register(`ingredients.${index}.note`)} />
                        <div className="row-buttons">
                            <button type="button" className="icon-button" aria-label="Move ingredient up"
                                onClick={() => ingredients.move(index, index - 1)} disabled={index === 0}>↑</button>
                            <button type="button" className="icon-button" aria-label="Move ingredient down"
                                onClick={() => ingredients.move(index, index + 1)}
                                disabled={index === ingredients.fields.length - 1}>↓</button>
                            <button type="button" className="icon-button" aria-label="Remove ingredient"
                                onClick={() => ingredients.remove(index)}
                                disabled={ingredients.fields.length === 1}>✕</button>
                        </div>
                    </div>
                ))}
                <button type="button" className="secondary"
                    onClick={() => ingredients.append({ name: '', quantity: '', unit: '', note: '' })}>+ Add Ingredient</button>
            </fieldset>

            {/* ----------------------------- Steps -------------------------------- */}

            <fieldset>
                <legend>Steps</legend>
                {steps.fields.map((field, index) => (
                    <div key={field.id} className="step-row">
                        <span className="step-number">{index + 1}</span>
                        <textarea rows={2} aria-label={`Step ${index + 1}`}
                            {...register(`steps.${index}.text`, { required: true })} />
                        <div className="step-buttons">
                            <button type="button" className="icon-button" aria-label="Move up"
                                onClick={() => steps.move(index, index - 1)} disabled={index === 0}>↑</button>
                            <button type="button" className="icon-button" aria-label="Move down"
                                onClick={() => steps.move(index, index + 1)} disabled={index === steps.fields.length - 1}>↓</button>
                            <button type="button" className="icon-button" aria-label="Remove step"
                                onClick={() => steps.remove(index)} disabled={steps.fields.length === 1}>X</button>
                        </div>
                    </div>
                ))}
                <button type="button" className="secondary" onClick={() => steps.append({ text: '' })}>
                    + Add step
                </button>
            </fieldset>
            <div className="form-actions">
                <button type="submit" className="primary" disabled={isSaving}>
                    {isSaving ? 'Saving...' : submitLabel}
                </button>
                <Link to={cancelTo} className="button secondary">Cancel</Link>
            </div>
        </form>
    );
}


//Helpers: convert between the API shape and the form shape -----

//Recipe (from the API) -> form values. with no recipe, start with the one empty row each.
function toFormValues(recipe?: Recipe): RecipeFormValues {
    if (!recipe) {
        return {
            title: '', description: '', servings: '4', prepTime: '', cookTime: '', sourceUrl: '',
            ingredients: [{ name: '', quantity: '', unit: '', note: '' }],
            steps: [{ text: '' }]
        };
    }
    return {
        title: recipe.title,
        description: recipe.description ?? '',
        servings: String(recipe.servings),
        prepTime: recipe.prepTime?.toString() ?? '',
        cookTime: recipe.cookTime?.toString() ?? '',
        sourceUrl: recipe.sourceUrl?.toString() ?? '',
        ingredients: recipe.ingredients.map((i) => ({
            name: i.name,
            quantity: i.quantity?.toString() ?? '',
            unit: i.unit ?? '',
            note: i.note ?? '',
        })),
        steps: recipe.steps.map((s) => ({ text: s.text }))
    };
}

//Form values -> the request the API expects (empty text becomes null, text becomes numbers)
function toRequest(values: RecipeFormValues): RecipeRequest {
    const toNumber = (text: string) => (text.trim() === '' ? null : Number(text));
    const toText = (text: string) => (text.trim() === '' ? null : text.trim());

    // NEW: empty, 0 or negative quantity → null ("a pinch of salt", "salt to taste")
    const toQuantity = (text: string) => {
        const value = Number(text);
        return text.trim() === '' || value <= 0 ? null : value;
    };

    return {
        title: values.title.trim(),
        description: toText(values.description),
        servings: Number(values.servings),
        prepTime: toNumber(values.prepTime),
        cookTime: toNumber(values.cookTime),
        sourceUrl: toText(values.sourceUrl),
        ingredients: values.ingredients.map((i) => ({
            name: i.name.trim(),
            quantity: toQuantity(i.quantity),
            unit: toText(i.unit),
            note: toText(i.note)
        })),
        steps: values.steps.map((s) => ({ text: s.text.trim() })),
    };

}
