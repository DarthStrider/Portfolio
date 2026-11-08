/**
 * MongoDB implementation.
 *
 * Each part is one document, and MongoDB updates a single document atomically. So every
 * stock rule is written into the update's filter: "add 4 to reserved, but only if
 * onHand - reserved is at least 4". If another request got there first, the filter no
 * longer matches and nothing changes. That gives the same guarantees as the Postgres
 * row-level checks, with no multi-document transaction, so a standalone mongod works.
 *
 * A reservation touches several documents, so it's done as a small saga:
 *   1. insert the reservation as "pending";
 *   2. hold each line with a conditional $inc, in SKU order;
 *   3. if any line fails, undo the holds already made and delete the pending reservation;
 *   4. otherwise mark it "active" and write the ledger.
 * Concurrent readers can briefly see a hold that's about to be undone. Stock is never
 * over-reserved; at worst, a racing reservation is refused when it could just have fit.
 * A crash between steps leaves a "pending" reservation that says exactly which holds to
 * undo. With a replica set, the same steps could run inside a transaction instead.
 */
import { randomUUID } from "node:crypto";
import { MongoClient, type Collection, type Db, type Filter } from "mongodb";
import { ConflictError, NotFoundError } from "../domain/errors.ts";
import { mergeLines, withDerived } from "../domain/lines.ts";
import type {
  InventoryRepo, Line, Movement, MovementKind, Part, PartFilter, Reservation, ReserveResult, SeedPart, Shortage,
} from "../domain/types.ts";
import type { NewShape, Shape, ShapePatch } from "../domain/shapes.ts";
import type { Conveyor, ConveyorPatch, NewConveyor } from "../domain/conveyors.ts";
import type { NewSplitter, Splitter, SplitterPatch } from "../domain/splitters.ts";
import type { PartPatch } from "../domain/newPart.ts";

interface PartDoc {
  _id: string; // the SKU
  name: string; category: Part["category"]; unit: string;
  onHand: number; reserved: number; reorderLevel: number; location: string; updatedAt: Date;
}
interface MovementDoc { _id: string; seq: number; sku: string; kind: MovementKind; qty: number; note: string; reservationId: string | null; at: Date }
interface ReservationDoc {
  _id: string; quoteRef: string; status: Reservation["status"] | "pending"; lines: Line[]; createdAt: Date; closedAt: Date | null;
}
interface CounterDoc { _id: string; value: number }
/** A shape is stored almost exactly as the API returns it: documents fit nested data like size and position. */
interface ShapeDoc extends Omit<Shape, "id" | "createdAt" | "updatedAt"> { _id: string; createdAt: Date; updatedAt: Date }
/** Conveyors too: the nested position stays nested. */
interface ConveyorDoc extends Omit<Conveyor, "id" | "createdAt" | "updatedAt"> { _id: string; createdAt: Date; updatedAt: Date }
/** A splitter's rules are nested lists of objects: a document holds them as they are. */
interface SplitterDoc extends Omit<Splitter, "id" | "createdAt" | "updatedAt"> { _id: string; createdAt: Date; updatedAt: Date }

/** `onHand - reserved >= qty`, as a query filter. */
const atLeastAvailable = (qty: number) => ({ $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, qty] } });

export class MongoRepo implements InventoryRepo {
  readonly kind = "mongo";
  private readonly client: MongoClient;
  private readonly db: Db;
  private readonly parts: Collection<PartDoc>;
  private readonly moves: Collection<MovementDoc>;
  private readonly res: Collection<ReservationDoc>;
  private readonly counters: Collection<CounterDoc>;
  private readonly shapes: Collection<ShapeDoc>;
  private readonly conveyors: Collection<ConveyorDoc>;
  private readonly splitters: Collection<SplitterDoc>;

  constructor(url: string, dbName = "inventory") {
    this.client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
    this.db = this.client.db(dbName);
    this.parts = this.db.collection<PartDoc>("parts");
    this.moves = this.db.collection<MovementDoc>("movements");
    this.res = this.db.collection<ReservationDoc>("reservations");
    this.counters = this.db.collection<CounterDoc>("counters");
    this.shapes = this.db.collection<ShapeDoc>("shapes");
    this.conveyors = this.db.collection<ConveyorDoc>("conveyors");
    this.splitters = this.db.collection<SplitterDoc>("splitters");
  }

