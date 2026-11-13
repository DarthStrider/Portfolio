/**
 * The Conveyors tab: build belts, place them with the mouse, turn, reverse and delete them,
 * and Run / Stop the line. Belts are saved through the inventory API like the shapes.
 *
 * Belts can be built into lines one section at a time: select the last section and add a
 * straight (typed, or dragged out with the mouse), a curve or a transfer, and it's placed
 * exactly at the end (sections.ts does the geometry). A line then moves, turns, reverses and
 * runs as one; deleting a section in the middle splits it in two.
 *
 * While running, transport.ts moves the shapes every frame. Nothing is saved until Stop,
 * when each shape's new position is written back with one PATCH, so a run is just a
 * preview until you stop it.
 */
import * as THREE from "three";
import { conveyorsApi, ShapesApiError } from "../shapes/api";
import type { createShapes } from "../shapes/controller";
import { ConveyorLayer } from "./ConveyorLayer";
import { step, supportHeight, type Body, type Exit, type Gate } from "./transport";
import { afterRemoving, describe, dragLength, endOf, lineOf, minRadius, place, shifted, startOf, turnedAbout, type SectionSpec } from "./sections";
import { poses, rootOf } from "../line/joints";
import type { Join, Stations } from "../line/stations";
import type { Attachment } from "../line/types";
import type { Conveyor, NewConveyor } from "./types";

type Shapes = ReturnType<typeof createShapes>;
/** extending: dragging a new straight out of the end of a line (fromId is its last section). */
type Mode = { kind: "idle" } | { kind: "placing" } | { kind: "moving"; id: string } | { kind: "extending"; fromId: string; length: number };

const POLL_MS = 4000;
const FLOOR_LIMIT = 3;
/** Physics steps are at most this long, however slow the frame. */
const MAX_STEP = 1 / 120;

/** What the splitters tell the running line: where their gates are, and where each item goes. */
export interface Gates {
  list(): readonly Gate[];
  /** Asked once when a shape reaches a gate. */
  route(shapeId: string, gate: Gate): Exit;
}

/** What the mergers and machines plug in: their stations, and how to save a run's joins. */
export interface Line {
  stations: Stations;
  /** Called on Stop, after positions are saved, with the joins machines made during the run. */
  saveJoins(joins: readonly Join[]): Promise<void>;
  /** Called on Stop: items that left bins (first) and items that ended up in bins (last). */
  saveReleases(items: readonly { binId: string; shapeId: string; x: number; z: number }[]): Promise<void>;
  saveCatches(items: readonly { binId: string; shapeId: string }[]): Promise<void>;
  /** Called every frame while running, after the step, to update the stations' 3D models. */
  frame(dt: number): void;
}

interface Draft {
  /** centimeters (speed in cm/s), as typed */
  length: number; width: number; height: number; speed: number;
  rotationY: number; name: string; x: number; z: number;
  /** For extending a line: a straight's length, and a curve's radius at the middle of the belt. */
  extLength: number; radius: number;
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
  const draft: Draft = { length: 150, width: 30, height: 30, speed: 20, rotationY: 0, name: "", x: 70, z: -60, extLength: 100, radius: 50 };

  /** Set while running: one body per shape, keyed by shape id. */
  let bodies: Map<string, Body> | null = null;
  let started: Map<string, { x: number; z: number }> = new Map();
  let gates: Gates = { list: () => [], route: () => "straight" };
  let line: Line | null = null;
  /** Joins made during this run: which shape now rides on which. */
  let links = new Map<string, { parentId: string; attach: Attachment }>();
  let joins: Join[] = [];
  /** Where each stored item was when the run started: shape id -> bin id. */
  let storedAtStart = new Map<string, string>();
  const listeners: ((belts: readonly Conveyor[]) => void)[] = [];

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
      for (const fn of listeners) fn(belts);
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

  /** Deletes a section. In the middle of a line, the sections after it become a line of their own. */
  function remove(id: string) {
    const b = belts.find((x) => x.id === id);
    if (!b) return;
    if (selected === id) setSelected(null);
    const line = lineOf(belts, b);
    const at = line.indexOf(b);
    const rest = afterRemoving(line, at, uuid);
    const split = at > 0 && at < line.length - 1;
    void act(async () => {
      await conveyorsApi.remove(id);
      if (rest.length) await conveyorsApi.updateMany(rest);
    }, `Deleted ${b.name}.${split ? " The line is split in two." : ""} Shapes on it drop to the floor.`);
  }

