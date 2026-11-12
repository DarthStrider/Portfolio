import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import type { TaskStore } from "../src/store.js";
import { memoryStore } from "./memoryStore.js";

// The real Express app on a random port, over real HTTP, with tasks kept in memory.
let store: TaskStore;
let server: Server;
let base: string;

before(async () => {
  // The app reads `store` through this wrapper, so each test can swap in a fresh one.
  const current: TaskStore = {
    list: () => store.list(),
    create: (t) => store.create(t),
    update: (id, c) => store.update(id, c),
    remove: (id) => store.remove(id),
    ping: () => store.ping(),
  };
  server = createApp(current).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  store = memoryStore();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

test("GET /tasks starts empty", async () => {
  assert.deepEqual(await call("GET", "/tasks"), { status: 200, body: [] });
});

test("POST /tasks creates a task with a trimmed title and returns 201", async () => {
  const res = await call("POST", "/tasks", { title: "  Buy milk  " });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, "Buy milk");
  assert.equal(res.body.done, false);
  assert.equal((await call("GET", "/tasks")).body.length, 1);
});

test("POST /tasks rejects a missing, blank or too-long title with 400", async () => {
  for (const body of [{}, { title: "   " }, { title: "x".repeat(201) }, { title: 5 }]) {
    const res = await call("POST", "/tasks", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, /title/);
  }
  assert.deepEqual((await call("GET", "/tasks")).body, [], "nothing was stored");
});

test("PATCH /tasks/:id marks a task done and renames it", async () => {
  const { body: task } = await call("POST", "/tasks", { title: "Draft" });
  const done = await call("PATCH", `/tasks/${task.id}`, { done: true });
  assert.equal(done.status, 200);
  assert.equal(done.body.done, true);
  const renamed = await call("PATCH", `/tasks/${task.id}`, { title: "Final" });
  assert.equal(renamed.body.title, "Final");
  assert.equal(renamed.body.done, true);
});

test("PATCH validates the id, the title and done", async () => {
  const { body: task } = await call("POST", "/tasks", { title: "Draft" });
  assert.equal((await call("PATCH", "/tasks/abc", { done: true })).status, 400);
  assert.equal((await call("PATCH", "/tasks/0", { done: true })).status, 400);
  assert.equal((await call("PATCH", `/tasks/${task.id}`, { title: "" })).status, 400);
  const badDone = await call("PATCH", `/tasks/${task.id}`, { done: "yes" });
  assert.equal(badDone.status, 400);
  assert.match(badDone.body.error, /done/);
});

test("PATCH and DELETE of a missing task return 404", async () => {
  assert.equal((await call("PATCH", "/tasks/12345", { done: true })).status, 404);
  assert.equal((await call("DELETE", "/tasks/12345")).status, 404);
});

test("DELETE /tasks/:id returns 204 with no body, then the task is gone", async () => {
  const { body: task } = await call("POST", "/tasks", { title: "Temporary" });
  assert.deepEqual(await call("DELETE", `/tasks/${task.id}`), { status: 204, body: undefined });
  assert.deepEqual((await call("GET", "/tasks")).body, []);
});

test("health: live is always ok; ready follows the database", async () => {
  assert.deepEqual(await call("GET", "/health/live"), { status: 200, body: { status: "ok" } });
  assert.equal((await call("GET", "/health/ready")).status, 200);
  store = memoryStore({ down: true });
  assert.deepEqual(await call("GET", "/health/ready"), { status: 503, body: { status: "database unavailable" } });
  assert.equal((await call("GET", "/health/live")).status, 200, "liveness ignores the database");
});

test("an error thrown by the store becomes a 500 with a generic message", async () => {
  store = { ...memoryStore(), list: async () => { throw new Error("connection reset"); } };
  const original = console.error;
  console.error = () => {}; // the app logs the error; keep the test output clean
  try {
    assert.deepEqual(await call("GET", "/tasks"), { status: 500, body: { error: "internal server error" } });
  } finally {
    console.error = original;
  }
});

test("GET /info reports the hostname", async () => {
  const res = await call("GET", "/info");
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.hostname, "string");
});
