import { test } from "node:test";
import assert from "node:assert/strict";
import type { TaskStore } from "../src/store.js";

/**
 * The behaviour every TaskStore must have. memory.test.ts runs it against the in-memory store,
 * postgres.test.ts against a real database, so the two can't quietly drift apart.
 *
 * @param fresh returns an empty store; called before every test.
 */
export function storeContract(name: string, fresh: () => Promise<TaskStore>, options: { skip?: string | false } = {}) {
  const t = (title: string, fn: (store: TaskStore) => Promise<void>) =>
    test(`${name}: ${title}`, { skip: options.skip }, async () => fn(await fresh()));

  t("starts empty", async (store) => {
    assert.deepEqual(await store.list(), []);
  });

  t("create returns the new task, not done, with an id and a creation time", async (store) => {
    const before = Date.now();
    const task = await store.create("Buy milk");
    assert.equal(task.title, "Buy milk");
    assert.equal(task.done, false);
    assert.ok(Number.isInteger(task.id) && task.id > 0);
    assert.ok(task.createdAt instanceof Date);
    assert.ok(task.createdAt.getTime() >= before - 5_000, "createdAt is now");
  });

  t("list returns tasks in the order they were created", async (store) => {
    const a = await store.create("first");
    const b = await store.create("second");
    assert.deepEqual((await store.list()).map((x) => x.id), [a.id, b.id]);
  });

  t("update changes only the fields given", async (store) => {
    const task = await store.create("Write tests");
    const done = await store.update(task.id, { done: true });
    assert.equal(done?.title, "Write tests");
    assert.equal(done?.done, true);
    const renamed = await store.update(task.id, { title: "Write more tests" });
    assert.equal(renamed?.title, "Write more tests");
    assert.equal(renamed?.done, true, "done stays as it was");
  });

  t("update of a missing id returns undefined", async (store) => {
    assert.equal(await store.update(999_999, { done: true }), undefined);
  });

  t("remove deletes once, then reports the id as missing", async (store) => {
    const task = await store.create("Temporary");
    assert.equal(await store.remove(task.id), true);
    assert.equal(await store.remove(task.id), false);
    assert.deepEqual(await store.list(), []);
  });

  t("ids are not reused after a delete", async (store) => {
    const a = await store.create("a");
    await store.remove(a.id);
    const b = await store.create("b");
    assert.notEqual(b.id, a.id);
  });

  t("ping succeeds when the store is reachable", async (store) => {
    await store.ping();
  });
}
