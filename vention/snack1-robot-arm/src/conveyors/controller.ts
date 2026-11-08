/**
 * The Conveyors tab: build belts, place them with the mouse, turn, reverse and delete them,
 * and Run / Stop the line. Belts are saved through the inventory API like the shapes.
 *
 * While running, transport.ts moves the shapes every frame. Nothing is saved until Stop,
 * when each shape's new position is written back with one PATCH, so a run is just a
 * preview until you stop it.
 */
import * as THREE from "three";
import { conveyorsApi, ShapesApiError } from "../shapes/api";
import type { createShapes } from "../shapes/controller";
import { ConveyorLayer } from "./ConveyorLayer";
import { step, supportHeight, type Body } from "./transport";
import type { Conveyor, NewConveyor } from "./types";

type Shapes = ReturnType<typeof createShapes>;
type Mode = { kind: "idle" } | { kind: "placing" } | { kind: "moving"; id: string };

const POLL_MS = 4000;
const FLOOR_LIMIT = 3;
/** Physics steps are at most this long, however slow the frame. */
const MAX_STEP = 1 / 120;

interface Draft {
  /** centimeters (speed in cm/s), as typed */
  length: number; width: number; height: number; speed: number;
  rotationY: number; name: string; x: number; z: number;
}

interface Options {
  root: HTMLElement;
  runButton: HTMLButtonElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  shapes: Shapes;
}

