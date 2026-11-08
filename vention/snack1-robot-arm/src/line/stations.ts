/**
 * What mergers and joining machines do while the belts run. Pure logic over the transport's
 * bodies: no Three.js, no API, so it's unit-tested.
 *
 * Each station puts stop lines on belts (transport.ts holds items there when asked) and keeps a
 * little state: which item is waiting where, who merged last, what a machine is holding.
 *
 * Mergers
 *   Feeder items stop at the end of their feeder and wait for a gap at the merge point: no
 *   other item within `gap` of it on the main belt, and nothing else being merged. Then they're
 *   slid onto the main belt's centerline. Priority decides who waits when both sides want to go:
 *   - main: feeder items wait for a gap; the main belt never stops.
 *   - feeders: main-belt items stop short of the merge point while a feeder item is waiting.
 *   - alternate: they take turns. For a y merger, the two feeders take turns.
 *   Feeder stops queue, so a busy feeder backs up instead of piling items on one spot.
 *
 * Machines
 *   A machine holds the first item matching its base and the first matching its attach slot
 *   (by kind of object). With both, it works for `cycleSeconds`, then joins the attach item onto
 *   the base at their connection points and lets the base, now carrying it, go on. Items it
 *   doesn't need, or doesn't need yet, pass straight through.
 *
 * Bins
 *   An item that comes to rest on the floor inside a bin is caught if it's one of the bin's kinds, meets
 *   its accept conditions and the bin has room; otherwise it's left lying there. A bin with a feed
 *   puts its items back on the line: onto a belt whenever the spot is clear ("steady") or only
 *   when a machine further along that belt needs one ("demand"), or straight into a machine's slot.
 *   A bin holding several kinds releases its oldest item that's wanted: for a machine, the oldest
 *   one whose kind the machine has an empty slot for.
 */
import { beltUnder, fromBelt, isOver, toBelt, type Body, type StopLine } from "../conveyors/transport";
import type { Conveyor } from "../conveyors/types";
import type { Shape } from "../shapes/types";
import { attachmentFor, findPoint, ownerOf } from "./joints";
import type { Attachment, Bin, Connectors, Machine, Merger } from "./types";
import { BIN_SIZE } from "./types";
import { matches, type Part } from "../splitters/rules";

export interface World {
  belts: readonly Conveyor[];
  mergers: readonly Merger[];
  machines: readonly Machine[];
  shapes: readonly Shape[];
  connectors: readonly Connectors[];
  bins?: readonly Bin[];
  parts?: readonly Part[];
}

export interface Join {
  machineId: string;
  machineName: string;
  baseId: string;
  attachedId: string;
  basePoint: string;
  attachedPoint: string;
  attach: Attachment;
}

export type MachineStatus =
  | { state: "idle" }
  | { state: "waiting"; has: "base" | "attach" }
  | { state: "joining"; progress: number }
  | { state: "error"; message: string };

const FEEDER_STOP_INSET = 0.08; // feeder items wait this far before the end of their belt
const dirOf = (b: Conveyor) => (b.speed >= 0 ? 1 : -1);