  // ---- Lines ----

  /** The section a new one would follow: the selected belt, if it's the last of its line (or on its own). */
  function lineEnd(): Conveyor | null {
    const b = belts.find((x) => x.id === selected);
    if (!b) return null;
    const line = lineOf(belts, b);
    return line[line.length - 1].id === b.id ? b : null;
  }

  /** Adds a section at the end of the line that `from` ends, and selects it so the next one follows it. */
  function addSection(from: Conveyor, spec: SectionSpec) {
    const line = lineOf(belts, from);
    const placed = place(endOf(from), spec, from.width);
    const lineId = from.lineId ?? uuid();
    const base = line[0].name.replace(/ · \d+$/, "").slice(0, 32);
    const name = `${base} · ${line.length + 1}`;
    let made: Conveyor | null = null;
    void act(async () => {
      // A belt on its own becomes the first section of a new line.
      if (!from.lineId) await conveyorsApi.update(from.id, { lineId, lineIndex: 0 });
      made = await conveyorsApi.create({
        name, width: from.width, height: from.height, speed: from.speed, ...placed, lineId, lineIndex: from.lineIndex + 1,
      });
    }, `Added ${describe(placed).toLowerCase()}.`).then(() => {
      if (made) setSelected(made.id);
    });
  }

  /** Changes every section of a belt's line at once (all or none), or just the belt if it's on its own. */
  function changeLine(b: Conveyor, change: (s: Conveyor, line: Conveyor[]) => Partial<Conveyor>, done: string) {
    const line = lineOf(belts, b);
    const updates = line.map((s) => ({ id: s.id, ...change(s, line) }));
    void act(() => (updates.length === 1 ? conveyorsApi.update(updates[0].id, change(line[0], line)) : conveyorsApi.updateMany(updates)), done);
  }

  // ---- Running ----

  function start() {
    if (bodies) return;
    setMode({ kind: "idle" });
    bodies = new Map();
    started = new Map();
    links = new Map();
    joins = [];
    line?.stations.reset();
    storedAtStart = new Map(shapes.shapes.filter((s) => s.binId && !s.attachedTo).map((s) => [s.id, s.binId!]));
    // Shapes joined onto another ride on it, and stored ones are in their bins: only the ones
    // standing on their own get a body.
    for (const s of shapes.shapes) {
      if (s.attachedTo || s.binId) continue;
      bodies.set(s.id, {
        id: s.id, x: s.position.x, z: s.position.z, y: supportHeight(belts, s.position.x, s.position.z),
        vx: 0, vy: 0, vz: 0, size: Math.max(s.size.x, s.size.z),
      });
      started.set(s.id, { ...s.position });
    }
    shapes.setRunning(true);
    message = null;
    render();
  }

  async function stop() {
    if (!bodies) return;
    const moves: { id: string; x: number; z: number }[] = [];
    // Shapes joined during the run are saved where they ended up too, so if the assembly is
    // refused (not enough stock), they're left at the machine rather than back at the start.
    const where = currentPoses();
    const storedNow = new Map(line?.stations.stored() ?? []);
    for (const [id, from] of started) {
      const p = where.get(id);
      if (!p || storedNow.has(id)) continue; // ended up in a bin: its position doesn't matter
      // Millimeters are plenty, and the API keeps whatever we send.
      const x = Math.round(p.x * 1000) / 1000;
      const z = Math.round(p.z * 1000) / 1000;
      if (Math.hypot(x - from.x, z - from.z) >= 0.001) moves.push({ id, x, z });
    }
    // What changed in the bins: items that left one (saved with where they ended up), and items now in one.
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const releases = [...storedAtStart].filter(([id, bin]) => storedNow.get(id) !== bin && where.has(id))
      .map(([shapeId, binId]) => ({ binId, shapeId, x: round(where.get(shapeId)!.x), z: round(where.get(shapeId)!.z) }));
    const catches = [...storedNow].filter(([id, bin]) => storedAtStart.get(id) !== bin).map(([shapeId, binId]) => ({ binId, shapeId }));
    const made = joins;
    bodies = null;
    joins = [];
    line?.stations.reset();
    line?.frame(0); // lights back to idle
    shapes.setRunning(false);
    if (moves.length === 0 && made.length === 0 && !releases.length && !catches.length) message = { text: "Nothing moved. Shapes ride a belt when placed on top of it.", error: false };
    render();
    // Releases first (they put items back on the floor), joins next, catches last (an item can
    // be joined and then caught as one assembly in the same run).
    if (releases.length && line) await line.saveReleases(releases);
    await shapes.saveMoves(moves);
    if (made.length && line) await line.saveJoins(made);
    if (catches.length && line) await line.saveCatches(catches);
    if (line && (releases.length || made.length || catches.length)) await shapes.reload();
  }

