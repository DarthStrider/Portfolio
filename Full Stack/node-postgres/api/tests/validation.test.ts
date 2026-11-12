import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TITLE, parseId, validTitle } from "../src/validation.js";

test("parseId accepts positive whole numbers, including as route strings", () => {
  assert.equal(parseId("1"), 1);
  assert.equal(parseId("42"), 42);
  assert.equal(parseId(7), 7);
});

test("parseId rejects zero, negatives, decimals and text", () => {
  for (const bad of ["0", "-3", "1.5", "abc", "", undefined, null]) {
    assert.equal(parseId(bad), undefined, `${String(bad)} should be rejected`);
  }
});

test("validTitle accepts 1 to 200 characters with something besides spaces", () => {
  assert.ok(validTitle("a"));
  assert.ok(validTitle("  padded  "), "spaces around text are fine (the route trims them)");
  assert.ok(validTitle("x".repeat(MAX_TITLE)));
});

test("validTitle rejects empty, blank, too long and non-string titles", () => {
  assert.ok(!validTitle(""));
  assert.ok(!validTitle("   "));
  assert.ok(!validTitle("x".repeat(MAX_TITLE + 1)));
  assert.ok(!validTitle(42));
  assert.ok(!validTitle(undefined));
  assert.ok(!validTitle({ title: "nested" }));
});
