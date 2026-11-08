/**
 * A fixed-capacity pool of body slots.
 *
 * Every per-box array in the app (physics state, sizes, colors) is allocated
 * once at MAX_BODIES and indexed by slot. Spawning a box takes a slot from the
 * free list; removing it puts the slot back. Nothing is allocated or garbage
 * collected while the simulation runs.
 *
 * `dense` lists the live slots packed at the front (0..count-1), so loops touch
 * only live boxes. Removal swaps the last live slot into the hole: O(1), at the
 * cost of not keeping order.
 */
export class SlotPool {
  readonly capacity: number;
  /** Live slots, packed: dense[0..count-1]. */
  readonly dense: Int32Array;
  count = 0;
  /** slot -> its index in `dense`, or -1 if free. */
  private readonly where: Int32Array;
  private readonly free: Int32Array;
  private freeTop: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.dense = new Int32Array(capacity);
    this.where = new Int32Array(capacity).fill(-1);
    this.free = new Int32Array(capacity);
    // Stack the free slots so slot 0 comes out first.
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
    this.freeTop = capacity;
  }

  /** Returns a free slot, or -1 if the pool is full. */
  alloc(): number {
    if (this.freeTop === 0) return -1;
    const slot = this.free[--this.freeTop];
    this.where[slot] = this.count;
    this.dense[this.count++] = slot;
    return slot;
  }

  release(slot: number): void {
    const k = this.where[slot];
    if (k < 0) return; // already free
    const last = this.dense[--this.count];
    this.dense[k] = last; // move the last live slot into the hole
    this.where[last] = k;
    this.where[slot] = -1;
    this.free[this.freeTop++] = slot;
  }

  has(slot: number): boolean {
    return this.where[slot] >= 0;
  }
}
