import { BOUNDS, BURST_AREA, MAX_BODIES, SIZE_PRESETS, SPAWN, type V3 } from "../layout";
import type { PhysicsBackend } from "../physics/types";
import { SlotPool } from "./SlotPool";

/**
 * Decides which boxes exist: spawns them onto the belt at a steady rate, keeps
 * the total at `target` by retiring the oldest, removes any that leave the world,
 * and drops a burst for the stress test. Knows nothing about rendering.
 */
export class BoxFlow {
  readonly pool: SlotPool;
  /** Size preset per slot (which also picks the box's color). */
  readonly preset: Uint8Array;
  backend: PhysicsBackend;
  target = 200;
  /** Boxes per second onto the belt. */
  rate = 6;

  private readonly spawnedAt: Float64Array;
  private clock = 0;
  private spawnDebt = 0;
  private seed = 12345;
  private readonly tmp: V3 = { x: 0, y: 0, z: 0 };

  constructor(backend: PhysicsBackend, capacity = MAX_BODIES) {
    this.backend = backend;
    this.pool = new SlotPool(capacity);
    this.preset = new Uint8Array(capacity);
    this.spawnedAt = new Float64Array(capacity);
  }

  get count(): number {
    return this.pool.count;
  }

  /** Call once per frame. */
  update(dt: number): void {
    this.clock += dt;
    while (this.pool.count > this.target) this.retireOldest();

    if (this.target > 0) {
      // Accumulate fractional boxes so e.g. 6/s spawns evenly whatever the frame rate.
      this.spawnDebt += this.rate * dt;
      while (this.spawnDebt >= 1) {
        this.spawnDebt -= 1;
        if (this.pool.count >= this.target) this.retireOldest(); // recycle: oldest out, new one in
        this.spawn(SPAWN.x + (this.random() - 0.5) * 0.04, SPAWN.y, (this.random() * 2 - 1) * SPAWN.zJitter);
      }
    } else {
      this.spawnDebt = 0;
    }

    this.retireOutOfBounds();
  }

  /** Drops `n` boxes at once in layers above the bin and the floor around it. Returns the new target. */
  burst(n: number): number {
    const a = BURST_AREA;
    const cols = Math.floor((a.maxX - a.minX) / a.spacing) + 1;
    const rows = Math.floor((a.maxZ - a.minZ) / a.spacing) + 1;
    const room = Math.min(n, this.pool.capacity - this.pool.count);
    for (let k = 0; k < room; k++) {
      const layer = Math.floor(k / (cols * rows));
      const inLayer = k % (cols * rows);
      this.spawn(
        a.minX + (inLayer % cols) * a.spacing,
        a.baseY + layer * a.spacing,
        a.minZ + Math.floor(inLayer / cols) * a.spacing,
      );
    }
    this.target = Math.max(this.target, this.pool.count);
    return this.target;
  }

  clear(): void {
    while (this.pool.count > 0) this.retire(this.pool.dense[this.pool.count - 1]);
    this.spawnDebt = 0;
  }

  /** Moves every live box into another engine, at its current position, so engines can be switched mid-run. */
  switchBackend(next: PhysicsBackend): void {
    const { dense, count } = this.pool;
    next.beltSpeed = this.backend.beltSpeed;
    for (let k = 0; k < count; k++) {
      const slot = dense[k];
      this.backend.getPosition(slot, this.tmp);
      const h = SIZE_PRESETS[this.preset[slot]];
      next.add(slot, { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z, hx: h.x, hy: h.y, hz: h.z });
    }
    this.backend = next;
  }

  private spawn(x: number, y: number, z: number): void {
    const slot = this.pool.alloc();
    if (slot < 0) return; // pool full
    const p = Math.floor(this.random() * SIZE_PRESETS.length);
    const h = SIZE_PRESETS[p];
    this.preset[slot] = p;
    this.spawnedAt[slot] = this.clock;
    this.backend.add(slot, { x, y, z, hx: h.x, hy: h.y, hz: h.z });
  }

  private retire(slot: number): void {
    this.backend.remove(slot);
    this.pool.release(slot);
  }

  /** O(n) scan; at most a few dozen times a second, so simpler than keeping a queue. */
  private retireOldest(): void {
    const { dense, count } = this.pool;
    if (count === 0) return;
    let oldest = dense[0];
    for (let k = 1; k < count; k++) if (this.spawnedAt[dense[k]] < this.spawnedAt[oldest]) oldest = dense[k];
    this.retire(oldest);
  }

  private retireOutOfBounds(): void {
    const { dense } = this.pool;
    // Walk backwards: release() swaps the last live slot into the hole, and we've already checked that one.
    for (let k = this.pool.count - 1; k >= 0; k--) {
      const slot = dense[k];
      this.backend.getPosition(slot, this.tmp);
      const p = this.tmp;
      if (p.y < BOUNDS.minY || Math.abs(p.x) > BOUNDS.maxAbsXZ || Math.abs(p.z) > BOUNDS.maxAbsXZ) this.retire(slot);
    }
  }

  /** Small seeded generator, so runs (and benchmarks) are repeatable. */
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 2 ** 32;
  }
}
