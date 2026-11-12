import { test } from "node:test";
import assert from "node:assert/strict";
import { eventsQuery, relativeTime, tone } from "../src/filters";
import type { AccessEvent } from "../src/types";

test("eventsQuery leaves out the defaults", () => {
  assert.equal(eventsQuery("all", ""), "");
  assert.equal(eventsQuery("all", "   "), "", "blank search is no search");
});

test("eventsQuery adds the outcome, the trimmed search and a non-default limit", () => {
  assert.equal(eventsQuery("denied", "  server room "), "?outcome=denied&search=server+room");
  assert.equal(eventsQuery("status", "", 20), "?outcome=status&limit=20");
});

test("eventsQuery encodes characters that mean something in a URL", () => {
  assert.equal(eventsQuery("all", "a&b=c"), "?search=a%26b%3Dc");
});

const event = (granted: boolean | null): AccessEvent => ({
  id: 1, occurredAtUtc: "2026-11-12T15:00:00Z", deviceId: 1, deviceName: "Door", location: "Floor", cardholderId: null,
  cardholderName: null, kind: granted === null ? "StatusChange" : "BadgeSwipe", granted, detail: null, outcome: "",
});

test("tone colours granted, denied and status changes differently", () => {
  assert.equal(tone(event(true)), "granted");
  assert.equal(tone(event(false)), "denied");
  assert.equal(tone(event(null)), "status");
});

test("relativeTime describes how long ago, then falls back to the date", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  assert.equal(relativeTime("2026-11-12T14:59:30Z", now), "just now");
  assert.equal(relativeTime("2026-11-12T14:45:00Z", now), "15 min ago");
  assert.equal(relativeTime("2026-11-12T12:00:00Z", now), "3 h ago");
  assert.equal(relativeTime("2026-11-10T08:00:00Z", now), "2026-11-10");
});

test("relativeTime treats a time without a zone as UTC, as the API stores it", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  assert.equal(relativeTime("2026-11-12T14:50:00", now), "10 min ago");
});
