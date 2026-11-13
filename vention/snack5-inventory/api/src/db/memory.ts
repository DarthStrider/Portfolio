/**
 * Reference implementation: plain maps in one process. It defines the behaviour the
 * contract tests expect, runs the API with no database (DB=memory), and is what the
 * API tests use. JavaScript runs one callback at a time and nothing here awaits midway,
 * so every method is atomic for free.
 */
import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError } from "../domain/errors.ts";
import { mergeLines, withDerived } from "../domain/lines.ts";
import type {
  InventoryRepo, Line, Movement, MovementKind, Part, PartFilter, Reservation, ReserveResult, SeedPart, Shortage,
} from "../domain/types.ts";
import type { NewShape, Shape, ShapePatch } from "../domain/shapes.ts";
import { withSectionDefaults, type Conveyor, type ConveyorPatch, type ConveyorUpdate, type NewConveyor } from "../domain/conveyors.ts";
import type { NewSplitter, Splitter, SplitterPatch } from "../domain/splitters.ts";
import type { PartPatch } from "../domain/newPart.ts";
import { stockNeeded, type Bin, type BinPatch, type BinResult, type LoadLine, type NewBin } from "../domain/bins.ts";
import type { AssembleResult, Assembly, ConnectionPoint, Connectors, Machine, MachinePatch, Merger, MergerPatch, NewAssembly, NewMachine, NewMerger, Owner } from "../domain/assembly.ts";
import type { NewRobot, Robot, RobotPatch } from "../domain/robots.ts";
import type { SceneCleared } from "../domain/types.ts";

interface PartRow { sku: string; name: string; category: Part["category"]; unit: string; onHand: number; reserved: number; reorderLevel: number; location: string; updatedAt: string }

export class MemoryRepo implements InventoryRepo {
  readonly kind = "memory";
  private parts = new Map<string, PartRow>();
  private moves: Movement[] = [];
  private res = new Map<string, Reservation>();
  private seq = 0;
  private shapes = new Map<string, Shape>();
  private conveyors = new Map<string, Conveyor>();
  private splitters = new Map<string, Splitter>();
  private connectors = new Map<string, Connectors>();
  private mergers = new Map<string, Merger>();
  private machines = new Map<string, Machine>();
  private assemblies: Assembly[] = [];
  private bins = new Map<string, Omit<Bin, "count">>();
  private robots = new Map<string, Robot>();

  async init(): Promise<void> {}
  async ping(): Promise<void> {}
  async close(): Promise<void> {}

  async seedIfEmpty(seed: readonly SeedPart[]): Promise<boolean> {
    if (this.parts.size > 0) return false;
    const now = new Date().toISOString();
    for (const s of seed) this.parts.set(s.sku, { ...s, reserved: 0, updatedAt: now });
    return true;
  }

  async listParts(filter: PartFilter = {}): Promise<Part[]> {
    const q = filter.search?.trim().toLowerCase();
    return [...this.parts.values()]
      .map(out)
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .filter((p) => !filter.lowOnly || p.low)
      .sort((a, b) => (a.sku < b.sku ? -1 : 1));
  }

  async getParts(skus: readonly string[]): Promise<Part[]> {
    return skus.flatMap((s) => (this.parts.has(s) ? [out(this.parts.get(s)!)] : []));
  }

  async createPart(s: SeedPart): Promise<Part> {
    if (this.parts.has(s.sku)) throw new ConflictError(`Part ${s.sku} already exists`);
    const p: PartRow = { ...s, reserved: 0, updatedAt: new Date().toISOString() };
    this.parts.set(s.sku, p);
    if (s.onHand > 0) this.log(s.sku, "receive", s.onHand, "Initial stock", null);
    return out(p);
  }

  async updatePart(sku: string, patch: PartPatch): Promise<Part> {
    const p = this.row(sku);
    Object.assign(p, patch);
    this.touch(p);
    return out(p);
  }

