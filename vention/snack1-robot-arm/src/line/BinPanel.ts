/**
 * The Bins tab: bins that hold the kinds of object you choose. Set what a bin accepts (its kinds,
 * plus optional conditions like a splitter rule's), where it sits, and what it feeds: a spot on a
 * belt (steadily, or only when a machine needs one) or a machine directly. Load it from stock,
 * or unload it back. A load can be several kinds at once: a list of specific items, or every kind
 * that matches a rule you set (part category is plate, available > 5…), so many of each.
 *
 * The line controller owns the lists (it needs them for the stations) and passes them in.
 */
import * as THREE from "three";
import { binsApi, ShapesApiError } from "../shapes/api";
import { lookFor } from "../shapes/fromPart";
import { SHAPE_KINDS, type ShapeKind } from "../shapes/types";
import type { Conveyor } from "../conveyors/types";
import { matches, type Part } from "../splitters/rules";
import { FIELDS, OP_LABEL, OPS, type Condition, type Field } from "../splitters/types";
import type { Shape } from "../shapes/types";
import type { BinLayer } from "./BinLayer";
import type { Bin, Feed, ItemLook, Machine, NewBin, Owner } from "./types";

const KIND_COLOR: Record<ShapeKind, string> = { box: "#f59e0b", cylinder: "#22c55e", sphere: "#e11d48", cone: "#a855f7" };
const IN_CM = new Set<Field>(["width", "height", "depth"]);
const plural = (k: string) => (k === "box" ? "boxes" : `${k}s`);

interface Options {
  root: HTMLElement;
  layer: BinLayer;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  bins: () => readonly Bin[];
  belts: () => readonly Conveyor[];
  machines: () => readonly Machine[];
  parts: () => readonly Part[];
  running: () => boolean;
  reload: () => Promise<void>;
}

interface Draft {
  name: string;
  holds: Owner[];
  capacity: number;
  x: number; z: number; rotationY: number; // cm, degrees
  accept: Condition[];
  feedType: Feed["type"];
  beltId: string; along: number; mode: "steady" | "demand";
  machineId: string;
  qty: number;
  /** Which of its kinds to load. */
  loadOwner: Owner;
  /** Loading: a list of specific items, or every kind matching a rule. */
  loadMode: "items" | "rule";
  loadLines: { owner: Owner; qty: number }[];
  loadRule: Condition[];
  ruleQty: number;
  /** Add kinds the bin doesn't hold yet to its list. */
  addToHolds: boolean;
}

/** What one item of a kind looks like when it's loaded into a bin. */
export function lookOf(owner: Owner, parts: readonly Part[]): ItemLook | null {
  if (owner.startsWith("kind:")) {
    const kind = owner.slice(5) as ShapeKind;
    const d = kind === "sphere" ? 0.12 : 0.1;
    return { kind, size: { x: d, y: kind === "box" ? 0.1 : 0.12, z: d }, color: KIND_COLOR[kind], name: kind[0].toUpperCase() + kind.slice(1) };
  }
  const part = parts.find((p) => `part:${p.sku}` === owner);
  if (!part) return null;
  const look = lookFor(part);
  return { kind: look.kind, size: look.size, color: look.color, name: part.name.slice(0, 40) };
}

