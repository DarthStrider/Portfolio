/**
 * Talks to the inventory API (Snack 5), which stores the shapes in PostgreSQL or MongoDB.
 * The API allows calls from pages on localhost (CORS), so this dev server can use it directly.
 */
import type { InventoryPart } from "./fromPart";
import type { NewShape, Shape, ShapePatch } from "./types";
import type { Conveyor, ConveyorPatch, NewConveyor } from "../conveyors/types";
import type { NewSplitter, Splitter, SplitterPatch } from "../splitters/types";
import type { Part } from "../splitters/rules";
import type { Bin, BinPatch, ItemLook, NewBin } from "../line/types";
import type { NewRobot, Robot, RobotPatch } from "../robots/types";
import type { Assembly, ConnectionPoint, Connectors, Machine, MachinePatch, Merger, MergerPatch, NewAssembly, NewMachine, NewMerger, Owner } from "../line/types";

/** Override with VITE_INVENTORY_API, e.g. http://localhost:8080 for the API without Docker. */
export const API_BASE: string = (import.meta.env.VITE_INVENTORY_API as string | undefined) ?? "http://localhost:8081";

export class ShapesApiError extends Error {
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(message);
    this.problems = problems;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ShapesApiError(`Can't reach the inventory API at ${API_BASE}. Is Snack 5 running?`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[] };
  if (!res.ok) throw new ShapesApiError(data.error ?? res.statusText, data.problems ?? []);
  return data as T;
}

export const shapesApi = {
  info: () => call<{ db: string; host: string }>("GET", "/info"),
  list: () => call<Shape[]>("GET", "/shapes"),
  parts: () => call<InventoryPart[]>("GET", "/parts"),
  create: (shape: NewShape) => call<Shape>("POST", "/shapes", shape),
  update: (id: string, patch: ShapePatch) => call<Shape>("PATCH", `/shapes/${id}`, patch),
  remove: (id: string) => call<{ deleted: string }>("DELETE", `/shapes/${id}`),
};

export const conveyorsApi = {
  list: () => call<Conveyor[]>("GET", "/conveyors"),
  create: (belt: NewConveyor) => call<Conveyor>("POST", "/conveyors", belt),
  update: (id: string, patch: ConveyorPatch) => call<Conveyor>("PATCH", `/conveyors/${id}`, patch),
  /** Several belts at once, all or none: a line moving, turning or splitting. */
  updateMany: (updates: readonly ({ id: string } & ConveyorPatch)[]) => call<Conveyor[]>("PATCH", "/conveyors", { updates }),
  remove: (id: string) => call<{ deleted: string }>("DELETE", `/conveyors/${id}`),
};

export const splittersApi = {
  list: () => call<Splitter[]>("GET", "/splitters"),
  create: (s: NewSplitter) => call<Splitter>("POST", "/splitters", s),
  update: (id: string, patch: SplitterPatch) => call<Splitter>("PATCH", `/splitters/${id}`, patch),
  remove: (id: string) => call<{ deleted: string }>("DELETE", `/splitters/${id}`),
  /** Parts with every field the rules can test (location, stock, low). */
  parts: () => call<Part[]>("GET", "/parts"),
};

export const lineApi = {
  connectors: () => call<{ defaultPoints: ConnectionPoint[]; connectors: Connectors[] }>("GET", "/connectors"),
  setPoints: (owner: Owner, points: ConnectionPoint[]) => call<Connectors>("PUT", `/connectors/${owner}`, { points }),
  resetPoints: (owner: Owner) => call<{ deleted: string }>("DELETE", `/connectors/${owner}`),
  mergers: () => call<Merger[]>("GET", "/mergers"),
  createMerger: (m: NewMerger) => call<Merger>("POST", "/mergers", m),
  updateMerger: (id: string, patch: MergerPatch) => call<Merger>("PATCH", `/mergers/${id}`, patch),
  removeMerger: (id: string) => call<{ deleted: string }>("DELETE", `/mergers/${id}`),
  machines: () => call<Machine[]>("GET", "/machines"),
  createMachine: (m: NewMachine) => call<Machine>("POST", "/machines", m),
  updateMachine: (id: string, patch: MachinePatch) => call<Machine>("PATCH", `/machines/${id}`, patch),
  removeMachine: (id: string) => call<{ deleted: string }>("DELETE", `/machines/${id}`),
  assemble: (a: NewAssembly) => call<Assembly>("POST", "/assemblies", a),
  assemblies: () => call<Assembly[]>("GET", "/assemblies?limit=20"),
};

export const binsApi = {
  list: () => call<Bin[]>("GET", "/bins"),
  create: (b: NewBin) => call<Bin>("POST", "/bins", b),
  update: (id: string, patch: BinPatch) => call<Bin>("PATCH", `/bins/${id}`, patch),
  remove: (id: string) => call<{ deleted: string }>("DELETE", `/bins/${id}`),
  /** Several kinds at once, all or nothing; addToHolds adds kinds the bin doesn't hold yet. */
  load: (id: string, lines: { owner: Owner; qty: number; look: ItemLook }[], addToHolds: boolean) =>
    call<{ count: number; holds: Owner[] }>("POST", `/bins/${id}/load`, { lines, addToHolds }),
  unload: (id: string, qty: number) => call<{ unloaded: number }>("POST", `/bins/${id}/unload`, { qty }),
  catch: (id: string, shapeId: string) => call<{ caught: string }>("POST", `/bins/${id}/catch`, { shapeId }),
  release: (id: string, shapeId: string, position: { x: number; z: number }) => call<{ released: string }>("POST", `/bins/${id}/release`, { shapeId, position }),
};

export const robotsApi = {
  list: () => call<Robot[]>("GET", "/robots"),
  create: (r: NewRobot) => call<Robot>("POST", "/robots", r),
  update: (id: string, patch: RobotPatch) => call<Robot>("PATCH", `/robots/${id}`, patch),
  remove: (id: string) => call<{ deleted: string }>("DELETE", `/robots/${id}`),
};

export const sceneApi = {
  /** The API's settings: the floor's size (FLOOR_SIZE). */
  config: () => call<{ floorSize: number; floorHalf: number }>("GET", "/config"),
  /** Everything in the scene but the arm: shapes, belts and their stations, bins, robots. */
  clear: () => call<{ cleared: { shapes: number; conveyors: number; bins: number; robots: number } }>("DELETE", "/scene"),
};
