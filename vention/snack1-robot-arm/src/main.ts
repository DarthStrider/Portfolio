import * as THREE from "three";
import { ARM, JOINTS, demoGripperOpen, demoTarget } from "./arm/jointSpecs";
import { forwardKinematics } from "./arm/kinematics";
import { Gripper } from "./arm/Gripper";
import { RobotArm } from "./arm/RobotArm";
import { createStage } from "./scene/stage";
import { Trail } from "./scene/Trail";
import { createPanel, type JogDirection } from "./ui/panel";
import { createShapes } from "./shapes/controller";
import { createConveyors } from "./conveyors/controller";

const JOG_SPEED = 60; // degrees per second while a key or jog button is held
const DEMO_SMOOTHING = 3; // higher = joints follow the demo path more tightly

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const { renderer, scene, camera, controls } = createStage(canvas);

const arm = new RobotArm(ARM, JOINTS);
scene.add(arm.root);

const trail = new Trail();
scene.add(trail.line);

let gripper: Gripper | null = null;

// Shapes on the floor, stored in the inventory database (Snack 5's API).
const shapes = createShapes({ root: document.getElementById("shapes-panel")!, scene, camera, canvas, arm: ARM });

// Conveyor belts, also stored there. Shapes on a running belt ride along.
const belts = createConveyors({
  root: document.getElementById("conveyors-panel")!,
  runButton: document.getElementById("btn-run") as HTMLButtonElement,
  scene, camera, canvas, shapes,
});

// The right-hand panel's two tabs.
const tabs = { shapes: document.getElementById("tab-shapes")!, conveyors: document.getElementById("tab-conveyors")! };
function showTab(name: keyof typeof tabs) {
  for (const [key, tab] of Object.entries(tabs)) {
    const on = key === name;
    tab.setAttribute("aria-selected", String(on));
    document.getElementById(tab.getAttribute("aria-controls")!)!.hidden = !on;
  }
}
tabs.shapes.addEventListener("click", () => showTab("shapes"));
tabs.conveyors.addEventListener("click", () => showTab("conveyors"));
belts.onShowTab(() => showTab("conveyors"));

const state = {
  selected: 1,
  demo: true,
  demoTime: 0,
  trail: true,
  jog: 0 as JogDirection,
};

const panel = createPanel(JOINTS, {
  onSelect: select,
  onJog: (direction) => {
    state.jog = direction;
    if (direction !== 0) setDemo(false);
  },
  onToggleDemo: () => setDemo(!state.demo),
  onToggleGripper: toggleGripper,
  onToggleTrail: () => setTrail(!state.trail),
  onReset: reset,
});

// ---- Gripper (glTF) ----

Gripper.load(`${import.meta.env.BASE_URL}models/gripper.glb`)
  .catch((err: unknown) => {
    console.error(err);
    panel.showStatus("Couldn't load models/gripper.glb, so a placeholder gripper is shown.");
    return Gripper.placeholder();
  })
  .then((loaded) => {
    gripper = loaded;
    arm.toolMount.add(loaded.object);
    panel.setGripperOpen(loaded.isOpen);
  });

// ---- Actions ----

function select(index: number) {
  state.selected = (index + JOINTS.length) % JOINTS.length;
  arm.highlight(state.selected);
  panel.setSelected(state.selected);
}

function setDemo(on: boolean) {
  state.demo = on;
  panel.setDemo(on);
}

function toggleGripper() {
  setDemo(false); // otherwise the demo would immediately override it
  setGripperOpen(!(gripper?.isOpen ?? true));
}

function setGripperOpen(open: boolean) {
  if (!gripper || gripper.isOpen === open) return;
  gripper.setOpen(open);
  panel.setGripperOpen(open);
}

function setTrail(on: boolean) {
  state.trail = on;
  trail.visible = on;
  if (!on) trail.clear();
  panel.setTrail(on);
}

function reset() {
  setDemo(false);
  JOINTS.forEach((spec, i) => arm.setAngle(i, spec.home));
  setGripperOpen(true);
  trail.clear();
}

