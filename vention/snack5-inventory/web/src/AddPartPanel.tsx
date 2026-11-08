import { useState, type FormEvent } from "react";
import { api, type Category, type Part } from "./api";

const CATEGORIES: { id: Category; unit: string; prefix: string; example: string }[] = [
  { id: "extrusion", unit: "bar (3 m)", prefix: "BAR-", example: "BAR-2040-CLR" },
  { id: "plate", unit: "plate", prefix: "PL-", example: "PL-400" },
  { id: "fastener", unit: "pack of 50", prefix: "", example: "M8-BOLT" },
  { id: "motor", unit: "piece", prefix: "SRV-", example: "SRV-750" },
  { id: "actuator", unit: "piece", prefix: "LA-", example: "LA-500" },
  { id: "controller", unit: "piece", prefix: "MC-", example: "MC-2" },
  { id: "gripper", unit: "piece", prefix: "GR-", example: "GR-2" },
];
const UNITS = ["piece", "plate", "bar (3 m)", "pack of 50", "pack of 100", "metre"];
const SKU = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

interface Props {
  existing: Part[];
  onCreated: (part: Part) => void;
  onCancel: () => void;
}

/** Form for a new part. Checks what it can before sending; the API checks everything again. */
export function AddPartPanel({ existing, onCreated, onCancel }: Props) {
  const [category, setCategory] = useState<Category>("plate");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("plate");
  const [unitTouched, setUnitTouched] = useState(false);
  const [onHand, setOnHand] = useState("0");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const meta = CATEGORIES.find((c) => c.id === category)!;
  const skuTaken = existing.some((p) => p.sku === sku);
  const skuBad = sku !== "" && !SKU.test(sku);

  function pickCategory(c: Category) {
    setCategory(c);
    // Suggest the usual unit for the category, unless the user already chose one.
    if (!unitTouched) setUnit(CATEGORIES.find((x) => x.id === c)!.unit);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblems([]);
    try {
      const part = await api.createPart({
        sku, name, category, unit, location,
        onHand: Number(onHand), reorderLevel: Number(reorderLevel),
      });
      onCreated(part);
    } catch (err) {
      const body = (err as { body?: { problems?: string[] } }).body;
      setProblems(body?.problems ?? [(err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel" aria-label="Add a part">
      <div className="panel-head">
        <div>
          <p className="eyebrow">New part</p>
          <h2>Add to inventory</h2>
          <p className="muted">Saved to the database straight away. Starting stock is logged as a receipt.</p>
        </div>
        <button className="ghost" onClick={onCancel} aria-label="Close">✕</button>
      </div>

      <form className="addpart" onSubmit={submit}>
        <fieldset className="cats">
          <legend>Category</legend>
          {CATEGORIES.map((c) => (
            <button type="button" key={c.id} className={c.id === category ? "cat on" : "cat"} aria-pressed={c.id === category} onClick={() => pickCategory(c.id)}>
              {c.id}
            </button>
          ))}
        </fieldset>

        <label className="full">
          SKU
          <input value={sku} required maxLength={32} placeholder={`e.g. ${meta.example}`} autoFocus
            onChange={(e) => setSku(e.target.value.toUpperCase().replace(/\s+/g, "-"))}
            aria-invalid={skuTaken || skuBad} className="mono" />
          {skuTaken && <span className="field-error">{sku} already exists</span>}
          {skuBad && <span className="field-error">Capital letters, digits and dashes only, 2–32 characters</span>}
          {!sku && meta.prefix && <span className="hint">Parts like this usually start with {meta.prefix}</span>}
        </label>

        <label className="full">
          Name
          <input value={name} required maxLength={80} placeholder="e.g. Mounting plate, 400 mm" onChange={(e) => setName(e.target.value)} />
        </label>

        <label>
          Unit
          <input value={unit} required maxLength={30} list="units" onChange={(e) => { setUnit(e.target.value); setUnitTouched(true); }} />
          <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </label>
        <label>
          Bin location
          <input value={location} maxLength={20} placeholder="e.g. B-01-4" className="mono" onChange={(e) => setLocation(e.target.value.toUpperCase())} />
        </label>
        <label>
          Starting stock
          <input type="number" min={0} max={100000} step={1} required value={onHand} onChange={(e) => setOnHand(e.target.value)} />
        </label>
        <label>
          Reorder at
          <input type="number" min={0} max={100000} step={1} required value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
        </label>

        {Number(onHand) <= Number(reorderLevel) && name && (
          <p className="banner warn full">This part will show as low stock straight away.</p>
        )}
        {problems.length > 0 && (
          <div className="banner error full">
            {problems.length === 1 ? problems[0] : <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        )}

        <div className="buttons full">
          <button type="submit" disabled={busy || skuTaken || skuBad}>Add part</button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </aside>
  );
}
