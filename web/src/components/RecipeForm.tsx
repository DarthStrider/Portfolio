import { Link } from 'react-router';
import { useFieldArray, useForm, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import type { Recipe, RecipeRequest } from '../types/recipe';
import { UNIT_GROUPS } from '../utils/units';
import { groupBySection } from '../utils/groupBySection';


//What the form holds while the user types.
//Input always give back text, so numbers are string here and converted on Sumbit

interface IngredientRowValues {
    name: string;
    quantity: string;
    unit: string;
    note: string;
}

interface SectionValues {
    name: string;
    ingredients: IngredientRowValues[];
}

interface RecipeFormValues {
    title: string;
    description: string;
    servings: string;
    prepTime: string;
    cookTime: string;
    sourceUrl: string;
    sections: SectionValues[];
    steps: { text: string }[];
}

interface RecipeFormProps {
    initialRecipe?: Recipe;                        //given when editing
    submitLabel: string;                           //"Create recipe" / "Save changes"
    isSaving: boolean;                             //disables the button while saving
    cancelTo: string;
    onSubmit: (request: RecipeRequest) => void;    //the page decides what to do with it
}

//A fresh empty row / section (functions, so every call gives a new object)
const emptyIngredient = (): IngredientRowValues => ({ name: '', quantity: '', unit: '', note: '' });
const emptySection = (): SectionValues => ({ name: '', ingredients: [emptyIngredient()] });

export function RecipeForm({ initialRecipe, submitLabel, isSaving, cancelTo, onSubmit }: RecipeFormProps) {
    const {
        register,
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<RecipeFormValues>({ defaultValues: toFormValues(initialRecipe) });

    // Dynamic lists: each gives the rows plus add/remove/move helpers
    const sections = useFieldArray({ control, name: 'sections' });
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
                    <input type="number" min={1} max={100} {...register('servings', { required: 'Servings is required', min: { value: 1, message: 'At least 1' } })} />
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
                {sections.fields.map((field, index) => (
                    <IngredientSection
                        key={field.id}
                        index={index}
                        count={sections.fields.length}
                        control={control}
                        register={register}
                        errors={errors}
                        onMoveUp={() => sections.move(index, index - 1)}
                        onMoveDown={() => sections.move(index, index + 1)}
                        onRemove={() => sections.remove(index)}
                    />
                ))}
                <button type="button" className="secondary"
                    onClick={() => sections.append(emptySection(), { focusName: `sections.${sections.fields.length}.name` })}>                + Add Secion
                </button>
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
                                onClick={() => steps.remove(index)} disabled={steps.fields.length === 1}>✕</button>
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

interface IngredientSectionProps {
    index: number,
    count: number,
    control: Control<RecipeFormValues>;
    register: UseFormRegister<RecipeFormValues>;
    errors: FieldErrors<RecipeFormValues>;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}

function IngredientSection({ index, count, control, register, errors, onMoveUp, onMoveDown, onRemove }: IngredientSectionProps) {
    //Hooks can't be called inside .map() section gets its own component and its own field array
    const ingredients = useFieldArray({ control, name: `sections.${index}.ingredients` });
    const nameError = errors.sections?.[index]?.name;

    return (
        <div className="section-card">
            <div className="section-header">
                <input
                    className="section-name"
                    placeholder={count === 1 ? 'Section name (optional, ex. Cake)' : 'Section name, ex. Cake'}
                    aria-label={`Section ${index + 1} name`}
                    {...register(`sections.${index}.name`, {
                        maxLength: { value: 100, message: 'Section name can be at most 100 characters' },
                        validate: (value, values) => validateSectionName(value, values, index),
                    })} />
                {count > 1 && (
                    <div className="row-buttons">
                        <button type="button" className="icon-button" aria-label={`Move section ${index + 1} up`}
                            onClick={onMoveUp} disabled={index === 0}>↑</button>
                        <button type="button" className="icon-button" aria-label={`Move section ${index + 1} down`}
                            onClick={onMoveDown} disabled={index === count - 1}>↓</button>
                        <button type="button" className="icon-button" aria-label={`Remove section ${index + 1} `}
                            onClick={onRemove}>✕</button>
                    </div>
                )}
                 </div>
                {nameError && <span className="field-error">{nameError.message}</span>}

                {ingredients.fields.map((field, row) => (
                    <div key={field.id} className="ingredient-row">
                        <input type="number" step="any" min={0} placeholder="Qty" aria-label="Quantity"
                            {...register(`sections.${index}.ingredients.${row}.quantity`)} />
                        <select aria-label="Unit" {...register(`sections.${index}.ingredients.${row}.unit`)}>
                            <option value="">-</option>
                            {UNIT_GROUPS.map((group) => (
                                <optgroup key={group.label} label={group.label}>
                                    {group.units.map((unit) => (
                                        <option key={unit} value={unit}>{unit}</option>
                                    ))}
                                </optgroup>))}
                        </select>
                        <input placeholder="Ingredient" aria-label="Ingredient name"
                            {...register(`sections.${index}.ingredients.${row}.name`, { required: true })} />
                        <input placeholder="note" aria-label="Note"
                            {...register(`sections.${index}.ingredients.${row}.note`)} />
                        <div className="row-buttons">
                            <button type="button" className="icon-button" aria-label="Move ingredient up"
                                onClick={() => ingredients.move(row, row - 1)} disabled={row === 0}>↑</button>
                            <button type="button" className="icon-button" aria-label="Move ingredient down"
                                onClick={() => ingredients.move(row, row + 1)} disabled={row === ingredients.fields.length - 1}>↓</button>
                            <button type="button" className="icon-button" aria-label="Delete ingredient"
                                onClick={() => ingredients.remove(row)} disabled={ingredients.fields.length===1} >✕</button>
                        </div>

                    </div>
                ))}
                <button type="button" className="secondary" onClick={() => ingredients.append(emptyIngredient())}>+ Add Ingredient</button>
            </div>
    );
}

//Name rules: optional with one section, required and unique (ignoring case) with two or more
function validateSectionName(value: string, values: RecipeFormValues, index: number): string | true {
    const name = value.trim().toLowerCase();

    if (values.sections.length > 1 && name === '') {
        return 'Give each section a name when there is more than one.'
    }

    const isDuplicate = name !== '' && values.sections.some(
        (section, i) => i !== index && section.name.trim().toLowerCase() === name);
    return isDuplicate ? 'Another section already has this name' : true;
}

//Helpers: convert between the API shape and the form shape -----

//Recipe (from the API) -> form values. with no recipe, start with the one empty row each.
function toFormValues(recipe?: Recipe): RecipeFormValues {
    if (!recipe) {
        return {
            title: '', description: '', servings: '4', prepTime: '', cookTime: '', sourceUrl: '', sections: [emptySection()],
            steps: [{ text: '' }]
        };
    }
    return {
        title: recipe.title,
        description: recipe.description ?? '',
        servings: String(recipe.servings),
        prepTime: recipe.prepTime?.toString() ?? '',
        cookTime: recipe.cookTime?.toString() ?? '',
        sourceUrl: recipe.sourceUrl ?? '',
        sections: groupBySection(recipe.ingredients).map((group) => ({
            name: group.section ?? '',
            ingredients: group.lines.map((i) => ({
                name: i.name,
                quantity: i.quantity?.toString() ?? '',
                unit: i.unit ?? '',
                note: i.note ?? '',
            })),
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
        ingredients: values.sections.flatMap((section) =>
            section.ingredients.map((i) =>
            ({
                name: i.name.trim(),
                quantity: toQuantity(i.quantity),
                unit: toText(i.unit),
                note: toText(i.note),
                section: toText(section.name),
            }))),
        steps: values.steps.map((s) => ({ text: s.text.trim() })),
    };

}