  /** Where every shape is now: bodies for the free ones, and joined ones riding on them. */
  function currentPoses() {
    return poses(shapes.shapes, (s) => {
      const b = bodies?.get(s.id);
      return b
        ? { x: b.x, y: b.y + s.size.y / 2, z: b.z, rotationY: s.rotationY }
        : { x: s.position.x, y: supportHeight(belts, s.position.x, s.position.z) + s.size.y / 2, z: s.position.z, rotationY: s.rotationY };
    }, links);
  }

  /** Called every frame by main.ts. */
  function update(dt: number) {
    if (!bodies) return;
    layer.animate(dt);
    const st = line?.stations;
    const options = {
      gates: gates.list(), route: (b: Body, g: Gate) => gates.route(b.id!, g),
      stops: st?.stops() ?? [], hold: st?.hold,
    };
    for (let left = dt; left > 1e-9; left -= MAX_STEP) {
      const h = Math.min(MAX_STEP, left);
      st?.prepare(bodies);
      step(bodies.values(), belts, h, options);
      for (const j of st?.afterStep(h) ?? []) {
        // The attached shape stops being a free body: from now on it rides on the base.
        bodies.delete(j.attachedId);
        links.set(j.attachedId, { parentId: j.baseId, attach: j.attach });
        joins.push(j);
      }
      const bins = st?.binStep(h, bodies);
      for (const c of bins?.caught ?? []) bodies.delete(c.shapeId);
      for (const r of bins?.released ?? []) bodies.set(r.body.id!, r.body);
    }
    const stored = st?.stored() ?? new Map();
    for (const [id, p] of currentPoses()) {
      shapes.layer.poseCenter(id, p);
      shapes.layer.setVisible(id, !stored.has(rootOf(id, shapes.shapes, links)));
    }
    line?.frame(dt);
  }

  runButton.addEventListener("click", () => (bodies ? void stop() : start()));

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

  function ghostBelt(): (Pick<Conveyor, "length" | "width" | "height" | "rotationY"> & Partial<Conveyor>) | null {
    if (mode.kind === "placing") return { length: draft.length / 100, width: draft.width / 100, height: draft.height / 100, rotationY: draft.rotationY };
    if (mode.kind === "moving") {
      const id = mode.id;
      return belts.find((b) => b.id === id) ?? null;
    }
    return null;
  }

  /** True while placing or moving a belt: main.ts gives this module the pointer first then. */
  const isActive = () => mode.kind !== "idle";
  /** True while dragging a section out of a line's end: main.ts stops the camera orbiting then. */
  const isExtending = () => mode.kind === "extending";

