/**
 * Camera controls on top of OrbitControls: pan along the floor, orbit, zoom, and jump to a
 * top view, the whole scene, or the starting view. Driven by the on-screen pad and the
 * keyboard; the mouse still orbits (drag), pans (right-drag) and zooms (scroll).
 *
 * Panning moves the camera and the point it looks at together, along the floor, in the
 * direction the camera faces, so "forward" always means up the screen. Speeds scale with
 * the distance to that point: zoomed out over a 20 m floor you move fast, close up slowly.
 */
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FLOOR_HALF } from "./floor";

export type ViewAction = "forward" | "back" | "left" | "right" | "orbitLeft" | "orbitRight" | "zoomIn" | "zoomOut";
export type ViewJump = "home" | "top" | "fit";

/** Keys for held actions, and for jumps. Arrows and A/D already jog the arm's joints. */
const KEYS: Record<string, ViewAction> = {
  i: "forward", k: "back", j: "left", l: "right", u: "orbitLeft", o: "orbitRight",
  "=": "zoomIn", "+": "zoomIn", "-": "zoomOut", _: "zoomOut",
};
const JUMP_KEYS: Record<string, ViewJump> = { h: "home", v: "top", f: "fit" };

const PAN_RATE = 0.9; // distances per second
const ORBIT_RATE = 1.4; // radians per second
const ZOOM_RATE = 1.6; // e-folds per second
const JUMP_SECONDS = 0.45;

interface Options {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Where the pad goes. */
  host: HTMLElement;
  /** The objects to frame for "fit": belts, shapes, bins, the arm. */
  bounds: () => THREE.Box3;
  /** Called after the view moves, e.g. so the sun's shadows follow it. */
  onMove?: (target: THREE.Vector3) => void;
}

