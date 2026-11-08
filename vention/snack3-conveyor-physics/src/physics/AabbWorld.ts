import { DENSITY, GRAVITY, MAX_HALF_EXTENT, STATICS, type StaticCollider, type V3 } from "../layout";
import type { SlotPool } from "../sim/SlotPool";
import { HALF_NEIGHBORS, SpatialHash } from "./SpatialHash";
import type { BodyDesc, PhysicsBackend, PhysicsStats, Quat } from "./types";

// ---- Tuning ----
const ITERATIONS = 6; // solver passes per step; more = stiffer stacks, more cost
const RESTITUTION = 0.1; // bounciness for real impacts
const BOUNCE_THRESHOLD = 0.5; // m/s; slower contacts don't bounce, which stops resting jitter
const FRICTION = 0.5;
const SLOP = 0.0005; // allowed overlap (m) before position correction kicks in
const CORRECTION = 0.8; // fraction of the overlap removed per pass
const BROAD_MARGIN = 0.005; // m; pairs this close become candidates for the step
const MAX_SPEED = 8; // m/s; caps how far a box can move in one step (anti-tunnelling)
const SLEEP_SPEED_SQ = 0.06 * 0.06;
const SLEEP_TIME = 0.4; // s below SLEEP_SPEED before a body sleeps
const WAKE_SPEED = 0.25; // m/s impact that wakes a sleeping body
const WAKE_MARGIN = 0.01; // m; sleeping bodies this close to a woken one wake too
const MAX_PAIRS_PER_BODY = 16;
const LAYER_HEIGHT = 0.05; // m; pairs are ordered bottom-up in layers this thick
const LAYERS = 128; // covers y from -1 m to 5.4 m; anything higher goes in the top layer

interface StaticBox {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  conveyor: boolean;
}

/**
 * A small rigid-body engine for axis-aligned boxes (they never rotate).
 *
 * Each step:
 *  1. Integrate: gravity changes velocity, velocity changes position (semi-implicit Euler).
 *  2. Broad phase: find pairs that might touch, using the spatial hash (or all pairs, for comparison).
 *  3. Narrow phase: for each touching pair, push the boxes apart along the axis of least
 *     overlap and cancel their approaching velocity, with friction. Repeat a few times so
 *     stacks settle (sequential impulses, Gauss-Seidel style).
 *  4. Sleep: boxes that have been still for a while stop being simulated until something wakes them.
 *
 * All per-body state is in flat typed arrays indexed by slot ("structure of arrays"):
 * no objects per box, cache-friendly loops, and nothing for the garbage collector to do.
 */
export class AabbWorld implements PhysicsBackend {
  readonly name = "Custom AABB";
  readonly stats: PhysicsStats = { pairsTested: 0, contacts: 0, awake: 0 };
  /** Off = test every pair of bodies (O(n²)), to show what the spatial hash saves. */
  useSpatialHash = true;

  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  readonly hx: Float64Array;
  readonly hy: Float64Array;
  readonly hz: Float64Array;
  readonly invMass: Float64Array;
  readonly asleep: Uint8Array;
  private readonly alive: Uint8Array;
  private readonly prevX: Float64Array;
  private readonly prevY: Float64Array;
  private readonly prevZ: Float64Array;
  private readonly sleepTime: Float64Array;
  /** Set during a step for bodies touching the belt: those must not fall asleep while it runs. */
  private readonly onBelt: Uint8Array;
  private speed = 0.8;

  private readonly statics: StaticBox[];
  private readonly hash: SpatialHash;
  private readonly neighborOffsets: Int32Array;
  private pairs: Int32Array;
  private sortedPairs: Int32Array;
  private readonly layerCounts = new Int32Array(LAYERS + 1);
  private pairCount = 0;
  private readonly wakeStack: Int32Array;
  private hashBuilt = false;
  private lastPool: SlotPool | null = null;

