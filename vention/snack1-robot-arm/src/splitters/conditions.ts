/**
 * Editing conditions, shared by the splitters' rules and the robots' rules: one row of
 * "field · comparison · value" per condition, and turning what's typed into what the API stores.
 * Sizes are meters in the API and centimeters on screen.
 */
import { FIELDS, OP_LABEL, OPS, type Condition, type Field } from "./types";

export const IN_CM = new Set<Field>(["width", "height", "depth"]);

/**
 * One condition's row. data-r is the rule, data-c the condition, data-k what's being changed;
 * `attr` keeps two editors on the page apart (the robots use data-rr).
 */
export function conditionRow(c: Condition, r: number, i: number, attr = "data-r"): string {
  const type = FIELDS[c.field].type;
  const fieldSel = `<select ${attr}="${r}" data-c="${i}" data-k="field" aria-label="Field">${(Object.keys(FIELDS) as Field[])
    .map((f) => `<option value="${f}" ${f === c.field ? "selected" : ""}>${FIELDS[f].label}</option>`).join("")}</select>`;
  const opSel = `<select ${attr}="${r}" data-c="${i}" data-k="op" aria-label="Comparison">${OPS[type]
    .map((o) => `<option value="${o}" ${o === c.op ? "selected" : ""}>${OP_LABEL[o]}</option>`).join("")}</select>`;
  const attrs = `${attr}="${r}" data-c="${i}" data-k="value" aria-label="Value"`;
  let input: string;
  if (type === "boolean") {
    input = `<select ${attrs}><option value="true" ${c.value === true ? "selected" : ""}>yes</option><option value="false" ${c.value === false ? "selected" : ""}>no</option></select>`;
  } else if (type === "number") {
    const v = IN_CM.has(c.field) ? Math.round(Number(c.value) * 1000) / 10 : Number(c.value);
    input = `<input type="number" step="any" value="${v}" ${attrs}>`;
  } else if (c.field === "color" && (c.op === "eq" || c.op === "ne")) {
    input = `<input type="color" value="${esc(String(c.value))}" ${attrs}>`;
  } else {
    const list = { kind: "dl-kind", "part.category": "dl-category", sku: "dl-sku", "part.location": "dl-location" }[c.field as string];
    const v = Array.isArray(c.value) ? c.value.join(", ") : String(c.value);
    input = `<input type="text" value="${esc(v)}" ${list ? `list="${list}"` : ""} placeholder="${c.op === "in" ? "a, b, c" : ""}" ${attrs}>`;
  }
  return `<div class="cond">${i > 0 ? `<span class="and">and</span>` : `<span class="and">if</span>`}${fieldSel}${opSel}${input}
    <button type="button" data-do="del-cond" ${attr}="${r}" data-c="${i}" title="Remove condition" aria-label="Remove condition">−</button></div>`;
}


export function defaultValue(field: Field): Condition["value"] {
  const type = FIELDS[field].type;
  if (type === "boolean") return true;
  if (type === "number") return IN_CM.has(field) ? 0.1 : 0;
  if (field === "color") return "#e11d48";
  if (field === "kind") return "box";
  return "";
}

/** What the person typed, as the API stores it: cm → m for sizes, lists split on commas. */
export function readValue(c: Condition, raw: string): Condition["value"] {
  const type = FIELDS[c.field].type;
  if (type === "boolean") return raw === "true";
  if (type === "number") return IN_CM.has(c.field) ? Number(raw) / 100 : Number(raw);
  if (c.op === "in") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw;
}


export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** A condition after its field, comparison or value is changed in a row. Returns true if the row's layout changes. */
export function editCondition(cond: Condition, key: string | undefined, raw: string): boolean {
  if (key === "field") {
    cond.field = raw as Field;
    const type = FIELDS[cond.field].type;
    if (!OPS[type].includes(cond.op)) cond.op = OPS[type][0];
    cond.value = defaultValue(cond.field);
    return true;
  }
  if (key === "op") {
    cond.op = raw as Condition["op"];
    if (cond.op === "in" && !Array.isArray(cond.value)) cond.value = String(cond.value) ? [String(cond.value)] : [];
    if (cond.op !== "in" && Array.isArray(cond.value)) cond.value = cond.value.join(", ");
    return true;
  }
  if (key === "value") cond.value = readValue(cond, raw);
  return false;
}
