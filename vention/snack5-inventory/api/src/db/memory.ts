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
import type { Conveyor, ConveyorPatch, NewConveyor } from "../domain/conveyors.ts";
import type { NewSplitter, Splitter, SplitterPatch } from "../domain/splitters.ts";
import type { PartPatch } from "../domain/newPart.ts";

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
    const shape: Shape = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now };
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
  }

  async listConveyors(): Promise<Conveyor[]> {
    return [...this.conveyors.values()].map((c) => structuredClone(c));
  }

  async createConveyor(input: NewConveyor): Promise<Conveyor> {
    const now = new Date().toISOString();
    const c: Conveyor = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now };
    this.conveyors.set(c.id, c);
    return structuredClone(c);
  }

  async updateConveyor(id: string, patch: ConveyorPatch): Promise<Conveyor> {
    const c = this.conveyors.get(id);
    if (!c) throw new NotFoundError(`No conveyor ${id}`);
    Object.assign(c, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return structuredClone(c);
  }

  async deleteConveyor(id: string): Promise<void> {
    if (!this.conveyors.delete(id)) throw new NotFoundError(`No conveyor ${id}`);
    // Like the foreign key's ON DELETE CASCADE in Postgres.
    for (const [sid, s] of this.splitters) if (s.conveyorId === id) this.splitters.delete(sid);
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

  async reset(): Promise<void> {
    this.splitters.clear();
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
