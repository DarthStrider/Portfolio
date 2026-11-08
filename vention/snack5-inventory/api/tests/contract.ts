/**
 * The behaviour every InventoryRepo must have. Run against each database by
 * memory.test.ts, postgres.test.ts and mongo.test.ts, so the three can't drift apart.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ConflictError, NotFoundError } from "../src/domain/errors.ts";
import type { InventoryRepo, SeedPart } from "../src/domain/types.ts";

export const FIXTURE: SeedPart[] = [
  { sku: "BAR-4040-CLR", name: "40x40 extrusion", category: "extrusion", unit: "bar (3 m)", onHand: 10, reorderLevel: 4, location: "A-1" },
  { sku: "LA-300", name: "Linear actuator", category: "actuator", unit: "piece", onHand: 3, reorderLevel: 2, location: "D-1" },
  { sku: "MC-1", name: "Motion controller", category: "controller", unit: "piece", onHand: 2, reorderLevel: 2, location: "D-2" },
  { sku: "PL-200", name: "Mounting plate 200_mm", category: "plate", unit: "plate", onHand: 20, reorderLevel: 5, location: "B-1" },
];

export function contractTests(name: string, makeRepo: () => Promise<InventoryRepo>) {
  describe(`${name} repository`, () => {
    let repo: InventoryRepo;

    before(async () => {
      repo = await makeRepo();
      await repo.init();
    });
    beforeEach(async () => {
      await repo.reset();
      assert.equal(await repo.seedIfEmpty(FIXTURE), true);
    });
    after(async () => {
      await repo.reset();
      await repo.close();
    });

    test("seeds only an empty database", async () => {
      assert.equal(await repo.seedIfEmpty(FIXTURE), false);
      assert.equal((await repo.listParts()).length, FIXTURE.length);
    });

    test("lists parts by SKU with derived fields", async () => {
      const parts = await repo.listParts();
      assert.deepEqual(parts.map((p) => p.sku), ["BAR-4040-CLR", "LA-300", "MC-1", "PL-200"]);
      const mc = parts.find((p) => p.sku === "MC-1")!;
      assert.equal(mc.available, 2);
      assert.equal(mc.reserved, 0);
      assert.equal(mc.low, true); // available 2 <= reorder level 2
      assert.ok(!Number.isNaN(Date.parse(mc.updatedAt)));
    });

    test("searches SKU and name case-insensitively, with % and _ taken literally", async () => {
      assert.deepEqual((await repo.listParts({ search: "actuator" })).map((p) => p.sku), ["LA-300"]);
      assert.deepEqual((await repo.listParts({ search: "la-3" })).map((p) => p.sku), ["LA-300"]);
      assert.deepEqual((await repo.listParts({ search: "200_mm" })).map((p) => p.sku), ["PL-200"]);
      assert.deepEqual((await repo.listParts({ search: "%" })).map((p) => p.sku), []);
    });

    test("filters to low stock", async () => {
      assert.deepEqual((await repo.listParts({ lowOnly: true })).map((p) => p.sku), ["MC-1"]);
      await repo.consume("LA-300", 1, "");
      assert.deepEqual((await repo.listParts({ lowOnly: true })).map((p) => p.sku), ["LA-300", "MC-1"]);
    });

    test("getParts returns only the SKUs that exist", async () => {
      assert.deepEqual((await repo.getParts(["PL-200", "NOPE-1", "LA-300"])).map((p) => p.sku).sort(), ["LA-300", "PL-200"]);
    });

    test("createPart adds a part and logs its initial stock as a receipt", async () => {
      const p = await repo.createPart({ sku: "PL-400", name: "Mounting plate, 400 mm", category: "plate", unit: "plate", onHand: 12, reorderLevel: 5, location: "B-01-4" });
      assert.deepEqual([p.sku, p.onHand, p.reserved, p.available, p.low], ["PL-400", 12, 0, 12, false]);
      assert.equal((await repo.getParts(["PL-400"]))[0].name, "Mounting plate, 400 mm");
      const [m] = await repo.movements({ sku: "PL-400", limit: 5 });
      assert.deepEqual([m.kind, m.qty, m.note], ["receive", 12, "Initial stock"]);
      // A part can start empty: no ledger line, since nothing was received.
      await repo.createPart({ sku: "SRV-750", name: "Servo motor, 750 W", category: "motor", unit: "piece", onHand: 0, reorderLevel: 2, location: "" });
      assert.equal((await repo.movements({ sku: "SRV-750", limit: 5 })).length, 0);
      assert.equal((await repo.getParts(["SRV-750"]))[0].low, true);
    });

    test("createPart refuses a SKU that exists, even from simultaneous requests", async () => {
      await assert.rejects(repo.createPart({ ...FIXTURE[1], onHand: 99 }), ConflictError);
      assert.equal((await repo.getParts(["LA-300"]))[0].onHand, 3);
      const part = { sku: "GR-2", name: "Vacuum gripper", category: "gripper" as const, unit: "piece", onHand: 1, reorderLevel: 0, location: "" };
      const results = await Promise.allSettled([repo.createPart(part), repo.createPart(part), repo.createPart(part)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await repo.movements({ sku: "GR-2", limit: 5 })).length, 1);
    });

    test("receive adds stock and writes a movement", async () => {
      const p = await repo.receive("PL-200", 5, "PO-1001");
      assert.equal(p.onHand, 25);
      const [m] = await repo.movements({ sku: "PL-200", limit: 10 });
      assert.equal(m.kind, "receive");
      assert.equal(m.qty, 5);
      assert.equal(m.note, "PO-1001");
      assert.equal(m.reservationId, null);
    });

    test("receive and consume reject unknown SKUs", async () => {
      await assert.rejects(repo.receive("NOPE-1", 1, ""), NotFoundError);
      await assert.rejects(repo.consume("NOPE-1", 1, ""), NotFoundError);
    });

    test("consume can't take stock that's reserved for a quote", async () => {
      const r = await repo.reserve("Q-1", [{ sku: "LA-300", qty: 2 }]);
      assert.equal(r.ok, true);
      await assert.rejects(repo.consume("LA-300", 2, "line-side"), ConflictError);
      const p = await repo.consume("LA-300", 1, "line-side");
      assert.equal(p.onHand, 2);
      assert.equal(p.available, 0);
    });

    test("reserve holds every line and records who for", async () => {
      const r = await repo.reserve("Q-1", [{ sku: "LA-300", qty: 2 }, { sku: "BAR-4040-CLR", qty: 3 }]);
      assert.ok(r.ok);
      assert.equal(r.reservation.status, "active");
      assert.equal(r.reservation.quoteRef, "Q-1");
      assert.deepEqual(r.reservation.lines, [{ sku: "BAR-4040-CLR", qty: 3 }, { sku: "LA-300", qty: 2 }]);
      const [bar, la] = await repo.getParts(["BAR-4040-CLR", "LA-300"]);
      assert.equal(bar.reserved, 3);
      assert.equal(la.available, 1);
      const moves = await repo.movements({ limit: 10 });
      assert.deepEqual(moves.map((m) => m.kind), ["reserve", "reserve"]);
      assert.ok(moves.every((m) => m.reservationId === r.reservation.id));
    });

    test("reserve adds up lines for the same SKU", async () => {
      const r = await repo.reserve("Q-1", [{ sku: "LA-300", qty: 1 }, { sku: "LA-300", qty: 2 }]);
      assert.ok(r.ok);
      assert.deepEqual(r.reservation.lines, [{ sku: "LA-300", qty: 3 }]);
      assert.ok(!(await repo.reserve("Q-2", [{ sku: "LA-300", qty: 1 }])).ok);
    });

    test("reserve is all or nothing, and reports every shortage", async () => {
      const r = await repo.reserve("Q-1", [
        { sku: "BAR-4040-CLR", qty: 2 }, { sku: "LA-300", qty: 5 }, { sku: "GHOST-1", qty: 1 }, { sku: "PL-200", qty: 1 },
      ]);
      assert.equal(r.ok, false);
      assert.ok(!r.ok);
      assert.deepEqual(
        r.shortages.map((s) => ({ ...s })).sort((a, b) => a.sku.localeCompare(b.sku)),
        [{ sku: "GHOST-1", need: 1, available: 0, known: false }, { sku: "LA-300", need: 5, available: 3, known: true }],
      );
      for (const p of await repo.listParts()) assert.equal(p.reserved, 0, `${p.sku} was left reserved`);
      assert.deepEqual(await repo.reservations(10), []);
      assert.deepEqual(await repo.movements({ limit: 10 }), []);
    });

    test("concurrent reservations never over-reserve", async () => {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => repo.reserve(`Q-${i}`, [{ sku: "LA-300", qty: 1 }])));
      assert.equal(results.filter((r) => r.ok).length, 3);
      const [la] = await repo.getParts(["LA-300"]);
      assert.equal(la.reserved, 3);
      assert.equal(la.available, 0);
    });

    test("release gives the stock back", async () => {
      const r = await repo.reserve("Q-1", [{ sku: "MC-1", qty: 2 }]);
      assert.ok(r.ok);
      const released = await repo.release(r.reservation.id);
      assert.equal(released.status, "released");
      assert.ok(released.closedAt);
      const [mc] = await repo.getParts(["MC-1"]);
      assert.equal(mc.reserved, 0);
      assert.equal(mc.onHand, 2);
    });

    test("fulfil ships the reserved stock", async () => {
      const r = await repo.reserve("Q-1", [{ sku: "MC-1", qty: 2 }, { sku: "PL-200", qty: 4 }]);
      assert.ok(r.ok);
      const done = await repo.fulfil(r.reservation.id);
      assert.equal(done.status, "fulfilled");
      const [mc, pl] = await repo.getParts(["MC-1", "PL-200"]);
      assert.deepEqual([mc.onHand, mc.reserved, pl.onHand, pl.reserved], [0, 0, 16, 0]);
      const kinds = (await repo.movements({ limit: 10 })).map((m) => m.kind);
      assert.deepEqual(kinds.slice(0, 2), ["fulfil", "fulfil"]);
    });

    test("a reservation can only be closed once, even by simultaneous requests", async () => {
      const r = await repo.reserve("Q-1", [{ sku: "LA-300", qty: 2 }]);
      assert.ok(r.ok);
      const outcomes = await Promise.allSettled([repo.release(r.reservation.id), repo.release(r.reservation.id), repo.fulfil(r.reservation.id)]);
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      assert.ok(outcomes.filter((o) => o.status === "rejected").every((o) => (o as PromiseRejectedResult).reason instanceof ConflictError));
      const [la] = await repo.getParts(["LA-300"]);
      assert.equal(la.reserved, 0);
    });

    test("closing an unknown reservation is not found", async () => {
      await assert.rejects(repo.release("00000000-0000-4000-8000-000000000000"), NotFoundError);
      await assert.rejects(repo.fulfil("not-a-uuid"), NotFoundError);
    });

    test("shapes: create, list oldest first, move, rename, delete", async () => {
      const box = await repo.createShape({ name: "Crate", kind: "box", size: { x: 0.3, y: 0.2, z: 0.25 }, color: "#d97706", position: { x: 0.5, z: -0.2 }, rotationY: 15, sku: null });
      const can = await repo.createShape({ name: "Actuator", kind: "box", size: { x: 0.4, y: 0.06, z: 0.06 }, color: "#2563eb", position: { x: -0.4, z: 0.3 }, rotationY: 0, sku: "LA-300" });
      assert.equal(box.sku, null);
      assert.equal(can.sku, "LA-300");
      assert.equal((await repo.listShapes())[1].sku, "LA-300");
      assert.match(box.id, /^[0-9a-f-]{36}$/);
      assert.deepEqual(box.size, { x: 0.3, y: 0.2, z: 0.25 });
      assert.deepEqual((await repo.listShapes()).map((s) => s.name), ["Crate", "Actuator"]);

      const moved = await repo.updateShape(box.id, { position: { x: 0.6, z: 0.1 }, rotationY: 90 });
      assert.deepEqual([moved.position, moved.rotationY, moved.name, moved.color], [{ x: 0.6, z: 0.1 }, 90, "Crate", "#d97706"]);
      const renamed = await repo.updateShape(box.id, { name: "Tote", color: "#15803d" });
      assert.deepEqual([renamed.name, renamed.color, renamed.position], ["Tote", "#15803d", { x: 0.6, z: 0.1 }]);
      assert.ok(Date.parse(renamed.updatedAt) >= Date.parse(renamed.createdAt));

      await repo.deleteShape(can.id);
      assert.deepEqual((await repo.listShapes()).map((s) => s.id), [box.id]);
      await assert.rejects(repo.deleteShape(can.id), NotFoundError);
      await assert.rejects(repo.updateShape("00000000-0000-4000-8000-000000000000", { rotationY: 1 }), NotFoundError);
    });

    test("conveyors: create, list, move, change speed, delete", async () => {
      const a = await repo.createConveyor({ name: "Infeed", length: 1.2, width: 0.3, height: 0.25, speed: 0.2, position: { x: 0.6, z: -0.5 }, rotationY: 0 });
      const b = await repo.createConveyor({ name: "Outfeed", length: 0.8, width: 0.25, height: 0.15, speed: -0.1, position: { x: -0.4, z: 0.6 }, rotationY: 90 });
      assert.match(a.id, /^[0-9a-f-]{36}$/);
      assert.deepEqual((await repo.listConveyors()).map((c) => [c.name, c.speed]), [["Infeed", 0.2], ["Outfeed", -0.1]]);
      const moved = await repo.updateConveyor(a.id, { position: { x: 0.5, z: -0.6 }, speed: 0.35 });
      assert.deepEqual([moved.position, moved.speed, moved.length, moved.rotationY], [{ x: 0.5, z: -0.6 }, 0.35, 1.2, 0]);
      await repo.deleteConveyor(b.id);
      assert.deepEqual((await repo.listConveyors()).map((c) => c.id), [a.id]);
      await assert.rejects(repo.deleteConveyor(b.id), NotFoundError);
      await assert.rejects(repo.updateConveyor("00000000-0000-4000-8000-000000000000", { speed: 0 }), NotFoundError);
    });

    test("splitters: rules stored as written, updated whole, deleted with their belt", async () => {
      const belt = await repo.createConveyor({ name: "Sorter", length: 2, width: 0.4, height: 0.3, speed: 0.3, position: { x: 0.8, z: 0 }, rotationY: 0 });
      const rules = [
        { conditions: [{ field: "part.category" as const, op: "eq" as const, value: "plate" }], exit: "left" as const },
        { conditions: [{ field: "kind" as const, op: "in" as const, value: ["sphere", "cylinder"] }, { field: "height" as const, op: "gt" as const, value: 0.1 }], exit: "right" as const },
      ];
      const s = await repo.createSplitter({ name: "Gate 1", conveyorId: belt.id, along: 1.2, rules, otherwise: "straight" });
      assert.deepEqual([s.conveyorId, s.along, s.rules, s.otherwise], [belt.id, 1.2, rules, "straight"]);
      // Reordering is a whole-list update; other fields stay.
      const swapped = await repo.updateSplitter(s.id, { rules: [rules[1], rules[0]], otherwise: "left" });
      assert.deepEqual([swapped.rules.map((r) => r.exit), swapped.otherwise, swapped.along, swapped.name], [["right", "left"], "left", 1.2, "Gate 1"]);
      assert.deepEqual((await repo.listSplitters()).map((x) => x.id), [s.id]);
      await repo.deleteConveyor(belt.id);
      assert.deepEqual(await repo.listSplitters(), []);
      await assert.rejects(repo.updateSplitter(s.id, { name: "x" }), NotFoundError);
      await assert.rejects(repo.deleteSplitter(s.id), NotFoundError);
    });

    test("updatePart changes details but never stock", async () => {
      const before = (await repo.getParts(["PL-200"]))[0];
      const p = await repo.updatePart("PL-200", { category: "gripper", location: "Z-9" });
      assert.deepEqual([p.category, p.location, p.name, p.onHand, p.reorderLevel], ["gripper", "Z-9", before.name, before.onHand, before.reorderLevel]);
      assert.equal((await repo.getParts(["PL-200"]))[0].category, "gripper");
      await assert.rejects(repo.updatePart("NOPE-1", { location: "A" }), NotFoundError);
    });

    test("reservations and movements come newest first, with a limit", async () => {
      for (const q of ["Q-1", "Q-2", "Q-3"]) assert.ok((await repo.reserve(q, [{ sku: "PL-200", qty: 1 }])).ok);
      assert.deepEqual((await repo.reservations(2)).map((r) => r.quoteRef), ["Q-3", "Q-2"]);
      const moves = await repo.movements({ limit: 2 });
      assert.deepEqual(moves.map((m) => m.note), ["Reserved for Q-3", "Reserved for Q-2"]);
      assert.equal((await repo.movements({ sku: "LA-300", limit: 10 })).length, 0);
    });
  });
}