  constructor(capacity: number, statics: readonly StaticCollider[] = STATICS) {
    const f64 = () => new Float64Array(capacity);
    this.px = f64(); this.py = f64(); this.pz = f64();
    this.vx = f64(); this.vy = f64(); this.vz = f64();
    this.hx = f64(); this.hy = f64(); this.hz = f64();
    this.prevX = f64(); this.prevY = f64(); this.prevZ = f64();
    this.invMass = f64();
    this.sleepTime = f64();
    this.asleep = new Uint8Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.onBelt = new Uint8Array(capacity);

    this.statics = statics.map((s) => ({
      cx: (s.min.x + s.max.x) / 2,
      cy: (s.min.y + s.max.y) / 2,
      cz: (s.min.z + s.max.z) / 2,
      hx: (s.max.x - s.min.x) / 2,
      hy: (s.max.y - s.min.y) / 2,
      hz: (s.max.z - s.min.z) / 2,
      conveyor: s.conveyor === true,
    }));

    // Cells as wide as the biggest box (plus margin), so touching boxes are always in neighboring cells.
    this.hash = new SpatialHash(capacity, 2 * MAX_HALF_EXTENT + BROAD_MARGIN);
    this.neighborOffsets = Int32Array.from(HALF_NEIGHBORS.flat());
    this.pairs = new Int32Array(capacity * MAX_PAIRS_PER_BODY * 2);
    this.sortedPairs = new Int32Array(capacity * MAX_PAIRS_PER_BODY * 2);
    this.wakeStack = new Int32Array(capacity);
  }

  get beltSpeed(): number {
    return this.speed;
  }

  /** Changing the belt speed wakes everything: sleeping boxes on the belt have to start (or stop) moving. */
  set beltSpeed(v: number) {
    if (v === this.speed) return;
    this.speed = v;
    if (this.lastPool) {
      const { dense, count } = this.lastPool;
      for (let k = 0; k < count; k++) {
        this.asleep[dense[k]] = 0;
        this.sleepTime[dense[k]] = 0;
      }
    }
  }

  add(slot: number, d: BodyDesc): void {
    this.px[slot] = this.prevX[slot] = d.x;
    this.py[slot] = this.prevY[slot] = d.y;
    this.pz[slot] = this.prevZ[slot] = d.z;
    this.vx[slot] = this.vy[slot] = this.vz[slot] = 0;
    this.hx[slot] = d.hx;
    this.hy[slot] = d.hy;
    this.hz[slot] = d.hz;
    this.invMass[slot] = 1 / (8 * d.hx * d.hy * d.hz * DENSITY);
    this.asleep[slot] = 0;
    this.sleepTime[slot] = 0;
    this.alive[slot] = 1;
  }

  remove(slot: number): void {
    this.alive[slot] = 0;
    // Whatever was resting on this box has lost its support: wake it (and its pile).
    this.drainWake(this.pushSleepingNeighbors(slot, 0));
  }

  savePrevious(pool: SlotPool): void {
    const { dense, count } = pool;
    for (let k = 0; k < count; k++) {
      const i = dense[k];
      this.prevX[i] = this.px[i];
      this.prevY[i] = this.py[i];
      this.prevZ[i] = this.pz[i];
    }
  }

  step(dt: number, pool: SlotPool): void {
    this.lastPool = pool;
    this.integrate(dt, pool);
    this.broadPhase(pool);
    this.sortPairsBottomUp();

    this.stats.contacts = 0;
    for (let k = 0; k < pool.count; k++) this.onBelt[pool.dense[k]] = 0;
    for (let it = 0; it < ITERATIONS; it++) {
      const first = it === 0;
      const shock = it === ITERATIONS - 1;
      for (let k = 0; k < pool.count; k++) {
        const i = pool.dense[k];
        if (!this.asleep[i]) this.solveStatics(i, first);
      }
      for (let p = 0; p < this.pairCount; p++) this.solvePair(this.pairs[2 * p], this.pairs[2 * p + 1], first, shock);
    }

    this.updateSleep(dt, pool);
  }

  getPosition(slot: number, out: V3): void {
    out.x = this.px[slot];
    out.y = this.py[slot];
    out.z = this.pz[slot];
  }

  readTransform(slot: number, alpha: number, pos: V3, quat: Quat): void {
    pos.x = this.prevX[slot] + (this.px[slot] - this.prevX[slot]) * alpha;
    pos.y = this.prevY[slot] + (this.py[slot] - this.prevY[slot]) * alpha;
    pos.z = this.prevZ[slot] + (this.pz[slot] - this.prevZ[slot]) * alpha;
    quat.x = quat.y = quat.z = 0; // axis-aligned: never rotates
    quat.w = 1;
  }

  isAsleep(slot: number): boolean {
    return this.asleep[slot] === 1;
  }

