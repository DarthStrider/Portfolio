/**
 * The Shapes panel: create shapes, or pick a part from the inventory, place them on the
 * floor with the mouse, move and delete them. Shapes are saved through the inventory API, so they're in the database, and the
 * panel polls every few seconds so changes from another browser appear here too.
 *
 * main.ts owns the pointer and keyboard and asks this module first: handleClick and
 * handleKey return true when they used the event.
 */
import * as THREE from "three";
import type { ArmDimensions } from "../arm/kinematics";
import { shapesApi, ShapesApiError } from "./api";
import { reachOf, reachRadiusAt, REACH_LABEL, type Reach } from "./reach";
import { ShapeLayer } from "./ShapeLayer";
import { lookFor, placedBySku, type InventoryPart } from "./fromPart";
import { SHAPE_KINDS, type NewShape, type Shape, type ShapeKind, type Size } from "./types";

const POLL_MS = 4000;
const FLOOR_LIMIT = 3; // meters, same as the API
const DEFAULT_COLORS: Record<ShapeKind, string> = { box: "#f59e0b", cylinder: "#22c55e", sphere: "#e11d48", cone: "#a855f7" };

type Mode = { kind: "idle" } | { kind: "placing" } | { kind: "moving"; id: string };

interface Draft {
  kind: ShapeKind;
  /** centimeters, as typed */
  w: number; h: number; d: number;
  color: string;
  name: string;
  rotationY: number;
  /** centimeters */
  x: number; z: number;
}

interface Options {
  root: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  arm: ArmDimensions;
}

