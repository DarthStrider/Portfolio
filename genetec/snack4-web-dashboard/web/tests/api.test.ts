import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api";

const realFetch = globalThis.fetch;
let urls: string[] = [];

function respond(status: number, body: unknown) {
  urls = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("events calls /api/events with the filters as a query string", async () => {
  respond(200, []);
  await api.events("granted", "lobby");
  assert.deepEqual(urls, ["/api/events?outcome=granted&search=lobby"]);
});

test("the reports call their own endpoints", async () => {
  respond(200, []);
  await api.deniedByDoor();
  await api.noisiest();
  assert.deepEqual(urls, ["/api/reports/denied-by-door", "/api/reports/noisiest"]);
});

test("an error response throws the API's message", async () => {
  respond(400, { error: "outcome must be all, granted, denied or status" });
  await assert.rejects(api.events("all", ""), { message: "outcome must be all, granted, denied or status" });
});
