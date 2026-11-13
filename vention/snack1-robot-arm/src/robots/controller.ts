/**
 * The Robots tab, and the robots at work.
 *
 * A robot is an extra arm on the floor with a pick zone and rules. It works all the time:
 * whenever an item it can lift is in its zone and a rule (or "anything else") says where it
 * goes, it plans the move with the same planner as the main arm's Pick (in its own frame,
 * cell.ts), and does it:
 *
 * - Belts running: the item is held still while the gripper comes down, taken off the belts,
 *   and put down where it lands on whatever is there (a belt carries it on; a bin catches it).
 *   Positions are saved when the belts stop, like everything else in a run.
 * - Belts stopped: the same moves, and each item's new place is saved as it's put down (or
 *   it's stored, for a bin).
 *
 * Items a robot can't take (out of reach, too wide, no rule) are left alone until they move.
 * Anything the person does that changes the scene (run, stop, editing the robot) cancels a
 * move in progress: what it was holding goes back where it was.
 */
import * as THREE from "three";
import { ARM, JOINTS } from "../arm/jointSpecs";
import { supportHeight } from "../conveyors/transport";
import type { createConveyors } from "../conveyors/controller";
import type { createLine } from "../line/controller";
import type { createShapes } from "../shapes/controller";
import { binsApi, robotsApi, splittersApi, ShapesApiError } from "../shapes/api";
import { MIN_REACH_RADIUS } from "../shapes/reach";
import { onFloor } from "../scene/floor";
import { planPickPlace, ProgramPlayer, type ArmState } from "../pick/program";
import type { Part } from "../splitters/rules";
import { conditionRow, editCondition, esc } from "../splitters/conditions";
import type { Condition } from "../splitters/types";
import { decide, describeTarget, inZone, placeFor, toLocal, toWorld, type Drop } from "./cell";
import { RobotLayer, ROBOT_REACH } from "./RobotLayer";
import type { Robot, RobotRule, Target } from "./types";

const POLL_MS = 4000;
const SCAN_EVERY = 0.25; // seconds between looks at the pick zone
const MAX_ROBOTS = 12;

interface Options {
  root: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  shapes: ReturnType<typeof createShapes>;
  conveyors: ReturnType<typeof createConveyors>;
  line: ReturnType<typeof createLine>;
  /** The shape the main arm is busy with, if any: robots leave it alone. */
  mainArmShape: () => string | null;
  gripperUrl: string;
}

type Mode =
  | { kind: "idle" }
  | { kind: "placing" }
  | { kind: "moving"; id: string }
  | { kind: "zone"; id: string }
  /** Clicking a rule's spot: r is the rule's index, or -1 for "anything else". */
  | { kind: "spot"; r: number };

interface Job {
  player: ProgramPlayer;
  shapeId: string;
  from: { x: number; z: number };
  drop: Drop;
  target: Target;
  rotationY: number;
  holding: boolean;
  /** While running: frozen on its belt (until grabbed) or taken off the belts. */
  frozen: boolean;
  taken: boolean;
}

interface Runtime {
  job: Job | null;
  wait: number;
  status: string;
  /** Items it put down: not picked again while they're still in its zone. */
  placed: Set<string>;
  /** Items it can't take, and where they were: tried again once they've moved. */
  refused: Map<string, { x: number; z: number }>;
}

type Editable = { pick: Robot["pick"]; rules: RobotRule[]; otherwise: Target | null };