export function createView({ camera, controls, host, bounds, onMove }: Options) {
  const home = { position: camera.position.clone(), target: controls.target.clone() };
  const held = new Set<ViewAction>();
  let jump: { fromP: THREE.Vector3; toP: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Moves the camera and its target together, keeping the target over the floor. */
  function pan(dx: number, dz: number) {
    const t = controls.target;
    const nx = THREE.MathUtils.clamp(t.x + dx, -FLOOR_HALF, FLOOR_HALF);
    const nz = THREE.MathUtils.clamp(t.z + dz, -FLOOR_HALF, FLOOR_HALF);
    camera.position.x += nx - t.x;
    camera.position.z += nz - t.z;
    t.x = nx;
    t.z = nz;
  }

  function update(dt: number) {
    if (jump) {
      jump.t = Math.min(1, jump.t + dt / JUMP_SECONDS);
      const k = jump.t * jump.t * (3 - 2 * jump.t); // smoothstep
      camera.position.lerpVectors(jump.fromP, jump.toP, k);
      controls.target.lerpVectors(jump.fromT, jump.toT, k);
      if (jump.t >= 1) jump = null;
    } else if (held.size) {
      const has = (a: ViewAction) => (held.has(a) ? 1 : 0);
      offset.subVectors(camera.position, controls.target);
      const distance = offset.length();

      // Along the floor, the way the camera faces (or, looking straight down, up the screen).
      camera.getWorldDirection(forward).setY(0);
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
      forward.normalize();
      right.crossVectors(forward, UP);
      const ahead = has("forward") - has("back");
      const across = has("right") - has("left");
      const step = PAN_RATE * distance * dt;
      if (ahead || across) pan((forward.x * ahead + right.x * across) * step, (forward.z * ahead + right.z * across) * step);

      const turn = has("orbitLeft") - has("orbitRight");
      if (turn) {
        offset.subVectors(camera.position, controls.target).applyAxisAngle(UP, -turn * ORBIT_RATE * dt);
        camera.position.addVectors(controls.target, offset);
      }

      const zoom = has("zoomIn") - has("zoomOut");
      if (zoom) {
        offset.subVectors(camera.position, controls.target);
        const d = THREE.MathUtils.clamp(offset.length() * Math.exp(-zoom * ZOOM_RATE * dt), controls.minDistance, controls.maxDistance);
        camera.position.addVectors(controls.target, offset.setLength(d));
      }
    }
    onMove?.(controls.target);
  }

  function go(position: THREE.Vector3, target: THREE.Vector3) {
    jump = { fromP: camera.position.clone(), toP: position, fromT: controls.target.clone(), toT: target, t: 0 };
  }

  function jumpTo(kind: ViewJump) {
    if (kind === "home") return go(home.position.clone(), home.target.clone());
    if (kind === "top") {
      // Straight down from above the current target, the same distance away (a little more,
      // so the view isn't cramped). A sliver of z keeps "up the screen" well defined.
      const d = Math.max(3, camera.position.distanceTo(controls.target) * 1.2);
      const t = controls.target.clone().setY(0);
      return go(t.clone().add(new THREE.Vector3(0, d, d * 0.001)), t);
    }
    // Fit: everything in view, seen from the current direction.
    const box = bounds();
    if (box.isEmpty()) return go(home.position.clone(), home.target.clone());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(camera.fov) / 2;
    // The side panels cover about half the width on a wide screen: fit into the middle half.
    const visibleAspect = window.innerWidth > 700 ? camera.aspect * 0.5 : camera.aspect;
    const fit = sphere.radius / Math.sin(Math.min(fov, Math.atan(Math.tan(fov) * visibleAspect)));
    const d = THREE.MathUtils.clamp(fit * 1.1, controls.minDistance, controls.maxDistance);
    // From the current direction, but at least 35° above the floor, so far belts aren't edge-on.
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    const minUp = Math.sin(THREE.MathUtils.degToRad(35));
    if (dir.y < minUp) {
      const flat = Math.hypot(dir.x, dir.z) || 1;
      const k = Math.cos(Math.asin(minUp)) / flat;
      dir.set(dir.x * k, minUp, dir.z * k);
    }
    const t = sphere.center.clone();
    t.y = Math.min(t.y, 0.5);
    go(t.clone().addScaledVector(dir, d), t);
  }

  // ---- The pad ----

  host.innerHTML = `
    <div class="view-pad" role="toolbar" aria-label="Camera">
      <div class="pad-grid">
        <button type="button" data-hold="orbitLeft" title="Orbit left (U)" aria-label="Orbit left">⟲</button>
        <button type="button" data-hold="forward" title="Move forward (I)" aria-label="Move forward">▲</button>
        <button type="button" data-hold="orbitRight" title="Orbit right (O)" aria-label="Orbit right">⟳</button>
        <button type="button" data-hold="left" title="Move left (J)" aria-label="Move left">◀</button>
        <button type="button" data-hold="back" title="Move back (K)" aria-label="Move back">▼</button>
        <button type="button" data-hold="right" title="Move right (L)" aria-label="Move right">▶</button>
      </div>
      <div class="pad-col">
        <button type="button" data-hold="zoomIn" title="Zoom in (+)" aria-label="Zoom in">＋</button>
        <button type="button" data-hold="zoomOut" title="Zoom out (−)" aria-label="Zoom out">−</button>
      </div>
      <div class="pad-col">
        <button type="button" data-jump="fit" title="Show everything (F)">Fit</button>
        <button type="button" data-jump="top" title="Look straight down (V)">Top</button>
        <button type="button" data-jump="home" title="Back to the starting view (H)">Home</button>
      </div>
    </div>`;

  // Hold a button to keep moving. Pointer capture keeps the release with the button even if
  // the pointer slides off it.
  host.addEventListener("pointerdown", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-hold]");
    if (!btn) return;
    btn.setPointerCapture(e.pointerId);
    jump = null;
    held.add(btn.dataset.hold as ViewAction);
    btn.classList.add("held");
  });
  const release = (e: PointerEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-hold]");
    if (!btn) return;
    held.delete(btn.dataset.hold as ViewAction);
    btn.classList.remove("held");
  };
  host.addEventListener("pointerup", release);
  host.addEventListener("pointercancel", release);
  host.addEventListener("click", (e) => {
    const kind = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-jump]")?.dataset.jump as ViewJump | undefined;
    if (kind) jumpTo(kind);
  });

  // ---- Keyboard ----

  const keyOf = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

  /** For main.ts's keydown: true if the key moved the camera. */
  function handleKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false; // leave Ctrl + / Ctrl − to the browser
    const key = keyOf(e);
    if (KEYS[key]) {
      jump = null;
      held.add(KEYS[key]);
      return true;
    }
    if (JUMP_KEYS[key] && !e.repeat) {
      jumpTo(JUMP_KEYS[key]);
      return true;
    }
    return false;
  }

  function handleKeyUp(e: KeyboardEvent) {
    const action = KEYS[keyOf(e)];
    if (action) held.delete(action);
  }

  window.addEventListener("blur", () => held.clear());

  return { update, handleKey, handleKeyUp, jumpTo };
}
