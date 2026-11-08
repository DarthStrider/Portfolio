/** Splitters as the inventory API stores them (snack5-inventory/api/src/domain/splitters.ts). */
export const EXITS = ["left", "straight", "right"] as const;
export type Exit = (typeof EXITS)[number];

export type FieldType = "text" | "number" | "boolean";

/** What a condition can test. Sizes are meters in the API; the panel shows centimeters. */
export const FIELDS = {
  kind: { type: "text", label: "Shape kind" },
  color: { type: "text", label: "Color" },
  name: { type: "text", label: "Shape name" },
  sku: { type: "text", label: "SKU" },
  width: { type: "number", label: "Width (cm)" },
  height: { type: "number", label: "Height (cm)" },
  depth: { type: "number", label: "Depth (cm)" },
  isPart: { type: "boolean", label: "Is an inventory part" },
  "part.category": { type: "text", label: "Part category" },
  "part.location": { type: "text", label: "Part location" },
  "part.name": { type: "text", label: "Part name" },
  "part.onHand": { type: "number", label: "Part on hand" },
  "part.available": { type: "number", label: "Part available" },
  "part.low": { type: "boolean", label: "Part low on stock" },
} as const satisfies Record<string, { type: FieldType; label: string }>;
export type Field = keyof typeof FIELDS;

export type Op = "eq" | "ne" | "in" | "contains" | "lt" | "lte" | "gt" | "gte";
export const OPS: Record<FieldType, readonly Op[]> = {
  text: ["eq", "ne", "in", "contains"],
  number: ["eq", "ne", "lt", "lte", "gt", "gte"],
  boolean: ["eq"],
};
export const OP_LABEL: Record<Op, string> = { eq: "is", ne: "is not", in: "is one of", contains: "contains", lt: "<", lte: "≤", gt: ">", gte: "≥" };

export interface Condition {
  field: Field;
  op: Op;
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
  /** Meters from the start of the belt (its -x end before turning). */
  along: number;
  rules: Rule[];
  otherwise: Exit;
  createdAt: string;
  updatedAt: string;
}

export type NewSplitter = Omit<Splitter, "id" | "createdAt" | "updatedAt">;
export type SplitterPatch = Partial<Pick<Splitter, "name" | "along" | "rules" | "otherwise">>;
