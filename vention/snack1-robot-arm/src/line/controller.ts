/**
 * The Machines tab: mergers where belts come together, joining machines, and the assemblies
 * they've made. Owns the stored connection points too (the point editor in the Shapes tab
 * edits them), since machines join at those points.
 *
 * While the belts run, the conveyor controller drives the stations created here: mergers hold
 * and release items, machines hold and join them. On Stop, each join is saved as an assembly,
 * which uses up the parts from stock (all or nothing, in the API).
 */
import * as THREE from "three";
import { binsApi, conveyorsApi, lineApi, splittersApi, ShapesApiError } from "../shapes/api";
import { BinLayer } from "./BinLayer";
import { createBinPanel, lookOf } from "./BinPanel";
import type { createShapes } from "../shapes/controller";
import type { createConveyors } from "../conveyors/controller";
import { fromBelt, toBelt } from "../conveyors/transport";
import type { Conveyor } from "../conveyors/types";
import type { Part } from "../splitters/rules";
import { SHAPE_KINDS } from "../shapes/types";
import { pointsFor } from "./joints";
import { LineLayer } from "./LineLayer";
import { createPointEditor } from "./PointEditor";
import { createStations, type Join, type MachineStatus } from "./stations";
import type { Assembly, Bin, Connectors, Machine, Merger, MergerKind, Owner, Priority } from "./types";

const POLL_MS = 4000;
const DEG = Math.PI / 180;
const Y_ANGLE = 35; // degrees between a y merger's feeders and its output
const PRIORITY_LABEL: Record<Priority, string> = { main: "Main belt first", feeders: "Feeders first", alternate: "Take turns" };

interface Options {
  root: HTMLElement;
  /** The Bins tab's panel. */
  binsRoot: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  shapes: ReturnType<typeof createShapes>;
  conveyors: ReturnType<typeof createConveyors>;
}