export function createRobots(o: Options) {
  const { root, scene, camera, canvas, shapes, conveyors, line } = o;
  const layer = new RobotLayer();
  layer.setGripperUrl(o.gripperUrl);
  scene.add(layer.root);

  let robots: Robot[] = [];
  let parts: Part[] = [];
  let online = false;
  let busy = false;
  let message: { text: string; error: boolean } | null = null;
  let selected: string | null = null;
  let edit: Editable | null = null;
  let dirty = false;
  let mode: Mode = { kind: "idle" };
  let hover: { x: number; z: number } | null = null;
  const draft = { name: "", rotationY: 0 };
  const runtime = new Map<string, Runtime>();
  /** Items some robot is working on, so two robots never go for the same one. */
  const claimed = new Set<string>();
  let scanTimer = 0;

  // ---- API ----

  async function load() {
    try {
      const [list, ps] = await Promise.all([robotsApi.list(), splittersApi.parts()]);
      online = true;
      // A robot whose place or zone changed elsewhere drops what it's doing.
      for (const r of list) {
        const old = robots.find((x) => x.id === r.id);
        if (old && old.updatedAt !== r.updatedAt) cancel(r.id, "Changed: starting over.");
      }
      for (const id of runtime.keys()) if (!list.some((r) => r.id === id)) cancel(id, "");
      robots = list;
      parts = ps;
      for (const r of robots) if (!runtime.has(r.id)) runtime.set(r.id, { job: null, wait: 0, status: "Watching its pick zone.", placed: new Set(), refused: new Map() });
      for (const id of [...runtime.keys()]) if (!robots.some((r) => r.id === id)) runtime.delete(id);
      layer.sync(robots);
      if (selected && !robots.some((r) => r.id === selected)) select(null);
      else if (selected && !dirty) edit = editable(robots.find((r) => r.id === selected)!);
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
    if (mode.kind === "idle" && !busy) void load();
  }, POLL_MS);

  // Starting or stopping the belts changes where every item is: drop what's in hand.
  conveyors.onRunChange(() => {
    for (const id of runtime.keys()) cancel(id, "");
  });

  // ---- At work ----

  /** Every free item, where it is and the height of what it stands on. */
  function items(): { id: string; x: number; z: number; y: number }[] {
    const belts = conveyors.belts;
    const joinedTo = new Set(shapes.shapes.filter((s) => s.attachedTo).map((s) => s.attachedTo!));
    const free = (id: string) => !joinedTo.has(id);
    if (conveyors.running) {
      // Only items resting on something, not falling.
      return conveyors.items().filter((b) => free(b.id) && Math.abs(b.y - supportHeight(belts, b.x, b.z, b.y + 1e-3)) < 1e-3);
    }
    return shapes.shapes
      .filter((s) => !s.attachedTo && !s.binId && free(s.id))
      .map((s) => ({ id: s.id, x: s.position.x, z: s.position.z, y: supportHeight(belts, s.position.x, s.position.z) }));
  }

  function pendingDrops(): { x: number; z: number }[] {
    return [...runtime.values()].flatMap((rt) => (rt.job ? [rt.job.drop] : []));
  }

  function update(dt: number) {
    scanTimer -= dt;
    const scan = scanTimer <= 0;
    if (scan) scanTimer = SCAN_EVERY;
    let all: ReturnType<typeof items> | null = null;
    for (const r of robots) {
      const rt = runtime.get(r.id);
      const view = layer.view(r.id);
      if (!rt || !view?.gripper) continue;
      if (rt.job) {
        work(r, rt, dt);
        continue;
      }
      rt.wait -= dt;
      if (!scan || rt.wait > 0 || (mode.kind !== "idle" && "id" in mode && mode.id === r.id)) continue;
      all ??= items();
      look(r, rt, all);
    }
  }

  /** Looks at the pick zone and starts on the first item it can take. */
  function look(r: Robot, rt: Runtime, all: ReturnType<typeof items>) {
    const busyShape = o.mainArmShape();
    const zone = all.filter((it) => inZone(r, it.x, it.z));
    for (const id of rt.placed) if (!zone.some((it) => it.id === id)) rt.placed.delete(id);
    for (const [id, at] of rt.refused) {
      const now = all.find((it) => it.id === id);
      if (!now || Math.hypot(now.x - at.x, now.z - at.z) > 0.02) rt.refused.delete(id);
    }
    const shown = zone.length ? zone[0].y : 0;
    layer.setZoneHeight(r.id, shown);

    let waiting = "";
    for (const it of zone) {
      if (claimed.has(it.id) || rt.placed.has(it.id) || rt.refused.has(it.id) || it.id === busyShape) continue;
      const shape = shapes.shapes.find((s) => s.id === it.id);
      if (!shape) continue;
      const choice = decide(r, shape, shape.sku ? parts.find((p) => p.sku === shape.sku) : undefined);
      if (!choice) {
        rt.refused.set(it.id, { x: it.x, z: it.z });
        rt.status = `Leaving ${shape.name}: no rule for it.`;
        continue;
      }
      const where = placeFor(choice.target, {
        belts: conveyors.belts, bins: line.bins,
        items: all.filter((x) => x.id !== it.id), pending: pendingDrops(),
      });
      if (!where.ok) {
        if (where.wait) waiting = `${shape.name}: ${where.reason}.`;
        else {
          rt.refused.set(it.id, { x: it.x, z: it.z });
          rt.status = `Can't move ${shape.name}: ${where.reason}.`;
        }
        continue;
      }
      // Plan in the robot's own frame, as if it were the main arm at the origin.
      const local = toLocal(r, it);
      const plan = planPickPlace(ARM, JOINTS, {
        shape: { ...shape, position: local, rotationY: shape.rotationY - r.rotationY },
        fromBaseY: it.y, to: toLocal(r, where.drop), toBaseY: where.drop.baseY, turn: 0,
      });
      if (!plan.ok) {
        rt.refused.set(it.id, { x: it.x, z: it.z });
        rt.status = plan.reason;
        continue;
      }
      const view = layer.view(r.id)!;
      const state: ArmState = { joints: [...view.arm.anglesDeg], gap: view.gripper!.gap };
      const running = conveyors.running;
      if (running) conveyors.freeze(it.id, true);
      claimed.add(it.id);
      rt.job = {
        player: new ProgramPlayer(ARM, JOINTS, plan.steps, state), shapeId: it.id, from: { x: it.x, z: it.z },
        drop: where.drop, target: choice.target, rotationY: plan.rotationY + r.rotationY, holding: false, frozen: running, taken: false,
      };
      rt.status = `Moving ${shape.name} to ${describeTarget(choice.target, conveyors.belts, line.bins)}${choice.rule >= 0 ? ` (rule ${choice.rule + 1})` : ""}.`;
      renderList();
      return;
    }
    if (waiting) rt.status = `Waiting: ${waiting}`;
    else if (!zone.some((it) => !rt.refused.has(it.id) && !rt.placed.has(it.id))) rt.status = rt.refused.size ? rt.status : "Watching its pick zone.";
    renderList();
  }

  /** One frame of a move: drive the arm, and grab or let go when the program says. */
  function work(r: Robot, rt: Runtime, dt: number) {
    const job = rt.job!;
    const view = layer.view(r.id)!;
    const gripper = view.gripper!;
    const state: ArmState = { joints: [...view.arm.anglesDeg], gap: gripper.gap };
    const events = job.player.update(dt, state);
    state.joints.forEach((a, i) => view.arm.setAngle(i, a));
    gripper.setGap(state.gap);
    for (const event of events) {
      if (event === "grab") {
        shapes.layer.hold(job.shapeId, gripper.object);
        job.holding = true;
        if (conveyors.running) {
          conveyors.take(job.shapeId);
          job.taken = true;
          job.frozen = false;
        }
      } else if (event === "release") {
        shapes.layer.release(job.shapeId);
        job.holding = false;
        putDown(rt, job);
      } else if (event === "done") {
        claimed.delete(job.shapeId);
        rt.job = null;
        rt.wait = 0.2;
        rt.status = "Watching its pick zone.";
        renderList();
        return;
      } else if (event === "error") {
        cancel(r.id, job.player.error ?? "The robot stopped.");
        return;
      }
    }
  }

  function putDown(rt: Runtime, job: Job) {
    rt.placed.add(job.shapeId);
    if (conveyors.running) {
      // It lands on whatever is there: a belt carries it on, a bin catches it.
      conveyors.put(job.shapeId, job.drop.x, job.drop.z);
      job.taken = false;
      return;
    }
    const target = job.target;
    void (async () => {
      await shapes.placeShape(job.shapeId, job.drop, job.rotationY);
      if (target.type === "bin") {
        try {
          await binsApi.catch(target.binId, job.shapeId);
        } catch (err) {
          message = { text: `${shapes.shapes.find((s) => s.id === job.shapeId)?.name ?? "An item"} wasn't stored: ${(err as Error).message}`, error: true };
          render();
        }
        await Promise.all([shapes.reload(), line.reload()]);
      }
    })();
  }

  /** Stops a robot's move: what it was holding goes back where it was. */
  function cancel(id: string, reason: string) {
    const rt = runtime.get(id);
    const job = rt?.job;
    if (!rt || !job) return;
    rt.job = null;
    claimed.delete(job.shapeId);
    if (job.holding) shapes.layer.release(job.shapeId);
    if (job.taken) conveyors.put(job.shapeId, job.from.x, job.from.z);
    if (job.frozen) conveyors.freeze(job.shapeId, false);
    if (!conveyors.running) shapes.refresh();
    const view = layer.view(id);
    if (view) JOINTS.forEach((spec, i) => view.arm.setAngle(i, spec.home));
    rt.wait = 0.5;
    if (reason) rt.status = reason;
    renderList();
  }

  // ---- Editing ----

  function editable(r: Robot): Editable {
    return { pick: { ...r.pick }, rules: structuredClone(r.rules), otherwise: r.otherwise ? { ...r.otherwise } : null };
  }

  function select(id: string | null) {
    selected = id;
    dirty = false;
    edit = id ? editable(robots.find((r) => r.id === id)!) : null;
    layer.select(id);
    render();
  }

  function save() {
    if (!selected || !edit) return;
    const id = selected;
    const patch = { pick: edit.pick, rules: edit.rules, otherwise: edit.otherwise };
    cancel(id, "");
    dirty = false;
    void act(() => robotsApi.update(id, patch), "Saved.");
  }

  function defaultTarget(): Target {
    const r = robots.find((x) => x.id === selected)!;
    // In front of the robot and to its left, a little apart from the zone.
    const p = toWorld(r, { x: 0.15, z: -0.55 });
    return { type: "spot", x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
  }

  function targetOf(r: number): Target | null {
    return r === -1 ? edit!.otherwise : edit!.rules[r]?.target ?? null;
  }

  function setTarget(r: number, t: Target | null) {
    if (r === -1) edit!.otherwise = t;
    else if (t) edit!.rules[r].target = t;
  }

  function newTarget(type: string, r: number): Target | null {
    const belt = conveyors.belts.find((b) => b.kind === "straight");
    const bin = line.bins[0];
    if (type === "spot") return targetOf(r)?.type === "spot" ? targetOf(r) : defaultTarget();
    if (type === "belt" && belt) return { type: "belt", conveyorId: belt.id, along: Math.min(0.2, belt.length) };
    if (type === "bin" && bin) return { type: "bin", binId: bin.id };
    if (type === "none") return null;
    message = { text: type === "belt" ? "Add a straight belt first." : "Add a bin first.", error: true };
    return targetOf(r);
  }

  function changed(relayout = false) {
    dirty = true;
    if (relayout) renderEditor(true);
    renderButtons();
    layer.sync(robots.map((r) => (r.id === selected && edit ? { ...r, ...edit } : r)));
  }

  // ---- Pointer ----

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  function aim(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  function floorPoint(e: PointerEvent): { x: number; z: number } | null {
    aim(e);
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
    const p = { x: Math.round(hit.x * 100) / 100, z: Math.round(hit.z * 100) / 100 };
    return onFloor(p.x, p.z, 0.2) ? p : null;
  }

  const isActive = () => mode.kind !== "idle";

  function handleHover(e: PointerEvent): boolean {
    if (mode.kind === "idle") return false;
    hover = floorPoint(e);
    if (mode.kind === "placing" || mode.kind === "moving") {
      const r = mode.kind === "moving" ? robots.find((x) => x.id === (mode as { id: string }).id) : null;
      layer.showGhost(hover, r?.rotationY ?? draft.rotationY);
    }
    canvas.style.cursor = hover ? "crosshair" : "not-allowed";
    renderHint();
    return true;
  }

  function handleClick(e: PointerEvent): boolean {
    if (mode.kind === "idle") return false;
    const at = floorPoint(e);
    if (!at) return true;
    const m = mode;
    setMode({ kind: "idle" });
    if (m.kind === "placing") {
      const name = draft.name.trim() || `Robot ${robots.length + 1}`;
      void act(async () => {
        const r = await robotsApi.create({ name, position: at, rotationY: draft.rotationY, rules: [], otherwise: null });
        selected = r.id;
      }, `Added ${name}. Now give it rules: what to pick up, and where each goes.`).then(() => select(selected));
    } else if (m.kind === "moving") {
      const r = robots.find((x) => x.id === m.id);
      if (!r) return true;
      // The pick zone moves with the robot.
      const pick = { ...r.pick, x: r.pick.x + at.x - r.position.x, z: r.pick.z + at.z - r.position.z };
      cancel(r.id, "");
      void act(() => robotsApi.update(r.id, { position: at, pick }), `Moved ${r.name}.`);
    } else if (m.kind === "zone" && edit) {
      edit.pick = { ...edit.pick, x: at.x, z: at.z };
      changed(true);
    } else if (m.kind === "spot" && edit) {
      setTarget(m.r, { type: "spot", x: at.x, z: at.z });
      changed(true);
    }
    return true;
  }

  /** A click on a robot selects it. */
  function handlePick(e: PointerEvent): boolean {
    aim(e);
    const id = layer.pick(raycaster);
    if (!id) return false;
    if (id !== selected && dirty && !confirm("Discard the unsaved changes to this robot's rules?")) return true;
    select(id === selected ? null : id);
    showTab();
    return true;
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && mode.kind !== "idle") {
      setMode({ kind: "idle" });
      return true;
    }
    return false;
  }

  function setMode(next: Mode) {
    mode = next;
    hover = null;
    if (mode.kind === "idle") {
      layer.showGhost(null);
      canvas.style.cursor = "";
    }
    render();
  }

  // ---- The panel ----

  let showTab = () => {};

  root.innerHTML = `
    <section>
      <h2>Add a robot</h2>
      <p class="small-note">An arm that works on its own: it picks up items that arrive in its green circle and puts each one where its rules say.</p>
      <div class="row">
        <label>Name <input type="text" data-draft="name" maxlength="40" placeholder="Automatic"></label>
        <label>Facing ° <input type="number" data-draft="rotationY" min="-360" max="360" step="15"></label>
      </div>
      <button type="button" data-do="place" class="primary wide-btn">Place with mouse</button>
      <p class="hint" hidden></p>
    </section>
    <section>
      <h2>Robots <span class="count"></span></h2>
      <ul class="list robot-list"></ul>
    </section>
    <section class="robot-editor" hidden>
      <h2>Pick zone <small class="for"></small></h2>
      <div class="row">
        <label>Radius cm <input type="number" data-zone="radius" min="5" max="60" step="1"></label>
        <button type="button" data-do="zone">Set with mouse</button>
      </div>
      <p class="small-note zone-note"></p>
      <h2>Rules</h2>
      <p class="small-note">Checked in order: the first rule that fits an item says where it goes.</p>
      <ol class="rules robot-rules"></ol>
      <button type="button" data-do="add-rule" class="wide-btn">+ Add rule</button>
      <div class="otherwise-row"></div>
      <div class="actions">
        <button type="button" data-do="save" class="primary">Save rules</button>
        <button type="button" data-do="revert">Revert</button>
      </div>
    </section>
    <p class="status" role="status" hidden></p>`;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const list = $("ul.robot-list");
  const editor = $("section.robot-editor");
  const rulesEl = $("ol.robot-rules");
  const otherwiseEl = $("div.otherwise-row");
  const status = $("p.status");
  const hint = $("p.hint");
  const placeBtn = $<HTMLButtonElement>('[data-do="place"]');

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.draft === "name") draft.name = el.value;
    else if (el.dataset.draft === "rotationY") draft.rotationY = Number(el.value || 0);
    if (el.dataset.draft || !edit) return;
    if (el.dataset.zone === "radius") {
      const cm = Number(el.value);
      if (cm >= 5 && cm <= 60) {
        edit.pick = { ...edit.pick, radius: cm / 100 };
        changed();
      }
      return;
    }
    // A target: data-t is the rule (-1 for anything else), data-tk what's changed.
    if (el.dataset.t !== undefined) {
      const r = Number(el.dataset.t);
      const t = targetOf(r);
      if (el.dataset.tk === "type") {
        setTarget(r, newTarget(el.value, r));
        return changed(true);
      }
      if (t?.type === "belt" && el.dataset.tk === "belt") t.conveyorId = el.value;
      if (t?.type === "belt" && el.dataset.tk === "along") t.along = Math.max(0, Number(el.value || 0) / 100);
      if (t?.type === "bin" && el.dataset.tk === "bin") t.binId = el.value;
      return changed();
    }
    // A condition: data-rr is the rule, data-c the condition.
    const rule = edit.rules[Number(el.dataset.rr)];
    const cond = rule?.conditions[Number(el.dataset.c)];
    if (!cond) return;
    changed(editCondition(cond, el.dataset.k, el.value));
  });

  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!btn || !root.contains(btn)) return;
    const id = btn.dataset.id;
    switch (btn.dataset.do) {
      case "place":
        return setMode(mode.kind === "placing" ? { kind: "idle" } : { kind: "placing" });
      case "pick":
        if (id !== selected && dirty && !confirm("Discard the unsaved changes to this robot's rules?")) return;
        return select(id === selected ? null : id!);
      case "move":
        return setMode(mode.kind === "moving" && mode.id === id ? { kind: "idle" } : { kind: "moving", id: id! });
      case "turn": {
        const r = robots.find((x) => x.id === id)!;
        cancel(r.id, "");
        return void act(() => robotsApi.update(r.id, { rotationY: ((r.rotationY + 90 + 180) % 360) - 180 }), `Turned ${r.name}.`);
      }
      case "delete": {
        const r = robots.find((x) => x.id === id)!;
        cancel(r.id, "");
        if (selected === id) select(null);
        return void act(() => robotsApi.remove(r.id), `Deleted ${r.name}.`);
      }
    }
    if (!edit) return;
    const r = Number(btn.dataset.rr);
    switch (btn.dataset.do) {
      case "zone":
        return setMode(mode.kind === "zone" ? { kind: "idle" } : { kind: "zone", id: selected! });
      case "spot": {
        const t = Number(btn.dataset.t);
        return setMode(mode.kind === "spot" && mode.r === t ? { kind: "idle" } : { kind: "spot", r: t });
      }
      case "add-rule":
        if (edit.rules.length >= 10) return;
        edit.rules.push({ conditions: [{ field: "kind", op: "eq", value: "box" }], target: defaultTarget() });
        return changed(true);
      case "add-cond":
        if (edit.rules[r].conditions.length < 5) edit.rules[r].conditions.push({ field: "color", op: "eq", value: "#e11d48" } as Condition);
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
        edit = editable(robots.find((x) => x.id === selected)!);
        layer.sync(robots);
        return render();
    }
  });

  function render() {
    const nameIn = $<HTMLInputElement>('[data-draft="name"]');
    const rotIn = $<HTMLInputElement>('[data-draft="rotationY"]');
    if (document.activeElement !== nameIn) nameIn.value = draft.name;
    if (document.activeElement !== rotIn) rotIn.value = String(draft.rotationY);
    placeBtn.textContent = mode.kind === "placing" ? "Cancel placing" : "Place with mouse";
    placeBtn.setAttribute("aria-pressed", String(mode.kind === "placing"));
    placeBtn.disabled = !online || busy || robots.length >= MAX_ROBOTS;
    renderList();
    editor.hidden = !edit;
    if (edit) renderEditor();
    status.hidden = !message;
    status.textContent = message?.text ?? "";
    status.classList.toggle("error", !!message?.error);
    renderHint();
  }

  function renderList() {
    $("span.count").textContent = robots.length ? `(${robots.length})` : "";
    const html = robots.length === 0
      ? `<li class="empty">${online ? "No robots yet. Place one with the mouse." : "Start the inventory API to add robots."}</li>`
      : robots.map((r) => {
          const rt = runtime.get(r.id);
          const moving = mode.kind === "moving" && mode.id === r.id;
          return `<li class="${r.id === selected ? "selected" : ""}">
            <button type="button" class="pick" data-do="pick" data-id="${r.id}" aria-pressed="${r.id === selected}">
              <span class="swatch robot-swatch"></span>
              <span class="label"><strong>${esc(r.name)}</strong>
                <small>${r.rules.length} rule${r.rules.length === 1 ? "" : "s"}${r.otherwise ? ", anything else moved" : ""} · facing ${Math.round(r.rotationY)}°</small>
                <small class="robot-status">${esc(rt?.status ?? "")}</small></span>
            </button>
            <span class="row-actions">
              <button type="button" data-do="move" data-id="${r.id}" aria-pressed="${moving}">${moving ? "Cancel" : "Move"}</button>
              <button type="button" data-do="turn" data-id="${r.id}" title="Turn 90°">↻ 90°</button>
              <button type="button" data-do="delete" data-id="${r.id}" title="Delete">✕</button>
            </span>
          </li>`;
        }).join("");
    if (list.innerHTML !== html) list.innerHTML = html;
  }

  function targetRow(t: Target | null, r: number): string {
    const type = t?.type ?? "none";
    const opts = [["spot", "a spot on the floor"], ["belt", "a belt"], ["bin", "a bin"], ...(r === -1 ? [["none", "leave it"]] : [])]
      .map(([v, l]) => `<option value="${v}" ${v === type ? "selected" : ""}>${l}</option>`).join("");
    let more = "";
    if (t?.type === "spot") {
      const picking = mode.kind === "spot" && mode.r === r;
      more = `<span class="at">(${Math.round(t.x * 100)}, ${Math.round(t.z * 100)}) cm</span>
        <button type="button" data-do="spot" data-t="${r}" aria-pressed="${picking}">${picking ? "Cancel" : "Set"}</button>`;
    } else if (t?.type === "belt") {
      const belts = conveyors.belts.filter((b) => b.kind === "straight");
      more = `<select data-t="${r}" data-tk="belt" aria-label="Belt">${belts.map((b) => `<option value="${b.id}" ${b.id === t.conveyorId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
        <label class="inline">at <input type="number" data-t="${r}" data-tk="along" min="0" max="400" step="5" value="${Math.round(t.along * 100)}"> cm</label>`;
    } else if (t?.type === "bin") {
      more = `<select data-t="${r}" data-tk="bin" aria-label="Bin">${line.bins.map((b) => `<option value="${b.id}" ${b.id === t.binId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>`;
    }
    return `<div class="target"><label>${r === -1 ? "anything else:" : "put it on"} <select data-t="${r}" data-tk="type" aria-label="Where it goes">${opts}</select></label>${more}</div>`;
  }

  /** `force` rebuilds the rules even with focus in them (after a change that alters their layout). */
  function renderEditor(force = false) {
    if (!edit || !selected) return;
    const r = robots.find((x) => x.id === selected)!;
    $("small.for").textContent = `for ${r.name}`;
    const radius = $<HTMLInputElement>('[data-zone="radius"]');
    if (document.activeElement !== radius) radius.value = String(Math.round(edit.pick.radius * 100));
    const zoneBtn = $<HTMLButtonElement>('[data-do="zone"]');
    zoneBtn.textContent = mode.kind === "zone" ? "Cancel" : "Set with mouse";
    zoneBtn.setAttribute("aria-pressed", String(mode.kind === "zone"));
    const d = Math.hypot(toLocal(r, edit.pick).x, toLocal(r, edit.pick).z);
    $("p.zone-note").textContent = d > ROBOT_REACH - 0.05
      ? `⚠ The middle of the zone is ${Math.round(d * 100)} cm from the robot: too far to reach (about ${Math.round(ROBOT_REACH * 100)} cm at most).`
      : d < MIN_REACH_RADIUS ? "⚠ The zone is too close to the robot's base to reach." : `${Math.round(d * 100)} cm from the robot. It reaches about ${Math.round(ROBOT_REACH * 100)} cm (the blue ring).`;
    if (!force && document.activeElement && rulesEl.contains(document.activeElement) && document.activeElement.tagName !== "BUTTON") {
      // Typing in a rule: don't rebuild the row under the cursor.
    } else {
      rulesEl.innerHTML = edit.rules.length === 0
        ? `<li class="empty">No rules yet: add one, or move "anything else" below.</li>`
        : edit.rules.map((rule, i) => `
          <li class="rule">
            <div class="rule-head">
              <span class="rule-n">${i + 1}</span>
              <span class="rule-moves">
                <button type="button" data-do="up" data-rr="${i}" ${i === 0 ? "disabled" : ""} title="Check earlier">↑</button>
                <button type="button" data-do="down" data-rr="${i}" ${i === edit!.rules.length - 1 ? "disabled" : ""} title="Check later">↓</button>
                <button type="button" data-do="del-rule" data-rr="${i}" title="Delete rule">✕</button>
              </span>
            </div>
            ${rule.conditions.map((c, j) => conditionRow(c, i, j, "data-rr")).join("")}
            <div class="rule-foot"><button type="button" data-do="add-cond" data-rr="${i}" ${rule.conditions.length >= 5 ? "disabled" : ""}>+ and</button></div>
            ${targetRow(rule.target, i)}
          </li>`).join("");
    }
    if (force || !otherwiseEl.contains(document.activeElement) || document.activeElement?.tagName === "BUTTON") otherwiseEl.innerHTML = targetRow(edit.otherwise, -1);
    $<HTMLButtonElement>('[data-do="add-rule"]').disabled = edit.rules.length >= 10;
    renderButtons();
  }

  function renderButtons() {
    const save = $<HTMLButtonElement>('[data-do="save"]');
    save.disabled = !dirty || busy || !online;
    save.textContent = dirty ? "Save rules" : "Saved";
    $<HTMLButtonElement>('[data-do="revert"]').disabled = !dirty || busy;
  }

  function renderHint() {
    hint.hidden = mode.kind === "idle";
    const where = hover ? ` (${Math.round(hover.x * 100)}, ${Math.round(hover.z * 100)}) cm.` : "";
    const text: Record<Mode["kind"], string> = {
      idle: "",
      placing: "Click the floor where the robot stands.",
      moving: "Click the floor where it should go; its pick zone moves with it.",
      zone: "Click where it should pick from: the end of a belt, say.",
      spot: "Click the spot where these items go.",
    };
    hint.textContent = `${text[mode.kind]}${where} Esc cancels.`;
  }

  render();
  void load();

  return {
    layer, update, isActive, handleClick, handleHover, handlePick, handleKey,
    reload: load,
    /** Drops every move in progress (the scene is about to be cleared). */
    cancelAll() {
      for (const id of runtime.keys()) cancel(id, "");
    },
    onShowTab(fn: () => void) {
      showTab = fn;
    },
  };
}
