/**
 * Splitters: diverter gates on a conveyor belt that send each item left, right or straight on,
 * by rules you write. The rules are data, stored here, so they can be changed from the arm app,
 * the API or the database directly, even while the line is running.
 *
 * A splitter has an ordered list of rules. Each rule is one or more conditions (all must hold)
 * and an exit. The first rule that matches an item decides its exit; if none matches, the
 * splitter's `otherwise` exit does.
 *
 * Conditions can test the shape itself (kind, color, size, name, SKU) or the inventory part it
 * stands for (category, location, stock). Part fields are read when the item reaches the gate,
 * so changing a part in the inventory changes where its items go.
 */
import { ValidationError } from "./errors.ts";

export const EXITS = ["left", "straight", "right"] as const;
export type Exit = (typeof EXITS)[number];

/** Every field a condition can test, and its type. Sizes are meters, like the rest of the API. */
export const FIELDS = {
  kind: "text",
  color: "text",
  name: "text",
  sku: "text",
  width: "number",
  height: "number",
  depth: "number",
  isPart: "boolean",
  "part.category": "text",
  "part.location": "text",
  "part.name": "text",
  "part.onHand": "number",
  "part.available": "number",
  "part.low": "boolean",
} as const;
export type Field = keyof typeof FIELDS;
type FieldType = (typeof FIELDS)[Field];

export const OPS: Record<FieldType, readonly Op[]> = {
  text: ["eq", "ne", "in", "contains"],
  number: ["eq", "ne", "lt", "lte", "gt", "gte"],
  boolean: ["eq"],
};
export type Op = "eq" | "ne" | "in" | "contains" | "lt" | "lte" | "gt" | "gte";

export interface Condition {
  field: Field;
  op: Op;
  /** Text, a number, true/false, or a list of texts for "in". */
  value: string | number | boolean | string[];
}

export interface Rule {
  conditions: Condition[];
  exit: Exit;
}

export interface Splitter {
  id: string;
  name: string;
  conveyorId: string;
  /** Meters from the start of the belt (its -x end before turning) to the gate. */
  along: number;
  rules: Rule[];
  /** Where an item goes when no rule matches. */
  otherwise: Exit;
  createdAt: string;
  updatedAt: string;
}

export type NewSplitter = Omit<Splitter, "id" | "createdAt" | "updatedAt">;
/** Everything but the belt can change: move a gate to another belt by re-creating it. */
export type SplitterPatch = Partial<Pick<Splitter, "name" | "along" | "rules" | "otherwise">>;

export const MAX_RULES = 20;
export const MAX_CONDITIONS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = Record<string, unknown>;
const asBody = (v: unknown): Body => (v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {});

/** Checks one condition, returning a normalized copy or a problem. Texts are compared ignoring case. */
function parseCondition(c: unknown, where: string, problems: string[]): Condition | null {
  const b = asBody(c);
  const field = b.field as Field;
  if (!(typeof field === "string" && field in FIELDS)) {
    problems.push(`${where}: field must be one of ${Object.keys(FIELDS).join(", ")}`);
    return null;
  }
  const type = FIELDS[field];
  const op = b.op as Op;
  if (!OPS[type].includes(op)) {
    problems.push(`${where}: ${field} can be compared with ${OPS[type].join(", ")}`);
    return null;
  }
  const v = b.value;
  if (type === "boolean") {
    if (typeof v !== "boolean") return problems.push(`${where}: value must be true or false`), null;
    return { field, op, value: v };
  }
  if (type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) return problems.push(`${where}: value must be a number`), null;
    return { field, op, value: v };
  }
  if (op === "in") {
    const list = Array.isArray(v) ? v : null;
    if (!list || list.length === 0 || list.length > 20 || !list.every((s) => typeof s === "string" && s.trim() !== "" && s.length <= 80)) {
      return problems.push(`${where}: value must be a list of 1 to 20 texts`), null;
    }
    return { field, op, value: (list as string[]).map((s) => s.trim().toLowerCase()) };
  }
  if (typeof v !== "string" || v.trim() === "" || v.length > 80) return problems.push(`${where}: value must be text up to 80 characters`), null;
  return { field, op, value: v.trim().toLowerCase() };
}

function parseRules(v: unknown, problems: string[]): Rule[] | undefined {
  if (!Array.isArray(v) || v.length > MAX_RULES) {
    problems.push(`rules must be a list of at most ${MAX_RULES} rules`);
    return undefined;
  }
  const rules: Rule[] = [];
  v.forEach((r, i) => {
    const b = asBody(r);
    const where = `rule ${i + 1}`;
    if (!EXITS.includes(b.exit as Exit)) problems.push(`${where}: exit must be left, straight or right`);
    const cs = b.conditions;
    if (!Array.isArray(cs) || cs.length === 0 || cs.length > MAX_CONDITIONS) {
      problems.push(`${where}: conditions must be a list of 1 to ${MAX_CONDITIONS}`);
      return;
    }
    const conditions = cs.map((c, j) => parseCondition(c, `${where}, condition ${j + 1}`, problems));
    if (conditions.every((c) => c !== null) && EXITS.includes(b.exit as Exit)) rules.push({ conditions: conditions as Condition[], exit: b.exit as Exit });
  });
  return rules;
}

const name = (v: unknown) => (typeof v === "string" && v.trim() !== "" && v.trim().length <= 40 ? v.trim() : null);
const along = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 4 ? v : null);

/** Shape checks only; that `along` fits on the belt is checked against the belt in app.ts. */
export function parseNewSplitter(input: unknown): NewSplitter {
  const b = asBody(input);
  const problems: string[] = [];
  const n = name(b.name);
  if (n === null) problems.push("name must be text up to 40 characters");
  if (typeof b.conveyorId !== "string" || !UUID.test(b.conveyorId)) problems.push("conveyorId must be a conveyor's id");
  const a = along(b.along);
  if (a === null) problems.push("along must be meters from the start of the belt, 0 to 4");
  const otherwise = (b.otherwise ?? "straight") as Exit;
  if (!EXITS.includes(otherwise)) problems.push("otherwise must be left, straight or right");
  const rules = parseRules(b.rules ?? [], problems);
  if (problems.length) throw new ValidationError(problems);
  return { name: n!, conveyorId: b.conveyorId as string, along: a!, rules: rules!, otherwise };
}

export function parseSplitterPatch(input: unknown): SplitterPatch {
  const b = asBody(input);
  const problems: string[] = [];
  const patch: SplitterPatch = {};
  if (b.name !== undefined) {
    const n = name(b.name);
    if (n === null) problems.push("name must be text up to 40 characters");
    else patch.name = n;
  }
  if (b.along !== undefined) {
    const a = along(b.along);
    if (a === null) problems.push("along must be meters from the start of the belt, 0 to 4");
    else patch.along = a;
  }
  if (b.otherwise !== undefined) {
    if (!EXITS.includes(b.otherwise as Exit)) problems.push("otherwise must be left, straight or right");
    else patch.otherwise = b.otherwise as Exit;
  }
  if (b.rules !== undefined) patch.rules = parseRules(b.rules, problems);
  const unknown = Object.keys(b).filter((k) => !["name", "along", "rules", "otherwise"].includes(k));
  if (unknown.length) problems.push(`can't change ${unknown.join(", ")}; delete and re-create the splitter instead`);
  if (!problems.length && Object.keys(patch).length === 0) problems.push("nothing to change: send name, along, rules or otherwise");
  if (problems.length) throw new ValidationError(problems);
  return patch;
}