  async receive(sku: string, qty: number, note: string): Promise<Part> {
    const p = this.row(sku);
    p.onHand += qty;
    this.touch(p);
    this.log(sku, "receive", qty, note, null);
    return out(p);
  }

  async consume(sku: string, qty: number, note: string): Promise<Part> {
    const p = this.row(sku);
    const available = p.onHand - p.reserved;
    if (available < qty) throw new ConflictError(`Only ${available} of ${sku} available`);
    p.onHand -= qty;
    this.touch(p);
    this.log(sku, "consume", qty, note, null);
    return out(p);
  }

  async movements({ sku, limit }: { sku?: string; limit: number }): Promise<Movement[]> {
    const list = sku ? this.moves.filter((m) => m.sku === sku) : this.moves;
    return list.slice(-limit).reverse();
  }

  async reserve(quoteRef: string, lines: readonly Line[]): Promise<ReserveResult> {
    const want = mergeLines(lines);
    const shortages: Shortage[] = [];
    for (const { sku, qty } of want) {
      const p = this.parts.get(sku);
      const available = p ? p.onHand - p.reserved : 0;
      if (available < qty) shortages.push({ sku, need: qty, available, known: p !== undefined });
    }
    if (shortages.length) return { ok: false, shortages };

    const reservation: Reservation = {
      id: randomUUID(), quoteRef, status: "active", lines: want, createdAt: new Date().toISOString(), closedAt: null,
    };
    this.res.set(reservation.id, reservation);
    for (const { sku, qty } of want) {
      const p = this.parts.get(sku)!;
      p.reserved += qty;
      this.touch(p);
      this.log(sku, "reserve", qty, `Reserved for ${quoteRef}`, reservation.id);
    }
    return { ok: true, reservation: structuredClone(reservation) };
  }

  async reservations(limit: number): Promise<Reservation[]> {
    return [...this.res.values()].reverse().slice(0, limit).map((r) => structuredClone(r));
  }

  async release(id: string): Promise<Reservation> {
    return this.close_(id, "release");
  }

  async fulfil(id: string): Promise<Reservation> {
    return this.close_(id, "fulfil");
  }

  async listShapes(): Promise<Shape[]> {
    return [...this.shapes.values()].map((s) => structuredClone(s));
  }

  async createShape(input: NewShape): Promise<Shape> {
    const now = new Date().toISOString();
    const shape: Shape = { ...structuredClone(input), attachedTo: null, attach: null, binId: null, stockTaken: false, id: randomUUID(), createdAt: now, updatedAt: now };
    this.shapes.set(shape.id, shape);
    return structuredClone(shape);
  }