  /** Runs only the broad phase and returns the candidate pairs (for tests and the benchmark). */
  candidatePairs(pool: SlotPool): [number, number][] {
    this.broadPhase(pool);
    const out: [number, number][] = [];
    for (let p = 0; p < this.pairCount; p++) out.push([this.pairs[2 * p], this.pairs[2 * p + 1]]);
    return out;
  }

  // ---- 1. Integration ----

  private integrate(dt: number, pool: SlotPool): void {
    const { px, py, pz, vx, vy, vz, asleep } = this;
    const { dense, count } = pool;
    for (let k = 0; k < count; k++) {
      const i = dense[k];
      if (asleep[i]) continue;
      vy[i] += GRAVITY * dt;
      const speedSq = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
      if (speedSq > MAX_SPEED * MAX_SPEED) {
        const s = MAX_SPEED / Math.sqrt(speedSq);
        vx[i] *= s;
        vy[i] *= s;
        vz[i] *= s;
      }
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;
    }
  }

  // ---- 2. Broad phase ----

  /** Fills `pairs` with every pair of live bodies whose boxes are within BROAD_MARGIN. */
  private broadPhase(pool: SlotPool): void {
    this.pairCount = 0;
    this.stats.pairsTested = 0;
    const { dense, count } = pool;

    if (!this.useSpatialHash) {
      for (let a = 0; a < count; a++)
        for (let b = a + 1; b < count; b++) this.candidate(dense[a], dense[b]);
      this.hashBuilt = false;
      return;
    }

    const h = this.hash;
    h.build(dense, count, this.px, this.py, this.pz);
    this.hashBuilt = true;
    const { head, next, cx, cy, cz } = h;
    const offsets = this.neighborOffsets;

    for (let k = 0; k < count; k++) {
      const i = dense[k];
      const x = cx[i], y = cy[i], z = cz[i];
      // Same cell: only bodies after i in the chain, so each pair is seen once.
      for (let j = next[i]; j !== -1; j = next[j]) {
        if (cx[j] === x && cy[j] === y && cz[j] === z) this.candidate(i, j);
      }
      // The 13 "forward" neighbor cells.
      for (let o = 0; o < offsets.length; o += 3) {
        const qx = x + offsets[o], qy = y + offsets[o + 1], qz = z + offsets[o + 2];
        for (let j = head[h.bucket(qx, qy, qz)]; j !== -1; j = next[j]) {
          // Different cells can share a bucket; check it really is the cell we asked for.
          if (cx[j] === qx && cy[j] === qy && cz[j] === qz) this.candidate(i, j);
        }
      }
    }
  }

  /**
   * Reorders the pairs from lowest to highest (counting sort on height layers, O(n)).
   * Solving bottom-up lets support travel up a stack within a single pass.
   */
  private sortPairsBottomUp(): void {
    const counts = this.layerCounts;
    counts.fill(0);
    const { py, pairs } = this;
    const layerOf = (p: number) => {
      const y = Math.min(py[pairs[2 * p]], py[pairs[2 * p + 1]]);
      return Math.min(LAYERS - 1, Math.max(0, Math.floor((y + 1) / LAYER_HEIGHT)));
    };
    for (let p = 0; p < this.pairCount; p++) counts[layerOf(p) + 1]++;
    for (let l = 1; l <= LAYERS; l++) counts[l] += counts[l - 1]; // running totals = where each layer starts
    const out = this.sortedPairs;
    for (let p = 0; p < this.pairCount; p++) {
      const at = counts[layerOf(p)]++;
      out[2 * at] = pairs[2 * p];
      out[2 * at + 1] = pairs[2 * p + 1];
    }
    // Swap buffers instead of copying back.
    this.sortedPairs = pairs;
    this.pairs = out;
  }

  private candidate(i: number, j: number): void {
    if (this.asleep[i] && this.asleep[j]) return; // two sleepers can't affect each other
    this.stats.pairsTested++;
    if (
      Math.abs(this.px[j] - this.px[i]) < this.hx[i] + this.hx[j] + BROAD_MARGIN &&
      Math.abs(this.py[j] - this.py[i]) < this.hy[i] + this.hy[j] + BROAD_MARGIN &&
      Math.abs(this.pz[j] - this.pz[i]) < this.hz[i] + this.hz[j] + BROAD_MARGIN &&
      2 * this.pairCount < this.pairs.length
    ) {
      this.pairs[2 * this.pairCount] = i;
      this.pairs[2 * this.pairCount + 1] = j;
      this.pairCount++;
    }
  }