// ---- Keyboard ----

const held = new Set<string>();

window.addEventListener("keydown", (e) => {
  // Typing a shape's name or size must not move the arm (R would reset it, G open the gripper…).
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  if (belts.handleKey(e) || shapes.handleKey(e)) {
    e.preventDefault();
    return;
  }
  // Let a focused button handle its own Space/Enter instead of toggling twice.
  if (e.target instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (/^[1-9]$/.test(key) && Number(key) <= JOINTS.length) select(Number(key) - 1);
  else if (key === "ArrowUp") select(state.selected - 1);
  else if (key === "ArrowDown") select(state.selected + 1);
  else if (key === "ArrowLeft" || key === "ArrowRight" || key === "a" || key === "d") {
    held.add(key);
    setDemo(false);
  } else if (key === "g" && !e.repeat) toggleGripper();
  else if (key === " " && !e.repeat) setDemo(!state.demo);
  else if (key === "t" && !e.repeat) setTrail(!state.trail);
  else if (key === "r" && !e.repeat) reset();
  else return;

  e.preventDefault();
});

window.addEventListener("keyup", (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener("blur", () => held.clear());

function keyboardDirection(): number {
  const negative = held.has("ArrowLeft") || held.has("a") ? 1 : 0;
  const positive = held.has("ArrowRight") || held.has("d") ? 1 : 0;
  return positive - negative;
}

// ---- Click a joint housing to select it ----

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pressX = 0;
let pressY = 0;

function housingAt(e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(arm.housings, false)[0]?.object;
}

canvas.addEventListener("pointerdown", (e) => {
  pressX = e.clientX;
  pressY = e.clientY;
});
canvas.addEventListener("pointerup", (e) => {
  if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 4) return; // that was an orbit drag
  // Whoever is placing something gets the click; then shapes (they sit on top of belts), then belts.
  if (belts.isActive() && belts.handleClick(e)) return;
  if (shapes.handleClick(e)) return; // placing, moving or selecting a shape
  if (belts.handlePick(e)) return;
  const hit = housingAt(e);
  if (hit) select(hit.userData.jointIndex as number);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.buttons !== 0) return;
  if (belts.isActive() ? belts.handleHover(e) : shapes.handleHover(e)) return;
  canvas.style.cursor = housingAt(e) || belts.hoversBelt(e) ? "pointer" : "";
});

// ---- Frame loop ----

const tcpWorld = new THREE.Vector3();
let lastTime = performance.now();

select(state.selected);
panel.setDemo(state.demo);
panel.setTrail(state.trail);

renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - lastTime) / 1000, 0.05); // clamp after a hidden tab resumes
  lastTime = time;

  if (state.demo) {
    state.demoTime += dt;
    // Frame-rate independent easing toward the demo path, so toggling the demo
    // on from any pose glides there instead of jumping.
    const k = 1 - Math.exp(-DEMO_SMOOTHING * dt);
    JOINTS.forEach((_, i) => {
      const current = arm.getAngle(i);
      arm.setAngle(i, current + (demoTarget(i, state.demoTime) - current) * k);
    });
    setGripperOpen(demoGripperOpen(state.demoTime));
  } else {
    const direction = keyboardDirection() + state.jog;
    if (direction !== 0) {
      const i = state.selected;
      arm.setAngle(i, arm.getAngle(i) + Math.sign(direction) * JOG_SPEED * dt);
    }
  }

  gripper?.update(dt);
  belts.update(dt); // moves shapes riding the belts while running

  // getWorldPosition walks up the hierarchy and refreshes world matrices first,
  // so it's correct even though the joints changed since the last render.
  arm.tcp.getWorldPosition(tcpWorld);
  if (state.trail) trail.push(tcpWorld);
  panel.update(arm.anglesDeg, tcpWorld, forwardKinematics(ARM, arm.anglesRad()));

  controls.update();
  renderer.render(scene, camera);
});
