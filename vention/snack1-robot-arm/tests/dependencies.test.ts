// Dependency hygiene, checked like any other behavior.
//
// These tests read package.json, package-lock.json and .nvmrc only, so they need no install and
// run in milliseconds. They catch the mistakes that otherwise show up as a confusing CI failure
// or a "works on my machine" bug: a lock file out of step with package.json, a Node version pin
// that disagrees with "engines", or three.js and its type definitions drifting apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const readJson = (file: string) => JSON.parse(readFileSync(new URL(file, root), "utf8"));

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const nvmrc = readFileSync(new URL(".nvmrc", root), "utf8").trim();

type Version = [major: number, minor: number, patch: number];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version: string): Version {
  const m = SEMVER.exec(version);
  assert.ok(m, `"${version}" is not a MAJOR.MINOR.PATCH version`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// Enough of npm's range syntax for this project: ^x.y.z, ~x.y.z, >=x.y.z and exact versions.
// A short bound like ">=22" means ">=22.0.0".
function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  const op = /^(\^|~|>=)?/.exec(range)![0];
  const bound = range.slice(op.length).split(".");
  while (bound.length < 3) bound.push("0");
  const base = parse(bound.join("."));
  if (compare(v, base) < 0) return false;
  if (op === ">=") return true;
  if (op === "~") return v[0] === base[0] && v[1] === base[1];
  if (op === "^") {
    // A caret allows changes that SemVer promises are compatible. Below 1.0.0 the minor
    // number is the breaking one (0.170 → 0.171 may break), and below 0.1.0 even the patch is.
    if (base[0] > 0) return v[0] === base[0];
    if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
    return v[0] === 0 && v[1] === 0 && v[2] === base[2];
  }
  return compare(v, base) === 0;
}

const declared: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

test("the range helper follows npm's rules, including the 0.x special case", () => {
  assert.ok(satisfies("6.4.5", "^6.3.0"));
  assert.ok(!satisfies("7.0.0", "^6.3.0"), "a new major is a breaking change");
  assert.ok(satisfies("0.170.4", "^0.170.0"));
  assert.ok(!satisfies("0.171.0", "^0.170.0"), "below 1.0.0, a new minor is breaking");
  assert.ok(satisfies("5.9.1", "~5.9.0"));
  assert.ok(!satisfies("5.10.0", "~5.9.0"));
  assert.ok(satisfies("24.1.0", ">=22"));
  assert.ok(!satisfies("20.19.0", ">=22"));
});

test("the project version is a valid MAJOR.MINOR.PATCH", () => {
  parse(pkg.version);
  assert.equal(lock.version, pkg.version, "run npm install so the lock file records the new version");
});

test("package-lock.json was regenerated after the last package.json edit", () => {
  const lockRoot = lock.packages[""];
  assert.deepEqual(lockRoot.dependencies ?? {}, pkg.dependencies ?? {}, "run npm install");
  assert.deepEqual(lockRoot.devDependencies ?? {}, pkg.devDependencies ?? {}, "run npm install");
});

test("every locked direct dependency is inside the range package.json allows", () => {
  for (const [name, range] of Object.entries(declared)) {
    const locked = lock.packages[`node_modules/${name}`]?.version;
    assert.ok(locked, `${name} is in package.json but not in package-lock.json`);
    assert.ok(satisfies(locked, range), `${name}@${locked} is outside "${range}"`);
  }
});

test("three and @types/three are on the same release", () => {
  // @types/three is versioned to match three. A mismatch type-checks against an API the
  // running library doesn't have, so Dependabot updates these two together (see .github).
  const [, threeMinor] = parse(lock.packages["node_modules/three"].version);
  const [, typesMinor] = parse(lock.packages["node_modules/@types/three"].version);
  assert.equal(typesMinor, threeMinor);
});

test(".nvmrc pins a Node version that package.json's engines field accepts", () => {
  const range: string = pkg.engines?.node;
  assert.ok(range, 'package.json needs "engines": { "node": ... }');
  const pinned = /^v?(\d+)$/.exec(nvmrc)?.[1];
  assert.ok(pinned, `.nvmrc should hold a major version like "22", not "${nvmrc}"`);
  assert.ok(satisfies(`${pinned}.0.0`, range), `.nvmrc says ${pinned}, engines says ${range}`);
});

test("the Node version running these tests meets the engines field", () => {
  const running = process.versions.node;
  assert.ok(
    satisfies(running, pkg.engines.node),
    `Node ${running} is older than package.json allows (${pkg.engines.node})`,
  );
});