  async init(): Promise<void> {
    await this.client.connect();
    await this.moves.createIndex({ sku: 1, seq: -1 });
    await this.moves.createIndex({ seq: -1 });
    await this.res.createIndex({ createdAt: -1 });
  }

  async seedIfEmpty(seed: readonly SeedPart[]): Promise<boolean> {
    if ((await this.parts.estimatedDocumentCount()) > 0) return false;
    const now = new Date();
    try {
      await this.parts.insertMany(
        seed.map((s) => ({
          _id: s.sku, name: s.name, category: s.category, unit: s.unit,
          onHand: s.onHand, reserved: 0, reorderLevel: s.reorderLevel, location: s.location, updatedAt: now,
        })),
        { ordered: false },
      );
    } catch (err) {
      // Another API replica seeded at the same moment: duplicate keys are fine.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    return true;
  }

  async ping(): Promise<void> {
    await this.db.command({ ping: 1 });
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async listParts(filter: PartFilter = {}): Promise<Part[]> {
    const q: Filter<PartDoc> = {};
    const search = filter.search?.trim();
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [{ _id: re }, { name: re }];
    }
    if (filter.lowOnly) q.$expr = { $lte: [{ $subtract: ["$onHand", "$reserved"] }, "$reorderLevel"] };
    return (await this.parts.find(q).sort({ _id: 1 }).toArray()).map(toPart);
  }

  async getParts(skus: readonly string[]): Promise<Part[]> {
    return (await this.parts.find({ _id: { $in: [...skus] } }).sort({ _id: 1 }).toArray()).map(toPart);
  }

  async createPart(s: SeedPart): Promise<Part> {
    const doc: PartDoc = {
      _id: s.sku, name: s.name, category: s.category, unit: s.unit,
      onHand: s.onHand, reserved: 0, reorderLevel: s.reorderLevel, location: s.location, updatedAt: new Date(),
    };
    try {
      await this.parts.insertOne(doc);
    } catch (err) {
      // The SKU is the _id, so the unique index rejects a duplicate, even if two requests race.
      if ((err as { code?: number }).code === 11000) throw new ConflictError(`Part ${s.sku} already exists`);
      throw err;
    }
    if (s.onHand > 0) await this.log([{ sku: s.sku, kind: "receive", qty: s.onHand, note: "Initial stock", reservationId: null }]);
    return toPart(doc);
  }

  async updatePart(sku: string, patch: PartPatch): Promise<Part> {
    const doc = await this.parts.findOneAndUpdate({ _id: sku }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundError(`No part ${sku}`);
    return toPart(doc);
  }

  async receive(sku: string, qty: number, note: string): Promise<Part> {
    const doc = await this.parts.findOneAndUpdate(
      { _id: sku },
      { $inc: { onHand: qty }, $set: { updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!doc) throw new NotFoundError(`No part ${sku}`);
    await this.log([{ sku, kind: "receive", qty, note, reservationId: null }]);
    return toPart(doc);
  }

  async consume(sku: string, qty: number, note: string): Promise<Part> {
    const doc = await this.parts.findOneAndUpdate(
      { _id: sku, ...atLeastAvailable(qty) },
      { $inc: { onHand: -qty }, $set: { updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!doc) {
      const [part] = await this.getParts([sku]);
      if (!part) throw new NotFoundError(`No part ${sku}`);
      throw new ConflictError(`Only ${part.available} of ${sku} available`);
    }
    await this.log([{ sku, kind: "consume", qty, note, reservationId: null }]);
    return toPart(doc);
  }

  async movements({ sku, limit }: { sku?: string; limit: number }): Promise<Movement[]> {
    const docs = await this.moves.find(sku ? { sku } : {}).sort({ seq: -1 }).limit(limit).toArray();
    return docs.map((m) => ({
      id: String(m.seq), sku: m.sku, kind: m.kind, qty: m.qty, note: m.note, reservationId: m.reservationId, at: m.at.toISOString(),
    }));
  }

  async reserve(quoteRef: string, lines: readonly Line[]): Promise<ReserveResult> {
    const want = mergeLines(lines);
    const id = randomUUID();
    await this.res.insertOne({ _id: id, quoteRef, status: "pending", lines: want, createdAt: new Date(), closedAt: null });

    const held: Line[] = [];
    for (const line of want) {
      const r = await this.parts.updateOne(
        { _id: line.sku, ...atLeastAvailable(line.qty) },
        { $inc: { reserved: line.qty }, $set: { updatedAt: new Date() } },
      );
      if (r.modifiedCount !== 1) break;
      held.push(line);
    }

    if (held.length < want.length) {
      for (const line of held) await this.parts.updateOne({ _id: line.sku }, { $inc: { reserved: -line.qty } });
      await this.res.deleteOne({ _id: id });
      return { ok: false, shortages: await this.shortages(want, want[held.length]) };
    }

    await this.res.updateOne({ _id: id }, { $set: { status: "active" } });
    await this.log(want.map((l) => ({ sku: l.sku, kind: "reserve" as const, qty: l.qty, note: `Reserved for ${quoteRef}`, reservationId: id })));
    return { ok: true, reservation: toReservation((await this.res.findOne({ _id: id }))!) };
  }

  async reservations(limit: number): Promise<Reservation[]> {
    const docs = await this.res.find({ status: { $ne: "pending" } }).sort({ createdAt: -1, _id: 1 }).limit(limit).toArray();
    return docs.map(toReservation);
  }

  async release(id: string): Promise<Reservation> {
    return this.closeReservation(id, "release");
  }

  async fulfil(id: string): Promise<Reservation> {
    return this.closeReservation(id, "fulfil");
  }

  async listShapes(): Promise<Shape[]> {
    return (await this.shapes.find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map(toShape);
  }

  async createShape(s: NewShape): Promise<Shape> {
    const now = new Date();
    const doc: ShapeDoc = { ...s, _id: randomUUID(), createdAt: now, updatedAt: now };
    await this.shapes.insertOne(doc);
    return toShape(doc);
  }

  async updateShape(id: string, patch: ShapePatch): Promise<Shape> {
    const doc = await this.shapes.findOneAndUpdate(
      { _id: id },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!doc) throw new NotFoundError(`No shape ${id}`);
    return toShape(doc);
  }

  async deleteShape(id: string): Promise<void> {
    const r = await this.shapes.deleteOne({ _id: id });
    if (r.deletedCount !== 1) throw new NotFoundError(`No shape ${id}`);
  }

  async listConveyors(): Promise<Conveyor[]> {
    return (await this.conveyors.find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map(toConveyor);
  }

  async createConveyor(c: NewConveyor): Promise<Conveyor> {
    const now = new Date();
    const doc: ConveyorDoc = { ...c, _id: randomUUID(), createdAt: now, updatedAt: now };
    await this.conveyors.insertOne(doc);
    return toConveyor(doc);
  }

  async updateConveyor(id: string, patch: ConveyorPatch): Promise<Conveyor> {
    const doc = await this.conveyors.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundError(`No conveyor ${id}`);
    return toConveyor(doc);
  }

  async deleteConveyor(id: string): Promise<void> {
    const r = await this.conveyors.deleteOne({ _id: id });
    if (r.deletedCount !== 1) throw new NotFoundError(`No conveyor ${id}`);
    // No foreign keys here: delete the belt's splitters ourselves. A splitter created for this
    // belt in the instant between the two deletes would be left pointing at nothing; the arm
    // app ignores splitters whose belt is gone, and Postgres's foreign key rules it out.
    await this.splitters.deleteMany({ conveyorId: id });
  }

  async listSplitters(): Promise<Splitter[]> {
    return (await this.splitters.find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map(toSplitter);
  }

  async createSplitter(s: NewSplitter): Promise<Splitter> {
    const now = new Date();
    const doc: SplitterDoc = { ...s, _id: randomUUID(), createdAt: now, updatedAt: now };
    await this.splitters.insertOne(doc);
    return toSplitter(doc);
  }

  async updateSplitter(id: string, patch: SplitterPatch): Promise<Splitter> {
    const doc = await this.splitters.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundError(`No splitter ${id}`);
    return toSplitter(doc);
  }

  async deleteSplitter(id: string): Promise<void> {
    const r = await this.splitters.deleteOne({ _id: id });
    if (r.deletedCount !== 1) throw new NotFoundError(`No splitter ${id}`);
  }

  async reset(): Promise<void> {
    await Promise.all([this.splitters.deleteMany({}), this.conveyors.deleteMany({}), this.shapes.deleteMany({}), this.parts.deleteMany({}), this.moves.deleteMany({}), this.res.deleteMany({}), this.counters.deleteMany({})]);
  }

  /**
   * Claim the reservation first by flipping its status with a conditional update, so two
   * simultaneous "release" clicks can't both give the stock back.
   */
  private async closeReservation(id: string, action: "release" | "fulfil"): Promise<Reservation> {
    const doc = await this.res.findOneAndUpdate(
      { _id: id, status: "active" },
      { $set: { status: action === "fulfil" ? "fulfilled" : "released", closedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!doc) {
      const existing = await this.res.findOne({ _id: id });
      if (!existing || existing.status === "pending") throw new NotFoundError(`No reservation ${id}`);
      throw new ConflictError(`Reservation is already ${existing.status}`);
    }
    for (const { sku, qty } of doc.lines) {
      const inc = action === "fulfil" ? { reserved: -qty, onHand: -qty } : { reserved: -qty };
      await this.parts.updateOne({ _id: sku }, { $inc: inc, $set: { updatedAt: new Date() } });
    }
    await this.log(doc.lines.map((l) => ({
      sku: l.sku, kind: action, qty: l.qty, note: `${action === "fulfil" ? "Shipped" : "Released"} for ${doc.quoteRef}`, reservationId: id,
    })));
    return toReservation(doc);
  }

  /** Current shortages for `want`. If a race already freed the stock, still report the line that failed. */
  private async shortages(want: Line[], failed: Line): Promise<Shortage[]> {
    const current = await this.getParts(want.map((l) => l.sku));
    const bySku = new Map(current.map((p) => [p.sku, p]));
    const out: Shortage[] = [];
    for (const { sku, qty } of want) {
      const p = bySku.get(sku);
      const available = p?.available ?? 0;
      if (available < qty || sku === failed.sku) out.push({ sku, need: qty, available, known: p !== undefined });
    }
    return out;
  }

  /** Ledger entries get an increasing sequence number from a counter document, so "newest first" is exact. */
  private async log(entries: Omit<MovementDoc, "_id" | "seq" | "at">[]): Promise<void> {
    if (entries.length === 0) return;
    const counter = await this.counters.findOneAndUpdate(
      { _id: "movements" },
      { $inc: { value: entries.length } },
      { upsert: true, returnDocument: "after" },
    );
    const last = counter!.value;
    const at = new Date();
    await this.moves.insertMany(entries.map((e, i) => ({ ...e, _id: randomUUID(), seq: last - entries.length + i + 1, at })));
  }
}

function toPart(d: PartDoc): Part {
  return withDerived({
    sku: d._id, name: d.name, category: d.category, unit: d.unit, onHand: d.onHand, reserved: d.reserved,
    reorderLevel: d.reorderLevel, location: d.location, updatedAt: d.updatedAt.toISOString(),
  });
}

function toReservation(d: ReservationDoc): Reservation {
  return {
    id: d._id, quoteRef: d.quoteRef, status: d.status as Reservation["status"], lines: d.lines,
    createdAt: d.createdAt.toISOString(), closedAt: d.closedAt ? d.closedAt.toISOString() : null,
  };
}

function toShape(d: ShapeDoc): Shape {
  return {
    id: d._id, name: d.name, kind: d.kind, size: d.size, color: d.color, position: d.position, rotationY: d.rotationY,
    sku: d.sku ?? null, // shapes saved before parts could be placed have no sku field
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

function toConveyor(d: ConveyorDoc): Conveyor {
  return {
    id: d._id, name: d.name, length: d.length, width: d.width, height: d.height, speed: d.speed,
    position: d.position, rotationY: d.rotationY,
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

function toSplitter(d: SplitterDoc): Splitter {
  return {
    id: d._id, name: d.name, conveyorId: d.conveyorId, along: d.along, rules: d.rules, otherwise: d.otherwise,
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}
