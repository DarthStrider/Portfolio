/** Line equipment as the inventory API stores it (snack5-inventory/api/src/domain/assembly.ts). */
import type { ShapeKind, Size } from "../shapes/types";
import type { Condition } from "../splitters/types";

/** A kind of object: an inventory part, or plain shapes of one kind. */
export type Owner = `part:${string}` | `kind:${ShapeKind}`;

/** A named spot on an object, as fractions of its size from its center (-0.5..0.5; y = 0.5 is the top). */
export interface ConnectionPoint {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface Connectors {
  owner: Owner;
  points: ConnectionPoint[];
  updatedAt: string;
}

export type MergerKind = "side" | "y";
export type Priority = "main" | "feeders" | "alternate";

export interface Merger {
  id: string;
  name: string;
  kind: MergerKind;
  /** The main belt ("side") or the output belt ("y"). */
  conveyorId: string;
  /** Meters from that belt's start; 0 for "y". */
  along: number;
  feederIds: string[];
  priority: Priority;
  /** Clear space needed at the merge point, meters. */
  gap: number;
  createdAt: string;
  updatedAt: string;
}
export type NewMerger = Omit<Merger, "id" | "createdAt" | "updatedAt">;
export type MergerPatch = Partial<Pick<Merger, "name" | "along" | "priority" | "gap">>;

export interface Slot {
  owner: Owner;
  point: string;
}

export interface Machine {
  id: string;
  name: string;
  conveyorId: string;
  along: number;
  /** Stays on the belt; the attach item is joined onto it. */
  base: Slot;
  attach: Slot;
  cycleSeconds: number;
  createdAt: string;
  updatedAt: string;
}
export type NewMachine = Omit<Machine, "id" | "createdAt" | "updatedAt">;
export type MachinePatch = Partial<Pick<Machine, "name" | "along" | "base" | "attach" | "cycleSeconds">>;

export interface Attachment {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

export interface NewAssembly {
  name: string;
  baseShapeId: string;
  attachedShapeId: string;
  basePoint: string;
  attachedPoint: string;
  attachment: Attachment;
}

export interface Assembly extends Omit<NewAssembly, "attachment"> {
  id: string;
  consumed: { sku: string; qty: number }[];
  createdAt: string;
}

export type FeedMode = "steady" | "demand";
export type Feed =
  | { type: "none" }
  | { type: "belt"; conveyorId: string; along: number; mode: FeedMode }
  | { type: "machine"; machineId: string };

export interface Bin {
  id: string;
  name: string;
  /** The kinds of object it holds: one or more. */
  holds: Owner[];
  /** Extra conditions an item must meet to be caught (all of them). */
  accept: Condition[];
  capacity: number;
  position: { x: number; z: number };
  rotationY: number;
  feed: Feed;
  count: number;
  createdAt: string;
  updatedAt: string;
}
export type NewBin = Omit<Bin, "id" | "count" | "createdAt" | "updatedAt">;
export type BinPatch = Partial<Pick<Bin, "name" | "holds" | "accept" | "capacity" | "position" | "rotationY" | "feed">>;

/** Bins are this size, meters (the API's BIN_SIZE). */
export const BIN_SIZE = { x: 0.5, y: 0.35, z: 0.4 } as const;

export interface ItemLook {
  kind: ShapeKind;
  size: Size;
  color: string;
  name: string;
}
