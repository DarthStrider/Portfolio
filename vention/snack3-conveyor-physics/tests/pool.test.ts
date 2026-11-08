import { test } from "node:test";
import assert from "node:assert/strict";
import { SlotPool } from "../src/sim/SlotPool";

const live = (pool: SlotPool) => [...pool.dense.subarray(0, pool.count)].sort((a, b) => a - b);

test("alloc hands out slots from 0 and returns -1 when full", () => {
  const pool = new SlotPool(3);
  assert.deepEqual([pool.alloc(), pool.alloc(), pool.alloc()], [0, 1, 2]);
  assert.equal(pool.alloc(), -1);
  assert.equal(pool.count, 3);
});

test("release swaps the last live slot into the hole and recycles the slot", () => {
  const pool = new SlotPool(4);
  [0, 1, 2, 3].forEach(() => pool.alloc());
  pool.release(1);
  assert.deepEqual([...pool.dense.subarray(0, pool.count)], [0, 3, 2]);
  assert.ok(!pool.has(1));
  assert.equal(pool.alloc(), 1, "the freed slot is reused");
  pool.release(1);
  pool.release(1); // releasing twice is harmless
  assert.equal(pool.count, 3);
});

test("stays consistent through 10,000 random allocs and releases", () => {
  const pool = new SlotPool(64);
  const expected = new Set<number>();
  let seed = 3;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  for (let i = 0; i < 10_000; i++) {
    if (random() < 0.55) {
      const slot = pool.alloc();
      if (slot >= 0) {
        assert.ok(!expected.has(slot), `slot ${slot} handed out twice`);
        expected.add(slot);
      } else assert.equal(expected.size, 64);
    } else if (expected.size > 0) {
      const slot = [...expected][Math.floor(random() * expected.size)];
      pool.release(slot);
      expected.delete(slot);
    }
    assert.equal(pool.count, expected.size);
  }
  assert.deepEqual(live(pool), [...expected].sort((a, b) => a - b));
  for (let s = 0; s < 64; s++) assert.equal(pool.has(s), expected.has(s));
});
