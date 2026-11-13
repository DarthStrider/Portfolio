/**
 * PostgreSQL implementation.
 *
 * Single-row changes are one statement each: an UPDATE whose WHERE clause carries the
 * rule (`on_hand - reserved >= $2`), with the ledger insert in the same statement via a
 * CTE. Postgres re-checks that WHERE clause against the latest row version when two
 * updates race, so the rule holds without explicit locks. Multi-row changes
 * (reserve, release, fulfil) are PL/pgSQL functions in schema.sql: one round trip,
 * one transaction, rows locked in SKU order.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { ConflictError, NotFoundError } from "../domain/errors.ts";
import { mergeLines, withDerived } from "../domain/lines.ts";
import { Q } from "./postgres-sql.ts";
import type {
  InventoryRepo, Line, Movement, Part, PartFilter, Reservation, ReserveResult, SeedPart, Shortage,
} from "../domain/types.ts";
import type { NewShape, Shape, ShapeKind, ShapePatch } from "../domain/shapes.ts";
import { withSectionDefaults, type Conveyor, type ConveyorPatch, type ConveyorUpdate, type NewConveyor, type SectionKind } from "../domain/conveyors.ts";
import type { Exit, NewSplitter, Rule, Splitter, SplitterPatch } from "../domain/splitters.ts";
import type { PartPatch } from "../domain/newPart.ts";
import type { Bin, BinPatch, BinResult, Feed, LoadLine, NewBin } from "../domain/bins.ts";
import type { Condition } from "../domain/splitters.ts";
import type {
  AssembleResult, Assembly, Attachment, ConnectionPoint, Connectors, Machine, MachinePatch, Merger, MergerPatch, NewAssembly, NewMachine, NewMerger, Owner,
} from "../domain/assembly.ts";


interface PartRow {
  sku: string; name: string; category: Part["category"]; unit: string;
  on_hand: number; reserved: number; reorder_level: number; location: string; updated_at: Date;
}
interface MovementRow { id: string; sku: string; kind: Movement["kind"]; qty: number; note: string; reservation_id: string | null; at: Date }
interface ReservationRow { id: string; quote_ref: string; status: Reservation["status"]; created_at: Date; closed_at: Date | null; lines: Line[] }

interface ShapeRow {
  id: string; name: string; kind: ShapeKind; size_x: number; size_y: number; size_z: number;
  color: string; x: number; z: number; rotation_y: number; sku: string | null;
  attached_to: string | null; attach: Attachment | null; bin_id: string | null; stock_taken: boolean; created_at: Date; updated_at: Date;
}
interface BinRow {
  id: string; name: string; holds: Owner[]; accept: Condition[]; capacity: number; x: number; z: number; rotation_y: number;
  feed: Feed; count: number; created_at: Date; updated_at: Date;
}
interface ConnectorsRow { owner: Owner; points: ConnectionPoint[]; updated_at: Date }
interface MergerRow {
  id: string; name: string; kind: Merger["kind"]; conveyor_id: string; along: number; feeder_ids: string[];
  priority: Merger["priority"]; gap: number; created_at: Date; updated_at: Date;
}
interface MachineRow {
  id: string; name: string; conveyor_id: string; along: number; base_owner: Owner; base_point: string;
  attach_owner: Owner; attach_point: string; cycle_seconds: number; created_at: Date; updated_at: Date;
}
interface AssemblyRow {
  id: string; name: string; base_shape_id: string; attached_shape_id: string; base_point: string; attached_point: string;
  consumed: { sku: string; qty: number }[]; created_at: Date;
}

interface ConveyorRow {
  id: string; name: string; length: number; width: number; height: number; speed: number;
  x: number; z: number; rotation_y: number; kind: SectionKind; turn: number; radius: number;
  line_id: string | null; line_index: number; created_at: Date; updated_at: Date;
}

interface SplitterRow {
  id: string; name: string; conveyor_id: string; along: number; rules: Rule[]; otherwise: Exit; created_at: Date; updated_at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresRepo implements InventoryRepo {
  readonly kind = "postgres";
  private readonly pool: pg.Pool;

  /** Connection settings come from the standard PG* environment variables, or `config`. */
  constructor(config: pg.PoolConfig = {}) {
    this.pool = new pg.Pool({ max: 10, ...config });
  }

  async init(): Promise<void> {
    await this.pool.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  }

  async seedIfEmpty(seed: readonly SeedPart[]): Promise<boolean> {
    const { rows } = await this.pool.query<{ n: number }>(Q.count);
    if (rows[0].n > 0) return false;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const s of seed) {
        await client.query(Q.insertPart, [s.sku, s.name, s.category, s.unit, s.onHand, s.reorderLevel, s.location]);
      }
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listParts(filter: PartFilter = {}): Promise<Part[]> {
    const search = filter.search?.trim() || null;
    const { rows } = await this.pool.query<PartRow>(Q.listParts, [search && escapeLike(search), filter.lowOnly ?? false]);
    return rows.map(toPart);
  }

  async getParts(skus: readonly string[]): Promise<Part[]> {
    const { rows } = await this.pool.query<PartRow>(Q.getParts, [skus]);
    return rows.map(toPart);
  }

  async createPart(s: SeedPart): Promise<Part> {
    const { rows } = await this.pool.query<PartRow>(Q.createPart, [s.sku, s.name, s.category, s.unit, s.onHand, s.reorderLevel, s.location]);
    // ON CONFLICT DO NOTHING returns no row when the SKU is taken, even if two requests race.
    if (!rows[0]) throw new ConflictError(`Part ${s.sku} already exists`);
    return toPart(rows[0]);
  }

  async updatePart(sku: string, p: PartPatch): Promise<Part> {
    const { rows } = await this.pool.query<PartRow>(Q.updatePart, [sku, p.name ?? null, p.category ?? null, p.location ?? null, p.reorderLevel ?? null]);
    if (!rows[0]) throw new NotFoundError(`No part ${sku}`);
    return toPart(rows[0]);
  }

  async receive(sku: string, qty: number, note: string): Promise<Part> {
    const { rows } = await this.pool.query<PartRow>(Q.receive, [sku, qty, note]);
    if (!rows[0]) throw new NotFoundError(`No part ${sku}`);
    return toPart(rows[0]);
  }

  async consume(sku: string, qty: number, note: string): Promise<Part> {
    const { rows } = await this.pool.query<PartRow>(Q.consume, [sku, qty, note]);
    if (rows[0]) return toPart(rows[0]);
    // No row updated: either the SKU doesn't exist or there wasn't enough available.
    const [part] = await this.getParts([sku]);
    if (!part) throw new NotFoundError(`No part ${sku}`);
    throw new ConflictError(`Only ${part.available} of ${sku} available`);
  }

  async movements({ sku, limit }: { sku?: string; limit: number }): Promise<Movement[]> {
    const { rows } = await this.pool.query<MovementRow>(Q.movements, [sku ?? null, limit]);
    return rows.map((m) => ({
      id: String(m.id), sku: m.sku, kind: m.kind, qty: m.qty, note: m.note, reservationId: m.reservation_id, at: m.at.toISOString(),
    }));
  }

  async reserve(quoteRef: string, lines: readonly Line[]): Promise<ReserveResult> {
    const { rows } = await this.pool.query<{ result: { ok: true; id: string } | { ok: false; shortages: Shortage[] } }>(
      Q.reserve, [quoteRef, JSON.stringify(mergeLines(lines))],
    );
    const result = rows[0].result;
    if (!result.ok) return { ok: false, shortages: result.shortages };
    return { ok: true, reservation: await this.reservation(result.id) };
  }

  async reservations(limit: number): Promise<Reservation[]> {
    const { rows } = await this.pool.query<ReservationRow>(Q.reservations, [null, limit]);
    return rows.map(toReservation);
  }

  async release(id: string): Promise<Reservation> {
    return this.closeReservation(id, "release");
  }

  async fulfil(id: string): Promise<Reservation> {
    return this.closeReservation(id, "fulfil");
  }

  async listShapes(): Promise<Shape[]> {
    const { rows } = await this.pool.query<ShapeRow>(Q.listShapes);
    return rows.map(toShape);
  }

  async createShape(s: NewShape): Promise<Shape> {
    const { rows } = await this.pool.query<ShapeRow>(Q.createShape, [
      s.name, s.kind, s.size.x, s.size.y, s.size.z, s.color, s.position.x, s.position.z, s.rotationY, s.sku,
    ]);
    return toShape(rows[0]);
  }

  async updateShape(id: string, p: ShapePatch): Promise<Shape> {
    if (!UUID.test(id)) throw new NotFoundError(`No shape ${id}`);
    // NULL means "keep the current value" (coalesce in the SQL).
    const { rows } = await this.pool.query<ShapeRow>(Q.updateShape, [
      id, p.name ?? null, p.color ?? null, p.position?.x ?? null, p.position?.z ?? null, p.rotationY ?? null,
    ]);
    if (!rows[0]) throw new NotFoundError(`No shape ${id}`);
    return toShape(rows[0]);
  }

  async deleteShape(id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundError(`No shape ${id}`);
    const { rowCount } = await this.pool.query(Q.deleteShape, [id]);
    if (!rowCount) throw new NotFoundError(`No shape ${id}`);
  }

  async listConveyors(): Promise<Conveyor[]> {
    const { rows } = await this.pool.query<ConveyorRow>(Q.listConveyors);
    return rows.map(toConveyor);
  }

  async createConveyor(input: NewConveyor): Promise<Conveyor> {
    const c = withSectionDefaults(input);
    const { rows } = await this.pool.query<ConveyorRow>(Q.createConveyor, [
      c.name, c.length, c.width, c.height, c.speed, c.position.x, c.position.z, c.rotationY,
      c.kind, c.turn, c.radius, c.lineId, c.lineIndex,
    ]);
    return toConveyor(rows[0]);
  }

  async updateConveyor(id: string, p: ConveyorPatch, db: Pick<pg.PoolClient, "query"> = this.pool): Promise<Conveyor> {
    if (!UUID.test(id)) throw new NotFoundError(`No conveyor ${id}`);
    const { rows } = await db.query<ConveyorRow>(Q.updateConveyor, [
      id, p.name ?? null, p.position?.x ?? null, p.position?.z ?? null, p.rotationY ?? null, p.speed ?? null,
      p.lineId !== undefined, p.lineId ?? null, p.lineIndex ?? null,
    ]);
    if (!rows[0]) throw new NotFoundError(`No conveyor ${id}`);
    return toConveyor(rows[0]);
  }

  async updateConveyors(updates: readonly ConveyorUpdate[]): Promise<Conveyor[]> {
    // One transaction: a whole line moves, or none of it does.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out: Conveyor[] = [];
      for (const { id, patch } of updates) out.push(await this.updateConveyor(id, patch, client));
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteConveyor(id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundError(`No conveyor ${id}`);
    // Splitters, machines and mergers on this belt go by ON DELETE CASCADE. Mergers it only
    // feeds are found through an array, so they're deleted first, in the same transaction.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(Q.deleteMergersFeeding, [id]);
      const { rowCount } = await client.query(Q.deleteConveyor, [id]);
      if (!rowCount) throw new NotFoundError(`No conveyor ${id}`);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listSplitters(): Promise<Splitter[]> {
    const { rows } = await this.pool.query<SplitterRow>(Q.listSplitters);
    return rows.map(toSplitter);
  }

  async createSplitter(s: NewSplitter): Promise<Splitter> {
    // The driver turns jsonb into objects on the way out; on the way in it needs a JSON string.
    const { rows } = await this.pool.query<SplitterRow>(Q.createSplitter, [s.name, s.conveyorId, s.along, JSON.stringify(s.rules), s.otherwise]);
    return toSplitter(rows[0]);
  }

  async updateSplitter(id: string, p: SplitterPatch): Promise<Splitter> {
    if (!UUID.test(id)) throw new NotFoundError(`No splitter ${id}`);
    const { rows } = await this.pool.query<SplitterRow>(Q.updateSplitter, [
      id, p.name ?? null, p.along ?? null, p.rules ? JSON.stringify(p.rules) : null, p.otherwise ?? null,
    ]);
    if (!rows[0]) throw new NotFoundError(`No splitter ${id}`);
    return toSplitter(rows[0]);
  }

  async deleteSplitter(id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundError(`No splitter ${id}`);
    const { rowCount } = await this.pool.query(Q.deleteSplitter, [id]);
    if (!rowCount) throw new NotFoundError(`No splitter ${id}`);
  }

  async listConnectors(): Promise<Connectors[]> {
    const { rows } = await this.pool.query<ConnectorsRow>(Q.listConnectors);
    return rows.map((r) => ({ owner: r.owner, points: r.points, updatedAt: r.updated_at.toISOString() }));
  }

  async setConnectors(owner: Owner, points: ConnectionPoint[]): Promise<Connectors> {
    // An upsert: one statement whether or not the kind had points before.
    const { rows } = await this.pool.query<ConnectorsRow>(Q.setConnectors, [owner, JSON.stringify(points)]);
    return { owner: rows[0].owner, points: rows[0].points, updatedAt: rows[0].updated_at.toISOString() };
  }

  async deleteConnectors(owner: Owner): Promise<void> {
    const { rowCount } = await this.pool.query(Q.deleteConnectors, [owner]);
    if (!rowCount) throw new NotFoundError(`No connection points stored for ${owner}`);
  }

  async listMergers(): Promise<Merger[]> {
    const { rows } = await this.pool.query<MergerRow>(Q.listMergers);
    return rows.map(toMerger);
  }

  async createMerger(m: NewMerger): Promise<Merger> {
    const { rows } = await this.pool.query<MergerRow>(Q.createMerger, [m.name, m.kind, m.conveyorId, m.along, m.feederIds, m.priority, m.gap]);
    return toMerger(rows[0]);
  }

  async updateMerger(id: string, p: MergerPatch): Promise<Merger> {
    if (!UUID.test(id)) throw new NotFoundError(`No merger ${id}`);
    const { rows } = await this.pool.query<MergerRow>(Q.updateMerger, [id, p.name ?? null, p.along ?? null, p.priority ?? null, p.gap ?? null]);
    if (!rows[0]) throw new NotFoundError(`No merger ${id}`);
    return toMerger(rows[0]);
  }

  async deleteMerger(id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundError(`No merger ${id}`);
    const { rowCount } = await this.pool.query(Q.deleteMerger, [id]);
    if (!rowCount) throw new NotFoundError(`No merger ${id}`);
  }

  async listMachines(): Promise<Machine[]> {
    const { rows } = await this.pool.query<MachineRow>(Q.listMachines);
    return rows.map(toMachine);
  }

  async createMachine(m: NewMachine): Promise<Machine> {
    const { rows } = await this.pool.query<MachineRow>(Q.createMachine, [
      m.name, m.conveyorId, m.along, m.base.owner, m.base.point, m.attach.owner, m.attach.point, m.cycleSeconds,
    ]);
    return toMachine(rows[0]);
  }

  async updateMachine(id: string, p: MachinePatch): Promise<Machine> {
    if (!UUID.test(id)) throw new NotFoundError(`No machine ${id}`);
    const { rows } = await this.pool.query<MachineRow>(Q.updateMachine, [
      id, p.name ?? null, p.along ?? null, p.base?.owner ?? null, p.base?.point ?? null, p.attach?.owner ?? null, p.attach?.point ?? null, p.cycleSeconds ?? null,
    ]);
    if (!rows[0]) throw new NotFoundError(`No machine ${id}`);
    return toMachine(rows[0]);
  }

  async deleteMachine(id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundError(`No machine ${id}`);
    const { rowCount } = await this.pool.query(Q.deleteMachine, [id]);
    if (!rowCount) throw new NotFoundError(`No machine ${id}`);
  }

  async assemble(a: NewAssembly): Promise<AssembleResult> {
    // One call to inv_assemble (schema.sql): locks, checks, stock, ledger and the join in one transaction.
    const { rows } = await this.pool.query<{ result: { ok: true; id: string } | Exclude<AssembleResult, { ok: true }> }>(Q.assemble, [
      a.name, a.baseShapeId, a.attachedShapeId, a.basePoint, a.attachedPoint, JSON.stringify(a.attachment),
    ]);
    const result = rows[0].result;
    if (!result.ok) return result;
    const { rows: made } = await this.pool.query<AssemblyRow>(Q.listAssemblies, [result.id, 1]);
    return { ok: true, assembly: toAssembly(made[0]) };
  }

  async listAssemblies(limit: number): Promise<Assembly[]> {
    const { rows } = await this.pool.query<AssemblyRow>(Q.listAssemblies, [null, limit]);
    return rows.map(toAssembly);
  }

  async listBins(): Promise<Bin[]> {
    const { rows } = await this.pool.query<BinRow>(Q.listBins, [null]);
    return rows.map(toBin);
  }

  private async bin(id: string): Promise<Bin> {
    const { rows } = await this.pool.query<BinRow>(Q.listBins, [id]);
    if (!rows[0]) throw new NotFoundError(`No bin ${id}`);
    return toBin(rows[0]);
  }

  async createBin(b: NewBin): Promise<Bin> {
    const { rows } = await this.pool.query<{ id: string }>(Q.createBin, [
      b.name, b.holds, JSON.stringify(b.accept), b.capacity, b.position.x, b.position.z, b.rotationY, JSON.stringify(b.feed),
    ]);
    return this.bin(rows[0].id);
  }

  async updateBin(id: string, p: BinPatch): Promise<Bin> {
    if (!UUID.test(id)) throw new NotFoundError(`No bin ${id}`);
    const { rows } = await this.pool.query<{ id: string }>(Q.updateBin, [
      id, p.name ?? null, p.holds ?? null, p.accept ? JSON.stringify(p.accept) : null, p.capacity ?? null,
      p.position?.x ?? null, p.position?.z ?? null, p.rotationY ?? null, p.feed ? JSON.stringify(p.feed) : null,
    ]);
    if (!rows[0]) throw new NotFoundError(`No bin ${id}`);
    return this.bin(id);
  }

  async deleteBin(id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundError(`No bin ${id}`);
    try {
      const { rowCount } = await this.pool.query(Q.deleteBin, [id]);
      if (!rowCount) throw new NotFoundError(`No bin ${id}`);
    } catch (err) {
      // ON DELETE RESTRICT: shapes are still stored in it.
      if ((err as { code?: string }).code === "23503") throw new ConflictError("Empty the bin before deleting it");
      throw err;
    }
  }

  async loadBin(id: string, lines: readonly LoadLine[], addToHolds: boolean): Promise<BinResult<{ count: number; holds: Owner[] }>> {
    if (!UUID.test(id)) return { ok: false, reason: "not_found" };
    // One call: inv_bin_load (schema.sql) locks, checks and loads every line in one transaction.
    const { rows } = await this.pool.query<{ result: { ok: true; count: number; holds: Owner[] } | Exclude<BinResult, { ok: true }> }>(Q.loadBin, [
      id, JSON.stringify(lines.map((l) => ({ owner: l.owner, qty: l.qty, ...l.look }))), addToHolds,
    ]);
    const r = rows[0].result;
    return r.ok ? { ok: true, value: { count: r.count, holds: r.holds } } : r;
  }

  async unloadBin(id: string, qty: number): Promise<BinResult<{ unloaded: number }>> {
    if (!UUID.test(id)) return { ok: false, reason: "not_found" };
    const { rows } = await this.pool.query<{ result: { ok: true; unloaded: number } | Exclude<BinResult, { ok: true }> }>(Q.unloadBin, [id, qty]);
    const r = rows[0].result;
    return r.ok ? { ok: true, value: { unloaded: r.unloaded } } : r;
  }

  async catchIntoBin(id: string, shapeId: string): Promise<BinResult> {
    if (!UUID.test(id) || !UUID.test(shapeId)) return { ok: false, reason: "not_found" };
    const { rows } = await this.pool.query<{ result: { ok: true } | Exclude<BinResult, { ok: true }> }>(Q.catchIntoBin, [id, shapeId]);
    const r = rows[0].result;
    return r.ok ? { ok: true, value: undefined } : r;
  }

  async releaseFromBin(id: string, shapeId: string, at: { x: number; z: number }): Promise<BinResult> {
    if (!UUID.test(id) || !UUID.test(shapeId)) return { ok: false, reason: "not_in_bin" };
    const { rowCount } = await this.pool.query(Q.releaseFromBin, [id, shapeId, at.x, at.z]);
    return rowCount ? { ok: true, value: undefined } : { ok: false, reason: "not_in_bin" };
  }

  async reset(): Promise<void> {
    await this.pool.query(Q.reset);
  }

  private async closeReservation(id: string, action: "release" | "fulfil"): Promise<Reservation> {
    if (!UUID.test(id)) throw new NotFoundError(`No reservation ${id}`);
    const { rows } = await this.pool.query<{ result: string }>(Q.close, [id, action]);
    const result = rows[0].result;
    if (result === "not_found") throw new NotFoundError(`No reservation ${id}`);
    if (result !== "ok") throw new ConflictError(`Reservation is already ${result}`);
    return this.reservation(id);
  }

  private async reservation(id: string): Promise<Reservation> {
    const { rows } = await this.pool.query<ReservationRow>(Q.reservations, [id, 1]);
    if (!rows[0]) throw new NotFoundError(`No reservation ${id}`);
    return toReservation(rows[0]);
  }
}

/** `%` and `_` in a search box are literal characters, not wildcards. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toPart(r: PartRow): Part {
  return withDerived({
    sku: r.sku, name: r.name, category: r.category, unit: r.unit, onHand: r.on_hand, reserved: r.reserved,
    reorderLevel: r.reorder_level, location: r.location, updatedAt: r.updated_at.toISOString(),
  });
}

function toReservation(r: ReservationRow): Reservation {
  return {
    id: r.id, quoteRef: r.quote_ref, status: r.status, lines: r.lines,
    createdAt: r.created_at.toISOString(), closedAt: r.closed_at ? r.closed_at.toISOString() : null,
  };
}

function toShape(r: ShapeRow): Shape {
  return {
    id: r.id, name: r.name, kind: r.kind, size: { x: r.size_x, y: r.size_y, z: r.size_z }, color: r.color,
    position: { x: r.x, z: r.z }, rotationY: r.rotation_y, sku: r.sku, attachedTo: r.attached_to, attach: r.attach, binId: r.bin_id, stockTaken: r.stock_taken,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

function toConveyor(r: ConveyorRow): Conveyor {
  return {
    id: r.id, name: r.name, length: r.length, width: r.width, height: r.height, speed: r.speed,
    position: { x: r.x, z: r.z }, rotationY: r.rotation_y,
    kind: r.kind, turn: r.turn, radius: r.radius, lineId: r.line_id, lineIndex: r.line_index,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

function toSplitter(r: SplitterRow): Splitter {
  return {
    id: r.id, name: r.name, conveyorId: r.conveyor_id, along: r.along, rules: r.rules, otherwise: r.otherwise,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

function toMerger(r: MergerRow): Merger {
  return {
    id: r.id, name: r.name, kind: r.kind, conveyorId: r.conveyor_id, along: r.along, feederIds: r.feeder_ids,
    priority: r.priority, gap: r.gap, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

function toMachine(r: MachineRow): Machine {
  return {
    id: r.id, name: r.name, conveyorId: r.conveyor_id, along: r.along,
    base: { owner: r.base_owner, point: r.base_point }, attach: { owner: r.attach_owner, point: r.attach_point },
    cycleSeconds: r.cycle_seconds, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

function toAssembly(r: AssemblyRow): Assembly {
  return {
    id: r.id, name: r.name, baseShapeId: r.base_shape_id, attachedShapeId: r.attached_shape_id,
    basePoint: r.base_point, attachedPoint: r.attached_point, consumed: r.consumed, createdAt: r.created_at.toISOString(),
  };
}

function toBin(r: BinRow): Bin {
  return {
    id: r.id, name: r.name, holds: r.holds, accept: r.accept, capacity: r.capacity, position: { x: r.x, z: r.z },
    rotationY: r.rotation_y, feed: r.feed, count: r.count, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}