export function createBinPanel(o: Options) {
  let editing: string | null = null;
  let placing = false;
  let busy = false;
  let message: { text: string; error: boolean } | null = null;
  const blank = (): Draft => ({
    name: "", holds: ["kind:box"], capacity: 50, x: 120, z: 60, rotationY: 0, accept: [],
    feedType: "none", beltId: "", along: 10, mode: "steady", machineId: "", qty: 10, loadOwner: "kind:box",
    loadMode: "items", loadLines: [], loadRule: [{ field: "part.category", op: "eq", value: "plate" }], ruleQty: 2, addToHolds: true,
  });
  let draft = blank();

  async function act(work: () => Promise<unknown>, success: string) {
    busy = true;
    render();
    try {
      await work();
      message = { text: success, error: false };
      await o.reload();
    } catch (err) {
      const e = err as ShapesApiError;
      message = { text: e.problems?.length ? e.problems.join("; ") : e.message, error: true };
    } finally {
      busy = false;
      render(true);
    }
  }

  function feedOf(d: Draft): Feed {
    if (d.feedType === "belt") return { type: "belt", conveyorId: d.beltId, along: d.along / 100, mode: d.mode };
    if (d.feedType === "machine") return { type: "machine", machineId: d.machineId };
    return { type: "none" };
  }

  function body(at?: { x: number; z: number }): NewBin {
    return {
      name: draft.name.trim() || `Bin ${o.bins().length + 1}`, holds: draft.holds, accept: draft.accept, capacity: draft.capacity,
      position: at ?? { x: draft.x / 100, z: draft.z / 100 }, rotationY: draft.rotationY, feed: feedOf(draft),
    };
  }

  function save(at?: { x: number; z: number }) {
    const b = body(at);
    const id = editing;
    if (!b.holds.length) {
      message = { text: "Tick at least one kind of object for the bin to hold.", error: true };
      return render(true);
    }
    if (id) {
      void act(() => binsApi.update(id, b), `Saved ${b.name}.`);
    } else {
      void act(async () => {
        const made = await binsApi.create(b);
        editing = made.id;
        draft.loadLines = [{ owner: made.holds[0], qty: 5 }]; // ready to load, as Edit would be
      }, `Added ${b.name}.`);
    }
  }

  function edit(bin: Bin) {
    editing = bin.id;
    o.layer.select(bin.id);
    draft = {
      ...blank(), name: bin.name, holds: [...bin.holds], loadOwner: bin.holds[0], loadLines: [{ owner: bin.holds[0], qty: 5 }], capacity: bin.capacity, x: Math.round(bin.position.x * 100), z: Math.round(bin.position.z * 100),
      rotationY: bin.rotationY, accept: structuredClone(bin.accept), feedType: bin.feed.type,
      ...(bin.feed.type === "belt" ? { beltId: bin.feed.conveyorId, along: Math.round(bin.feed.along * 100), mode: bin.feed.mode } : {}),
      ...(bin.feed.type === "machine" ? { machineId: bin.feed.machineId } : {}),
    };
    render(true);
  }

  // ---- Placing with the mouse ----

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  function floorPoint(e: PointerEvent): { x: number; z: number } | null {
    const rect = o.canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, o.camera);
    if (!raycaster.ray.intersectPlane(floor, hit)) return null;
    const p = { x: Math.round(hit.x * 100) / 100, z: Math.round(hit.z * 100) / 100 };
    return Math.abs(p.x) <= 2.75 && Math.abs(p.z) <= 2.8 ? p : null;
  }

  function handleHover(e: PointerEvent): boolean {
    if (!placing) return false;
    const p = floorPoint(e);
    if (p) o.layer.showGhost(p.x, p.z, draft.rotationY);
    else o.layer.hideGhost();
    o.canvas.style.cursor = p ? "crosshair" : "not-allowed";
    return true;
  }

  function handleClick(e: PointerEvent): boolean {
    if (!placing) return false;
    const p = floorPoint(e);
    if (!p) return true;
    placing = false;
    o.layer.hideGhost();
    o.canvas.style.cursor = "";
    draft.x = Math.round(p.x * 100);
    draft.z = Math.round(p.z * 100);
    save(p);
    return true;
  }

  // ---- The panel ----

  o.root.innerHTML = `<div class="bins-body"></div>`;
  const host = o.root.querySelector<HTMLElement>(".bins-body")!;

  host.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.hold) {
      // The checklist of kinds.
      const ow = el.dataset.hold as Owner;
      const on = (el as HTMLInputElement).checked;
      draft.holds = on ? [...new Set([...draft.holds, ow])] : draft.holds.filter((h) => h !== ow);
      return renderSummary();
    }
    if (el.dataset.line !== undefined) {
      const line = draft.loadLines[Number(el.dataset.line)];
      if (!line) return;
      if (el.dataset.lk === "owner") line.owner = el.value as Owner;
      else line.qty = Math.max(1, Math.round(Number(el.value) || 1));
      return renderPreview();
    }
    const k = el.dataset.b as keyof Draft | undefined;
    if (k) {
      const v = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
      (draft as unknown as Record<string, unknown>)[k] = v;
      if (k === "feedType") render(true);
      if (k === "ruleQty") renderPreview();
      return;
    }
    const list = el.dataset.set === "rule" ? draft.loadRule : draft.accept;
    const i = Number(el.dataset.c);
    const c = list[i];
    if (!c) return;
    if (el.dataset.k === "field") {
      c.field = el.value as Field;
      const type = FIELDS[c.field].type;
      if (!OPS[type].includes(c.op)) c.op = OPS[type][0];
      c.value = type === "boolean" ? true : type === "number" ? (IN_CM.has(c.field) ? 0.1 : 0) : "";
      render(true);
    } else if (el.dataset.k === "op") {
      c.op = el.value as Condition["op"];
      if (c.op === "in" && !Array.isArray(c.value)) c.value = String(c.value) ? [String(c.value)] : [];
      if (c.op !== "in" && Array.isArray(c.value)) c.value = c.value.join(", ");
      render(true);
    } else if (el.dataset.k === "value") {
      const type = FIELDS[c.field].type;
      c.value = type === "boolean" ? el.value === "true" : type === "number" ? Number(el.value) / (IN_CM.has(c.field) ? 100 : 1)
        : c.op === "in" ? el.value.split(",").map((x) => x.trim()).filter(Boolean) : el.value;
      renderPreview();
    }
  });

  host.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-do]");
    if (!btn) return;
    const id = btn.dataset.id!;
    switch (btn.dataset.do) {
      case "place":
        placing = !placing;
        if (!placing) o.layer.hideGhost();
        return render(true);
      case "save":
        return save();
      case "new":
        editing = null;
        o.layer.select(null);
        draft = blank();
        return render(true);
      case "edit": {
        const b = o.bins().find((x) => x.id === id);
        if (b) edit(b);
        return;
      }
      case "delete":
        if (editing === id) editing = null;
        return void act(() => binsApi.remove(id), "Bin deleted.");
      case "add-cond": {
        const list = btn.dataset.set === "rule" ? draft.loadRule : draft.accept;
        if (list.length < 5) list.push(btn.dataset.set === "rule" ? { field: "part.available", op: "gt", value: 0 } : { field: "color", op: "eq", value: "#e11d48" });
        return render(true);
      }
      case "del-cond":
        (btn.dataset.set === "rule" ? draft.loadRule : draft.accept).splice(Number(btn.dataset.c), 1);
        return render(true);
      case "load-mode":
        draft.loadMode = btn.dataset.mode as Draft["loadMode"];
        return render(true);
      case "add-line":
        if (draft.loadLines.length < 20) draft.loadLines.push({ owner: draft.loadLines.at(-1)?.owner ?? "kind:box", qty: 5 });
        return render(true);
      case "del-line":
        draft.loadLines.splice(Number(btn.dataset.line), 1);
        return render(true);
      case "load": {
        const b = o.bins().find((x) => x.id === editing);
        const plan = loadPlan();
        if (!b) return;
        if (!plan.length) {
          message = { text: draft.loadMode === "rule" ? "Nothing matches that rule." : "Add an item to load.", error: true };
          return render(true);
        }
        const lines = plan.map((l) => ({ owner: l.owner, qty: l.qty, look: lookOf(l.owner, o.parts())! }));
        const total = lines.reduce((n, l) => n + l.qty, 0);
        const addToHolds = draft.addToHolds;
        return void act(async () => {
          // A load may add kinds to the bin; keep the form in step, or Save would take them off again.
          draft.holds = (await binsApi.load(b.id, lines, addToHolds)).holds;
        },
          `Loaded ${total} item${total === 1 ? "" : "s"} (${lines.length} kind${lines.length === 1 ? "" : "s"}) into ${b.name}; parts were taken from stock.`);
      }
      case "unload": {
        const b = o.bins().find((x) => x.id === editing);
        if (!b) return;
        const qty = draft.qty;
        return void act(async () => {
          const r = await binsApi.unload(b.id, qty);
          message = { text: `Unloaded ${r.unloaded}.`, error: false };
        }, `Unloaded from ${b.name}; parts went back into stock.`);
      }
    }
  });

  const ownerLabel = (ow: Owner) => {
    if (ow.startsWith("kind:")) return `Plain ${plural(ow.slice(5))}`;
    const p = o.parts().find((x) => `part:${x.sku}` === ow);
    return p ? `${p.sku} · ${p.name}` : ow.slice(5);
  };

  function options(list: [string, string][], value: string) {
    return list.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("");
  }

  function conditionRow(c: Condition, i: number, set: "accept" | "rule" = "accept"): string {
    const type = FIELDS[c.field].type;
    const fieldSel = `<select data-set="${set}" data-c="${i}" data-k="field" aria-label="Field">${options((Object.keys(FIELDS) as Field[]).map((f) => [f, FIELDS[f].label]), c.field)}</select>`;
    const opSel = `<select data-set="${set}" data-c="${i}" data-k="op" aria-label="Comparison">${options(OPS[type].map((op) => [op, OP_LABEL[op]]), c.op)}</select>`;
    const attrs = `data-set="${set}" data-c="${i}" data-k="value" aria-label="Value"`;
    const input = type === "boolean"
      ? `<select ${attrs}>${options([["true", "yes"], ["false", "no"]], String(c.value))}</select>`
      : type === "number"
      ? `<input type="number" step="any" value="${IN_CM.has(c.field) ? Math.round(Number(c.value) * 1000) / 10 : Number(c.value)}" ${attrs}>`
      : c.field === "color" && (c.op === "eq" || c.op === "ne")
      ? `<input type="color" value="${esc(String(c.value) || "#e11d48")}" ${attrs}>`
      : `<input type="text" value="${esc(Array.isArray(c.value) ? c.value.join(", ") : String(c.value))}" ${attrs}>`;
    return `<div class="cond"><span class="and">${i ? "and" : "if"}</span>${fieldSel}${opSel}${input}<button type="button" data-do="del-cond" data-set="${set}" data-c="${i}" aria-label="Remove condition">−</button></div>`;
  }

  /** `force` for changes the person just made; polling passes nothing and won't rebuild under the cursor. */
  function render(force = false) {
    if (!force && host.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") return renderList();
    const bins = o.bins();
    const belts = o.belts();
    const machines = o.machines();
    const owners: [string, string][] = [
      ...SHAPE_KINDS.map((k): [string, string] => [`kind:${k}`, `Plain ${plural(k)}`]),
      ...o.parts().map((p): [string, string] => [`part:${p.sku}`, `${p.sku} · ${p.name}`]),
    ];
    const editingBin = bins.find((b) => b.id === editing);
    const locked = busy || o.running();
    host.innerHTML = `
      <section>
        <h2>${editingBin ? `Editing ${esc(editingBin.name)}` : "Add a bin"}</h2>
        <span class="slot-label">Holds</span>
        <div class="holds">${owners.map(([v, l]) => `<label class="check"><input type="checkbox" data-hold="${esc(v)}" ${draft.holds.includes(v as Owner) ? "checked" : ""}> ${esc(l)}</label>`).join("")}</div>
        <div class="row">
          <label>Capacity <input type="number" data-b="capacity" min="1" max="200" step="1" value="${draft.capacity}"></label>
          <label>Name <input type="text" data-b="name" maxlength="40" placeholder="Automatic" value="${esc(draft.name)}"></label>
        </div>
        <div class="dims">
          <label>X cm <input type="number" data-b="x" min="-275" max="275" step="5" value="${draft.x}"></label>
          <label>Z cm <input type="number" data-b="z" min="-280" max="280" step="5" value="${draft.z}"></label>
          <label>Turn ° <input type="number" data-b="rotationY" min="-360" max="360" step="15" value="${draft.rotationY}"></label>
        </div>
        <p class="rules-help summary"></p>
        ${draft.accept.map((c, i) => conditionRow(c, i)).join("")}
        <button type="button" data-do="add-cond" class="wide-btn" ${draft.accept.length >= 5 ? "disabled" : ""}>+ Condition</button>
        <div class="row">
          <label>Feeds <select data-b="feedType">${options([["none", "Nothing"], ["belt", "A belt"], ["machine", "A machine"]], draft.feedType)}</select></label>
          ${draft.feedType === "machine" ? `<label>Machine <select data-b="machineId">${options([["", "—"], ...machines.map((m): [string, string] => [m.id, m.name])], draft.machineId)}</select></label>` : ""}
          ${draft.feedType === "belt" ? `<label>Belt <select data-b="beltId">${options([["", "—"], ...belts.map((b): [string, string] => [b.id, b.name])], draft.beltId)}</select></label>` : ""}
        </div>
        ${draft.feedType === "belt" ? `<div class="row">
          <label>At cm along <input type="number" data-b="along" min="0" max="400" step="5" value="${draft.along}"></label>
          <label>When <select data-b="mode">${options([["steady", "Whenever there's room"], ["demand", "Only when a machine needs one"]], draft.mode)}</select></label>
        </div>` : ""}
        <div class="actions">
          ${editingBin ? `<button type="button" data-do="save" class="primary" ${locked ? "disabled" : ""}>Save bin</button>
                          <button type="button" data-do="new">New bin</button>`
                       : `<button type="button" data-do="place" class="primary" aria-pressed="${placing}" ${locked ? "disabled" : ""}>${placing ? "Cancel placing" : "Place with mouse"}</button>
                          <button type="button" data-do="save" ${locked ? "disabled" : ""}>Add at X, Z</button>`}
        </div>
        ${placing ? `<p class="hint">Click the floor to put the bin there. Esc cancels.</p>` : ""}
        ${editingBin ? `
        <h2>Load ${esc(editingBin.name)}</h2>
        <div class="sources" role="group" aria-label="How to choose what to load">
          <button type="button" data-do="load-mode" data-mode="items" aria-pressed="${draft.loadMode === "items"}">Specific items</button>
          <button type="button" data-do="load-mode" data-mode="rule" aria-pressed="${draft.loadMode === "rule"}">By rule</button>
        </div>
        ${draft.loadMode === "items" ? `
          ${draft.loadLines.map((l, i) => `<div class="load-line">
            <select data-line="${i}" data-lk="owner" aria-label="Kind">${options(owners, l.owner)}</select>
            <input type="number" data-line="${i}" data-lk="qty" min="1" max="200" step="1" value="${l.qty}" aria-label="How many">
            <button type="button" data-do="del-line" data-line="${i}" aria-label="Remove line">−</button></div>`).join("")}
          <button type="button" data-do="add-line" class="wide-btn" ${draft.loadLines.length >= 20 ? "disabled" : ""}>+ Item</button>`
        : `
          <p class="rules-help">Every kind of object that matches, from the inventory and the plain shapes:</p>
          ${draft.loadRule.map((c, i) => conditionRow(c, i, "rule")).join("")}
          <button type="button" data-do="add-cond" data-set="rule" class="wide-btn" ${draft.loadRule.length >= 5 ? "disabled" : ""}>+ Condition</button>
          <label class="inline">How many of each <input type="number" data-b="ruleQty" min="1" max="200" step="1" value="${draft.ruleQty}"></label>`}
        <ul class="load-preview"></ul>
        <label class="check"><input type="checkbox" data-b="addToHolds" ${draft.addToHolds ? "checked" : ""}> Also hold kinds it doesn't hold yet</label>
        <div class="actions">
          <button type="button" data-do="load" class="primary" ${locked ? "disabled" : ""}>Load</button>
          <span></span>
        </div>
        <div class="load">
          <label>Unload <input type="number" data-b="qty" min="1" max="200" step="1" value="${draft.qty}"></label>
          <button type="button" data-do="unload" ${locked ? "disabled" : ""}>Unload</button>
        </div>
        <p class="rules-help">Loading parts takes them from stock, all or nothing; unloading puts them back.</p>` : ""}
      </section>
      <section>
        <h2>Bins <span class="count">${bins.length ? `(${bins.length})` : ""}</span></h2>
        <ul class="shape-list bin-list"></ul>
      </section>
      <p class="shapes-status ${message?.error ? "error" : ""}" role="status" ${message ? "" : "hidden"}>${message ? esc(message.text) : ""}</p>`;
    renderSummary();
    renderPreview();
    renderList();
  }

  /** Every kind of object there is, as a stand-in shape a rule can be checked against. */
  function candidates(): { owner: Owner; shape: Shape; part?: Part }[] {
    const kinds: Owner[] = [...SHAPE_KINDS.map((k) => `kind:${k}` as Owner), ...o.parts().map((p) => `part:${p.sku}` as Owner)];
    return kinds.flatMap((owner) => {
      const look = lookOf(owner, o.parts());
      if (!look) return [];
      const sku = owner.startsWith("part:") ? owner.slice(5) : null;
      const shape: Shape = { id: owner, name: look.name, kind: look.kind, size: look.size, color: look.color, position: { x: 0, z: 0 }, rotationY: 0, sku, createdAt: "", updatedAt: "" };
      return [{ owner, shape, part: sku ? o.parts().find((p) => p.sku === sku) : undefined }];
    });
  }

  /** What Load would load: the listed items, or every kind matching the rule (none for an empty rule). */
  function loadPlan(): { owner: Owner; qty: number }[] {
    if (draft.loadMode === "items") {
      const merged = new Map<Owner, number>();
      for (const l of draft.loadLines) merged.set(l.owner, (merged.get(l.owner) ?? 0) + l.qty);
      return [...merged].map(([owner, qty]) => ({ owner, qty }));
    }
    if (!draft.loadRule.length) return [];
    return candidates().filter((c) => draft.loadRule.every((cond) => matches(cond, c.shape, c.part))).map((c) => ({ owner: c.owner, qty: draft.ruleQty }));
  }

  /** The plan, kind by kind, with what's available and what the bin doesn't hold yet. */
  function renderPreview() {
    const el = host.querySelector<HTMLElement>(".load-preview");
    const bin = o.bins().find((b) => b.id === editing);
    if (!el || !bin) return;
    const plan = loadPlan();
    const total = plan.reduce((n, l) => n + l.qty, 0);
    const room = bin.capacity - bin.count;
    el.innerHTML = !plan.length ? `<li class="empty">${draft.loadMode === "rule" ? "Nothing matches yet." : "No items listed."}</li>`
      : plan.map((l) => {
          const part = l.owner.startsWith("part:") ? o.parts().find((p) => `part:${p.sku}` === l.owner) : undefined;
          const short = part && part.available < l.qty;
          const notHeld = !bin.holds.includes(l.owner);
          return `<li><span>${l.qty} × ${esc(ownerLabel(l.owner))}</span>
            <small class="${short ? "over" : ""}">${part ? `${part.available} available` : "no stock needed"}${notHeld ? " · not held yet" : ""}</small></li>`;
        }).join("") + `<li class="total ${total > room ? "over" : ""}">${total} item${total === 1 ? "" : "s"} · room for ${room}</li>`;
  }

  /** The sentence saying what the bin catches, kept current as kinds are ticked. */
  function renderSummary() {
    const el = host.querySelector<HTMLElement>(".summary");
    if (!el) return;
    const kinds = draft.holds.map(ownerLabel);
    el.textContent = !kinds.length ? "Tick at least one kind."
      : `Catches ${kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} or ${kinds[kinds.length - 1]}` : kinds[0]}${draft.accept.length ? " that also meet:" : ". Add conditions to be pickier:"}`;
  }

  function renderList() {
    const bins = o.bins();
    const list = host.querySelector<HTMLElement>(".bin-list");
    if (!list) return;
    const feedText = (b: Bin) => {
      if (b.feed.type === "belt") {
        const id = b.feed.conveyorId;
        return `feeds ${esc(o.belts().find((c) => c.id === id)?.name ?? "a missing belt")} at ${Math.round(b.feed.along * 100)} cm${b.feed.mode === "demand" ? ", on demand" : ""}`;
      }
      if (b.feed.type === "machine") {
        const id = b.feed.machineId;
        return `feeds ${esc(o.machines().find((m) => m.id === id)?.name ?? "a missing machine")}`;
      }
      return "feeds nothing";
    };
    list.innerHTML = bins.length === 0
      ? `<li class="empty">No bins yet.</li>`
      : bins.map((b) => `<li class="${b.id === editing ? "selected" : ""}">
          <div class="pick static"><span class="swatch bin-swatch"></span><span class="label"><strong>${esc(b.name)}</strong>
            <small>${esc(b.holds.map(ownerLabel).join(", "))}${b.accept.length ? ` · ${b.accept.length} condition${b.accept.length > 1 ? "s" : ""}` : ""}</small>
            <small><span data-bin-count="${b.id}">${b.count}</span> / ${b.capacity} · ${feedText(b)}</small></span></div>
          <span class="row-actions">
            <button type="button" data-do="edit" data-id="${b.id}">Edit</button>
            <button type="button" data-do="delete" data-id="${b.id}" title="Delete (empty bins only)" ${o.running() ? "disabled" : ""}>✕</button>
          </span>
        </li>`).join("");
  }

  /** Counts during a run, straight into the list. */
  function showCounts(counts: ReadonlyMap<string, number>) {
    for (const el of host.querySelectorAll<HTMLElement>("[data-bin-count]")) {
      const n = counts.get(el.dataset.binCount!);
      if (n !== undefined) el.textContent = String(n);
    }
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && placing) {
      placing = false;
      o.layer.hideGhost();
      render();
      return true;
    }
    return false;
  }

  render();
  return { render, showCounts, handleClick, handleHover, handleKey, isActive: () => placing };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