export function createLine({ root, binsRoot, scene, camera, canvas, shapes, conveyors }: Options) {
  const layer = new LineLayer();
  scene.add(layer.root);
  const binLayer = new BinLayer();
  scene.add(binLayer.root);
  let bins: Bin[] = [];

  let mergers: Merger[] = [];
  let machines: Machine[] = [];
  let connectors: Connectors[] = [];
  let assemblies: Assembly[] = [];
  let parts: Part[] = [];
  let online = false;
  let busy = false;
  let message: { text: string; error: boolean } | null = null;
  let editing: string | null = null; // the machine whose settings are in the form
  const mDraft = { kind: "side" as MergerKind, main: "", f1: "", f2: "", along: 100, priority: "main" as Priority, gap: 30, name: "", snap: true };
  const kDraft = { belt: "", along: 100, name: "", baseOwner: "kind:box" as Owner, basePoint: "top", attachOwner: "kind:cylinder" as Owner, attachPoint: "bottom", cycle: 1.5 };

  const belts = () => conveyors.belts;
  const stations = createStations(() => ({ belts: belts(), mergers, machines, shapes: shapes.shapes, connectors, bins, parts }));
  const points = createPointEditor({ shapes, camera, canvas, connectors: () => connectors, reload: load });

  const binPanel = createBinPanel({
    root: binsRoot, layer: binLayer, camera, canvas,
    bins: () => bins, belts, machines: () => machines, parts: () => parts,
    running: () => conveyors.running, reload: load,
  });

  let statusTimer = 0;
  conveyors.setLine({
    stations,
    saveJoins,
    saveReleases,
    saveCatches,
    frame(dt) {
      const snap = stations.snapshot();
      layer.show(snap.mergers, snap.machines);
      const counts = stations.binCounts();
      binLayer.fill(counts, bins);
      binPanel.showCounts(counts);
      statusTimer += dt;
      if (statusTimer > 0.25) {
        statusTimer = 0;
        renderStatus(snap.machines);
      }
    },
  });
  conveyors.onBeltsChange(() => {
    syncLayer();
    render();
  });

  function syncLayer() {
    layer.sync(mergers, machines, belts(), (m) => stations.mergePoint(m));
    layer.show(new Map(), new Map());
    binLayer.sync(bins, belts(), machines, (b) => lookOf(b.holds[0], parts)?.color ?? "#64748b");
  }

  // ---- API ----

  async function load() {
    try {
      const [ms, ks, cs, as, ps, bs] = await Promise.all([
        lineApi.mergers(), lineApi.machines(), lineApi.connectors(), lineApi.assemblies(), splittersApi.parts(), binsApi.list(),
      ]);
      online = true;
      [mergers, machines, connectors, assemblies, parts, bins] = [ms, ks, cs.connectors, as, ps, bs];
      syncLayer();
      points.refresh();
      binPanel.render();
      if (message?.error && message.text.startsWith("Can't reach")) message = null;
    } catch (err) {
      online = false;
      message = { text: (err as Error).message, error: true };
    }
    render();
  }

  async function act(work: () => Promise<unknown>, success?: string) {
    busy = true;
    render();
    try {
      await work();
      message = success ? { text: success, error: false } : null;
      await load();
    } catch (err) {
      const e = err as ShapesApiError;
      message = { text: e.problems?.length ? e.problems.join("; ") : e.message, error: true };
    } finally {
      busy = false;
      render();
    }
  }

  // Not while running: the stations are reading these lists every step.
  setInterval(() => {
    if (!busy && !conveyors.running) void load();
  }, POLL_MS);

  /** After a run: save each join as an assembly. The API uses up the parts, or refuses the lot. */
  async function saveJoins(joins: readonly Join[]) {
    const lines: string[] = [];
    let made = 0;
    for (const j of joins) {
      const base = shapes.shapes.find((s) => s.id === j.baseId);
      const attached = shapes.shapes.find((s) => s.id === j.attachedId);
      const name = `${base?.name ?? "?"} + ${attached?.name ?? "?"}`.slice(0, 40);
      try {
        const a = await lineApi.assemble({
          name, baseShapeId: j.baseId, attachedShapeId: j.attachedId, basePoint: j.basePoint, attachedPoint: j.attachedPoint, attachment: j.attach,
        });
        made++;
        if (a.consumed.length) lines.push(`${name}: used ${a.consumed.map((c) => `${c.qty} × ${c.sku}`).join(", ")}`);
      } catch (err) {
        const e = err as ShapesApiError & { message: string };
        lines.push(`${name}: not joined. ${e.message}`);
      }
    }
    message = { text: `Saved ${made} assembl${made === 1 ? "y" : "ies"}.${lines.length ? " " + lines.join(". ") + "." : ""}`, error: made < joins.length };
    await load();
  }

  /** After a run: items that came out of bins go back on the floor where they ended up. */
  async function saveReleases(items: readonly { binId: string; shapeId: string; x: number; z: number }[]) {
    for (const it of items) {
      try {
        await binsApi.release(it.binId, it.shapeId, { x: it.x, z: it.z });
      } catch (err) {
        message = { text: `Couldn't take an item out of its bin: ${(err as Error).message}`, error: true };
      }
    }
  }

  /** After a run: items that ended up in bins. The API takes parts from stock as they go in, and may refuse. */
  async function saveCatches(items: readonly { binId: string; shapeId: string }[]) {
    const refused: string[] = [];
    for (const it of items) {
      try {
        await binsApi.catch(it.binId, it.shapeId);
      } catch (err) {
        const name = shapes.shapes.find((s) => s.id === it.shapeId)?.name ?? "An item";
        refused.push(`${name} wasn't stored: ${(err as Error).message}`);
      }
    }
    const caught = items.length - refused.length;
    message = { text: `${caught} item${caught === 1 ? "" : "s"} stored in bins.${refused.length ? " " + refused.join(". ") + "." : ""}`, error: refused.length > 0 };
    await load();
  }

  // ---- Putting feeders in place ----

  /** Turns and moves a belt so it runs along `travel` (a world direction) and ends at `end`. */
  function aim(f: Conveyor, end: { x: number; z: number }, travel: { x: number; z: number }) {
    const d = f.speed >= 0 ? 1 : -1; // a reversed belt runs toward its -u end
    const rotationY = Math.round((Math.atan2(-(d * travel.z), d * travel.x) / DEG) * 10) / 10;
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return conveyorsApi.update(f.id, {
      rotationY,
      position: { x: round(end.x - (travel.x * f.length) / 2), z: round(end.z - (travel.z * f.length) / 2) },
    });
  }

  async function snapFeeders(kind: MergerKind, main: Conveyor, along: number, feeders: Conveyor[]) {
    const t = main.rotationY * DEG;
    const udir = { x: Math.cos(t), z: -Math.sin(t) }; // the main belt's +u, in the world
    const vdir = { x: Math.sin(t), z: Math.cos(t) }; // and its +v
    const d = main.speed >= 0 ? 1 : -1;
    if (kind === "side") {
      // Square onto the side it's already on, ending at the main belt's edge.
      const f = feeders[0];
      const side = toBelt(main, f.position.x, f.position.z).v >= 0 ? 1 : -1;
      const end = fromBelt(main, along - main.length / 2, side * (main.width / 2));
      await aim(f, end, { x: -side * vdir.x, z: -side * vdir.z });
      return;
    }
    // A y: the two feeders come in from behind the output's start, at ±Y_ANGLE.
    const start = -d * (main.length / 2);
    for (const [i, f] of feeders.entries()) {
      const side = i === 0 ? -1 : 1;
      const end = fromBelt(main, start - d * 0.02, side * main.width * 0.3);
      const a = Y_ANGLE * DEG;
      const travel = { x: d * udir.x * Math.cos(a) - side * vdir.x * Math.sin(a), z: d * udir.z * Math.cos(a) - side * vdir.z * Math.sin(a) };
      await aim(f, end, travel);
    }
  }

  function addMerger() {
    const main = belts().find((b) => b.id === mDraft.main);
    const feederIds = (mDraft.kind === "y" ? [mDraft.f1, mDraft.f2] : [mDraft.f1]).filter(Boolean);
    const feeders = feederIds.map((id) => belts().find((b) => b.id === id)).filter((b): b is Conveyor => !!b);
    if (!main || feeders.length !== feederIds.length || feederIds.length !== (mDraft.kind === "y" ? 2 : 1)) {
      message = { text: mDraft.kind === "y" ? "Pick an output belt and two feeder belts." : "Pick a main belt and a feeder belt.", error: true };
      return render();
    }
    const name = mDraft.name.trim() || `${mDraft.kind === "y" ? "Y merger" : "Merger"} ${mergers.length + 1}`;
    const along = mDraft.kind === "y" ? 0 : mDraft.along / 100;
    void act(async () => {
      const m = await lineApi.createMerger({ name, kind: mDraft.kind, conveyorId: main.id, along, feederIds, priority: mDraft.priority, gap: mDraft.gap / 100 });
      if (mDraft.snap) {
        await snapFeeders(m.kind, main, m.along, feeders);
        await conveyors.reload();
      }
    }, `Added ${name}.${mDraft.snap ? " Feeders moved into place." : ""}`);
    mDraft.name = "";
  }

  function saveMachine() {
    const belt = belts().find((b) => b.id === kDraft.belt);
    if (!belt) {
      message = { text: "Pick the belt the machine sits on.", error: true };
      return render();
    }
    const body = {
      name: kDraft.name.trim() || `Machine ${machines.length + 1}`,
      along: kDraft.along / 100,
      base: { owner: kDraft.baseOwner, point: kDraft.basePoint },
      attach: { owner: kDraft.attachOwner, point: kDraft.attachPoint },
      cycleSeconds: kDraft.cycle,
    };
    const id = editing;
    void act(async () => {
      if (id) await lineApi.updateMachine(id, body);
      else await lineApi.createMachine({ ...body, conveyorId: belt.id });
      editing = null;
    }, id ? `Saved ${body.name}.` : `Added ${body.name}.`);
  }

  function edit(mc: Machine) {
    editing = mc.id;
    Object.assign(kDraft, {
      belt: mc.conveyorId, along: Math.round(mc.along * 100), name: mc.name, baseOwner: mc.base.owner, basePoint: mc.base.point,
      attachOwner: mc.attach.owner, attachPoint: mc.attach.point, cycle: mc.cycleSeconds,
    });
    render();
  }

  // ---- The panel ----

  root.innerHTML = `
    <section>
      <h2>Mergers</h2>
      <div class="row">
        <label>Kind <select data-m="kind"><option value="side">Side: feeder joins a belt</option><option value="y">Y: two belts into one</option></select></label>
        <label>Priority <select data-m="priority">${(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => `<option value="${p}">${PRIORITY_LABEL[p]}</option>`).join("")}</select></label>
      </div>
      <div class="row">
        <label class="m-main">Main belt <select data-m="main"></select></label>
        <label>Feeder <select data-m="f1"></select></label>
      </div>
      <div class="row">
        <label class="m-f2">Second feeder <select data-m="f2"></select></label>
        <label class="m-along">Along cm <input type="number" data-m="along" min="0" max="400" step="5"></label>
        <label>Gap cm <input type="number" data-m="gap" min="5" max="100" step="5"></label>
      </div>
      <label class="wide">Name <input type="text" data-m="name" maxlength="40" placeholder="Automatic"></label>
      <label class="check"><input type="checkbox" data-m="snap"> Move the feeder belts into place</label>
      <div class="actions"><button type="button" data-do="add-merger" class="primary">Add merger</button></div>
      <ul class="shape-list merger-list"></ul>
    </section>
    <section>
      <h2 class="k-title">Joining machines</h2>
      <div class="row">
        <label>Belt <select data-k="belt"></select></label>
        <label>Along cm <input type="number" data-k="along" min="0" max="400" step="5"></label>
      </div>
      <div class="slot">
        <span class="slot-label">Base (stays on the belt)</span>
        <div class="row"><label>Object <select data-k="baseOwner"></select></label><label>At point <select data-k="basePoint"></select></label></div>
      </div>
      <div class="slot">
        <span class="slot-label">Joined onto it</span>
        <div class="row"><label>Object <select data-k="attachOwner"></select></label><label>At point <select data-k="attachPoint"></select></label></div>
      </div>
      <div class="row">
        <label>Name <input type="text" data-k="name" maxlength="40" placeholder="Automatic"></label>
        <label>Cycle s <input type="number" data-k="cycle" min="0.2" max="10" step="0.1"></label>
      </div>
      <div class="actions">
        <button type="button" data-do="save-machine" class="primary">Add machine</button>
        <button type="button" data-do="cancel-edit">Cancel</button>
      </div>
      <ul class="shape-list machine-list"></ul>
    </section>
    <section>
      <h2>Recent assemblies</h2>
      <ul class="assembly-list"></ul>
    </section>
    <p class="shapes-status" role="status" hidden></p>
  `;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const m = el.dataset.m as keyof typeof mDraft | undefined;
    const k = el.dataset.k as keyof typeof kDraft | undefined;
    if (m) {
      const v = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
      (mDraft as Record<string, unknown>)[m] = v;
      if (m === "kind") mDraft.priority = mDraft.kind === "y" ? "alternate" : "main";
      if (m === "kind" || m === "main") render();
    } else if (k) {
      (kDraft as Record<string, unknown>)[k] = el.type === "number" ? Number(el.value) : el.value;
      // A new object means a new list of points: start from its first one.
      if (k === "baseOwner") kDraft.basePoint = pointsFor(kDraft.baseOwner, connectors)[0]?.name ?? "";
      if (k === "attachOwner") kDraft.attachPoint = pointsFor(kDraft.attachOwner, connectors)[0]?.name ?? "";
      if (k === "baseOwner" || k === "attachOwner") render();
    } else if (el.dataset.priority) {
      const id = el.dataset.priority;
      void act(() => lineApi.updateMerger(id, { priority: el.value as Priority }), "Priority changed.");
    }
  });

  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-do]");
    if (!btn) return;
    const id = btn.dataset.id!;
    switch (btn.dataset.do) {
      case "add-merger":
        return addMerger();
      case "save-machine":
        return saveMachine();
      case "cancel-edit":
        editing = null;
        return render();
      case "del-merger":
        return void act(() => lineApi.removeMerger(id), "Merger deleted.");
      case "del-machine":
        if (editing === id) editing = null;
        return void act(() => lineApi.removeMachine(id), "Machine deleted.");
      case "edit-machine": {
        const mc = machines.find((x) => x.id === id);
        if (mc) edit(mc);
      }
    }
  });

  const ownerLabel = (o: Owner) => {
    if (o.startsWith("kind:")) return `Any plain ${o.slice(5)}`;
    const p = parts.find((x) => `part:${x.sku}` === o);
    return p ? `${p.sku} · ${p.name}` : o.slice(5);
  };

  function owners(): Owner[] {
    return [...SHAPE_KINDS.map((k) => `kind:${k}` as Owner), ...parts.map((p) => `part:${p.sku}` as Owner)];
  }

  function fillSelect(sel: string, options: [string, string][], value: string) {
    const el = $<HTMLSelectElement>(sel);
    if (document.activeElement === el) return;
    el.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(label)}</option>`).join("");
  }

  function render() {
    const bs = belts();
    const beltOptions: [string, string][] = [["", "—"], ...bs.map((b): [string, string] => [b.id, b.name])];
    // Merger form
    fillSelect('[data-m="kind"]', [["side", "Side: feeder joins a belt"], ["y", "Y: two belts into one"]], mDraft.kind);
    fillSelect('[data-m="priority"]', (Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => [p, PRIORITY_LABEL[p]]), mDraft.priority);
    fillSelect('[data-m="main"]', beltOptions, mDraft.main);
    fillSelect('[data-m="f1"]', beltOptions, mDraft.f1);
    fillSelect('[data-m="f2"]', beltOptions, mDraft.f2);
    $(".m-main").firstChild!.textContent = mDraft.kind === "y" ? "Output belt " : "Main belt ";
    $(".m-f2").hidden = mDraft.kind !== "y";
    $(".m-along").hidden = mDraft.kind === "y";
    for (const k of ["along", "gap", "name"] as const) {
      const el = $<HTMLInputElement>(`[data-m="${k}"]`);
      if (document.activeElement !== el) el.value = String(mDraft[k]);
    }
    $<HTMLInputElement>('[data-m="snap"]').checked = mDraft.snap;

    const beltName = (id: string) => esc(bs.find((b) => b.id === id)?.name ?? "missing belt");
    $("ul.merger-list").innerHTML = mergers.length === 0
      ? `<li class="empty">No mergers yet.</li>`
      : mergers.map((m) => `<li>
          <div class="pick static"><span class="swatch merge-swatch"></span><span class="label"><strong>${esc(m.name)}</strong>
            <small>${m.kind === "y" ? `${m.feederIds.map(beltName).join(" + ")} → ${beltName(m.conveyorId)}` : `${beltName(m.feederIds[0])} → ${beltName(m.conveyorId)} at ${cm(m.along)} cm`} · gap ${cm(m.gap)} cm</small>
            <select data-priority="${m.id}" aria-label="Priority">${(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => `<option value="${p}" ${p === m.priority ? "selected" : ""}>${PRIORITY_LABEL[p]}</option>`).join("")}</select></span></div>
          <span class="row-actions"><button type="button" data-do="del-merger" data-id="${m.id}" title="Delete">✕</button></span>
        </li>`).join("");

    // Machine form
    fillSelect('[data-k="belt"]', beltOptions, kDraft.belt);
    $<HTMLSelectElement>('[data-k="belt"]').disabled = !!editing; // a machine stays on its belt
    const ownerOptions = owners().map((o): [string, string] => [o, ownerLabel(o)]);
    fillSelect('[data-k="baseOwner"]', ownerOptions, kDraft.baseOwner);
    fillSelect('[data-k="attachOwner"]', ownerOptions, kDraft.attachOwner);
    fillSelect('[data-k="basePoint"]', pointsFor(kDraft.baseOwner, connectors).map((p): [string, string] => [p.name, p.name]), kDraft.basePoint);
    fillSelect('[data-k="attachPoint"]', pointsFor(kDraft.attachOwner, connectors).map((p): [string, string] => [p.name, p.name]), kDraft.attachPoint);
    for (const k of ["along", "name", "cycle"] as const) {
      const el = $<HTMLInputElement>(`[data-k="${k}"]`);
      if (document.activeElement !== el) el.value = String(kDraft[k]);
    }
    $(".k-title").textContent = editing ? `Joining machines · editing ${machines.find((m) => m.id === editing)?.name ?? ""}` : "Joining machines";
    $('[data-do="save-machine"]').textContent = editing ? "Save machine" : "Add machine";
    $('[data-do="cancel-edit"]').hidden = !editing;

    $("ul.machine-list").innerHTML = machines.length === 0
      ? `<li class="empty">No machines yet.</li>`
      : machines.map((mc) => `<li>
          <div class="pick static"><span class="swatch machine-swatch"></span><span class="label"><strong>${esc(mc.name)}</strong>
            <small>${beltName(mc.conveyorId)} at ${cm(mc.along)} cm · ${mc.cycleSeconds} s</small>
            <small>${esc(ownerLabel(mc.base.owner))} (${esc(mc.base.point)}) ← ${esc(ownerLabel(mc.attach.owner))} (${esc(mc.attach.point)})</small>
            <small class="machine-status" data-status="${mc.id}"></small></span></div>
          <span class="row-actions">
            <button type="button" data-do="edit-machine" data-id="${mc.id}">Edit</button>
            <button type="button" data-do="del-machine" data-id="${mc.id}" title="Delete">✕</button>
          </span>
        </li>`).join("");

    $("ul.assembly-list").innerHTML = assemblies.length === 0
      ? `<li class="empty">None yet. Run the belts through a machine.</li>`
      : assemblies.slice(0, 8).map((a) => `<li><strong>${esc(a.name)}</strong>
          <small>${a.consumed.length ? a.consumed.map((c) => `${c.qty} × ${esc(c.sku)}`).join(", ") + " used" : "no stock used"} · ${new Date(a.createdAt).toLocaleTimeString()}</small></li>`).join("");

    for (const b of root.querySelectorAll<HTMLButtonElement>("button")) if (b.dataset.do) b.disabled = !online || busy || conveyors.running;
    const status = $("p.shapes-status");
    status.hidden = !message;
    status.textContent = message?.text ?? "";
    status.classList.toggle("error", !!message?.error);
  }

  function renderStatus(machineStatus: ReadonlyMap<string, MachineStatus>) {
    for (const el of root.querySelectorAll<HTMLElement>("[data-status]")) {
      const s = machineStatus.get(el.dataset.status!);
      el.textContent = !s || s.state === "idle" ? "" : s.state === "waiting" ? `holding the ${s.has}, waiting for the other`
        : s.state === "joining" ? `joining… ${Math.round(s.progress * 100)}%` : s.message;
      el.className = `machine-status ${s?.state ?? ""}`;
    }
  }

  render();
  void load();

  return {
    layer, points,
    handleClick: (e: PointerEvent) => points.handleClick(e) || binPanel.handleClick(e),
    handleHover: (e: PointerEvent) => points.handleHover() || binPanel.handleHover(e),
    handleKey: (e: KeyboardEvent) => binPanel.handleKey(e),
    isActive: () => points.isActive() || binPanel.isActive(),
    /** Rebuild the 3D models after a run (Stop) so lights go back to idle. */
    idle: () => layer.show(new Map(), new Map()),
  };
}

const cm = (m: number) => Math.round(m * 100);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
