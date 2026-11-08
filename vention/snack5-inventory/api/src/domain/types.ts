import type { NewShape, Shape, ShapePatch } from "./shapes.ts";
import type { Conveyor, ConveyorPatch, NewConveyor } from "./conveyors.ts";
import type { NewSplitter, Splitter, SplitterPatch } from "./splitters.ts";
import type { PartPatch } from "./newPart.ts";
import type { AssembleResult, Assembly, ConnectionPoint, Connectors, Machine, MachinePatch, Merger, MergerPatch, NewAssembly, NewMachine, NewMerger, Owner } from "./assembly.ts";

/**
 * The inventory's data model and the one interface every database implements.
 *
 * Quantities are whole stock units: bars, plates, packs or pieces, as given by `unit`.
 * `available` is what can still be promised: on hand minus what's reserved for quotes.
 */

export type Category = "extrusion" | "plate" | "fastener" | "motor" | "actuator" | "controller" | "gripper";

export interface Part {
  sku: string;
  name: string;
  category: Category;
  /** What one unit of stock is, e.g. "bar (3 m)" or "pack of 50". */
  unit: string;
  onHand: number;
  reserved: number;
  available: number;
  /** Reorder when available falls to this level or below. */
  reorderLevel: number;
  low: boolean;
  /** Bin location in the warehouse, e.g. "A-02-1". */
  location: string;
  updatedAt: string;
}

/** A part as it's first stocked, before anything is reserved. */
export interface SeedPart {
  sku: string;
  name: string;
  category: Category;
  unit: string;
  onHand: number;
  reorderLevel: number;
  location: string;
}

export type MovementKind = "receive" | "consume" | "reserve" | "release" | "fulfil";

/** One line of the stock ledger. Every change to a part writes one. */
export interface Movement {
  id: string;
  sku: string;
  kind: MovementKind;
  qty: number;
  note: string;
  reservationId: string | null;
  at: string;
}

export interface Line {
  sku: string;
  qty: number;
}

export type ReservationStatus = "active" | "released" | "fulfilled";

export interface Reservation {
  id: string;
  quoteRef: string;
  status: ReservationStatus;
  lines: Line[];
  createdAt: string;
  closedAt: string | null;
}

/** Why a reservation couldn't be made: `available` is 0 and `known` false for SKUs not stocked at all. */
export interface Shortage {
  sku: string;
  need: number;
  available: number;
  known: boolean;
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; shortages: Shortage[] };

export interface PartFilter {
  /** Case-insensitive match on SKU or name. */
  search?: string;
  /** Only parts at or below their reorder level. */
  lowOnly?: boolean;
}

export type DbKind = "postgres" | "mongo" | "memory";

/**
 * Everything the API needs from a database. Postgres, MongoDB and the in-memory
 * reference implementation all pass the same contract tests (tests/contract.ts).
 *
 * Rules every implementation enforces:
 * - stock never goes negative, and reserved never exceeds on hand, even under concurrent requests;
 * - consuming can only use available stock, never stock reserved for someone else;
 * - a reservation is all or nothing: if any line is short, nothing is reserved;
 * - every change writes a movement.
 */
export interface InventoryRepo {
  readonly kind: DbKind;
  /** Creates tables/indexes if missing. Safe to call on every start. */
  init(): Promise<void>;
  /** Inserts the seed parts if there are none yet. Returns whether it did. */
  seedIfEmpty(parts: readonly SeedPart[]): Promise<boolean>;
  /** Throws if the database can't be reached. */
  ping(): Promise<void>;
  close(): Promise<void>;