  async updateShape(id: string, patch: ShapePatch): Promise<Shape> {
    const s = this.shapes.get(id);
    if (!s) throw new NotFoundError(`No shape ${id}`);
    Object.assign(s, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return structuredClone(s);
  }

  async deleteShape(id: string): Promise<void> {
    if (!this.shapes.delete(id)) throw new NotFoundError(`No shape ${id}`);
    // Like ON DELETE CASCADE: what was joined onto it goes too, and what was joined onto that.
    for (const s of [...this.shapes.values()]) if (s.attachedTo === id) await this.deleteShape(s.id);
  }

  async listConveyors(): Promise<Conveyor[]> {
    return [...this.conveyors.values()].map((c) => structuredClone(c));
  }

  async createConveyor(input: NewConveyor): Promise<Conveyor> {
    const now = new Date().toISOString();
    const c: Conveyor = { ...structuredClone(withSectionDefaults(input)), id: randomUUID(), createdAt: now, updatedAt: now };
    this.conveyors.set(c.id, c);
    return structuredClone(c);
  }

  async updateConveyor(id: string, patch: ConveyorPatch): Promise<Conveyor> {
    const c = this.conveyors.get(id);
    if (!c) throw new NotFoundError(`No conveyor ${id}`);
    Object.assign(c, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return structuredClone(c);
  }

  async updateConveyors(updates: readonly ConveyorUpdate[]): Promise<Conveyor[]> {
    // Check every id first, so a bad one changes nothing (as a transaction would).
    for (const { id } of updates) if (!this.conveyors.has(id)) throw new NotFoundError(`No conveyor ${id}`);
    const out: Conveyor[] = [];
    for (const { id, patch } of updates) out.push(await this.updateConveyor(id, patch));
    return out;
  }

  async deleteConveyor(id: string): Promise<void> {
    if (!this.conveyors.delete(id)) throw new NotFoundError(`No conveyor ${id}`);
    // Like the foreign key's ON DELETE CASCADE in Postgres.
    for (const [sid, s] of this.splitters) if (s.conveyorId === id) this.splitters.delete(sid);
    for (const [mid, m] of this.machines) if (m.conveyorId === id) this.machines.delete(mid);
    for (const [mid, m] of this.mergers) if (m.conveyorId === id || m.feederIds.includes(id)) this.mergers.delete(mid);
  }

  async listConnectors(): Promise<Connectors[]> {
    return [...this.connectors.values()].sort((a, b) => (a.owner < b.owner ? -1 : 1)).map((c) => structuredClone(c));
  }

  async setConnectors(owner: Owner, points: ConnectionPoint[]): Promise<Connectors> {
    const c: Connectors = { owner, points: structuredClone(points), updatedAt: new Date().toISOString() };
    this.connectors.set(owner, c);
    return structuredClone(c);
  }

  async deleteConnectors(owner: Owner): Promise<void> {
    if (!this.connectors.delete(owner)) throw new NotFoundError(`No connection points stored for ${owner}`);
  }

  async listMergers(): Promise<Merger[]> {
    return [...this.mergers.values()].map((m) => structuredClone(m));
  }

  async createMerger(input: NewMerger): Promise<Merger> {
    const now = new Date().toISOString();
    const m: Merger = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now };
    this.mergers.set(m.id, m);
    return structuredClone(m);
  }

  async updateMerger(id: string, patch: MergerPatch): Promise<Merger> {
    const m = this.mergers.get(id);
    if (!m) throw new NotFoundError(`No merger ${id}`);
    Object.assign(m, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return structuredClone(m);
  }

  async deleteMerger(id: string): Promise<void> {
    if (!this.mergers.delete(id)) throw new NotFoundError(`No merger ${id}`);
  }

  async listMachines(): Promise<Machine[]> {
    return [...this.machines.values()].map((m) => structuredClone(m));
  }

  async createMachine(input: NewMachine): Promise<Machine> {
    const now = new Date().toISOString();
    const m: Machine = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now };
    this.machines.set(m.id, m);
    return structuredClone(m);
  }

  async updateMachine(id: string, patch: MachinePatch): Promise<Machine> {
    const m = this.machines.get(id);
    if (!m) throw new NotFoundError(`No machine ${id}`);
    Object.assign(m, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return structuredClone(m);
  }

  async deleteMachine(id: string): Promise<void> {
    if (!this.machines.delete(id)) throw new NotFoundError(`No machine ${id}`);
  }

  async assemble(input: NewAssembly): Promise<AssembleResult> {
    const base = this.shapes.get(input.baseShapeId);
    const attached = this.shapes.get(input.attachedShapeId);
    if (!base || !attached) return { ok: false, reason: "not_found" };
    if (attached.attachedTo) return { ok: false, reason: "already_attached" };
    // Walk up from the base: the attached shape mustn't be anything the base hangs from.
    for (let s: Shape | undefined = base, depth = 0; s && depth < 50; s = s.attachedTo ? this.shapes.get(s.attachedTo) : undefined, depth++) {
      if (s.id === attached.id) return { ok: false, reason: "cycle" };
    }
    const need = consumption([base, attached], (id) => this.assemblies.some((a) => a.baseShapeId === id || a.attachedShapeId === id));
    // (consumption also skips shapes whose part already left stock, e.g. ones that came out of a bin.)
    const shortages = need.flatMap(({ sku, qty }) => {
      const p = this.parts.get(sku);
      const available = p ? p.onHand - p.reserved : 0;
      return available < qty ? [{ sku, need: qty, available }] : [];
    });
    if (shortages.length) return { ok: false, reason: "short", shortages };

    const assembly: Assembly = {
      id: randomUUID(), name: input.name, baseShapeId: base.id, attachedShapeId: attached.id,
      basePoint: input.basePoint, attachedPoint: input.attachedPoint, consumed: need, createdAt: new Date().toISOString(),
    };
    for (const { sku, qty } of need) {
      const p = this.parts.get(sku)!;
      p.onHand -= qty;
      this.touch(p);
      this.log(sku, "consume", qty, `Assembly ${input.name} (${assembly.id})`, null);
    }
    Object.assign(attached, { attachedTo: base.id, attach: structuredClone(input.attachment), updatedAt: new Date().toISOString() });
    for (const s of [base, attached]) if (s.sku) s.stockTaken = true;
    this.assemblies.unshift(assembly);
    return { ok: true, assembly: structuredClone(assembly) };
  }

  async listBins(): Promise<Bin[]> {
    return [...this.bins.values()].map((b) => ({ ...structuredClone(b), count: this.inBin(b.id).length }));
  }

  async createBin(input: NewBin): Promise<Bin> {
    const now = new Date().toISOString();
    const b = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now };
    this.bins.set(b.id, b);
    return { ...structuredClone(b), count: 0 };
  }

  async updateBin(id: string, patch: BinPatch): Promise<Bin> {
    const b = this.bins.get(id);
    if (!b) throw new NotFoundError(`No bin ${id}`);
    Object.assign(b, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return { ...structuredClone(b), count: this.inBin(id).length };
  }

  async deleteBin(id: string): Promise<void> {
    if (!this.bins.has(id)) throw new NotFoundError(`No bin ${id}`);
    if (this.inBin(id).length) throw new ConflictError("Empty the bin before deleting it");
    this.bins.delete(id);
  }

  async loadBin(id: string, lines: readonly LoadLine[], addToHolds: boolean): Promise<BinResult<{ count: number; holds: Owner[] }>> {
    const bin = this.bins.get(id);
    if (!bin) return { ok: false, reason: "not_found" };
    const missing = lines.map((l) => l.owner).filter((o) => !bin.holds.includes(o));
    if (missing.length && !addToHolds) return { ok: false, reason: "wrong_kind", detail: `${bin.name} doesn't hold ${missing.join(", ")}` };
    const count = this.inBin(id).length;
    const total = lines.reduce((n, l) => n + l.qty, 0);
    if (count + total > bin.capacity) return { ok: false, reason: "full", detail: `${bin.name} has room for ${bin.capacity - count} more` };
    const need = stockNeeded(lines);
    const short = need.filter(({ sku, qty }) => {
      const p = this.parts.get(sku);
      return !p || p.onHand - p.reserved < qty;
    });
    if (short.length) return { ok: false, reason: "short", detail: short.map(({ sku }) => `${this.parts.get(sku) ? this.parts.get(sku)!.onHand - this.parts.get(sku)!.reserved : 0} of ${sku} available`).join(", ") };

    for (const { sku, qty } of need) {
      const p = this.parts.get(sku)!;
      p.onHand -= qty;
      this.touch(p);
      this.log(sku, "consume", qty, `Loaded into bin ${bin.name}`, null);
    }
    if (missing.length) bin.holds = [...bin.holds, ...missing];
    for (const l of lines) {
      const sku = l.owner.startsWith("part:") ? l.owner.slice(5) : null;
      const kind = sku ? l.look.kind : (l.owner.slice(5) as Shape["kind"]);
      for (let i = 0; i < l.qty; i++) {
        const s = await this.createShape({ name: l.look.name, kind, size: l.look.size, color: l.look.color, position: { ...bin.position }, rotationY: 0, sku });
        Object.assign(this.shapes.get(s.id)!, { binId: id, stockTaken: !!sku });
      }
    }
    return { ok: true, value: { count: count + total, holds: [...bin.holds] } };
  }

  async unloadBin(id: string, qty: number): Promise<BinResult<{ unloaded: number }>> {
    const bin = this.bins.get(id);
    if (!bin) return { ok: false, reason: "not_found" };
    // Plain items only, oldest first: an assembly in a bin is unloaded by releasing it.
    const items = this.inBin(id).filter((s) => ![...this.shapes.values()].some((c) => c.attachedTo === s.id)).slice(0, qty);
    for (const s of items) {
      if (s.sku && s.stockTaken) {
        const p = this.parts.get(s.sku);
        if (p) {
          p.onHand += 1;
          this.touch(p);
          this.log(s.sku, "receive", 1, `Unloaded from bin ${bin.name}`, null);
        }
      }
      this.shapes.delete(s.id);
    }
    return { ok: true, value: { unloaded: items.length } };
  }

  async catchIntoBin(id: string, shapeId: string): Promise<BinResult> {
    const bin = this.bins.get(id);
    const s = this.shapes.get(shapeId);
    if (!bin || !s || s.attachedTo || s.binId) return { ok: false, reason: "not_found" };
    if (!bin.holds.includes(s.sku ? `part:${s.sku}` : `kind:${s.kind}`)) return { ok: false, reason: "wrong_kind" };
    if (this.inBin(id).length >= bin.capacity) return { ok: false, reason: "full" };
    const tree = this.subtree(s.id);
    const need = consumption(tree.filter((x) => !x.stockTaken), () => false);
    const short = need.find(({ sku, qty }) => {
      const p = this.parts.get(sku);
      return !p || p.onHand - p.reserved < qty;
    });
    if (short) return { ok: false, reason: "short", detail: `Not enough ${short.sku} in stock` };
    for (const { sku, qty } of need) {
      const p = this.parts.get(sku)!;
      p.onHand -= qty;
      this.touch(p);
      this.log(sku, "consume", qty, `Caught in bin ${bin.name}`, null);
    }
    for (const x of tree) if (x.sku) x.stockTaken = true;
    s.binId = id;
    return { ok: true, value: undefined };
  }

  async releaseFromBin(id: string, shapeId: string, at: { x: number; z: number }): Promise<BinResult> {
    const s = this.shapes.get(shapeId);
    if (!s || s.binId !== id) return { ok: false, reason: "not_in_bin" };
    Object.assign(s, { binId: null, position: { ...at }, updatedAt: new Date().toISOString() });
    return { ok: true, value: undefined };
  }

  private inBin(id: string): Shape[] {
    return [...this.shapes.values()].filter((s) => s.binId === id);
  }

  /** A shape and everything joined onto it, all the way down. */
  private subtree(id: string): Shape[] {
    const out: Shape[] = [];
    const visit = (sid: string) => {
      const s = this.shapes.get(sid);
      if (!s || out.includes(s)) return;
      out.push(s);
      for (const c of this.shapes.values()) if (c.attachedTo === sid) visit(c.id);
    };
    visit(id);
    return out;
  }

  async listAssemblies(limit: number): Promise<Assembly[]> {
    return this.assemblies.slice(0, limit).map((a) => structuredClone(a));
  }

  async listSplitters(): Promise<Splitter[]> {
    return [...this.splitters.values()].map((s) => structuredClone(s));
  }

  async createSplitter(input: NewSplitter): Promise<Splitter> {
    const now = new Date().toISOString();
    const s: Splitter = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now };
    this.splitters.set(s.id, s);
    return structuredClone(s);
  }

  async updateSplitter(id: string, patch: SplitterPatch): Promise<Splitter> {
    const s = this.splitters.get(id);
    if (!s) throw new NotFoundError(`No splitter ${id}`);
    Object.assign(s, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return structuredClone(s);
  }

  async deleteSplitter(id: string): Promise<void> {
    if (!this.splitters.delete(id)) throw new NotFoundError(`No splitter ${id}`);
  }

  async listRobots(): Promise<Robot[]> {
    return [...this.robots.values()].map((r) => structuredClone(r));
  }

  async createRobot(input: NewRobot): Promise<Robot> {
    const now = new Date().toISOString();
    const r: Robot = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now };
    this.robots.set(r.id, r);
    return structuredClone(r);
  }

  async updateRobot(id: string, patch: RobotPatch): Promise<Robot> {
    const r = this.robots.get(id);
    if (!r) throw new NotFoundError(`No robot ${id}`);
    Object.assign(r, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return structuredClone(r);
  }

  async deleteRobot(id: string): Promise<void> {
    if (!this.robots.delete(id)) throw new NotFoundError(`No robot ${id}`);
  }

  async clearScene(): Promise<SceneCleared> {
    const out = { shapes: this.shapes.size, conveyors: this.conveyors.size, bins: this.bins.size, robots: this.robots.size };
    for (const m of [this.shapes, this.conveyors, this.splitters, this.mergers, this.machines, this.bins, this.robots]) m.clear();
    return out;
  }

  async reset(): Promise<void> {
    this.robots.clear();
    this.splitters.clear();
    this.connectors.clear();
    this.mergers.clear();
    this.machines.clear();
    this.assemblies = [];
    this.bins.clear();
    this.conveyors.clear();
    this.shapes.clear();
    this.parts.clear();
    this.moves = [];
    this.res.clear();
  }

  private close_(id: string, action: "release" | "fulfil"): Reservation {
    const r = this.res.get(id);
    if (!r) throw new NotFoundError(`No reservation ${id}`);
    if (r.status !== "active") throw new ConflictError(`Reservation is already ${r.status}`);
    for (const { sku, qty } of r.lines) {
      const p = this.parts.get(sku)!;
      p.reserved -= qty;
      if (action === "fulfil") p.onHand -= qty;
      this.touch(p);
      this.log(sku, action, qty, `${action === "fulfil" ? "Shipped" : "Released"} for ${r.quoteRef}`, id);
    }
    r.status = action === "fulfil" ? "fulfilled" : "released";
    r.closedAt = new Date().toISOString();
    return structuredClone(r);
  }

  private row(sku: string): PartRow {
    const p = this.parts.get(sku);
    if (!p) throw new NotFoundError(`No part ${sku}`);
    return p;
  }

  private touch(p: PartRow) {
    p.updatedAt = new Date().toISOString();
  }

  private log(sku: string, kind: MovementKind, qty: number, note: string, reservationId: string | null) {
    this.moves.push({ id: String(++this.seq), sku, kind, qty, note, reservationId, at: new Date().toISOString() });
  }
}

function out(p: PartRow): Part {
  return withDerived({ ...p });
}

/**
 * The parts a join (or a bin catch) uses up: each shape that stands for a part, unless its part
 * already left stock (stockTaken) or it was joined into an earlier assembly. Sorted by SKU.
 */
export function consumption(shapes: readonly Shape[], alreadyJoined: (id: string) => boolean): { sku: string; qty: number }[] {
  const need = new Map<string, number>();
  for (const s of shapes) if (s.sku && !s.stockTaken && !alreadyJoined(s.id)) need.set(s.sku, (need.get(s.sku) ?? 0) + 1);
  return [...need].sort(([a], [b]) => (a < b ? -1 : 1)).map(([sku, qty]) => ({ sku, qty }));
}