  function handleHover(e: PointerEvent): boolean {
    if (mode.kind === "extending") {
      const from = belts.find((b) => b.id === (mode as { fromId: string }).fromId);
      hover = floorPoint(e);
      if (!from || !hover) {
        layer.hideGhost();
        return true;
      }
      // The new straight follows the mouse: as long as the distance from the end, along the line.
      const end = endOf(from);
      mode = { ...mode, length: dragLength(end, hover) };
      const placed = place(end, { kind: "straight", length: mode.length }, from.width);
      layer.showGhost({ ...placed, width: from.width, height: from.height }, placed.position.x, placed.position.z, placed.rotationY);
      canvas.style.cursor = "crosshair";
      renderHint();
      return true;
    }
    const g = ghostBelt();
    if (!g) return false;
    hover = floorPoint(e);
    if (hover) layer.showGhost(g, hover.x, hover.z, g.rotationY); // a moved section shows alone; the rest of its line follows
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
    else if (mode.kind === "extending") {
      const from = belts.find((b) => b.id === (mode as { fromId: string }).fromId);
      if (from) addSection(from, { kind: "straight", length: mode.length });
    } else {
      const b = belts.find((x) => x.id === (mode as { id: string }).id);
      if (b) {
        // The whole line moves by the same offset, so it stays joined.
        const dx = at.x - b.position.x;
        const dz = at.z - b.position.z;
        changeLine(b, (s) => shifted(s, dx, dz), "Moved.");
      }
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

  /** The arrow at the open end of the selected belt's line, where a new section goes. */
  function showEnd() {
    const b = belts.find((x) => x.id === selected);
    const line = b ? lineOf(belts, b) : [];
    const last = line[line.length - 1];
    layer.showEnd(last && !bodies ? endOf(last) : null, last?.height);
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
    <section class="line-build" hidden>
      <h2>Extend the line <small class="from"></small></h2>
      <p class="small-note">Adds a section at the blue arrow. The new one becomes the end, so you can keep going.</p>
      <div class="row">
        <label>Straight cm <input type="number" data-field="extLength" min="30" max="400" step="5"></label>
        <button type="button" data-ext="straight">Add straight</button>
      </div>
      <button type="button" data-ext="drag" class="primary wide-btn">Drag a straight with the mouse</button>
      <div class="row">
        <label>Curve radius cm <input type="number" data-field="radius" min="10" max="200" step="5"></label>
        <span></span>
      </div>
      <div class="ext-grid">
        <button type="button" data-ext="curve" data-turn="90" title="Curve 90° left">↰ 90°</button>
        <button type="button" data-ext="curve" data-turn="45" title="Curve 45° left">↖ 45°</button>
        <button type="button" data-ext="curve" data-turn="-45" title="Curve 45° right">↗ 45°</button>
        <button type="button" data-ext="curve" data-turn="-90" title="Curve 90° right">↱ 90°</button>
      </div>
      <div class="ext-grid two">
        <button type="button" data-ext="transfer" data-turn="90" title="A square corner module: items stop in the middle and go out to the left">Transfer ↰</button>
        <button type="button" data-ext="transfer" data-turn="-90" title="A square corner module: items stop in the middle and go out to the right">Transfer ↱</button>
      </div>
    </section>
    <p class="line-note small-note" hidden></p>
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
  const builder = $("section.line-build");
  const lineNote = $("p.line-note");

  builder.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ext]");
    const from = lineEnd();
    if (!btn || !from) return;
    const turn = Number(btn.dataset.turn);
    switch (btn.dataset.ext) {
      case "straight":
        return addSection(from, { kind: "straight", length: Math.min(4, Math.max(0.3, draft.extLength / 100)) });
      case "drag":
        return setMode(mode.kind === "extending" ? { kind: "idle" } : { kind: "extending", fromId: from.id, length: draft.extLength / 100 });
      case "curve":
        return addSection(from, { kind: "curve", turn, radius: Math.max(minRadius(from.width), Math.min(2, draft.radius / 100)) });
      case "transfer":
        return addSection(from, { kind: "transfer", turn });
    }
  });
  lineNote.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-select]")?.dataset.select;
    if (id) setSelected(id);
  });

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
      case "turn": {
        // A line turns about its start; a belt on its own about its middle.
        const line = lineOf(belts, belt);
        const pivot = line.length > 1 ? startOf(line[0]) : belt.position;
        return changeLine(belt, (s) => turnedAbout(s, pivot, 90), "Turned 90°.");
      }
      case "reverse":
        return changeLine(belt, (s) => ({ speed: -s.speed }), "Reversed.");
      default:
        setSelected(id === selected ? null : id);
    }
  });

  function render() {
    for (const key of ["length", "width", "height", "speed", "rotationY", "name", "x", "z", "extLength", "radius"] as const) {
      const input = field(key);
      if (document.activeElement !== input) input.value = String(draft[key]);
    }
    const running = !!bodies;
    const locked = !online || busy || running;
    placeBtn.textContent = mode.kind === "placing" ? "Cancel placing" : "Place with mouse";
    placeBtn.setAttribute("aria-pressed", String(mode.kind === "placing"));
    placeBtn.disabled = addBtn.disabled = locked;

    // Extending: only from the end of a line (or a belt on its own), and not while running.
    const end = lineEnd();
    const chosen = belts.find((b) => b.id === selected);
    builder.hidden = !end || running;
    if (end) {
      $("small.from").textContent = `after ${end.name}`;
      const drag = builder.querySelector<HTMLButtonElement>('[data-ext="drag"]')!;
      drag.textContent = mode.kind === "extending" ? "Cancel dragging" : "Drag a straight with the mouse";
      drag.setAttribute("aria-pressed", String(mode.kind === "extending"));
      for (const b of builder.querySelectorAll<HTMLButtonElement>("button")) b.disabled = locked;
    }
    const last = chosen ? lineOf(belts, chosen).at(-1)! : null;
    lineNote.hidden = !chosen || !!end || running;
    if (chosen && last && !end) {
      lineNote.innerHTML = `New sections go on the end of a line. <button type="button" class="linkish" data-select="${last.id}">Select ${escapeHtml(last.name)}</button>`;
    }
    showEnd();

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
          const line = lineOf(belts, b);
          const shape = b.kind === "straight" ? `${cm(b.length)} × ${cm(b.width)} cm` : `${describe(b)}, ${cm(b.width)} cm wide`;
          const where = line.length > 1 ? ` · section ${line.indexOf(b) + 1} of ${line.length}` : "";
          return `<li class="${b.id === selected ? "selected" : ""}">
            <button type="button" class="pick" data-id="${b.id}" aria-pressed="${b.id === selected}">
              <span class="swatch belt-swatch"></span>
              <span class="label"><strong>${escapeHtml(b.name)}</strong>
                <small>${shape}, ${cm(b.height)} cm high${where}</small>
                <small>${dir} · turned ${Math.round(b.rotationY)}°</small></span>
            </button>
            <span class="row-actions">
              <button type="button" data-id="${b.id}" data-do="move" aria-pressed="${moving}" ${dis} title="${line.length > 1 ? "Moves the whole line" : "Click the floor to move it"}">${moving ? "Cancel" : "Move"}</button>
              <button type="button" data-id="${b.id}" data-do="turn" ${dis} title="${line.length > 1 ? "Turn the whole line 90° about its start" : "Turn 90°"}">↻ 90°</button>
              <button type="button" data-id="${b.id}" data-do="reverse" ${dis} title="${line.length > 1 ? "Run the whole line the other way" : "Run the other way"}">⇄</button>
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
    if (mode.kind === "extending") {
      hint.textContent = hover
        ? `${Math.round(mode.length * 100)} cm. Click, or release the mouse, to add it. Esc cancels.`
        : "Move the mouse along the line, or hold the button and drag. Esc cancels.";
      return;
    }
    const verb = mode.kind === "placing" ? "place it" : "move it there";
    hint.textContent = hover
      ? `x ${(hover.x * 100).toFixed(0)} cm, z ${(hover.z * 100).toFixed(0)} cm. Click to ${verb}.`
      : `Click the floor to ${verb}. Esc cancels.`;
  }

  render();
  void load();

  return {
    layer, update, isActive, isExtending, handleClick, handleHover, handlePick, hoversBelt, handleKey,
    get running() {
      return !!bodies;
    },
    /** The belts as last loaded. */
    get belts(): readonly Conveyor[] {
      return belts;
    },
    /** Called with the new list whenever the belts are (re)loaded. */
    onBeltsChange(fn: (belts: readonly Conveyor[]) => void) {
      listeners.push(fn);
    },
    /** Re-read the belts now (after something else moved them, such as snapping feeders into place). */
    reload: load,
    /** The mergers and machines plug in here. */
    setLine(next: Line) {
      line = next;
    },
    /** The splitters plug in here. */
    setGates(next: Gates) {
      gates = next;
    },
    /** main.ts passes a function that switches the side panel to this tab. */
    onShowTab(fn: () => void) {
      showTab = fn;
    },
  };
}

const cm = (m: number) => Math.round(m * 100);

/** A new line's id. crypto.randomUUID needs a secure page (localhost is one); this covers the rest. */
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