export function createConveyors({ root, runButton, scene, camera, canvas, shapes }: Options) {
  const layer = new ConveyorLayer();
  scene.add(layer.root);

  let belts: Conveyor[] = [];
  let selected: string | null = null;
  let mode: Mode = { kind: "idle" };
  let online = false;
  let busy = false;
  let message: { text: string; error: boolean } | null = null;
  let hover: { x: number; z: number } | null = null;
  const draft: Draft = { length: 150, width: 30, height: 30, speed: 20, rotationY: 0, name: "", x: 70, z: -60 };

  /** Set while running: one body per shape, keyed by shape id. */
  let bodies: Map<string, Body> | null = null;
  let started: Map<string, { x: number; z: number }> = new Map();

  // Shapes stand on whichever belt is under them, and can be placed onto one.
  shapes.setSurface({
    support: (x, z) => supportHeight(belts, x, z),
    pick: (raycaster) => layer.surfacePoint(raycaster),
  });

  // ---- API ----

  async function load() {
    try {
      belts = await conveyorsApi.list();
      online = true;
      layer.sync(belts);
      shapes.refresh();
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
    if (mode.kind === "idle" && !busy && !bodies) void load();
  }, POLL_MS);

  function newBelt(x: number, z: number): NewConveyor {
    return {
      name: draft.name.trim() || `Belt ${belts.length + 1}`,
      length: draft.length / 100, width: draft.width / 100, height: draft.height / 100,
      speed: draft.speed / 100, rotationY: draft.rotationY, position: { x, z },
    };
  }

  function create(x: number, z: number) {
    const belt = newBelt(x, z);
    void act(() => conveyorsApi.create(belt), `Added ${belt.name}.`);
    draft.name = "";
  }

  function remove(id: string) {
    const b = belts.find((x) => x.id === id);
    if (selected === id) setSelected(null);
    void act(() => conveyorsApi.remove(id), b ? `Deleted ${b.name}. Shapes on it drop to the floor.` : undefined);
  }

  // ---- Running ----

  function start() {
    if (bodies) return;
    setMode({ kind: "idle" });
    bodies = new Map();
    started = new Map();
    for (const s of shapes.shapes) {
      bodies.set(s.id, { x: s.position.x, z: s.position.z, y: supportHeight(belts, s.position.x, s.position.z), vx: 0, vy: 0, vz: 0 });
      started.set(s.id, { ...s.position });
    }
    shapes.setRunning(true);
    message = null;
    render();
  }

  function stop() {
    if (!bodies) return;
    const moves: { id: string; x: number; z: number }[] = [];
    for (const [id, b] of bodies) {
      const from = started.get(id)!;
      // Millimeters are plenty, and the API keeps whatever we send.
      const x = Math.round(b.x * 1000) / 1000;
      const z = Math.round(b.z * 1000) / 1000;
      if (Math.hypot(x - from.x, z - from.z) >= 0.001) moves.push({ id, x, z });
    }
    bodies = null;
    shapes.setRunning(false);
    shapes.saveMoves(moves);
    if (moves.length === 0) message = { text: "Nothing moved. Shapes ride a belt when placed on top of it.", error: false };
    render();
  }

  /** Called every frame by main.ts. */
  function update(dt: number) {
    if (!bodies) return;
    layer.animate(dt);
    for (let left = dt; left > 1e-9; left -= MAX_STEP) step(bodies.values(), belts, Math.min(MAX_STEP, left));
    for (const [id, b] of bodies) shapes.layer.pose(id, b.x, b.y, b.z);
  }

  runButton.addEventListener("click", () => (bodies ? stop() : start()));

  // ---- Pointer ----

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  function aim(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  function floorPoint(e: PointerEvent): { x: number; z: number } | null {
    aim(e);
    if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return null;
    const x = Math.round(hitPoint.x * 100) / 100;
    const z = Math.round(hitPoint.z * 100) / 100;
    return Math.abs(x) <= FLOOR_LIMIT && Math.abs(z) <= FLOOR_LIMIT ? { x, z } : null;
  }

  function ghostBelt(): { length: number; width: number; height: number; rotationY: number } | null {
    if (mode.kind === "placing") return { length: draft.length / 100, width: draft.width / 100, height: draft.height / 100, rotationY: draft.rotationY };
    if (mode.kind === "moving") {
      const id = mode.id;
      return belts.find((b) => b.id === id) ?? null;
    }
    return null;
  }

  /** True while placing or moving a belt: main.ts gives this module the pointer first then. */
  const isActive = () => mode.kind !== "idle";

  function handleHover(e: PointerEvent): boolean {
    const g = ghostBelt();
    if (!g) return false;
    hover = floorPoint(e);
    if (hover) layer.showGhost(g, hover.x, hover.z, g.rotationY);
    else layer.hideGhost();
    canvas.style.cursor = hover ? "crosshair" : "not-allowed";
    renderHint();
    return true;
  }

  /** Placing or moving: the click puts the belt down. */
  function handleClick(e: PointerEvent): boolean {
    if (mode.kind === "idle") return false;
    const at = floorPoint(e);
    if (!at) return true;
    if (mode.kind === "placing") create(at.x, at.z);
    else {
      const id = mode.id;
      void act(() => conveyorsApi.update(id, { position: at }), "Moved.");
    }
    setMode({ kind: "idle" });
    return true;
  }

  /** Idle: a click on a belt selects it. Asked after the shapes, which sit on top. */
  function handlePick(e: PointerEvent): boolean {
    aim(e);
    const id = layer.pick(raycaster);
    if (!id) return false;
    setSelected(id === selected ? null : id);
    showTab();
    return true;
  }

  function hoversBelt(e: PointerEvent): boolean {
    aim(e);
    return layer.pick(raycaster) !== null;
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && mode.kind !== "idle") {
      setMode({ kind: "idle" });
      return true;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected && mode.kind === "idle" && !bodies) {
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

  /** Clicking a belt in the scene opens its tab; main.ts wires the tabs. */
  let showTab = () => {};

  // ---- The panel ----

  root.innerHTML = `
    <section>
      <h2>Build a belt</h2>
      <div class="dims">
        <label>Length cm <input type="number" data-field="length" min="30" max="400" step="10"></label>
        <label>Width cm <input type="number" data-field="width" min="10" max="120" step="5"></label>
        <label>Height cm <input type="number" data-field="height" min="5" max="120" step="5"></label>
      </div>
      <div class="row">
        <label>Speed cm/s <input type="number" data-field="speed" min="-100" max="100" step="5"></label>
        <label>Turn ° <input type="number" data-field="rotationY" min="-360" max="360" step="15"></label>
      </div>
      <label class="wide">Name <input type="text" data-field="name" maxlength="40" placeholder="Automatic"></label>
      <div class="row">
        <label>X cm <input type="number" data-field="x" min="-300" max="300" step="5"></label>
        <label>Z cm <input type="number" data-field="z" min="-300" max="300" step="5"></label>
      </div>
      <div class="actions">
        <button type="button" data-action="place" class="primary">Place with mouse</button>
        <button type="button" data-action="add">Add at X, Z</button>
      </div>
      <p class="hint" hidden></p>
    </section>
    <section>
      <h2>Belts <span class="count"></span></h2>
      <ul class="shape-list belt-list"></ul>
    </section>
    <p class="shapes-status" role="status" hidden></p>
  `;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const list = $("ul.belt-list");
  const status = $("p.shapes-status");
  const hint = $("p.hint");
  const placeBtn = $<HTMLButtonElement>('[data-action="place"]');
  const addBtn = $<HTMLButtonElement>('[data-action="add"]');
  const field = (name: keyof Draft) => root.querySelector(`[data-field="${name}"]`) as HTMLInputElement;

  root.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    const key = input.dataset.field as keyof Draft | undefined;
    if (!key) return;
    if (key === "name") draft.name = input.value;
    else if (input.value !== "") draft[key] = Number(input.value);
    if (mode.kind === "placing" && hover) layer.showGhost(ghostBelt()!, hover.x, hover.z, draft.rotationY);
  });
  placeBtn.addEventListener("click", () => setMode(mode.kind === "placing" ? { kind: "idle" } : { kind: "placing" }));
  addBtn.addEventListener("click", () => create(draft.x / 100, draft.z / 100));
  list.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (!btn) return;
    const id = btn.dataset.id!;
    const belt = belts.find((b) => b.id === id);
    if (!belt) return;
    switch (btn.dataset.do) {
      case "delete":
        return remove(id);
      case "move":
        setSelected(id);
        return setMode(mode.kind === "moving" && mode.id === id ? { kind: "idle" } : { kind: "moving", id });
      case "turn":
        return void act(() => conveyorsApi.update(id, { rotationY: (belt.rotationY + 90) % 360 }));
      case "reverse":
        return void act(() => conveyorsApi.update(id, { speed: -belt.speed }));
      default:
        setSelected(id === selected ? null : id);
    }
  });

  function render() {
    for (const key of ["length", "width", "height", "speed", "rotationY", "name", "x", "z"] as const) {
      const input = field(key);
      if (document.activeElement !== input) input.value = String(draft[key]);
    }
    const running = !!bodies;
    const locked = !online || busy || running;
    placeBtn.textContent = mode.kind === "placing" ? "Cancel placing" : "Place with mouse";
    placeBtn.setAttribute("aria-pressed", String(mode.kind === "placing"));
    placeBtn.disabled = addBtn.disabled = locked;

    runButton.textContent = running ? "■ Stop belts" : "▶ Run belts";
    runButton.setAttribute("aria-pressed", String(running));
    runButton.disabled = !online || busy || (!running && belts.length === 0);
    runButton.title = belts.length === 0 ? "Add a conveyor first" : running ? "Stop and save where the shapes ended up" : "Start the belts";

    list.innerHTML = belts.length === 0
      ? `<li class="empty">${online ? "No belts yet. Place one with the mouse." : "Start the inventory API to add belts."}</li>`
      : belts.map((b) => {
          const moving = mode.kind === "moving" && mode.id === b.id;
          const dis = running ? "disabled" : "";
          const dir = b.speed === 0 ? "stopped" : `${Math.abs(Math.round(b.speed * 100))} cm/s ${b.speed > 0 ? "forward" : "reversed"}`;
          return `<li class="${b.id === selected ? "selected" : ""}">
            <button type="button" class="pick" data-id="${b.id}" aria-pressed="${b.id === selected}">
              <span class="swatch belt-swatch"></span>
              <span class="label"><strong>${escapeHtml(b.name)}</strong>
                <small>${cm(b.length)} × ${cm(b.width)} cm, ${cm(b.height)} cm high</small>
                <small>${dir} · turned ${Math.round(b.rotationY)}°</small></span>
            </button>
            <span class="row-actions">
              <button type="button" data-id="${b.id}" data-do="move" aria-pressed="${moving}" ${dis}>${moving ? "Cancel" : "Move"}</button>
              <button type="button" data-id="${b.id}" data-do="turn" ${dis} title="Turn 90°">↻ 90°</button>
              <button type="button" data-id="${b.id}" data-do="reverse" ${dis} title="Run the other way">⇄</button>
              <button type="button" data-id="${b.id}" data-do="delete" ${dis} title="Delete (or press Delete)">✕</button>
            </span>
          </li>`;
        }).join("");
    $("span.count").textContent = belts.length ? `(${belts.length})` : "";

    status.hidden = !message;
    status.textContent = message?.text ?? "";
    status.classList.toggle("error", !!message?.error);
    renderHint();
  }

  function renderHint() {
    if (mode.kind === "idle") {
      hint.hidden = !bodies;
      hint.textContent = "Running. Shapes on a belt ride along and drop off the end. Stop saves where they are.";
      return;
    }
    hint.hidden = false;
    const verb = mode.kind === "placing" ? "place it" : "move it there";
    hint.textContent = hover
      ? `x ${(hover.x * 100).toFixed(0)} cm, z ${(hover.z * 100).toFixed(0)} cm. Click to ${verb}.`
      : `Click the floor to ${verb}. Esc cancels.`;
  }

  render();
  void load();

  return {
    layer, update, isActive, handleClick, handleHover, handlePick, hoversBelt, handleKey,
    get running() {
      return !!bodies;
    },
    /** main.ts passes a function that switches the side panel to this tab. */
    onShowTab(fn: () => void) {
      showTab = fn;
    },
  };
}

const cm = (m: number) => Math.round(m * 100);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
