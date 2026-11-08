/**
 * Edits connection points for the selected shape's kind of object: every shape of that inventory
 * part (or every plain shape of that kind) shares them. Points show as markers on every such
 * shape in the scene; type positions as percentages of the size, or click on the object to put
 * a point where you clicked.
 */
import * as THREE from "three";
import { lineApi, ShapesApiError } from "../shapes/api";
import type { createShapes } from "../shapes/controller";
import type { Shape } from "../shapes/types";
import { ownerOf, pointsFor } from "./joints";
import type { ConnectionPoint, Connectors, Owner } from "./types";

type Shapes = ReturnType<typeof createShapes>;

const MARKER = new THREE.SphereGeometry(1, 16, 12);

interface Options {
  shapes: Shapes;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  /** The stored points, owned by the line controller (which reloads them). */
  connectors: () => readonly Connectors[];
  reload: () => Promise<void>;
}

export function createPointEditor({ shapes, camera, canvas, connectors, reload }: Options) {
  const root = shapes.pointsHost;
  let owner: Owner | null = null;
  let draft: ConnectionPoint[] = [];
  let dirty = false;
  let picking = false;
  let active = -1; // the highlighted point
  let busy = false;
  let message: { text: string; error: boolean } | null = null;
  const markers: THREE.Object3D[] = [];

  const selectedShape = (): Shape | undefined => shapes.shapes.find((s) => s.id === shapes.selectedId);

  shapes.onSelect(() => {
    const s = selectedShape();
    const next = s ? ownerOf(s) : null;
    if (next !== owner) {
      if (dirty && owner && !window.confirm("Discard your unsaved connection point changes?")) return;
      owner = next;
      resetDraft();
    }
    render();
  });

  function resetDraft() {
    draft = owner ? structuredClone([...pointsFor(owner, connectors())]) : [];
    dirty = false;
    active = draft.length ? 0 : -1;
    picking = false;
    message = null;
  }

  /** After a reload: show the saved points unless the person is editing. */
  function refresh() {
    if (owner && !dirty) resetDraft();
    // Never rebuild the rows under someone's cursor; the markers can always be redrawn.
    if (root.contains(document.activeElement)) refreshMarkers();
    else render();
  }

  async function act(work: () => Promise<unknown>, success: string) {
    busy = true;
    render();
    try {
      await work();
      dirty = false;
      await reload();
      resetDraft();
      message = { text: success, error: false };
    } catch (err) {
      const e = err as ShapesApiError;
      message = { text: e.problems?.length ? e.problems.join("; ") : e.message, error: true };
    } finally {
      busy = false;
      render();
    }
  }

  // ---- Markers on every object of this kind ----

  function refreshMarkers() {
    for (const m of markers) m.parent?.remove(m);
    markers.length = 0;
    if (!owner) return;
    for (const s of shapes.shapes) {
      if (ownerOf(s) !== owner) continue;
      const mesh = shapes.layer.meshOf(s.id);
      if (!mesh) continue;
      const r = Math.max(0.008, Math.min(0.02, Math.max(s.size.x, s.size.y, s.size.z) * 0.06));
      draft.forEach((p, i) => {
        const on = i === active;
        const marker = new THREE.Mesh(MARKER, new THREE.MeshBasicMaterial({ color: on ? 0xf97316 : 0x22d3ee, depthTest: false, transparent: true }));
        // Mesh geometry is centered on the object, in meters, so a point is just its fractions times the size.
        marker.position.set(p.x * s.size.x, p.y * s.size.y, p.z * s.size.z);
        marker.scale.setScalar(on ? r * 1.5 : r);
        marker.renderOrder = 10; // drawn over the object, so points on the far side show too
        mesh.add(marker);
        markers.push(marker);
      });
    }
  }

  // ---- Clicking on the object to place a point ----

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function handleClick(e: PointerEvent): boolean {
    if (!picking || !owner) return false;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const candidates = shapes.shapes.filter((s) => ownerOf(s) === owner).map((s) => ({ s, mesh: shapes.layer.meshOf(s.id) })).filter((c) => c.mesh);
    const hit = raycaster.intersectObjects(candidates.map((c) => c.mesh!), false)[0];
    if (!hit) return true; // keep picking until the object is clicked
    const s = candidates.find((c) => c.mesh === hit.object)!.s;
    // The hit in the object's own frame, as fractions of its size.
    const local = (hit.object as THREE.Mesh).worldToLocal(hit.point.clone());
    const frac = (v: number, size: number) => Math.round(Math.max(-0.5, Math.min(0.5, v / size)) * 100) / 100;
    draft.push({ name: nextName(), x: frac(local.x, s.size.x), y: frac(local.y, s.size.y), z: frac(local.z, s.size.z) });
    active = draft.length - 1;
    dirty = true;
    picking = false;
    canvas.style.cursor = "";
    render();
    return true;
  }

  function handleHover(): boolean {
    if (!picking) return false;
    canvas.style.cursor = "copy";
    return true;
  }

  function nextName() {
    for (let i = draft.length + 1; ; i++) if (!draft.some((p) => p.name === `point ${i}`)) return `point ${i}`;
  }

  // ---- The panel ----

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const i = Number(el.dataset.i);
    const p = draft[i];
    if (!p) return;
    if (el.dataset.k === "name") p.name = el.value;
    else if (el.value !== "") p[el.dataset.k as "x" | "y" | "z"] = Math.max(-0.5, Math.min(0.5, Number(el.value) / 100));
    dirty = true;
    active = i;
    refreshMarkers();
    renderButtons();
  });

  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-do]");
    if (!btn || !owner) return;
    const i = Number(btn.dataset.i);
    switch (btn.dataset.do) {
      case "focus":
        active = i;
        return render();
      case "remove":
        draft.splice(i, 1);
        active = Math.min(active, draft.length - 1);
        dirty = true;
        return render();
      case "add":
        draft.push({ name: nextName(), x: 0, y: 0.5, z: 0 });
        active = draft.length - 1;
        dirty = true;
        return render();
      case "pick":
        picking = !picking;
        return render();
      case "save": {
        const o = owner;
        const points = draft.map((p) => ({ ...p, name: p.name.trim() }));
        return void act(() => lineApi.setPoints(o, points), "Connection points saved for every object of this kind.");
      }
      case "undo":
        resetDraft();
        return render();
      case "defaults": {
        const o = owner;
        const stored = connectors().some((c) => c.owner === o);
        if (!stored) {
          resetDraft();
          return render();
        }
        return void act(() => lineApi.resetPoints(o), "Back to the default points: top and bottom.");
      }
    }
  });

  function render() {
    const s = selectedShape();
    root.hidden = !s || !owner;
    refreshMarkers();
    if (!s || !owner) return;
    const who = s.sku ? `every ${s.sku} (${esc(s.name)})` : `every plain ${s.kind}`;
    const stored = connectors().some((c) => c.owner === owner);
    root.innerHTML = `
      <h2>Connection points</h2>
      <p class="rules-help">Shared by ${who}${stored ? "" : " · using the defaults"}. Positions are % of the size from the center: x, z sideways, y = 50 is the top.</p>
      <ol class="points">
        ${draft.map((p, i) => `
          <li class="${i === active ? "on" : ""}">
            <button type="button" class="dot" data-do="focus" data-i="${i}" aria-label="Highlight ${esc(p.name)}"></button>
            <input type="text" value="${esc(p.name)}" maxlength="20" data-k="name" data-i="${i}" aria-label="Name">
            ${(["x", "y", "z"] as const).map((k) => `<input type="number" step="5" min="-50" max="50" value="${Math.round(p[k] * 100)}" data-k="${k}" data-i="${i}" aria-label="${k} %">`).join("")}
            <button type="button" data-do="remove" data-i="${i}" title="Remove" aria-label="Remove ${esc(p.name)}">−</button>
          </li>`).join("") || `<li class="empty">No points: this kind can't be joined.</li>`}
      </ol>
      <div class="actions">
        <button type="button" data-do="add">+ Add point</button>
        <button type="button" data-do="pick" aria-pressed="${picking}" class="${picking ? "" : "primary"}">${picking ? "Cancel" : "Click on object"}</button>
      </div>
      <p class="hint" ${picking ? "" : "hidden"}>Click on any ${s.sku ?? s.kind} in the scene to put a point there.</p>
      <div class="actions">
        <button type="button" data-do="save" class="primary">Save points</button>
        <button type="button" data-do="undo">Undo</button>
      </div>
      <button type="button" data-do="defaults" class="wide-btn link-btn">Back to defaults</button>
      <p class="shapes-status ${message?.error ? "error" : ""}" ${message ? "" : "hidden"}>${message ? esc(message.text) : ""}</p>`;
    renderButtons();
  }

  function renderButtons() {
    const save = root.querySelector<HTMLButtonElement>('[data-do="save"]');
    const undo = root.querySelector<HTMLButtonElement>('[data-do="undo"]');
    if (save) {
      save.disabled = !dirty || busy;
      save.textContent = dirty ? "Save points" : "Saved";
    }
    if (undo) undo.disabled = !dirty || busy;
  }

  return { refresh, refreshMarkers, handleClick, handleHover, isActive: () => picking };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