export function createShapes({ root, scene, camera, canvas, arm }: Options) {
  const layer = new ShapeLayer(reachRadiusAt(0, arm));
  scene.add(layer.root);

  let shapes: Shape[] = [];
  let parts: InventoryPart[] = [];
  /** "basic": a plain shape; "part": a shape standing for an inventory part. */
  let source: "basic" | "part" = "basic";
  let partSku: string | null = null;
  let partSearch = "";
  let selected: string | null = null;
  let mode: Mode = { kind: "idle" };
  let online = false;
  let busy = false;
  let message: { text: string; error: boolean } | null = null;
  let hover: { x: number; z: number } | null = null;
  const draft: Draft = { kind: "box", w: 20, h: 20, d: 20, color: DEFAULT_COLORS.box, name: "", rotationY: 0, x: 60, z: 0 };

  // ---- Talking to the API ----

  async function load() {
    try {
      const [list, stock, info] = await Promise.all([shapesApi.list(), shapesApi.parts(), online ? null : shapesApi.info()]);
      if (info) dbLabel.textContent = info.db;
      online = true;
      shapes = list;
      parts = stock;
      layer.sync(shapes);
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

  function sizeOf(d: Draft): Size {
    const cm = (n: number) => Math.round(n) / 100;
    if (d.kind === "sphere") return { x: cm(d.w), y: cm(d.w), z: cm(d.w) };
    if (d.kind === "cylinder" || d.kind === "cone") return { x: cm(d.w), y: cm(d.h), z: cm(d.w) };
    return { x: cm(d.w), y: cm(d.h), z: cm(d.d) };
  }

  function newShape(x: number, z: number): NewShape {
    const count = shapes.filter((s) => s.kind === draft.kind).length + 1;
    const sku = source === "part" ? partSku : null;
    return {
      name: draft.name.trim() || `${draft.kind[0].toUpperCase()}${draft.kind.slice(1)} ${count}`,
      kind: draft.kind, size: sizeOf(draft), color: draft.color, position: { x, z }, rotationY: draft.rotationY, sku,
    };
  }

  function create(x: number, z: number) {
    if (source === "part" && !partSku) {
      message = { text: "Pick a part from the inventory list first.", error: true };
      render();
      return;
    }
    const shape = newShape(x, z);
    void act(() => shapesApi.create(shape), `Added ${shape.name}${shape.sku ? ` (${shape.sku})` : ""}.`);
    if (source === "basic") draft.name = "";
  }

  /** Fills the form from a part: its look (kind, size, color) and its name. */
  function pickPart(sku: string) {
    const part = parts.find((p) => p.sku === sku);
    if (!part) return;
    partSku = sku;
    const look = lookFor(part);
    const cm = (m: number) => Math.round(m * 1000) / 10;
    Object.assign(draft, { kind: look.kind, w: cm(look.size.x), h: cm(look.size.y), d: cm(look.size.z), color: look.color, name: part.name.slice(0, 40) });
    render();
  }

  // Poll so changes from other browsers (or the API directly) show up. Skipped mid-placement.
  setInterval(() => {
    if (mode.kind === "idle" && !busy) void load();
  }, POLL_MS);

  // ---- Pointer: placing and moving on the floor ----

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  function aim(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  /** Where the pointer meets the floor, rounded to the centimeter, or null if off the floor area. */
  function floorPoint(e: PointerEvent): { x: number; z: number } | null {
    aim(e);
    if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return null;
    const x = Math.round(hitPoint.x * 100) / 100;
    const z = Math.round(hitPoint.z * 100) / 100;
    return Math.abs(x) <= FLOOR_LIMIT && Math.abs(z) <= FLOOR_LIMIT ? { x, z } : null;
  }

  function ghostSource(): { kind: ShapeKind; size: Size; color: string; rotationY: number } | null {
    if (mode.kind === "placing") return { kind: draft.kind, size: sizeOf(draft), color: draft.color, rotationY: draft.rotationY };
    if (mode.kind === "moving") {
      const id = mode.id;
      const s = shapes.find((x) => x.id === id);
      return s ? { kind: s.kind, size: s.size, color: s.color, rotationY: s.rotationY } : null;
    }
    return null;
  }

  /** Called on every pointer move. Returns true if the cursor is ours to set. */
  function handleHover(e: PointerEvent): boolean {
    const src = ghostSource();
    if (src) {
      hover = floorPoint(e);
      if (hover) layer.showGhost(src.kind, src.size, src.color, hover.x, hover.z, src.rotationY);
      else layer.hideGhost();
      canvas.style.cursor = hover ? "crosshair" : "not-allowed";
      renderHint();
      return true;
    }
    aim(e);
    if (layer.pick(raycaster)) {
      canvas.style.cursor = "pointer";
      return true;
    }
    return false;
  }

  /** Called on a click (not a drag). Returns true if it was used. */
  function handleClick(e: PointerEvent): boolean {
    if (mode.kind === "placing" || mode.kind === "moving") {
      const at = floorPoint(e);
      if (!at) return true;
      if (mode.kind === "placing") create(at.x, at.z);
      else {
        const id = mode.id;
        void act(() => shapesApi.update(id, { position: at }), "Moved.");
      }
      setMode({ kind: "idle" });
      return true;
    }
    aim(e);
    const id = layer.pick(raycaster);
    if (id) {
      setSelected(id === selected ? null : id);
      return true;
    }
    return false;
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && mode.kind !== "idle") {
      setMode({ kind: "idle" });
      return true;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected && mode.kind === "idle") {
      remove(selected);
      return true;
    }
    return false;
  }

  function setMode(next: Mode) {
    mode = next;
    hover = null;
    if (mode.kind === "idle") {
      layer.hideGhost();
      canvas.style.cursor = "";
    }
    render();
  }

  function setSelected(id: string | null) {
    selected = id;
    layer.select(id);
    render();
  }

  function remove(id: string) {
    const s = shapes.find((x) => x.id === id);
    if (selected === id) setSelected(null);
    void act(() => shapesApi.remove(id), s ? `Deleted ${s.name}.` : undefined);
  }

  // ---- The panel ----

  root.innerHTML = `
    <header>
      <h1>Shapes</h1>
      <p class="sub">Saved in the inventory database · <span class="db">connecting…</span></p>
    </header>
    <section>
      <h2>Add to the scene</h2>
      <div class="sources" role="group" aria-label="What to add">
        <button type="button" data-source="basic">Basic shape</button>
        <button type="button" data-source="part">Inventory part</button>
      </div>
      <div class="part-picker" hidden>
        <input type="search" class="part-search" placeholder="Search SKU or name" aria-label="Search inventory parts">
        <ul class="part-list" role="listbox" aria-label="Inventory parts"></ul>
      </div>
      <div class="kinds" role="group" aria-label="Kind">
        ${SHAPE_KINDS.map((k) => `<button type="button" data-kind="${k}">${k}</button>`).join("")}
      </div>
      <div class="dims"></div>
      <div class="row">
        <label>Color <input type="color" data-field="color"></label>
        <label>Turn ° <input type="number" data-field="rotationY" min="-360" max="360" step="5"></label>
      </div>
      <label class="wide">Name <input type="text" data-field="name" maxlength="40" placeholder="Automatic"></label>
      <div class="row">
        <label>X cm <input type="number" data-field="x" min="-300" max="300" step="5"></label>
        <label>Z cm <input type="number" data-field="z" min="-300" max="300" step="5"></label>
      </div>
      <p class="reach-line">At X, Z: <span class="reach"></span></p>
      <div class="actions">
        <button type="button" data-action="place" class="primary">Place with mouse</button>
        <button type="button" data-action="add">Add at X, Z</button>
      </div>
      <p class="hint" hidden></p>
    </section>
    <section>
      <h2>In the scene <span class="count"></span></h2>
      <ul class="shape-list"></ul>
    </section>
    <p class="shapes-status" role="status" hidden></p>
  `;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const dbLabel = $("span.db");
  const dims = $("div.dims");
  const list = $("ul.shape-list");
  const status = $("p.shapes-status");
  const hint = $("p.hint");
  const reachSpan = $("span.reach");
  const placeBtn = $<HTMLButtonElement>('[data-action="place"]');
  const addBtn = $<HTMLButtonElement>('[data-action="add"]');
  const field = (name: string) => root.querySelector(`[data-field="${name}"]`) as HTMLInputElement;
  const picker = $("div.part-picker");
  const partList = $("ul.part-list");
  const kinds = $("div.kinds");

  root.querySelectorAll<HTMLButtonElement>("[data-source]").forEach((b) =>
    b.addEventListener("click", () => {
      source = b.dataset.source as typeof source;
      if (source === "basic") {
        partSku = null;
        Object.assign(draft, { kind: "box", w: 20, h: 20, d: 20, color: DEFAULT_COLORS.box, name: "" });
      } else if (partSku) pickPart(partSku);
      render();
    }),
  );
  $<HTMLInputElement>("input.part-search").addEventListener("input", (e) => {
    partSearch = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderParts();
  });
  partList.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-sku]");
    if (li) pickPart(li.dataset.sku!);
  });

  root.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((b) =>
    b.addEventListener("click", () => {
      const kind = b.dataset.kind as ShapeKind;
      // Keep a custom color; otherwise switch to the new kind's default.
      if (draft.color === DEFAULT_COLORS[draft.kind]) draft.color = DEFAULT_COLORS[kind];
      draft.kind = kind;
      render();
    }),
  );
  root.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    const key = input.dataset.field as keyof Draft | undefined;
    if (!key) return;
    if (key === "color" || key === "name") draft[key] = input.value;
    else if (key !== "kind" && input.value !== "") (draft as unknown as Record<string, number>)[key] = Number(input.value);
    renderHint();
  });
  placeBtn.addEventListener("click", () => setMode(mode.kind === "placing" ? { kind: "idle" } : { kind: "placing" }));
  addBtn.addEventListener("click", () => create(draft.x / 100, draft.z / 100));
  list.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (!btn) return;
    const id = btn.dataset.id!;
    if (btn.dataset.do === "delete") remove(id);
    else if (btn.dataset.do === "move") {
      setSelected(id);
      setMode(mode.kind === "moving" && mode.id === id ? { kind: "idle" } : { kind: "moving", id });
    } else setSelected(id === selected ? null : id);
  });

  function dimInput(label: string, key: "w" | "h" | "d") {
    return `<label>${label} <input type="number" data-field="${key}" min="1" max="200" step="1" value="${draft[key]}"></label>`;
  }

  let renderedKind: ShapeKind | null = null;

  function renderParts() {
    const placed = placedBySku(shapes);
    const shown = parts.filter((p) => !partSearch || p.sku.toLowerCase().includes(partSearch) || p.name.toLowerCase().includes(partSearch));
    partList.innerHTML = shown.length === 0
      ? `<li class="empty">${parts.length ? "No parts match." : "No parts in the inventory yet."}</li>`
      : shown.map((p) => {
          const inScene = placed.get(p.sku) ?? 0;
          return `<li role="option" data-sku="${p.sku}" aria-selected="${p.sku === partSku}" class="${p.sku === partSku ? "on" : ""}">
            <span class="sku">${p.sku}</span>
            <span class="pname">${escapeHtml(p.name)}</span>
            <span class="stock ${inScene > p.onHand ? "over" : ""}">${p.available} avail${inScene ? ` · ${inScene} in scene` : ""}</span>
          </li>`;
        }).join("");
  }

  function render() {
    root.querySelectorAll<HTMLButtonElement>("[data-source]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.source === source)));
    picker.hidden = source !== "part";
    kinds.hidden = source === "part"; // a part's kind comes from its category
    if (source === "part") renderParts();
    root.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === draft.kind)));
    if (renderedKind !== draft.kind || dims.dataset.for !== `${draft.w}:${draft.h}:${draft.d}` && !dims.contains(document.activeElement)) {
      // Rebuild only when the kind changes, so typing in a field doesn't lose focus.
      dims.innerHTML =
        draft.kind === "box" ? dimInput("Width cm", "w") + dimInput("Height cm", "h") + dimInput("Depth cm", "d")
        : draft.kind === "sphere" ? dimInput("Diameter cm", "w")
        : dimInput("Diameter cm", "w") + dimInput("Height cm", "h");
      renderedKind = draft.kind;
      dims.dataset.for = `${draft.w}:${draft.h}:${draft.d}`;
    }
    for (const key of ["color", "rotationY", "name", "x", "z"] as const) {
      const input = field(key);
      if (document.activeElement !== input) input.value = String(draft[key]);
    }

    placeBtn.textContent = mode.kind === "placing" ? "Cancel placing" : "Place with mouse";
    placeBtn.setAttribute("aria-pressed", String(mode.kind === "placing"));
    placeBtn.disabled = addBtn.disabled = !online || busy || (source === "part" && !partSku);
    if (!online) dbLabel.textContent = "offline";

    list.innerHTML = shapes.length === 0
      ? `<li class="empty">${online ? "No shapes yet. Place one with the mouse." : "Start the inventory API to add shapes."}</li>`
      : shapes.map((s) => {
          const reach = reachOf(s, arm);
          const part = s.sku ? parts.find((p) => p.sku === s.sku) : undefined;
          const placed = s.sku ? placedBySku(shapes).get(s.sku) ?? 0 : 0;
          const stockNote = part
            ? `<small class="${placed > part.onHand ? "over" : ""}">${s.sku} · ${placed} in scene, ${part.onHand} on hand</small>`
            : s.sku ? `<small class="over">${s.sku} · no longer in the inventory</small>` : "";
          const moving = mode.kind === "moving" && mode.id === s.id;
          return `<li class="${s.id === selected ? "selected" : ""}">
            <button type="button" class="pick" data-id="${s.id}" aria-pressed="${s.id === selected}">
              <span class="swatch" style="background:${s.color}"></span>
              <span class="label"><strong>${escapeHtml(s.name)}</strong><small>${s.kind} · ${sizeText(s)}</small>${stockNote}
                <span class="pill ${reach}">${REACH_LABEL[reach]}</span></span>
            </button>
            <span class="row-actions">
              <button type="button" data-id="${s.id}" data-do="move" aria-pressed="${moving}" title="Click the floor to move it">${moving ? "Cancel" : "Move"}</button>
              <button type="button" data-id="${s.id}" data-do="delete" title="Delete (or press Delete)">✕</button>
            </span>
          </li>`;
        }).join("");
    $("span.count").textContent = shapes.length ? `(${shapes.length})` : "";

    status.hidden = !message;
    status.textContent = message?.text ?? "";
    status.classList.toggle("error", !!message?.error);
    renderHint();
  }

  /** The reach pill for the typed position, and what the mouse is doing. */
  function renderHint() {
    const draftShape = { kind: draft.kind, size: sizeOf(draft), position: { x: draft.x / 100, z: draft.z / 100 } };
    setReach(reachSpan, reachOf(draftShape, arm));
    if (mode.kind === "idle") {
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    const verb = mode.kind === "placing" ? "place it" : "move it there";
    if (!hover) hint.textContent = `Click the floor to ${verb}. Esc cancels.`;
    else {
      const src = ghostSource()!;
      const r = reachOf({ kind: src.kind, size: src.size, position: hover }, arm);
      hint.textContent = `x ${(hover.x * 100).toFixed(0)} cm, z ${(hover.z * 100).toFixed(0)} cm · ${REACH_LABEL[r]}. Click to ${verb}.`;
    }
  }

  function setReach(el: HTMLElement, reach: Reach) {
    el.className = `pill ${reach}`;
    el.textContent = REACH_LABEL[reach];
  }

  render();
  void load();

  return { layer, handleClick, handleHover, handleKey };
}

function sizeText(s: Shape): string {
  const cm = (m: number) => `${Math.round(m * 100)}`;
  if (s.kind === "sphere") return `⌀ ${cm(s.size.x)} cm`;
  if (s.kind === "box") return `${cm(s.size.x)} × ${cm(s.size.y)} × ${cm(s.size.z)} cm`;
  return `⌀ ${cm(s.size.x)} × ${cm(s.size.y)} cm`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
