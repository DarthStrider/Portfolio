// The browser's API client, tested in Node by replacing fetch with a fake that records each call.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api";

type Call = { url: string; init?: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Makes every fetch return this status and body, and remember what it was asked. */
function respond(status: number, body?: unknown) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("list calls GET /api/tasks and returns the parsed tasks", async () => {
  const tasks = [{ id: 1, title: "a", done: false, createdAt: "2026-01-01T00:00:00Z" }];
  respond(200, tasks);
  assert.deepEqual(await api.list(), tasks);
  assert.equal(calls[0].url, "/api/tasks");
  assert.equal(calls[0].init?.method, undefined, "GET is fetch's default");
});

test("create POSTs the title as JSON", async () => {
  respond(201, { id: 2, title: "Buy milk", done: false, createdAt: "" });
  await api.create("Buy milk");
  assert.equal(calls[0].url, "/api/tasks");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { title: "Buy milk" });
  assert.deepEqual(calls[0].init?.headers, { "Content-Type": "application/json" });
});

test("update PATCHes only the fields given, to the task's URL", async () => {
  respond(200, { id: 7, title: "x", done: true, createdAt: "" });
  await api.update(7, { done: true });
  assert.equal(calls[0].url, "/api/tasks/7");
  assert.equal(calls[0].init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { done: true });
});

test("remove resolves to undefined on 204 No Content", async () => {
  respond(204);
  assert.equal(await api.remove(3), undefined);
  assert.equal(calls[0].init?.method, "DELETE");
});

test("an error response throws the API's own message", async () => {
  respond(400, { error: "title is required (1-200 characters)" });
  await assert.rejects(api.create(""), { message: "title is required (1-200 characters)" });
});

test("an error without a JSON body throws a message with the status", async () => {
  respond(502);
  await assert.rejects(api.list(), { message: "Request failed (502)" });
});