  // ---- 3. Narrow phase ----

  /**
   * Box vs box. The normal points from i to j along the axis where they overlap least.
   *
   * `shock` (the last pass) is shock propagation: in a vertical contact the lower box
   * is treated as immovable, so a stack's upper boxes can't push it back down. Combined
   * with bottom-up order, the floor's support reaches the top of a stack in one sweep.
   * Without it, every box in a tall stack keeps a shared downward velocity that never
   * cancels, and the stack never comes to rest.
   */
  private solvePair(i: number, j: number, first: boolean, shock: boolean): void {
    const { px, py, pz, vx, vy, vz, hx, hy, hz } = this;
    const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
    const ox = hx[i] + hx[j] - Math.abs(dx);
    if (ox <= 0) return;
    const oy = hy[i] + hy[j] - Math.abs(dy);
    if (oy <= 0) return;
    const oz = hz[i] + hz[j] - Math.abs(dz);
    if (oz <= 0) return;
    if (first) this.stats.contacts++;

    let nx = 0, ny = 0, nz = 0, depth: number;
    if (ox <= oy && ox <= oz) { depth = ox; nx = dx < 0 ? -1 : 1; }
    else if (oy <= oz) { depth = oy; ny = dy < 0 ? -1 : 1; }
    else { depth = oz; nz = dz < 0 ? -1 : 1; }

    const rvx = vx[j] - vx[i], rvy = vy[j] - vy[i], rvz = vz[j] - vz[i];
    const vn = rvx * nx + rvy * ny + rvz * nz; // < 0: closing in

    // A sleeping box acts as immovable, unless it's hit hard enough to wake.
    if (this.asleep[i] && vn < -WAKE_SPEED) this.wake(i);
    if (this.asleep[j] && vn < -WAKE_SPEED) this.wake(j);
    let wi = this.asleep[i] ? 0 : this.invMass[i];
    let wj = this.asleep[j] ? 0 : this.invMass[j];
    if (shock && ny !== 0) {
      if (ny > 0) wi = 0; // i is below j
      else wj = 0;
    }
    const w = wi + wj;
    if (w === 0) return;

    // Push apart, split by inverse mass (the lighter box moves more).
    const push = (Math.max(depth - SLOP, 0) * CORRECTION) / w;
    px[i] -= nx * push * wi; py[i] -= ny * push * wi; pz[i] -= nz * push * wi;
    px[j] += nx * push * wj; py[j] += ny * push * wj; pz[j] += nz * push * wj;

    if (vn >= 0) return; // already separating

    // Normal impulse: cancel the closing speed (plus a little bounce for real impacts).
    const e = vn < -BOUNCE_THRESHOLD ? RESTITUTION : 0;
    const jn = (-(1 + e) * vn) / w;
    vx[i] -= nx * jn * wi; vy[i] -= ny * jn * wi; vz[i] -= nz * jn * wi;
    vx[j] += nx * jn * wj; vy[j] += ny * jn * wj; vz[j] += nz * jn * wj;

    // Friction: oppose sliding, but no more than FRICTION × the normal impulse (Coulomb).
    let tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
    const slide = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (slide < 1e-9) return;
    const jt = Math.min(slide / w, FRICTION * jn);
    tx /= slide; ty /= slide; tz /= slide;
    vx[i] += tx * jt * wi; vy[i] += ty * jt * wi; vz[i] += tz * jt * wi;
    vx[j] -= tx * jt * wj; vy[j] -= ty * jt * wj; vz[j] -= tz * jt * wj;
  }

