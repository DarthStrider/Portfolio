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
import { withSectionDefaults, type Conveyor, type ConveyorPatch, type ConveyorUpdate, type NewConveyor } from "../domain/conveyors.ts";
import type { NewSplitter, Splitter, SplitterPatch } from "../domain/splitters.ts";
import type { PartPatch } from "../domain/newPart.ts";
import type {
  AssembleResult, Assembly, ConnectionPoint, Connectors, Machine, MachinePatch, Merger, MergerPatch, NewAssembly, NewMachine, NewMerger, Owner,
} from "../domain/assembly.ts";
import { consumption } from "./memory.ts";
import { stockNeeded, type Bin, type BinPatch, type BinResult, type LoadLine, type NewBin } from "../domain/bins.ts";
import type { NewRobot, Robot, RobotPatch } from "../domain/robots.ts";
import type { SceneCleared } from "../domain/types.ts";

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
/** Conveyors too: the nested position stays nested. Documents saved before lines existed have no section fields. */
interface ConveyorDoc extends Omit<Conveyor, "id" | "createdAt" | "updatedAt" | "kind" | "turn" | "radius" | "lineId" | "lineIndex">,
  Partial<Pick<Conveyor, "kind" | "turn" | "radius" | "lineId" | "lineIndex">> { _id: string; createdAt: Date; updatedAt: Date }
