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
      // The floor is 20 m × 20 m: far corners are allowed by every store (PostgreSQL's CHECK too).
      const far = await repo.updateShape(can.id, { position: { x: 9.5, z: -10 } });
      assert.deepEqual(far.position, { x: 9.5, z: -10 });
      await repo.updateShape(can.id, { position: { x: -0.4, z: 0.3 } });

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

    test("conveyor lines: section fields stored, older belts default to straight, a batch update is all or none", async () => {
      const line = "6f1c2a1e-6c1b-4f7e-9a40-2d6b0a6c1f11";
      const first = await repo.createConveyor({ name: "Line 1", length: 1, width: 0.3, height: 0.3, speed: 0.2, position: { x: 0.5, z: 0 }, rotationY: 0, lineId: line, lineIndex: 0 });
      const bend = await repo.createConveyor({
        name: "Line 2", length: 0.942478, width: 0.3, height: 0.3, speed: 0.2, position: { x: 1, z: -0.6 }, rotationY: 0,
        kind: "curve", turn: 90, radius: 0.6, lineId: line, lineIndex: 1,
      });
      const corner = await repo.createConveyor({
        name: "Line 3", length: 0.3, width: 0.3, height: 0.3, speed: 0.2, position: { x: 1.75, z: -0.6 }, rotationY: 90,
        kind: "transfer", turn: -90, radius: 0, lineId: line, lineIndex: 2,
      });
      const plain = await repo.createConveyor({ name: "Alone", length: 0.8, width: 0.3, height: 0.2, speed: 0.1, position: { x: -0.5, z: 0.5 }, rotationY: 0 });
      assert.deepEqual([bend.kind, bend.turn, bend.radius, bend.lineId, bend.lineIndex], ["curve", 90, 0.6, line, 1]);
      assert.deepEqual([corner.kind, corner.turn], ["transfer", -90]);
      assert.deepEqual([plain.kind, plain.turn, plain.radius, plain.lineId, plain.lineIndex], ["straight", 0, 0, null, 0]);

      // A line moves as one: every section, in one request.
      const moved = await repo.updateConveyors([
        { id: first.id, patch: { position: { x: 0.6, z: 0.1 }, speed: 0.3 } },
        { id: bend.id, patch: { position: { x: 1.1, z: -0.5 }, speed: 0.3 } },
        { id: corner.id, patch: { position: { x: 1.85, z: -0.5 }, speed: 0.3 } },
      ]);
      assert.deepEqual(moved.map((c) => [c.id, c.position.x, c.speed]), [[first.id, 0.6, 0.3], [bend.id, 1.1, 0.3], [corner.id, 1.85, 0.3]]);
      // A missing id changes nothing at all.
      await assert.rejects(repo.updateConveyors([
        { id: first.id, patch: { speed: -0.3 } },
        { id: "00000000-0000-4000-8000-000000000000", patch: { speed: -0.3 } },
      ]), NotFoundError);
      assert.equal((await repo.listConveyors()).find((c) => c.id === first.id)!.speed, 0.3);
      // Leaving a line: lineId back to null, and a new place.
      const left = await repo.updateConveyor(corner.id, { lineId: null, lineIndex: 0 });
      assert.deepEqual([left.lineId, left.lineIndex, left.kind], [null, 0, "transfer"]);
      for (const c of [first, bend, corner, plain]) await repo.deleteConveyor(c.id);
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

    test("connection points: stored per kind, replaced whole, back to defaults", async () => {
      assert.deepEqual(await repo.listConnectors(), []);
      const pts = [{ name: "left", x: -0.5, y: 0, z: 0 }, { name: "top", x: 0, y: 0.5, z: 0 }];
      await repo.setConnectors("part:PL-200", pts);
      await repo.setConnectors("kind:box", [pts[1]]);
      const again = await repo.setConnectors("part:PL-200", [pts[0]]); // an upsert: replaces, doesn't add
      assert.deepEqual(again.points, [pts[0]]);
      assert.deepEqual((await repo.listConnectors()).map((c) => [c.owner, c.points.length]), [["kind:box", 1], ["part:PL-200", 1]]);
      await repo.deleteConnectors("kind:box");
      await assert.rejects(repo.deleteConnectors("kind:box"), NotFoundError);
    });

    test("mergers and machines: stored, patched, deleted with any belt they use", async () => {
      const mk = (name: string) => repo.createConveyor({ name, length: 1.5, width: 0.3, height: 0.3, speed: 0.3, position: { x: 0, z: 0 }, rotationY: 0 });
      const [main, a, b] = [await mk("Main"), await mk("Feeder A"), await mk("Feeder B")];
      const side = await repo.createMerger({ name: "Side", kind: "side", conveyorId: main.id, along: 0.8, feederIds: [a.id], priority: "main", gap: 0.3 });
      const y = await repo.createMerger({ name: "Y", kind: "y", conveyorId: main.id, along: 0, feederIds: [a.id, b.id], priority: "alternate", gap: 0.25 });
      assert.deepEqual([y.feederIds, y.priority], [[a.id, b.id], "alternate"]);
      assert.equal((await repo.updateMerger(side.id, { priority: "feeders" })).priority, "feeders");
      const m = await repo.createMachine({ name: "Joiner", conveyorId: main.id, along: 1.2, base: { owner: "part:PL-200", point: "top" }, attach: { owner: "kind:cylinder", point: "bottom" }, cycleSeconds: 1.5 });
      const m2 = await repo.updateMachine(m.id, { attach: { owner: "part:LA-300", point: "bottom" } });
      assert.deepEqual([m2.attach, m2.base, m2.along], [{ owner: "part:LA-300", point: "bottom" }, { owner: "part:PL-200", point: "top" }, 1.2]);
      // Deleting feeder B removes only the Y merger, which used it; deleting the main belt removes the rest.
      await repo.deleteConveyor(b.id);
      assert.deepEqual((await repo.listMergers()).map((x) => x.name), ["Side"]);
      await repo.deleteConveyor(main.id);
      assert.deepEqual([await repo.listMergers(), await repo.listMachines()], [[], []]);
      await assert.rejects(repo.deleteMachine(m.id), NotFoundError);
    });

    test("assemble: joins, uses each part once, refuses loops, double joins and shortages", async () => {
      const at = { x: 0, z: 0 };
      const shape = (name: string, sku: string | null) => repo.createShape({ name, kind: "box", size: { x: 0.2, y: 0.1, z: 0.2 }, color: "#9aa3af", position: at, rotationY: 0, sku });
      const plate = await shape("Plate", "PL-200");
      const motor = await shape("Actuator", "LA-300");
      const plain = await shape("Spacer", null);
      const stock = async () => Object.fromEntries((await repo.getParts(["PL-200", "LA-300"])).map((p) => [p.sku, p.onHand]));
      const before = await stock();
      const join = (base: string, attached: string) => repo.assemble({ name: "Bracket", baseShapeId: base, attachedShapeId: attached, basePoint: "top", attachedPoint: "bottom", attachment: { x: 0, y: 0.1, z: 0, rotationY: 0 } });

      const first = await join(plate.id, motor.id);
      assert.ok(first.ok);
      assert.deepEqual(first.ok && first.assembly.consumed, [{ sku: "LA-300", qty: 1 }, { sku: "PL-200", qty: 1 }]);
      assert.deepEqual(await stock(), { "PL-200": before["PL-200"] - 1, "LA-300": before["LA-300"] - 1 });
      const joined = (await repo.listShapes()).find((s) => s.id === motor.id)!;
      assert.deepEqual([joined.attachedTo, joined.attach], [plate.id, { x: 0, y: 0.1, z: 0, rotationY: 0 }]);
      assert.match((await repo.movements({ sku: "LA-300", limit: 1 }))[0].note, /^Assembly Bracket/);

      // A plain shape onto the assembly: no stock used, and the plate isn't used again.
      const second = await join(plate.id, plain.id);
      assert.deepEqual(second.ok && second.assembly.consumed, []);
      assert.deepEqual(await stock(), { "PL-200": before["PL-200"] - 1, "LA-300": before["LA-300"] - 1 });

      assert.deepEqual(await join(motor.id, plate.id), { ok: false, reason: "cycle" }); // the plate holds the actuator
      assert.deepEqual(await join(motor.id, plain.id), { ok: false, reason: "already_attached" });
      assert.deepEqual(await join(plate.id, "00000000-0000-4000-8000-000000000000"), { ok: false, reason: "not_found" });

      // Not enough actuators: nothing changes, nothing is attached.
      const p2 = await shape("Plate 2", "PL-200");
      const m2 = await shape("Actuator 2", "LA-300");
      const la = (await repo.getParts(["LA-300"]))[0];
      await repo.consume("LA-300", la.available, "use them all");
      const plates = (await stock())["PL-200"];
      const short = await join(p2.id, m2.id);
      assert.deepEqual(short, { ok: false, reason: "short", shortages: [{ sku: "LA-300", need: 1, available: 0 }] });
      assert.equal((await stock())["PL-200"], plates);
      assert.equal((await repo.listShapes()).find((s) => s.id === m2.id)!.attachedTo, null);

      assert.deepEqual((await repo.listAssemblies(10)).length, 2);
      // Deleting the base deletes what's joined onto it.
      await repo.deleteShape(plate.id);
      assert.deepEqual((await repo.listShapes()).map((s) => s.name).sort(), ["Actuator 2", "Plate 2"]);
    });

    test("bins: load from stock, catch, release, unload; stock taken exactly once", async () => {
      const on = async (sku: string) => (await repo.getParts([sku]))[0].onHand;
      const plates0 = await on("PL-200");
      const look = { kind: "box" as const, size: { x: 0.2, y: 0.02, z: 0.2 }, color: "#9aa3af", name: "Plate" };
      const bin = await repo.createBin({ name: "Plates", holds: ["part:PL-200", "kind:cylinder"], accept: [], capacity: 5, position: { x: 1, z: 1 }, rotationY: 0, feed: { type: "none" } });

      const loaded = await repo.loadBin(bin.id, [{ owner: "part:PL-200", qty: 3, look }], false);
      assert.deepEqual(loaded, { ok: true, value: { count: 3, holds: ["part:PL-200", "kind:cylinder"] } });
      assert.equal(await on("PL-200"), plates0 - 3);
      assert.match((await repo.movements({ sku: "PL-200", limit: 1 }))[0].note, /^Loaded into bin Plates/);
      assert.equal((await repo.loadBin(bin.id, [{ owner: "part:PL-200", qty: 3, look }], false)).ok, false); // 3 + 3 > capacity 5
      const stored = (await repo.listShapes()).filter((s) => s.binId === bin.id);
      assert.equal(stored.length, 3);
      assert.ok(stored.every((s) => s.stockTaken && s.sku === "PL-200"));

      // Released onto the floor, then joined: the plate isn't taken from stock again.
      assert.ok((await repo.releaseFromBin(bin.id, stored[0].id, { x: 0.5, z: 0 })).ok);
      assert.equal((await repo.releaseFromBin(bin.id, stored[0].id, { x: 0.5, z: 0 })).ok, false);
      const can = await repo.createShape({ name: "Can", kind: "cylinder", size: { x: 0.08, y: 0.12, z: 0.08 }, color: "#22c55e", position: { x: 0.5, z: 0 }, rotationY: 0, sku: null });
      const joined = await repo.assemble({ name: "Plate + can", baseShapeId: stored[0].id, attachedShapeId: can.id, basePoint: "top", attachedPoint: "bottom", attachment: { x: 0, y: 0.07, z: 0, rotationY: 0 } });
      assert.deepEqual(joined.ok && joined.assembly.consumed, []);
      assert.equal(await on("PL-200"), plates0 - 3);

      // Caught back in, with the can on it: nothing more is taken.
      assert.ok((await repo.catchIntoBin(bin.id, stored[0].id)).ok);
      assert.equal(await on("PL-200"), plates0 - 3);
      assert.equal((await repo.listBins())[0].count, 3);
      // A plate placed in the scene (never taken from stock) is taken as it's caught.
      const loose = await repo.createShape({ name: "Loose plate", kind: "box", size: look.size, color: look.color, position: { x: 0, z: 0 }, rotationY: 0, sku: "PL-200" });
      assert.ok((await repo.catchIntoBin(bin.id, loose.id)).ok);
      assert.equal(await on("PL-200"), plates0 - 4);
      assert.deepEqual(await repo.catchIntoBin(bin.id, can.id), { ok: false, reason: "not_found" }); // joined onto something
      // It holds cylinders too: a plain can goes in, and takes no stock; a ball doesn't.
      const can2 = await repo.createShape({ name: "Can 2", kind: "cylinder", size: { x: 0.08, y: 0.12, z: 0.08 }, color: "#22c55e", position: { x: 0, z: 0 }, rotationY: 0, sku: null });
      assert.ok((await repo.catchIntoBin(bin.id, can2.id)).ok);
      assert.equal(await on("PL-200"), plates0 - 4);
      const wrong = await repo.loadBin(bin.id, [{ owner: "kind:sphere", qty: 1, look }], false);
      assert.equal(wrong.ok === false && wrong.reason, "wrong_kind");
      const ball = await repo.createShape({ name: "Ball", kind: "sphere", size: { x: 0.1, y: 0.1, z: 0.1 }, color: "#e11d48", position: { x: 0, z: 0 }, rotationY: 0, sku: null });
      assert.deepEqual(await repo.catchIntoBin(bin.id, ball.id), { ok: false, reason: "wrong_kind" });

      await assert.rejects(repo.deleteBin(bin.id), ConflictError);
      // Unload takes plain items only (the plate with the can on it stays), giving each plate back.
      assert.deepEqual(await repo.unloadBin(bin.id, 10), { ok: true, value: { unloaded: 4 } });
      assert.equal(await on("PL-200"), plates0 - 1);
      assert.equal((await repo.listBins())[0].count, 1);

      // Short stock: nothing loads.
      const avail = (await repo.getParts(["PL-200"]))[0].available;
      const big = await repo.createBin({ name: "Big", holds: ["part:PL-200"], accept: [], capacity: 200, position: { x: -1, z: 1 }, rotationY: 0, feed: { type: "none" } });
      const short = await repo.loadBin(big.id, [{ owner: "part:PL-200", qty: avail + 1, look }], false);
      assert.equal(short.ok === false && short.reason, "short");
      assert.equal((await repo.listBins()).find((b) => b.id === big.id)!.count, 0);
    });

    test("bins: load several kinds at once, all or nothing, adding kinds when asked", async () => {
      const on = async (sku: string) => (await repo.getParts([sku]))[0].onHand;
      const [pl, la] = [await on("PL-200"), await on("LA-300")];
      const look = (name: string, kind: "box" | "cylinder") => ({ kind, size: { x: 0.1, y: 0.1, z: 0.1 }, color: "#9aa3af", name });
      const bin = await repo.createBin({ name: "Kit", holds: ["part:PL-200"], accept: [], capacity: 20, position: { x: 1, z: -1 }, rotationY: 0, feed: { type: "none" } });
      const lines = [
        { owner: "part:PL-200" as const, qty: 2, look: look("Plate", "box") },
        { owner: "part:LA-300" as const, qty: 1, look: look("Actuator", "cylinder") },
        { owner: "kind:cylinder" as const, qty: 3, look: look("Can", "cylinder") },
      ];
      const refused = await repo.loadBin(bin.id, lines, false);
      assert.equal(refused.ok === false && refused.reason, "wrong_kind"); // LA-300 and cylinders aren't held
      const loaded = await repo.loadBin(bin.id, lines, true);
      assert.deepEqual(loaded, { ok: true, value: { count: 6, holds: ["part:PL-200", "part:LA-300", "kind:cylinder"] } });
      assert.deepEqual([await on("PL-200"), await on("LA-300")], [pl - 2, la - 1]);
      const stored = (await repo.listShapes()).filter((s) => s.binId === bin.id);
      assert.deepEqual(stored.map((s) => s.sku ?? s.kind).sort(), ["LA-300", "PL-200", "PL-200", "cylinder", "cylinder", "cylinder"]);

      // One short line stops the whole load: nothing taken, nothing added.
      const avail = (await repo.getParts(["LA-300"]))[0].available;
      const short = await repo.loadBin(bin.id, [{ ...lines[0], qty: 1 }, { ...lines[1], qty: avail + 1 }], false);
      assert.equal(short.ok === false && short.reason, "short");
      assert.deepEqual([await on("PL-200"), (await repo.listBins()).find((b) => b.id === bin.id)!.count], [pl - 2, 6]);
      const full = await repo.loadBin(bin.id, [{ ...lines[2], qty: 15 }], false);
      assert.equal(full.ok === false && full.reason, "full");
    });

    test("robots: stored with their rules, patched, deleted; clearing the scene keeps stock", async () => {
      const belt = await repo.createConveyor({ name: "Out", length: 1.5, width: 0.3, height: 0.3, speed: 0.2, position: { x: 1, z: 1 }, rotationY: 0 });
      const robot = await repo.createRobot({
        name: "Sorter", position: { x: 2, z: -1 }, rotationY: 90, pick: { x: 2, z: -1.5, radius: 0.15 },
        rules: [{ conditions: [{ field: "kind", op: "eq", value: "box" }], target: { type: "belt", conveyorId: belt.id, along: 0.2 } }],
        otherwise: null,
      });
      assert.equal(robot.otherwise, null);
      assert.deepEqual(robot.rules[0].target, { type: "belt", conveyorId: belt.id, along: 0.2 });
      const moved = await repo.updateRobot(robot.id, { pick: { x: 2.2, z: -1.4, radius: 0.2 }, otherwise: { type: "spot", x: 2.6, z: -1 } });
      assert.deepEqual([moved.pick, moved.otherwise, moved.name, moved.rules.length], [{ x: 2.2, z: -1.4, radius: 0.2 }, { type: "spot", x: 2.6, z: -1 }, "Sorter", 1]);
      assert.equal((await repo.updateRobot(robot.id, { otherwise: null })).otherwise, null);
      await assert.rejects(repo.updateRobot("00000000-0000-4000-8000-000000000000", { name: "X" }), NotFoundError);

      // A scene with a bin holding a part, a free shape, a splitter: all go, the stock stays.
      const bin = await repo.createBin({ name: "B", holds: ["part:PL-200"], accept: [], capacity: 10, position: { x: -1, z: 1 }, rotationY: 0, feed: { type: "none" } });
      const before = (await repo.getParts(["PL-200"]))[0].onHand;
      assert.ok((await repo.loadBin(bin.id, [{ owner: "part:PL-200", qty: 2, look: { name: "Plate", kind: "box", size: { x: 0.1, y: 0.02, z: 0.1 }, color: "#94a3b8" } }], false)).ok);
      await repo.createShape({ name: "Crate", kind: "box", size: { x: 0.1, y: 0.1, z: 0.1 }, color: "#d97706", position: { x: 0, z: 0.5 }, rotationY: 0, sku: null });
      await repo.createSplitter({ name: "Gate", conveyorId: belt.id, along: 0.5, rules: [], otherwise: "straight" });
      const cleared = await repo.clearScene();
      assert.deepEqual(cleared, { shapes: 3, conveyors: 1, bins: 1, robots: 1 });
      assert.deepEqual(
        [(await repo.listShapes()).length, (await repo.listConveyors()).length, (await repo.listSplitters()).length, (await repo.listBins()).length, (await repo.listRobots()).length],
        [0, 0, 0, 0, 0],
      );
      assert.equal((await repo.getParts(["PL-200"]))[0].onHand, before - 2); // loading took them; clearing doesn't give them back
      await repo.createRobot({ name: "Again", position: { x: 0, z: 0 }, rotationY: 0, pick: { x: 0.5, z: 0, radius: 0.1 }, rules: [], otherwise: null });
      await repo.deleteRobot((await repo.listRobots())[0].id);
      await assert.rejects(repo.deleteRobot("00000000-0000-4000-8000-000000000000"), NotFoundError);
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