export function createStations(world: () => World) {
  /** Bodies of the current step, set by prepare(). */
  let bodies: ReadonlyMap<string, Body> = new Map();
  const waitingFeed = new Map<string, string>(); // stop id -> body id
  const waitingMain = new Map<string, string>(); // merger id -> body id
  const lastFrom = new Map<string, string>(); // merger id -> "main" or the feeder's stop id
  const slots = new Map<string, { base?: string; attach?: string; progress: number }>();
  const done = new Map<string, Set<string>>(); // machine id -> bodies it has finished with
  const status = new Map<string, MachineStatus>();
  const binQueue = new Map<string, string[]>(); // bin id -> stored shape ids, oldest first
  const binOf = new Map<string, string>(); // stored shape id -> bin id
  const refused = new Set<string>(); // landed in a bin and weren't accepted: not asked again until they leave
  const cooldown = new Map<string, number>(); // bin id -> seconds until it may release again
  const placed = new Map<string, string>(); // bin id -> body it just put into a machine, until the machine holds it

  const beltById = (id: string) => world().belts.find((b) => b.id === id);

  // ---- Geometry ----

  /** Where items merge: on the main belt's centerline. For a y merger, just inside the output's start. */
  function mergePoint(m: Merger): { x: number; z: number; y: number; u: number } | null {
    const main = beltById(m.conveyorId);
    if (!main) return null;
    const u = m.kind === "y" ? -dirOf(main) * (main.length / 2 - 0.1) : m.along - main.length / 2;
    return { ...fromBelt(main, u, 0), y: main.height, u };
  }

  function feederStop(m: Merger, i: number): StopLine | null {
    const f = beltById(m.feederIds[i]);
    if (!f) return null;
    const along = dirOf(f) > 0 ? f.length - FEEDER_STOP_INSET : FEEDER_STOP_INSET;
    return { id: `feed:${m.id}:${i}`, conveyorId: f.id, along, queue: true };
  }

  /** For "feeders" and "alternate", main-belt items may have to stop a gap short of a side merge. */
  function mainStop(m: Merger): StopLine | null {
    const main = beltById(m.conveyorId);
    if (!main || m.kind === "y" || m.priority === "main") return null;
    const along = m.along - dirOf(main) * m.gap;
    return along >= 0 && along <= main.length ? { id: `main:${m.id}`, conveyorId: main.id, along, queue: true } : null;
  }

  function stops(): StopLine[] {
    const { mergers, machines } = world();
    const out: StopLine[] = [];
    for (const m of mergers) {
      m.feederIds.forEach((_, i) => {
        const s = feederStop(m, i);
        if (s) out.push(s);
      });
      const s = mainStop(m);
      if (s) out.push(s);
    }
    for (const mc of machines) if (beltById(mc.conveyorId)) out.push({ id: `machine:${mc.id}`, conveyorId: mc.conveyorId, along: mc.along });
    return out;
  }

  /** Is the merge point clear for one more item? */
  function clear(m: Merger, except: Body): boolean {
    const main = beltById(m.conveyorId);
    const at = mergePoint(m);
    if (!main || !at) return false;
    for (const b of bodies.values()) {
      if (b === except) continue;
      if (b.guide && Math.hypot(b.guide.x - at.x, b.guide.z - at.z) < 1e-6) return false; // one is being merged now
      if (b.heldAt === `main:${m.id}`) continue; // waiting short of the merge point, by design
      if (!isOver(main, b.x, b.z) || Math.abs(b.y - main.height) > 1e-3 || beltUnder(world().belts, b.x, b.z, b.y) !== main) continue;
      if (Math.abs(toBelt(main, b.x, b.z).u - at.u) < m.gap) return false;
    }
    return true;
  }

  // ---- Holding ----

  function holdFeeder(m: Merger, i: number, body: Body, stopId: string): boolean {
    const others = m.feederIds.map((_, j) => `feed:${m.id}:${j}`).filter((id) => id !== stopId && waitingFeed.has(id));
    let wait = !clear(m, body);
    if (!wait && m.kind === "side" && m.priority === "alternate" && waitingMain.has(m.id) && lastFrom.get(m.id) !== "main") wait = true;
    if (!wait && m.kind === "y" && others.length && lastFrom.get(m.id) === stopId) wait = true; // the other feeder's turn
    if (wait) {
      waitingFeed.set(stopId, body.id!);
      return true;
    }
    const at = mergePoint(m)!;
    const f = beltById(m.feederIds[i])!;
    body.guide = { x: at.x, z: at.z, y: at.y, speed: Math.max(0.2, Math.abs(f.speed)) };
    waitingFeed.delete(stopId);
    lastFrom.set(m.id, stopId);
    return false;
  }

  function holdMain(m: Merger, body: Body): boolean {
    const feederWaiting = m.feederIds.some((_, j) => waitingFeed.has(`feed:${m.id}:${j}`));
    const at = mergePoint(m);
    const merging = at && [...bodies.values()].some((b) => b.guide && Math.hypot(b.guide.x - at.x, b.guide.z - at.z) < 1e-6);
    const wait = (feederWaiting || !!merging) && (m.priority === "feeders" || lastFrom.get(m.id) === "main" || merging);
    if (wait) {
      waitingMain.set(m.id, body.id!);
      return true;
    }
    waitingMain.delete(m.id);
    if (feederWaiting) lastFrom.set(m.id, "main");
    return false;
  }

  function holdMachine(mc: Machine, body: Body): boolean {
    const shape = world().shapes.find((s) => s.id === body.id);
    if (!shape) return false;
    const finished = done.get(mc.id) ?? new Set<string>();
    if (finished.has(body.id!)) return false;
    const slot = slots.get(mc.id) ?? { progress: 0 };
    slots.set(mc.id, slot);
    if (slot.base === body.id || slot.attach === body.id) return true;
    const owner = ownerOf(shape);
    if (owner === mc.base.owner && !slot.base) slot.base = body.id;
    else if (owner === mc.attach.owner && !slot.attach) slot.attach = body.id;
    else return false;
    return true;
  }

  function hold(body: Body, stop: StopLine): boolean {
    const [kind, id, index] = stop.id.split(":");
    if (kind === "machine") {
      const mc = world().machines.find((x) => x.id === id);
      return mc ? holdMachine(mc, body) : false;
    }
    const m = world().mergers.find((x) => x.id === id);
    if (!m) return false;
    return kind === "feed" ? holdFeeder(m, Number(index), body, stop.id) : holdMain(m, body);
  }

  // ---- Each step ----

  function prepare(current: ReadonlyMap<string, Body>) {
    bodies = current;
    // Forget waiting items that have gone (deleted, or carried off by something else).
    for (const [stop, id] of waitingFeed) if (bodies.get(id)?.heldAt !== stop) waitingFeed.delete(stop);
    for (const [m, id] of waitingMain) if (bodies.get(id)?.heldAt !== `main:${m}`) waitingMain.delete(m);
  }

  /** Advances the machines; returns the joins finished in this step. */
  function afterStep(dt: number): Join[] {
    const joins: Join[] = [];
    const { machines, shapes, connectors } = world();
    for (const mc of machines) {
      const slot = slots.get(mc.id);
      if (!slot || (!slot.base && !slot.attach)) {
        status.set(mc.id, { state: "idle" });
        continue;
      }
      if (!slot.base || !slot.attach) {
        status.set(mc.id, { state: "waiting", has: slot.base ? "base" : "attach" });
        continue;
      }
      slot.progress += dt;
      if (slot.progress < mc.cycleSeconds) {
        status.set(mc.id, { state: "joining", progress: slot.progress / mc.cycleSeconds });
        continue;
      }
      const base = shapes.find((s) => s.id === slot.base)!;
      const attached = shapes.find((s) => s.id === slot.attach)!;
      const bp = findPoint(mc.base.owner, mc.base.point, connectors);
      const ap = findPoint(mc.attach.owner, mc.attach.point, connectors);
      const finished = done.get(mc.id) ?? new Set<string>();
      done.set(mc.id, finished);
      finished.add(base.id).add(attached.id);
      slots.set(mc.id, { progress: 0 });
      if (!bp || !ap) {
        // A point was renamed or removed since the machine was set up: let both go, unjoined.
        status.set(mc.id, { state: "error", message: `No connection point "${!bp ? mc.base.point : mc.attach.point}" any more` });
        continue;
      }
      joins.push({
        machineId: mc.id, machineName: mc.name, baseId: base.id, attachedId: attached.id,
        basePoint: bp.name, attachedPoint: ap.name, attach: attachmentFor(base, bp, attached, ap),
      });
      status.set(mc.id, { state: "idle" });
    }
    return joins;
  }

  function reset() {
    binQueue.clear();
    binOf.clear();
    refused.clear();
    cooldown.clear();
    placed.clear();
    const stored = world().shapes.filter((s) => s.binId && !s.attachedTo).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    for (const s of stored) {
      binOf.set(s.id, s.binId!);
      binQueue.set(s.binId!, [...(binQueue.get(s.binId!) ?? []), s.id]);
    }
    waitingFeed.clear();
    waitingMain.clear();
    lastFrom.clear();
    slots.clear();
    done.clear();
    status.clear();
  }

  /** For the panel and the 3D view: is a merger holding anything, and what is each machine doing. */
  function snapshot() {
    const mergers = new Map<string, number>();
    for (const m of world().mergers) {
      const n = m.feederIds.filter((_, i) => waitingFeed.has(`feed:${m.id}:${i}`)).length + (waitingMain.has(m.id) ? 1 : 0);
      mergers.set(m.id, n);
    }
    return { mergers, machines: new Map(status) };
  }

  // ---- Bins ----

  /** Is a machine's slot for this kind of object empty? */
  function needs(mc: Machine, owner: string): boolean {
    const slot = slots.get(mc.id);
    return (mc.base.owner === owner && !slot?.base) || (mc.attach.owner === owner && !slot?.attach);
  }

  function inBin(b: Bin, x: number, z: number): boolean {
    const p = toBelt({ ...BIN_SIZE, length: BIN_SIZE.x, width: BIN_SIZE.z, height: BIN_SIZE.y, speed: 0, position: b.position, rotationY: b.rotationY }, x, z);
    return Math.abs(p.u) <= BIN_SIZE.x / 2 && Math.abs(p.v) <= BIN_SIZE.z / 2;
  }

  /**
   * After each step: catch items that came to rest in a bin, and release items from bins that
   * feed the line. Returns the ids caught (the caller removes their bodies) and the new bodies.
   */
  function binStep(dt: number, current: Map<string, Body>): { caught: { binId: string; shapeId: string }[]; released: { binId: string; body: Body }[] } {
    const { bins = [], shapes, parts = [], machines, belts } = world();
    const caught: { binId: string; shapeId: string }[] = [];
    const released: { binId: string; body: Body }[] = [];
    const shapeOf = (id: string) => shapes.find((s) => s.id === id);

    for (const body of current.values()) {
      if (body.y > 1e-4 || body.vy !== 0 || body.guide) continue; // only items lying on the floor
      const bin = bins.find((b) => inBin(b, body.x, body.z));
      if (!bin) {
        refused.delete(body.id!);
        continue;
      }
      if (refused.has(body.id!)) continue;
      const shape = shapeOf(body.id!);
      const part = shape?.sku ? parts.find((p) => p.sku === shape.sku) : undefined;
      const queue = binQueue.get(bin.id) ?? [];
      const ok = shape && bin.holds.includes(ownerOf(shape)) && bin.accept.every((c) => matches(c, shape, part)) && queue.length < bin.capacity;
      if (!ok) {
        refused.add(body.id!);
        continue;
      }
      binQueue.set(bin.id, [...queue, body.id!]);
      binOf.set(body.id!, bin.id);
      caught.push({ binId: bin.id, shapeId: body.id! });
    }

    for (const bin of bins) {
      const queue = binQueue.get(bin.id) ?? [];
      const wait = (cooldown.get(bin.id) ?? 0) - dt;
      cooldown.set(bin.id, wait);
      if (!queue.length || wait > 0 || bin.feed.type === "none") continue;
      let target: { belt: Conveyor; u: number } | null = null;
      /** Which stored items may go: by default any (the oldest goes first). */
      let wanted = (_owner: string) => true;

      if (bin.feed.type === "belt") {
        const belt = beltById(bin.feed.conveyorId);
        if (!belt) continue;
        const u = bin.feed.along - belt.length / 2;
        const onBelt = [...current.values()].filter((b) => Math.abs(b.y - belt.height) < 1e-3 && isOver(belt, b.x, b.z));
        if (onBelt.some((b) => Math.abs(toBelt(belt, b.x, b.z).u - u) < 0.25)) continue; // the spot isn't clear
        if (bin.feed.mode === "demand") {
          // Only kinds a machine further along needs, with none already on its way to it.
          const d = dirOf(belt);
          wanted = (owner) => machines.some((mc) => {
            if (mc.conveyorId !== belt.id || !needs(mc, owner)) return false;
            const mu = mc.along - belt.length / 2;
            if ((mu - u) * d <= 0) return false;
            return !onBelt.some((b) => {
              const s = shapeOf(b.id!);
              const bu = toBelt(belt, b.x, b.z).u;
              return s && ownerOf(s) === owner && (bu - u) * d >= 0 && (mu - bu) * d >= 0;
            });
          });
        }
        target = { belt, u };
      } else {
        const machineId = bin.feed.machineId;
        const mc = machines.find((m) => m.id === machineId);
        const belt = mc && beltById(mc.conveyorId);
        if (!mc || !belt) continue;
        wanted = (owner) => needs(mc, owner);
        const pending = placed.get(bin.id);
        if (pending && current.has(pending) && current.get(pending)!.heldAt !== `machine:${mc.id}`) continue; // still arriving
        // Just upstream of the machine's line, so the next step carries it across and the machine takes it.
        target = { belt, u: mc.along - belt.length / 2 - dirOf(belt) * 0.01 };
      }

      // Drop anything no longer in the scene, then take the oldest item that's wanted.
      const live = queue.filter((id) => shapeOf(id));
      binQueue.set(bin.id, live);
      const id = live.find((sid) => wanted(ownerOf(shapeOf(sid)!)));
      if (!id) continue;
      const shape = shapeOf(id)!;
      const at = fromBelt(target.belt, target.u, 0);
      const body: Body = { id, x: at.x, z: at.z, y: target.belt.height, vx: 0, vy: 0, vz: 0, size: Math.max(shape.size.x, shape.size.z) };
      binQueue.set(bin.id, live.filter((sid) => sid !== id));
      binOf.delete(id);
      if (bin.feed.type === "machine") placed.set(bin.id, id);
      cooldown.set(bin.id, 0.4);
      released.push({ binId: bin.id, body });
    }
    return { caught, released };
  }

  /** Where every stored item is now: shape id -> bin id. */
  function stored(): ReadonlyMap<string, string> {
    return binOf;
  }

  function binCounts(): Map<string, number> {
    return new Map([...binQueue].map(([id, q]) => [id, q.length]));
  }

  return { stops, hold, prepare, afterStep, reset, snapshot, mergePoint, binStep, stored, binCounts };
}

export type Stations = ReturnType<typeof createStations>;