  /** Box vs every static collider. Statics never move, so the box takes the whole correction. */
  private solveStatics(i: number, first: boolean): void {
    const { px, py, pz, vx, vy, vz } = this;
    for (const s of this.statics) {
      const dx = px[i] - s.cx, dy = py[i] - s.cy, dz = pz[i] - s.cz;
      const ox = this.hx[i] + s.hx - Math.abs(dx);
      if (ox <= 0) continue;
      const oy = this.hy[i] + s.hy - Math.abs(dy);
      if (oy <= 0) continue;
      const oz = this.hz[i] + s.hz - Math.abs(dz);
      if (oz <= 0) continue;
      if (first) this.stats.contacts++;
      if (s.conveyor) this.onBelt[i] = 1;

      let nx = 0, ny = 0, nz = 0, depth: number;
      if (ox <= oy && ox <= oz) { depth = ox; nx = dx < 0 ? -1 : 1; }
      else if (oy <= oz) { depth = oy; ny = dy < 0 ? -1 : 1; }
      else { depth = oz; nz = dz < 0 ? -1 : 1; }

      const push = Math.max(depth - SLOP, 0) * CORRECTION;
      px[i] += nx * push; py[i] += ny * push; pz[i] += nz * push;

      // Velocity relative to the surface. The belt's surface moves, so friction drags boxes along.
      const rvx = vx[i] - (s.conveyor ? this.speed : 0), rvy = vy[i], rvz = vz[i];
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn >= 0) continue;

      const e = vn < -BOUNCE_THRESHOLD ? RESTITUTION : 0;
      const dvn = -(1 + e) * vn;
      vx[i] += nx * dvn; vy[i] += ny * dvn; vz[i] += nz * dvn;

      let tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
      const slide = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (slide < 1e-9) continue;
      const dvt = Math.min(slide, FRICTION * dvn);
      tx /= slide; ty /= slide; tz /= slide;
      vx[i] -= tx * dvt; vy[i] -= ty * dvt; vz[i] -= tz * dvt;
    }
  }

  // ---- 4. Sleeping ----

  private updateSleep(dt: number, pool: SlotPool): void {
    const { vx, vy, vz, asleep, sleepTime } = this;
    const { dense, count } = pool;
    let awake = 0;
    for (let k = 0; k < count; k++) {
      const i = dense[k];
      if (asleep[i]) continue;
      const beltHolds = this.onBelt[i] === 1 && this.speed !== 0; // jammed on a running belt: stay awake
      if (!beltHolds && vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i] < SLEEP_SPEED_SQ) {
        sleepTime[i] += dt;
        if (sleepTime[i] >= SLEEP_TIME) {
          asleep[i] = 1;
          vx[i] = vy[i] = vz[i] = 0;
          continue;
        }
      } else {
        sleepTime[i] = 0;
      }
      awake++;
    }
    this.stats.awake = awake;
  }

  /**
   * Wakes a body and, transitively, every sleeping body touching it: the whole
   * resting pile it belongs to (an "island"). Otherwise a box could stay asleep
   * floating in mid-air after the box under it was knocked away.
   */
  private wake(start: number): void {
    if (this.asleep[start] !== 1) return;
    this.asleep[start] = 2;
    this.wakeStack[0] = start;
    this.drainWake(1);
  }

  /** Wakes everything on the stack, pushing each one's sleeping neighbors in turn (depth-first flood fill). */
  private drainWake(top: number): void {
    const stack = this.wakeStack;
    while (top > 0) {
      const i = stack[--top];
      this.asleep[i] = 0;
      this.sleepTime[i] = 0;
      top = this.pushSleepingNeighbors(i, top);
    }
  }

  /**
   * Pushes sleeping live bodies near body i onto wakeStack and marks them 2
   * ("queued") so none is pushed twice; drainWake sets them to 0. Returns the new top.
   */
  private pushSleepingNeighbors(i: number, top: number): number {
    const stack = this.wakeStack;
    const near = (j: number) =>
      j !== i &&
      this.alive[j] === 1 &&
      this.asleep[j] === 1 &&
      Math.abs(this.px[j] - this.px[i]) < this.hx[i] + this.hx[j] + WAKE_MARGIN &&
      Math.abs(this.py[j] - this.py[i]) < this.hy[i] + this.hy[j] + WAKE_MARGIN &&
      Math.abs(this.pz[j] - this.pz[i]) < this.hz[i] + this.hz[j] + WAKE_MARGIN;
    const mark = (j: number) => {
      this.asleep[j] = 2;
      stack[top++] = j;
    };

    if (this.hashBuilt) {
      // Sleeping bodies haven't moved since the hash was built, so their cells are still right.
      const h = this.hash;
      const x = h.cell(this.px[i]);
      const y = h.cell(this.py[i]);
      const z = h.cell(this.pz[i]);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            for (let j = h.head[h.bucket(x + dx, y + dy, z + dz)]; j !== -1; j = h.next[j]) {
              if (h.cx[j] === x + dx && h.cy[j] === y + dy && h.cz[j] === z + dz && near(j)) mark(j);
            }
          }
    } else if (this.lastPool) {
      const { dense, count } = this.lastPool;
      for (let k = 0; k < count; k++) if (near(dense[k])) mark(dense[k]);
    }
    return top;
  }
}
