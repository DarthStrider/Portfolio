/**
 * The Splitters tab: put diverter gates on belts and write the rules that decide where each
 * item goes. Rules are saved through the inventory API, so they can also be changed from the
 * API or the database directly; the tab re-reads them, and the inventory, every few seconds,
 * including while the line runs. A change takes effect for the next item that reaches the gate.
 */
import * as THREE from "three";
import { splittersApi, ShapesApiError } from "../shapes/api";
import type { createShapes } from "../shapes/controller";
import type { createConveyors } from "../conveyors/controller";
import { toBelt } from "../conveyors/transport";
import type { Conveyor } from "../conveyors/types";
import { SHAPE_KINDS, type Shape } from "../shapes/types";
import { route, type Part } from "./rules";
import { SplitterLayer } from "./SplitterLayer";
import { EXITS, FIELDS, OPS, type Condition, type Exit, type Field, type Rule, type Splitter } from "./types";
import { conditionRow, defaultValue, esc, readValue } from "./conditions";

const POLL_MS = 3000;
const EXIT_LABEL: Record<Exit, string> = { left: "← left", straight: "↑ straight", right: "right →" };
/** Size fields are meters in the API and centimeters on screen. */

interface Options {
  root: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  shapes: ReturnType<typeof createShapes>;
  conveyors: ReturnType<typeof createConveyors>;
}

