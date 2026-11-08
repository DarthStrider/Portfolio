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


interface PartRow {
  sku: string; name: string; category: Part["category"]; unit: string;
  on_hand: number; reserved: number; reorder_level: number; location: string; updated_at: Date;
}
interface MovementRow { id: string; sku: string; kind: Movement["kind"]; qty: number; note: string; reservation_id: string | null; at: Date }
interface ReservationRow { id: string; quote_ref: string; status: Reservation["status"]; created_at: Date; closed_at: Date | null; lines: Line[] }

interface ShapeRow {
  id: string; name: string; kind: ShapeKind; size_x: number; size_y: number; size_z: number;
  color: string; x: number; z: number; rotation_y: number; sku: string | null; created_at: Date; updated_at: Date;
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
    position: { x: r.x, z: r.z }, rotationY: r.rotation_y, sku: r.sku,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}