  listParts(filter?: PartFilter): Promise<Part[]>;
  getParts(skus: readonly string[]): Promise<Part[]>;
  /**
   * Adds a new part. Initial stock is written to the ledger as a receipt, so the
   * ledger still explains every unit. Throws ConflictError if the SKU already exists.
   */
  createPart(part: SeedPart): Promise<Part>;
  /** Changes name, category, location or reorder level; never stock. Throws NotFoundError for an unknown SKU. */
  updatePart(sku: string, patch: PartPatch): Promise<Part>;
  /** Adds stock. Throws NotFoundError for an unknown SKU. */
  receive(sku: string, qty: number, note: string): Promise<Part>;
  /** Removes available stock. Throws NotFoundError, or ConflictError if not enough is available. */
  consume(sku: string, qty: number, note: string): Promise<Part>;
  /** Newest first. */
  movements(filter: { sku?: string; limit: number }): Promise<Movement[]>;

  /** All or nothing. Lines with the same SKU are added together. */
  reserve(quoteRef: string, lines: readonly Line[]): Promise<ReserveResult>;
  /** Newest first. */
  reservations(limit: number): Promise<Reservation[]>;
  /** Gives reserved stock back. Throws NotFoundError, or ConflictError unless active. */
  release(id: string): Promise<Reservation>;
  /** Ships reserved stock: on hand and reserved both go down. Same errors as release. */
  fulfil(id: string): Promise<Reservation>;

  /** Shapes in the robot arm's scene, oldest first. */
  listShapes(): Promise<Shape[]>;
  createShape(shape: NewShape): Promise<Shape>;
  /** Throws NotFoundError for an unknown id. */
  updateShape(id: string, patch: ShapePatch): Promise<Shape>;
  /** Throws NotFoundError for an unknown id. */
  deleteShape(id: string): Promise<void>;

  /** Conveyor belts in the robot arm's scene, oldest first. */
  listConveyors(): Promise<Conveyor[]>;
  createConveyor(conveyor: NewConveyor): Promise<Conveyor>;
  /** Throws NotFoundError for an unknown id. */
  updateConveyor(id: string, patch: ConveyorPatch): Promise<Conveyor>;
  /** Throws NotFoundError for an unknown id. */
  deleteConveyor(id: string): Promise<void>;

  /** Splitters (diverter gates on belts), oldest first. Deleting a belt deletes its splitters. */
  listSplitters(): Promise<Splitter[]>;
  /** The caller checks the belt exists and `along` fits on it. */
  createSplitter(splitter: NewSplitter): Promise<Splitter>;
  /** Throws NotFoundError for an unknown id. */
  updateSplitter(id: string, patch: SplitterPatch): Promise<Splitter>;
  /** Throws NotFoundError for an unknown id. */
  deleteSplitter(id: string): Promise<void>;

  /** Connection points stored for each kind of object; kinds not listed use DEFAULT_POINTS. */
  listConnectors(): Promise<Connectors[]>;
  /** Replaces a kind's points (creating the entry if needed). */
  setConnectors(owner: Owner, points: ConnectionPoint[]): Promise<Connectors>;
  /** Back to the defaults. Throws NotFoundError if none were stored. */
  deleteConnectors(owner: Owner): Promise<void>;

  /** Mergers, oldest first. Deleting a belt deletes the mergers it's the main belt or a feeder of. */
  listMergers(): Promise<Merger[]>;
  createMerger(merger: NewMerger): Promise<Merger>;
  updateMerger(id: string, patch: MergerPatch): Promise<Merger>;
  deleteMerger(id: string): Promise<void>;

  /** Joining machines, oldest first. Deleting a belt deletes its machines. */
  listMachines(): Promise<Machine[]>;
  createMachine(machine: NewMachine): Promise<Machine>;
  updateMachine(id: string, patch: MachinePatch): Promise<Machine>;
  deleteMachine(id: string): Promise<void>;

  /**
   * Joins one shape onto another and uses up their parts from stock, all or nothing.
   * Refuses (ok: false) if a shape is missing, the attached one is already joined to
   * something, the join would make a loop, or a part is short.
   */
  assemble(input: NewAssembly): Promise<AssembleResult>;
  /** Newest first. */
  listAssemblies(limit: number): Promise<Assembly[]>;

  /** Deletes everything. Tests only. */
  reset(): Promise<void>;
}