export function createSplitters({ root, scene, camera, canvas, shapes, conveyors }: Options) {
  const layer = new SplitterLayer();
  scene.add(layer.root);

  let splitters: Splitter[] = [];
  let parts: Part[] = [];
  let selected: string | null = null;
  let placing = false;
  let online = false;
  let busy = false;
  let message: { text: string; error: boolean } | null = null;
  const draft = { name: "", beltId: "", along: 50 };
  /** The selected splitter's rules as being edited, and whether they differ from what's saved. */
  let edit: { rules: Rule[]; otherwise: Exit } | null = null;
  let dirty = false;
  /** The latest decision at each gate, shown in the panel while the line runs. */
  const lastRouted = new Map<string, { shape: string; exit: Exit; rule: number }>();

  const belts = () => conveyors.belts;
  const partFor = (s: Shape) => (s.sku ? parts.find((p) => p.sku === s.sku) : undefined);

  // The running line asks here when an item reaches a gate. Parts are the latest loaded,
  // so a change in the inventory applies from the next item on.
  conveyors.setGates({
    list: () => splitters.filter((s) => belts().some((b) => b.id === s.conveyorId)),
    route: (shapeId, gate) => {
      const s = splitters.find((x) => x.id === gate.id);
      const shape = shapes.shapes.find((x) => x.id === shapeId);
      if (!s || !shape) return "straight";
      const decision = route(s, shape, partFor(shape));
      lastRouted.set(s.id, { shape: shape.name, ...decision });
      layer.trigger(s.id, decision.exit);
      if (s.id === selected) renderLive();
      return decision.exit;
    },
  });
  conveyors.onBeltsChange(() => {
    layer.sync(splitters, belts());
    render();
  });

  // ---- API ----

  async function load() {
    try {
      const [list, stock] = await Promise.all([splittersApi.list(), splittersApi.parts()]);
      online = true;
      splitters = list;
      parts = stock;
      layer.sync(splitters, belts());
      if (selected && !splitters.some((s) => s.id === selected)) select(null);
      // Someone else changed the rules (API, database, another browser): show theirs unless we're mid-edit.
      if (selected && !dirty) edit = editable(splitters.find((s) => s.id === selected)!);
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

  setInterval(() => {
    if (!busy && !placing) void load();
  }, POLL_MS);

  function create(beltId: string, along: number) {
    const belt = belts().find((b) => b.id === beltId);
    if (!belt) {
      message = { text: "Pick a belt first.", error: true };
      return render();
    }
    const name = draft.name.trim() || `Splitter ${splitters.length + 1}`;
    void act(async () => {
      const s = await splittersApi.create({ name, conveyorId: beltId, along: Math.min(belt.length, Math.max(0, along)), rules: [], otherwise: "straight" });
      select(s.id);
    }, `Added ${name}. Now add rules to say what goes where.`);
    draft.name = "";
  }

  function select(id: string | null) {
    selected = id;
    dirty = false;
    const s = splitters.find((x) => x.id === id);
    edit = s ? editable(s) : null;
    layer.select(id);
    render();
  }

  function save() {
    if (!selected || !edit) return;
    const id = selected;
    const body = { rules: edit.rules.map(toApi), otherwise: edit.otherwise };
    void act(async () => {
      await splittersApi.update(id, body);
      dirty = false;
    }, "Rules saved.");
  }

  // ---- Pointer: click a belt to place a gate there ----

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoverAt: { belt: Conveyor; along: number } | null = null;

  function aim(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  /** The belt under the pointer and how far along it, to the centimeter. */
  function beltPoint(e: PointerEvent): { belt: Conveyor; along: number } | null {
    aim(e);
    const id = conveyors.layer.pick(raycaster);
    const hit = conveyors.layer.surfacePoint(raycaster);
    const belt = belts().find((b) => b.id === id);
    if (!belt || !hit) return null;
    const along = Math.round((toBelt(belt, hit.x, hit.z).u + belt.length / 2) * 100) / 100;
    return { belt, along: Math.min(belt.length, Math.max(0, along)) };
  }

  const isActive = () => placing;

  function handleHover(e: PointerEvent): boolean {
    if (!placing) return false;
    hoverAt = beltPoint(e);
    if (hoverAt) layer.showGhost(hoverAt.belt, hoverAt.along);
    else layer.hideGhost();
    canvas.style.cursor = hoverAt ? "crosshair" : "not-allowed";
    renderHint();
    return true;
  }

  function handleClick(e: PointerEvent): boolean {
    if (!placing) return false;
    const at = beltPoint(e);
    if (!at) return true; // keep placing until a belt is clicked
    create(at.belt.id, at.along);
    setPlacing(false);
    return true;
  }

  function handlePick(e: PointerEvent): boolean {
    aim(e);
    const id = layer.pick(raycaster);
    if (!id) return false;
    if (id !== selected && !confirmDiscard()) return true;
    select(id);
    showTab();
    return true;
  }

  function hoversGate(e: PointerEvent): boolean {
    aim(e);
    return layer.pick(raycaster) !== null;
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && placing) {
      setPlacing(false);
      return true;
    }
    return false;
  }

  function setPlacing(on: boolean) {
    placing = on;
    hoverAt = null;
    if (!on) {
      layer.hideGhost();
      canvas.style.cursor = "";
    }
    render();
  }

  function confirmDiscard(): boolean {
    // Unsaved rule edits are kept unless the person agrees to lose them.
    return !dirty || window.confirm("Discard your unsaved rule changes?");
  }

  let showTab = () => {};

  // ---- The panel ----

  root.innerHTML = `
    <section>
      <h2>Add a splitter</h2>
      <label class="wide">Belt <select data-draft="beltId"></select></label>
      <div class="row">
        <label>Along cm <input type="number" data-draft="along" min="0" max="400" step="5"></label>
        <label>Name <input type="text" data-draft="name" maxlength="40" placeholder="Automatic"></label>
      </div>
      <div class="actions">
        <button type="button" data-action="place" class="primary">Click a belt</button>
        <button type="button" data-action="add">Add on belt</button>
      </div>
      <p class="hint" hidden></p>
    </section>
    <section>
      <h2>Splitters <span class="count"></span></h2>
      <ul class="shape-list splitter-list"></ul>
    </section>
    <section class="rules-editor" hidden>
      <h2>Rules for <span class="rules-for"></span></h2>
      <p class="rules-help">Checked top to bottom: the first rule that matches an item decides where it goes.</p>
      <ol class="rules"></ol>
      <button type="button" data-do="add-rule" class="wide-btn">+ Add rule</button>
      <label class="otherwise">Anything else goes <select data-otherwise>${EXITS.map((x) => `<option value="${x}">${EXIT_LABEL[x]}</option>`).join("")}</select></label>
      <div class="actions">
        <button type="button" data-do="save" class="primary">Save rules</button>
        <button type="button" data-do="revert">Undo changes</button>
      </div>
      <h2>Items in the scene at this gate</h2>
      <ul class="preview"></ul>
      <p class="live" hidden></p>
    </section>
    <datalist id="dl-kind">${SHAPE_KINDS.map((k) => `<option value="${k}">`).join("")}</datalist>
    <datalist id="dl-category"></datalist>
    <datalist id="dl-sku"></datalist>
    <datalist id="dl-location"></datalist>
    <p class="shapes-status" role="status" hidden></p>
  `;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const beltSelect = $<HTMLSelectElement>('[data-draft="beltId"]');
  const list = $("ul.splitter-list");
  const editor = $("section.rules-editor");
  const rulesEl = $("ol.rules");
  const preview = $("ul.preview");
  const live = $("p.live");
  const status = $("p.shapes-status");
  const hint = $("p.hint");
  const placeBtn = $<HTMLButtonElement>('[data-action="place"]');
  const addBtn = $<HTMLButtonElement>('[data-action="add"]');
  const saveBtn = $<HTMLButtonElement>('[data-do="save"]');
  const revertBtn = $<HTMLButtonElement>('[data-do="revert"]');
  const otherwiseSel = $<HTMLSelectElement>("[data-otherwise]");

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset.draft as keyof typeof draft | undefined;
    if (key === "along") draft.along = Number(el.value || 0);
    else if (key === "name" || key === "beltId") draft[key] = el.value;
    if (key) return;
    if (!edit) return;
    // Rule editor: data-r is the rule, data-c the condition, data-k what's being changed.
    if (el.dataset.otherwise !== undefined) {
      edit.otherwise = el.value as Exit;
      return changed();
    }
    const r = Number(el.dataset.r);
    const rule = edit.rules[r];
    if (!rule) return;
    if (el.dataset.k === "exit") rule.exit = el.value as Exit;
    else {
      const cond = rule.conditions[Number(el.dataset.c)];
      if (!cond) return;
      if (el.dataset.k === "field") {
        cond.field = el.value as Field;
        const type = FIELDS[cond.field].type;
        if (!OPS[type].includes(cond.op)) cond.op = OPS[type][0];
        cond.value = defaultValue(cond.field);
        return changed(true);
      }
      if (el.dataset.k === "op") {
        cond.op = el.value as Condition["op"];
        if (cond.op === "in" && !Array.isArray(cond.value)) cond.value = String(cond.value) ? [String(cond.value)] : [];
        if (cond.op !== "in" && Array.isArray(cond.value)) cond.value = cond.value.join(", ");
        return changed(true);
      }
      if (el.dataset.k === "value") cond.value = readValue(cond, el.value);
    }
    changed();
  });

  /** Re-draws the preview at once, and the editor's rows only when their layout changed (so typing keeps focus). */
  function changed(relayout = false) {
    dirty = true;
    if (relayout) renderRules();
    renderPreview();
    renderButtons();
  }

  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!btn || !root.contains(btn)) return;
    if (btn === placeBtn) return setPlacing(!placing);
    if (btn === addBtn) return create(draft.beltId, draft.along / 100);
    const id = btn.dataset.id;
    if (id) {
      if (btn.dataset.do === "delete") {
        const s = splitters.find((x) => x.id === id);
        if (id === selected) select(null);
        return void act(() => splittersApi.remove(id), s ? `Deleted ${s.name}.` : undefined);
      }
      if (id !== selected && !confirmDiscard()) return;
      return select(id === selected ? null : id);
    }
    if (!edit) return;
    const r = Number(btn.dataset.r);
    switch (btn.dataset.do) {
      case "add-rule":
        edit.rules.push({ conditions: [{ field: "kind", op: "eq", value: "box" }], exit: "left" });
        return changed(true);
      case "add-cond":
        if (edit.rules[r].conditions.length < 5) edit.rules[r].conditions.push({ field: "color", op: "eq", value: "#e11d48" });
        return changed(true);
      case "del-cond": {
        const cs = edit.rules[r].conditions;
        cs.splice(Number(btn.dataset.c), 1);
        if (cs.length === 0) edit.rules.splice(r, 1);
        return changed(true);
      }
      case "del-rule":
        edit.rules.splice(r, 1);
        return changed(true);
      case "up":
      case "down": {
        const to = btn.dataset.do === "up" ? r - 1 : r + 1;
        if (to < 0 || to >= edit.rules.length) return;
        [edit.rules[r], edit.rules[to]] = [edit.rules[to], edit.rules[r]];
        return changed(true);
      }
      case "save":
        return save();
      case "revert":
        dirty = false;
        edit = editable(splitters.find((s) => s.id === selected)!);
        return render();
    }
  });

  function render() {
    // Belt picker and form
    // Gates go on straight sections only: a curve or a transfer has no straight run to divert from.
    const bs = belts().filter((b) => b.kind === "straight");
    if (!bs.some((b) => b.id === draft.beltId)) draft.beltId = bs[0]?.id ?? "";
    if (document.activeElement !== beltSelect) beltSelect.innerHTML = bs.length
      ? bs.map((b) => `<option value="${b.id}" ${b.id === draft.beltId ? "selected" : ""}>${esc(b.name)} (${cm(b.length)} cm)</option>`).join("")
      : `<option value="">Build a belt first (Conveyors tab)</option>`;
    for (const key of ["along", "name"] as const) {
      const input = $<HTMLInputElement>(`[data-draft="${key}"]`);
      if (document.activeElement !== input) input.value = String(draft[key]);
    }
    placeBtn.textContent = placing ? "Cancel" : "Click a belt";
    placeBtn.setAttribute("aria-pressed", String(placing));
    placeBtn.disabled = addBtn.disabled = !online || busy || bs.length === 0;

    // Datalists: suggestions from what's in the inventory right now.
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
    $("#dl-category").innerHTML = uniq(parts.map((p) => p.category)).map((x) => `<option value="${esc(x)}">`).join("");
    $("#dl-sku").innerHTML = uniq(parts.map((p) => p.sku)).map((x) => `<option value="${esc(x)}">`).join("");
    $("#dl-location").innerHTML = uniq(parts.map((p) => p.location)).map((x) => `<option value="${esc(x)}">`).join("");

    // The list
    list.innerHTML = splitters.length === 0
      ? `<li class="empty">${online ? "No splitters yet. Click a belt to put one on it." : "Start the inventory API to add splitters."}</li>`
      : splitters.map((s) => {
          const belt = bs.find((b) => b.id === s.conveyorId);
          const rules = s.rules.length ? `${s.rules.length} rule${s.rules.length === 1 ? "" : "s"}` : "no rules yet";
          return `<li class="${s.id === selected ? "selected" : ""}">
            <button type="button" class="pick" data-id="${s.id}" aria-pressed="${s.id === selected}">
              <span class="swatch gate-swatch"></span>
              <span class="label"><strong>${esc(s.name)}</strong>
                <small>${belt ? `${esc(belt.name)}, ${cm(s.along)} cm along` : "belt missing"} · ${rules}, else ${s.otherwise}</small></span>
            </button>
            <span class="row-actions"><button type="button" data-id="${s.id}" data-do="delete" title="Delete">✕</button></span>
          </li>`;
        }).join("");
    $("span.count").textContent = splitters.length ? `(${splitters.length})` : "";

    editor.hidden = !edit;
    if (edit) {
      $("span.rules-for").textContent = splitters.find((s) => s.id === selected)?.name ?? "";
      // Polling re-renders every few seconds; never rebuild the rows under someone's cursor.
      if (!editor.contains(document.activeElement)) renderRules();
      renderPreview();
      renderLive();
    }
    renderButtons();

    status.hidden = !message;
    status.textContent = message?.text ?? "";
    status.classList.toggle("error", !!message?.error);
    renderHint();
  }

  function renderButtons() {
    saveBtn.disabled = !dirty || busy || !online;
    revertBtn.disabled = !dirty || busy;
    saveBtn.textContent = dirty ? "Save rules" : "Saved";
  }

  function renderRules() {
    if (!edit) return;
    otherwiseSel.value = edit.otherwise;
    rulesEl.innerHTML = edit.rules.length === 0
      ? `<li class="empty">No rules: every item goes ${edit.otherwise}.</li>`
      : edit.rules.map((rule, r) => `
        <li class="rule">
          <div class="rule-head">
            <span class="rule-n">${r + 1}</span>
            <span class="rule-moves">
              <button type="button" data-do="up" data-r="${r}" ${r === 0 ? "disabled" : ""} title="Check earlier">↑</button>
              <button type="button" data-do="down" data-r="${r}" ${r === edit!.rules.length - 1 ? "disabled" : ""} title="Check later">↓</button>
              <button type="button" data-do="del-rule" data-r="${r}" title="Delete rule">✕</button>
            </span>
          </div>
          ${rule.conditions.map((c, i) => conditionRow(c, r, i)).join("")}
          <div class="rule-foot">
            <button type="button" data-do="add-cond" data-r="${r}" ${rule.conditions.length >= 5 ? "disabled" : ""}>+ and</button>
            <label>go <select data-r="${r}" data-k="exit">${EXITS.map((x) => `<option value="${x}" ${x === rule.exit ? "selected" : ""}>${EXIT_LABEL[x]}</option>`).join("")}</select></label>
          </div>
        </li>`).join("");
  }

  /** Where every shape would go at this gate under the rules being edited, saved or not. */
  function renderPreview() {
    if (!edit) return;
    const items = shapes.shapes;
    preview.innerHTML = items.length === 0
      ? `<li class="empty">No shapes in the scene.</li>`
      : items.map((s) => {
          const d = route(edit!, s, partFor(s));
          return `<li><span class="swatch" style="background:${esc(s.color)}"></span><span class="pname">${esc(s.name)}</span>
            <span class="exit ${d.exit}">${EXIT_LABEL[d.exit]}</span><small>${d.rule >= 0 ? `rule ${d.rule + 1}` : "anything else"}</small></li>`;
        }).join("");
  }

  function renderLive() {
    const last = selected ? lastRouted.get(selected) : undefined;
    live.hidden = !last;
    if (last) live.textContent = `Last item through: ${last.shape} went ${last.exit} (${last.rule >= 0 ? `rule ${last.rule + 1}` : "anything else"}).`;
  }

  function renderHint() {
    hint.hidden = !placing;
    if (placing) hint.textContent = hoverAt ? `${hoverAt.belt.name}, ${cm(hoverAt.along)} cm along. Click to put the gate here.` : "Point at a belt and click. Esc cancels.";
  }

  render();
  void load();

  return {
    layer, isActive, handleClick, handleHover, handlePick, hoversGate, handleKey,
    update: (dt: number) => layer.update(dt),
    /** Re-read the splitters now. */
    reload: load,
    onShowTab(fn: () => void) {
      showTab = fn;
    },
  };
}

/** A copy to edit, with sizes still in meters (converted only for display). */
function editable(s: Splitter): { rules: Rule[]; otherwise: Exit } {
  return { rules: structuredClone(s.rules), otherwise: s.otherwise };
}

function toApi(rule: Rule): Rule {
  return { exit: rule.exit, conditions: rule.conditions.map((c) => ({ ...c })) };
}

const cm = (m: number) => Math.round(m * 100);

