/**
 * Uniform grid for the broad phase, stored in a hash table.
 *
 * Each body goes in the cell containing its center. With cells at least as big
 * as the largest box, two boxes can only touch if their cells are neighbors, so
 * each body only needs checking against 27 cells instead of every other body:
 * O(n) instead of O(n²).
 *
 * Storage is two flat Int32Arrays: `head[bucket]` is the first body in a bucket
 * and `next[body]` the one after it, a linked list with no allocation.
 */
export class SpatialHash {
  readonly cellSize: number;
  readonly head: Int32Array;
  readonly next: Int32Array;
  readonly cx: Int32Array;
  readonly cy: Int32Array;
  readonly cz: Int32Array;
  private readonly inv: number;
  private readonly mask: number;

  constructor(capacity: number, cellSize: number) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    let size = 1;
    while (size < capacity * 2) size <<= 1; // power of two, so `& mask` replaces `%`
    this.mask = size - 1;
    this.head = new Int32Array(size);
    this.next = new Int32Array(capacity);
    this.cx = new Int32Array(capacity);
    this.cy = new Int32Array(capacity);
    this.cz = new Int32Array(capacity);
  }

  /** Bucket for integer cell coordinates. Large primes spread neighboring cells apart. */
  bucket(x: number, y: number, z: number): number {
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & this.mask;
  }

  /** Integer cell coordinate along one axis. */
  cell(v: number): number {
    return Math.floor(v * this.inv);
  }

  build(list: Int32Array, count: number, px: Float64Array, py: Float64Array, pz: Float64Array): void {
    this.head.fill(-1);
    for (let k = 0; k < count; k++) {
      const i = list[k];
      const x = (this.cx[i] = this.cell(px[i]));
      const y = (this.cy[i] = this.cell(py[i]));
      const z = (this.cz[i] = this.cell(pz[i]));
      const b = this.bucket(x, y, z);
      this.next[i] = this.head[b];
      this.head[b] = i;
    }
  }
}

/**
 * Half of the 26 neighbor offsets: the ones "after" (0,0,0) in x, then y, then z
 * order. Checking only these (plus the body's own cell) visits every neighboring
 * pair exactly once.
 */
export const HALF_NEIGHBORS: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        if (dx > 0 || (dx === 0 && dy > 0) || (dx === 0 && dy === 0 && dz > 0)) out.push([dx, dy, dz]);
      }
  return out;
})();