/** A splitter's rules are nested lists of objects: a document holds them as they are. */
interface SplitterDoc extends Omit<Splitter, "id" | "createdAt" | "updatedAt"> { _id: string; createdAt: Date; updatedAt: Date }
interface RobotDoc extends Omit<Robot, "id" | "createdAt" | "updatedAt"> { _id: string; createdAt: Date; updatedAt: Date }
interface BinDoc extends Omit<Bin, "id" | "count" | "createdAt" | "updatedAt"> { _id: string; createdAt: Date; updatedAt: Date }
interface ConnectorsDoc { _id: Owner; points: ConnectionPoint[]; updatedAt: Date }
interface MergerDoc extends Omit<Merger, "id" | "createdAt" | "updatedAt"> { _id: string; createdAt: Date; updatedAt: Date }
interface MachineDoc extends Omit<Machine, "id" | "createdAt" | "updatedAt"> { _id: string; createdAt: Date; updatedAt: Date }
interface AssemblyDoc extends Omit<Assembly, "id" | "createdAt"> { _id: string; createdAt: Date }

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
  private readonly connectors: Collection<ConnectorsDoc>;
  private readonly mergers: Collection<MergerDoc>;
  private readonly machines: Collection<MachineDoc>;
  private readonly assemblies: Collection<AssemblyDoc>;
  private readonly bins: Collection<BinDoc>;
  private readonly robots: Collection<RobotDoc>;

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
    this.connectors = this.db.collection<ConnectorsDoc>("connectors");
    this.mergers = this.db.collection<MergerDoc>("mergers");
    this.machines = this.db.collection<MachineDoc>("machines");
    this.assemblies = this.db.collection<AssemblyDoc>("assemblies");
    this.bins = this.db.collection<BinDoc>("bins");
    this.robots = this.db.collection<RobotDoc>("robots");
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
    const doc: ShapeDoc = { ...s, attachedTo: null, attach: null, binId: null, stockTaken: false, _id: randomUUID(), createdAt: now, updatedAt: now };
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
    // No ON DELETE CASCADE here: delete what was joined onto it, and so on down.
    for (const child of await this.shapes.find({ attachedTo: id }).toArray()) await this.deleteShape(child._id).catch(() => {});
  }

  async listConveyors(): Promise<Conveyor[]> {
    return (await this.conveyors.find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map(toConveyor);
  }

  async createConveyor(c: NewConveyor): Promise<Conveyor> {
    const now = new Date();
    const doc: ConveyorDoc = { ...withSectionDefaults(c), _id: randomUUID(), createdAt: now, updatedAt: now };
    await this.conveyors.insertOne(doc);
    return toConveyor(doc);
  }

  async updateConveyor(id: string, patch: ConveyorPatch): Promise<Conveyor> {
    const doc = await this.conveyors.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundError(`No conveyor ${id}`);
    return toConveyor(doc);
  }

  async updateConveyors(updates: readonly ConveyorUpdate[]): Promise<Conveyor[]> {
    // A standalone MongoDB has no multi-document transactions, so: check every id exists,
    // then write them all in one ordered bulk request. Only a crash between the two could
    // leave a line half moved, and the next move of the line puts every section right again.
    const ids = updates.map((u) => u.id);
    const found = new Set((await this.conveyors.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
    const missing = ids.find((id) => !found.has(id));
    if (missing) throw new NotFoundError(`No conveyor ${missing}`);
    const now = new Date();
    await this.conveyors.bulkWrite(updates.map(({ id, patch }) => ({ updateOne: { filter: { _id: id }, update: { $set: { ...patch, updatedAt: now } } } })));
    const byId = new Map((await this.conveyors.find({ _id: { $in: ids } }).toArray()).map((d) => [d._id, toConveyor(d)]));
    return ids.map((id) => byId.get(id)!);
  }

  async deleteConveyor(id: string): Promise<void> {
    const r = await this.conveyors.deleteOne({ _id: id });
    if (r.deletedCount !== 1) throw new NotFoundError(`No conveyor ${id}`);
    // No foreign keys here: delete the belt's splitters ourselves. A splitter created for this
    // belt in the instant between the two deletes would be left pointing at nothing; the arm
    // app ignores splitters whose belt is gone, and Postgres's foreign key rules it out.
    await this.splitters.deleteMany({ conveyorId: id });
    await this.machines.deleteMany({ conveyorId: id });
    await this.mergers.deleteMany({ $or: [{ conveyorId: id }, { feederIds: id }] });
  }

  async listConnectors(): Promise<Connectors[]> {
    return (await this.connectors.find({}).sort({ _id: 1 }).toArray()).map((d) => ({ owner: d._id, points: d.points, updatedAt: d.updatedAt.toISOString() }));
  }

  async setConnectors(owner: Owner, points: ConnectionPoint[]): Promise<Connectors> {
    const doc: ConnectorsDoc = { _id: owner, points, updatedAt: new Date() };
    await this.connectors.replaceOne({ _id: owner }, doc, { upsert: true });
    return { owner, points, updatedAt: doc.updatedAt.toISOString() };
  }

  async deleteConnectors(owner: Owner): Promise<void> {
    const r = await this.connectors.deleteOne({ _id: owner });
    if (r.deletedCount !== 1) throw new NotFoundError(`No connection points stored for ${owner}`);
  }

  async listMergers(): Promise<Merger[]> {
    return (await this.mergers.find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map((d) => fromDoc<Merger>(d));
  }

  async createMerger(m: NewMerger): Promise<Merger> {
    const now = new Date();
    const doc: MergerDoc = { ...m, _id: randomUUID(), createdAt: now, updatedAt: now };
    await this.mergers.insertOne(doc);
    return fromDoc<Merger>(doc);
  }

  async updateMerger(id: string, patch: MergerPatch): Promise<Merger> {
    const doc = await this.mergers.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundError(`No merger ${id}`);
    return fromDoc<Merger>(doc);
  }

  async deleteMerger(id: string): Promise<void> {
    if ((await this.mergers.deleteOne({ _id: id })).deletedCount !== 1) throw new NotFoundError(`No merger ${id}`);
  }

  async listMachines(): Promise<Machine[]> {
    return (await this.machines.find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map((d) => fromDoc<Machine>(d));
  }

  async createMachine(m: NewMachine): Promise<Machine> {
    const now = new Date();
    const doc: MachineDoc = { ...m, _id: randomUUID(), createdAt: now, updatedAt: now };
    await this.machines.insertOne(doc);
    return fromDoc<Machine>(doc);
  }

  async updateMachine(id: string, patch: MachinePatch): Promise<Machine> {
    const doc = await this.machines.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundError(`No machine ${id}`);
    return fromDoc<Machine>(doc);
  }

  async deleteMachine(id: string): Promise<void> {
    if ((await this.machines.deleteOne({ _id: id })).deletedCount !== 1) throw new NotFoundError(`No machine ${id}`);
  }

  /**
   * MongoDB has no multi-document transaction without a replica set, so this is a saga like
   * reserve(): claim the attached shape with a conditional update (so two joins can't both take
   * it), then use up each part with a conditional update; if any part is short, give back what
   * was taken and release the claim.
   */
  async assemble(a: NewAssembly): Promise<AssembleResult> {
    const [base, attached] = await Promise.all([this.shapes.findOne({ _id: a.baseShapeId }), this.shapes.findOne({ _id: a.attachedShapeId })]);
    if (!base || !attached) return { ok: false, reason: "not_found" };
    for (let s: ShapeDoc | null = base, depth = 0; s && depth < 50; depth++) {
      if (s._id === attached._id) return { ok: false, reason: "cycle" };
      s = s.attachedTo ? await this.shapes.findOne({ _id: s.attachedTo }) : null;
    }
    const joined = new Set((await this.assemblies.find({ $or: [
      { baseShapeId: { $in: [base._id, attached._id] } }, { attachedShapeId: { $in: [base._id, attached._id] } },
    ] }).toArray()).flatMap((x) => [x.baseShapeId, x.attachedShapeId]));
    const need = consumption([toShape(base), toShape(attached)], (id) => joined.has(id));

    const claim = await this.shapes.updateOne(
      { _id: attached._id, attachedTo: null }, // matches null or missing (shapes saved before assemblies)
      { $set: { attachedTo: base._id, attach: a.attachment, updatedAt: new Date() } },
    );
    if (claim.modifiedCount !== 1) return { ok: false, reason: "already_attached" };

    const taken: { sku: string; qty: number }[] = [];
    for (const n of need) {
      const r = await this.parts.updateOne({ _id: n.sku, ...atLeastAvailable(n.qty) }, { $inc: { onHand: -n.qty }, $set: { updatedAt: new Date() } });
      if (r.modifiedCount === 1) {
        taken.push(n);
        continue;
      }
      // Undo: give back what was taken, release the claim, and report what's short.
      for (const t of taken) await this.parts.updateOne({ _id: t.sku }, { $inc: { onHand: t.qty } });
      await this.shapes.updateOne({ _id: attached._id }, { $set: { attachedTo: null, attach: null } });
      const parts = await this.getParts(need.map((x) => x.sku));
      const shortages = need.flatMap((x) => {
        const available = parts.find((p) => p.sku === x.sku)?.available ?? 0;
        return available < x.qty ? [{ sku: x.sku, need: x.qty, available }] : [];
      });
      return { ok: false, reason: "short", shortages };
    }
    await this.shapes.updateMany({ _id: { $in: [base._id, attached._id] }, sku: { $ne: null } }, { $set: { stockTaken: true } });
    const doc: AssemblyDoc = {
      _id: randomUUID(), name: a.name, baseShapeId: base._id, attachedShapeId: attached._id,
      basePoint: a.basePoint, attachedPoint: a.attachedPoint, consumed: need, createdAt: new Date(),
    };
    await this.assemblies.insertOne(doc);
    if (need.length) await this.log(need.map(({ sku, qty }) => ({ sku, kind: "consume" as const, qty, note: `Assembly ${a.name} (${doc._id})`, reservationId: null })));
    return { ok: true, assembly: fromDoc<Assembly>(doc) };
  }

  async listBins(): Promise<Bin[]> {
    const docs = await this.bins.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
    return Promise.all(docs.map(async (d) => ({ ...fromDoc<Omit<Bin, "count">>(d), count: await this.shapes.countDocuments({ binId: d._id }) })));
  }

  async createBin(b: NewBin): Promise<Bin> {
    const now = new Date();
    const doc: BinDoc = { ...b, _id: randomUUID(), createdAt: now, updatedAt: now };
    await this.bins.insertOne(doc);
    return { ...fromDoc<Omit<Bin, "count">>(doc), count: 0 };
  }

  async updateBin(id: string, patch: BinPatch): Promise<Bin> {
    const doc = await this.bins.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundError(`No bin ${id}`);
    return { ...fromDoc<Omit<Bin, "count">>(doc), count: await this.shapes.countDocuments({ binId: id }) };
  }

  async deleteBin(id: string): Promise<void> {
    if (await this.shapes.countDocuments({ binId: id })) throw new ConflictError("Empty the bin before deleting it");
    if ((await this.bins.deleteOne({ _id: id })).deletedCount !== 1) throw new NotFoundError(`No bin ${id}`);
  }

  /**
   * Like reserve(): use up each part with a conditional update (it can't go below what's
   * available), giving back what was taken if a later one is short; then create the items.
   * Capacity is checked first, without a lock, so two loads at the same instant could overfill a
   * bin slightly; Postgres locks the bin and can't.
   */
  async loadBin(id: string, lines: readonly LoadLine[], addToHolds: boolean): Promise<BinResult<{ count: number; holds: Owner[] }>> {
    const bin = await this.bins.findOne({ _id: id });
    if (!bin) return { ok: false, reason: "not_found" };
    const missing = lines.map((l) => l.owner).filter((o) => !bin.holds.includes(o));
    if (missing.length && !addToHolds) return { ok: false, reason: "wrong_kind", detail: `${bin.name} doesn't hold ${missing.join(", ")}` };
    const count = await this.shapes.countDocuments({ binId: id });
    const total = lines.reduce((n, l) => n + l.qty, 0);
    if (count + total > bin.capacity) return { ok: false, reason: "full", detail: `${bin.name} has room for ${bin.capacity - count} more` };
    const taken: { sku: string; qty: number }[] = [];
    for (const n of stockNeeded(lines)) {
      const r = await this.parts.updateOne({ _id: n.sku, ...atLeastAvailable(n.qty) }, { $inc: { onHand: -n.qty }, $set: { updatedAt: new Date() } });
      if (r.modifiedCount === 1) {
        taken.push(n);
        continue;
      }
      for (const t of taken) await this.parts.updateOne({ _id: t.sku }, { $inc: { onHand: t.qty } });
      const [p] = await this.getParts([n.sku]);
      return { ok: false, reason: "short", detail: `${p?.available ?? 0} of ${n.sku} available` };
    }
    if (taken.length) await this.log(taken.map(({ sku, qty }) => ({ sku, kind: "consume" as const, qty, note: `Loaded into bin ${bin.name}`, reservationId: null })));
    const holds = missing.length ? [...bin.holds, ...missing] : bin.holds;
    if (missing.length) await this.bins.updateOne({ _id: id }, { $set: { holds, updatedAt: new Date() } });
    const now = new Date();
    await this.shapes.insertMany(lines.flatMap((l) => {
      const sku = l.owner.startsWith("part:") ? l.owner.slice(5) : null;
      const kind = sku ? l.look.kind : (l.owner.slice(5) as ShapeDoc["kind"]);
      return Array.from({ length: l.qty }, () => ({
        _id: randomUUID(), name: l.look.name, kind, size: l.look.size, color: l.look.color, position: { ...bin.position }, rotationY: 0,
        sku, attachedTo: null, attach: null, binId: id, stockTaken: !!sku, createdAt: now, updatedAt: now,
      }));
    }));
    return { ok: true, value: { count: count + total, holds } };
  }

  async unloadBin(id: string, qty: number): Promise<BinResult<{ unloaded: number }>> {
    const bin = await this.bins.findOne({ _id: id });
    if (!bin) return { ok: false, reason: "not_found" };
    const stored = await this.shapes.find({ binId: id }).sort({ createdAt: 1, _id: 1 }).toArray();
    let unloaded = 0;
    for (const s of stored) {
      if (unloaded >= qty) break;
      if (await this.shapes.countDocuments({ attachedTo: s._id })) continue; // assemblies leave by being released
      // Claim it by deleting it; only one unload can.
      if ((await this.shapes.deleteOne({ _id: s._id, binId: id })).deletedCount !== 1) continue;
      unloaded++;
      if (s.sku && s.stockTaken) {
        await this.parts.updateOne({ _id: s.sku }, { $inc: { onHand: 1 }, $set: { updatedAt: new Date() } });
        await this.log([{ sku: s.sku, kind: "receive", qty: 1, note: `Unloaded from bin ${bin.name}`, reservationId: null }]);
      }
    }
    return { ok: true, value: { unloaded } };
  }

  /** Claim the shape for the bin with a conditional update, then take its parts; undo the claim if they're short. */
  async catchIntoBin(id: string, shapeId: string): Promise<BinResult> {
    const [bin, s] = await Promise.all([this.bins.findOne({ _id: id }), this.shapes.findOne({ _id: shapeId })]);
    if (!bin || !s || s.attachedTo || s.binId) return { ok: false, reason: "not_found" };
    if (!bin.holds.includes(s.sku ? `part:${s.sku}` : `kind:${s.kind}`)) return { ok: false, reason: "wrong_kind" };
    if ((await this.shapes.countDocuments({ binId: id })) >= bin.capacity) return { ok: false, reason: "full" };
    const claim = await this.shapes.updateOne({ _id: shapeId, binId: null, attachedTo: null }, { $set: { binId: id, updatedAt: new Date() } });
    if (claim.modifiedCount !== 1) return { ok: false, reason: "not_found" };
    const tree: ShapeDoc[] = [];
    for (let level = [s]; level.length && tree.length < 500; ) {
      tree.push(...level);
      level = await this.shapes.find({ attachedTo: { $in: level.map((x) => x._id) } }).toArray();
    }
    const need = consumption(tree.map(toShape), () => false);
    const taken: typeof need = [];
    for (const n of need) {
      const r = await this.parts.updateOne({ _id: n.sku, ...atLeastAvailable(n.qty) }, { $inc: { onHand: -n.qty }, $set: { updatedAt: new Date() } });
      if (r.modifiedCount === 1) {
        taken.push(n);
        continue;
      }
      for (const t of taken) await this.parts.updateOne({ _id: t.sku }, { $inc: { onHand: t.qty } });
      await this.shapes.updateOne({ _id: shapeId }, { $set: { binId: null } });
      return { ok: false, reason: "short", detail: `Not enough ${n.sku} in stock` };
    }
    if (need.length) await this.log(need.map(({ sku, qty }) => ({ sku, kind: "consume" as const, qty, note: `Caught in bin ${bin.name}`, reservationId: null })));
    await this.shapes.updateMany({ _id: { $in: tree.map((x) => x._id) }, sku: { $ne: null } }, { $set: { stockTaken: true } });
    return { ok: true, value: undefined };
  }

  async releaseFromBin(id: string, shapeId: string, at: { x: number; z: number }): Promise<BinResult> {
    const r = await this.shapes.updateOne({ _id: shapeId, binId: id }, { $set: { binId: null, position: { ...at }, updatedAt: new Date() } });
    return r.modifiedCount === 1 ? { ok: true, value: undefined } : { ok: false, reason: "not_in_bin" };
  }

  async listAssemblies(limit: number): Promise<Assembly[]> {
    return (await this.assemblies.find({}).sort({ createdAt: -1, _id: 1 }).limit(limit).toArray()).map((d) => fromDoc<Assembly>(d));
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

  async listRobots(): Promise<Robot[]> {
    return (await this.robots.find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map((d) => fromDoc<Robot>(d));
  }

  async createRobot(r: NewRobot): Promise<Robot> {
    const now = new Date();
    const doc: RobotDoc = { ...r, _id: randomUUID(), createdAt: now, updatedAt: now };
    await this.robots.insertOne(doc);
    return fromDoc<Robot>(doc);
  }

  async updateRobot(id: string, patch: RobotPatch): Promise<Robot> {
    const doc = await this.robots.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundError(`No robot ${id}`);
    return fromDoc<Robot>(doc);
  }

  async deleteRobot(id: string): Promise<void> {
    if ((await this.robots.deleteOne({ _id: id })).deletedCount !== 1) throw new NotFoundError(`No robot ${id}`);
  }

  async clearScene(): Promise<SceneCleared> {
    // No multi-document transaction on a standalone server: each collection is emptied in
    // turn, shapes first so no bin is ever left holding a shape that's gone. If it stops
    // halfway, pressing Clear again finishes the job.
    const shapes = (await this.shapes.deleteMany({})).deletedCount;
    const bins = (await this.bins.deleteMany({})).deletedCount;
    const robots = (await this.robots.deleteMany({})).deletedCount;
    await Promise.all([this.splitters.deleteMany({}), this.mergers.deleteMany({}), this.machines.deleteMany({})]);
    const conveyors = (await this.conveyors.deleteMany({})).deletedCount;
    return { shapes, conveyors, bins, robots };
  }

  async reset(): Promise<void> {
    await this.robots.deleteMany({});
    await Promise.all([this.bins.deleteMany({}), this.assemblies.deleteMany({}), this.machines.deleteMany({}), this.mergers.deleteMany({}), this.connectors.deleteMany({}), this.splitters.deleteMany({}), this.conveyors.deleteMany({}), this.shapes.deleteMany({}), this.parts.deleteMany({}), this.moves.deleteMany({}), this.res.deleteMany({}), this.counters.deleteMany({})]);
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
    attachedTo: d.attachedTo ?? null, attach: d.attach ?? null, // nor did shapes saved before assemblies
    binId: d.binId ?? null, stockTaken: d.stockTaken ?? false, // or before bins
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

function toConveyor(d: ConveyorDoc): Conveyor {
  return {
    id: d._id, name: d.name, length: d.length, width: d.width, height: d.height, speed: d.speed,
    position: d.position, rotationY: d.rotationY,
    kind: d.kind ?? "straight", turn: d.turn ?? 0, radius: d.radius ?? 0, lineId: d.lineId ?? null, lineIndex: d.lineIndex ?? 0,
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

function toSplitter(d: SplitterDoc): Splitter {
  return {
    id: d._id, name: d.name, conveyorId: d.conveyorId, along: d.along, rules: d.rules, otherwise: d.otherwise,
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

/** Documents whose fields are already the API's: rename _id and turn dates into ISO strings. */
function fromDoc<R>(d: { _id: string; createdAt: Date; updatedAt?: Date }): R {
  const { _id, createdAt, updatedAt, ...rest } = d;
  return { ...rest, id: _id, createdAt: createdAt.toISOString(), ...(updatedAt ? { updatedAt: updatedAt.toISOString() } : {}) } as R;
}
