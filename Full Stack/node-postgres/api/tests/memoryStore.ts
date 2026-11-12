import type { TaskRow, TaskStore } from "../src/store.js";

/**
 * An in-memory TaskStore for tests. It follows the same contract as PostgreSQL (tests/contract.ts
 * checks both), so route tests that use it are testing the real behaviour, minus the network.
 */
export function memoryStore(options: { down?: boolean } = {}): TaskStore {
  let rows: TaskRow[] = [];
  let nextId = 1;
  const copy = (r: TaskRow): TaskRow => ({ ...r, createdAt: new Date(r.createdAt) });

  return {
    async list() {
      return rows.map(copy);
    },
    async create(title) {
      const row = { id: nextId++, title, done: false, createdAt: new Date() };
      rows.push(row);
      return copy(row);
    },
    async update(id, changes) {
      const row = rows.find((r) => r.id === id);
      if (!row) return undefined;
      if (changes.title !== undefined) row.title = changes.title;
      if (changes.done !== undefined) row.done = changes.done;
      return copy(row);
    },
    async remove(id) {
      const before = rows.length;
      rows = rows.filter((r) => r.id !== id);
      return rows.length < before;
    },
    async ping() {
      if (options.down) throw new Error("database unavailable");
    },
  };
}
