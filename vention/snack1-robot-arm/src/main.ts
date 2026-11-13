import * as THREE from "three";
import { ARM, JOINTS, demoGripperOpen, demoTarget } from "./arm/jointSpecs";
import { forwardKinematics } from "./arm/kinematics";
import { Gripper } from "./arm/Gripper";
import { RobotArm } from "./arm/RobotArm";
import { createStage } from "./scene/stage";
import { createView } from "./scene/view";
import { Trail } from "./scene/Trail";
import { createPanel, type JogDirection } from "./ui/panel";
import { createShapes } from "./shapes/controller";
import { createConveyors } from "./conveyors/controller";
import { createSplitters } from "./splitters/controller";
import { createLine } from "./line/controller";
import { createRobots } from "./robots/controller";
import { setFloorHalf } from "./scene/floor";
import { sceneApi } from "./shapes/api";
import { planPickPlace, ProgramPlayer, type ArmState } from "./pick/program";

const JOG_SPEED = 60; // degrees per second while a key or jog button is held
const DEMO_SMOOTHING = 3; // higher = joints follow the demo path more tightly

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const { renderer, scene, camera, controls, followView } = createStage(canvas);

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

// Splitters: gates on the belts that send each item left, right or straight on, by your rules.
const splitters = createSplitters({ root: document.getElementById("splitters-panel")!, scene, camera, canvas, shapes, conveyors: belts });

// Mergers and joining machines, plus the connection point editor in the Shapes tab.
const line = createLine({
  root: document.getElementById("machines-panel")!, binsRoot: document.getElementById("bins-panel")!,
  scene, camera, canvas, shapes, conveyors: belts,
});

// Automated robots: extra arms that pick items up from their zone and put them where their rules say.
// (`program`, the main arm's pick, is declared below; it's only read once things are running.)
const robots = createRobots({
  root: document.getElementById("robots-panel")!, scene, camera, canvas, shapes, conveyors: belts, line,
  mainArmShape: () => program?.shapeId ?? null,
  gripperUrl: `${import.meta.env.BASE_URL}models/gripper.glb`,
});

// The floor's size is the inventory API's setting (FLOOR_SIZE); until it answers, the default.
void sceneApi.config().then((c) => setFloorHalf(c.floorHalf)).catch(() => {});

// Clear scene: everything but the arm. Two clicks, so one stray click can't wipe the floor.
const clearBtn = document.getElementById("btn-clear") as HTMLButtonElement;
let clearArmed = 0;
clearBtn.addEventListener("click", async () => {
  if (belts.running) return panel.showStatus("Stop the belts before clearing the scene.");
  if (!clearArmed) {
    clearBtn.textContent = "Click again to clear";
    clearBtn.classList.add("danger");
    clearArmed = window.setTimeout(disarmClear, 4000);
    return;
  }
  disarmClear();
  stopProgram("Stopped: the scene was cleared.");
  robots.cancelAll();
  clearBtn.disabled = true;
  try {
    const { cleared: c } = await sceneApi.clear();
    panel.showStatus(`Cleared ${c.shapes} shape${c.shapes === 1 ? "" : "s"}, ${c.conveyors} belt${c.conveyors === 1 ? "" : "s"}, ${c.bins} bin${c.bins === 1 ? "" : "s"} and ${c.robots} robot${c.robots === 1 ? "" : "s"}. Stock is unchanged.`);
  } catch (err) {
    panel.showStatus(`Couldn't clear the scene: ${(err as Error).message}`);
  }
  clearBtn.disabled = false;
  await Promise.all([shapes.reload(), belts.reload(), splitters.reload(), line.reload(), robots.reload()]);
});
function disarmClear() {
  window.clearTimeout(clearArmed);
  clearArmed = 0;
  clearBtn.textContent = "Clear scene";
  clearBtn.classList.remove("danger");
}

// The right-hand panel's tabs.
const tabs = {
  shapes: document.getElementById("tab-shapes")!,
  conveyors: document.getElementById("tab-conveyors")!,
  splitters: document.getElementById("tab-splitters")!,
  machines: document.getElementById("tab-machines")!,
  bins: document.getElementById("tab-bins")!,
  robots: document.getElementById("tab-robots")!,
};
function showTab(name: keyof typeof tabs) {
  for (const [key, tab] of Object.entries(tabs)) {
    const on = key === name;
    tab.setAttribute("aria-selected", String(on));
    document.getElementById(tab.getAttribute("aria-controls")!)!.hidden = !on;
  }
}
tabs.shapes.addEventListener("click", () => showTab("shapes"));
tabs.conveyors.addEventListener("click", () => showTab("conveyors"));
tabs.splitters.addEventListener("click", () => showTab("splitters"));
tabs.machines.addEventListener("click", () => showTab("machines"));
tabs.bins.addEventListener("click", () => showTab("bins"));
tabs.robots.addEventListener("click", () => showTab("robots"));
robots.onShowTab(() => showTab("robots"));
belts.onShowTab(() => showTab("conveyors"));
splitters.onShowTab(() => showTab("splitters"));

const state = {
  selected: 1,
  demo: true,
  demoTime: 0,
  trail: true,
  jog: 0 as JogDirection,
};

/** The pick-and-place program running now, if any (see src/pick/program.ts). */
let program: {
  player: ProgramPlayer;
  shapeId: string;
  to: { x: number; z: number };
  rotationY: number;
  holding: boolean;
} | null = null;

const panel = createPanel(JOINTS, {
  onSelect: select,
  onJog: (direction) => {
    state.jog = direction;
    if (direction !== 0) {
      stopProgram("Stopped: you took over the arm.");
      setDemo(false);
    }
  },
  onToggleDemo: () => setDemo(!state.demo),
  onToggleGripper: toggleGripper,
  onToggleTrail: () => setTrail(!state.trail),
  onReset: reset,
  onStopProgram: () => stopProgram("Stopped."),
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
  if (on) stopProgram("Stopped for the demo.");
  state.demo = on;
  panel.setDemo(on);
}

function toggleGripper() {
  stopProgram("Stopped: you took over the gripper.");
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
  stopProgram("Stopped.");
  setDemo(false);
  JOINTS.forEach((spec, i) => arm.setAngle(i, spec.home));
  setGripperOpen(true);
  trail.clear();
}

// ---- Pick and place ----

/** The arm's commanded state, as the program player reads and writes it. */
function armState(): ArmState {
  return { joints: [...arm.anglesDeg], gap: gripper?.gap ?? 0 };
}

// The Shapes panel's Pick button: plan the whole move first, and only start if it can be done.
shapes.onPick((shapeId, request) => {
  if (program) return "The robot is busy with another shape.";
  if (!gripper) return "The gripper is still loading.";
  if (shapes.running) return "Stop the belts first.";
  const plan = planPickPlace(ARM, JOINTS, request);
  if (!plan.ok) return plan.reason;
  setDemo(false);
  state.jog = 0;
  held.clear();
  const player = new ProgramPlayer(ARM, JOINTS, plan.steps, armState());
  program = { player, shapeId, to: request.to, rotationY: plan.rotationY, holding: false };
  return null;
});

/** Ends the program early: lets go of the shape, which goes back to where it's stored. */
function stopProgram(reason: string) {
  if (!program) return;
  const { shapeId, holding } = program;
  program = null;
  if (holding) shapes.layer.release(shapeId);
  shapes.pickFinished(shapeId, null, reason);
  panel.setProgram(null);
  if (gripper) panel.setGripperOpen(gripper.isOpen);
}

function runProgram(dt: number) {
  if (!program || !gripper) return;
  if (shapes.running) {
    stopProgram("Stopped: the belts started.");
    return;
  }
  const { player, shapeId } = program;
  const commanded = armState();
  const events = player.update(dt, commanded);
  commanded.joints.forEach((angle, i) => arm.setAngle(i, angle));
  gripper.setGap(commanded.gap);

  for (const event of events) {
    if (event === "grab") {
      shapes.layer.hold(shapeId, gripper.object);
      program.holding = true;
    } else if (event === "release") {
      shapes.layer.release(shapeId);
      program.holding = false;
    } else if (event === "done") {
      const { to, rotationY } = program;
      program = null;
      panel.setProgram(null);
      panel.setGripperOpen(gripper.isOpen);
      shapes.pickFinished(shapeId, { x: to.x, z: to.z, rotationY });
      return;
    } else if (event === "error") {
      stopProgram(player.error ?? "The robot stopped.");
      return;
    }
  }
  const step = player.step;
  if (step) panel.setProgram({ label: step.label, index: player.index, count: player.steps.length, progress: player.progress });
}

// ---- Keyboard ----

const held = new Set<string>();

window.addEventListener("keydown", (e) => {
  // Typing a shape's name or size must not move the arm (R would reset it, G open the gripper…).
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  if (robots.handleKey(e) || line.handleKey(e) || splitters.handleKey(e) || belts.handleKey(e) || shapes.handleKey(e) || view.handleKey(e)) {
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
    stopProgram("Stopped: you took over the arm.");
    held.add(key);
    setDemo(false);
  } else if (key === "g" && !e.repeat) toggleGripper();
  else if (key === " " && !e.repeat) setDemo(!state.demo);
  else if (key === "t" && !e.repeat) setTrail(!state.trail);
  else if (key === "r" && !e.repeat) reset();
  else return;

  e.preventDefault();
});

window.addEventListener("keyup", (e) => {
  held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  view.handleKeyUp(e);
});
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
// Before OrbitControls sees the press (capture runs first): don't orbit while dragging out a section.
canvas.addEventListener("pointerdown", () => (controls.enabled = !belts.isExtending()), { capture: true });
canvas.addEventListener("pointerup", (e) => {
  // Dragging a straight out of a line's end: the release adds it, however far the mouse went.
  if (belts.isExtending() && belts.handleClick(e)) {
    controls.enabled = !belts.isExtending(); // done: the camera can orbit and zoom again
    return;
  }
  if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 4) return; // that was an orbit drag
  // Whoever is placing something gets the click; then shapes (they sit on top of belts), then
  // splitter gates (they stand over belts), then belts.
  if (line.isActive() && line.handleClick(e)) return; // putting a connection point on an object, or placing a bin
  if (robots.isActive() && robots.handleClick(e)) return; // placing a robot, its pick zone or a drop spot
  if (splitters.isActive() && splitters.handleClick(e)) return;
  if (belts.isActive() && belts.handleClick(e)) return;
  if (shapes.handleClick(e)) return; // placing, moving or selecting a shape
  if (splitters.handlePick(e)) return;
  if (belts.handlePick(e)) return;
  if (robots.handlePick(e)) return;
  const hit = housingAt(e);
  if (hit) select(hit.userData.jointIndex as number);
});
canvas.addEventListener("pointermove", (e) => {
  // While extending, the camera holds still and the new section follows the mouse, button down or not.
  controls.enabled = !belts.isExtending();
  if (belts.isExtending()) return void belts.handleHover(e);
  if (e.buttons !== 0) return;
  if (robots.isActive() && robots.handleHover(e)) return;
  if (line.isActive() ? line.handleHover(e) : splitters.isActive() ? splitters.handleHover(e) : belts.isActive() ? belts.handleHover(e) : shapes.handleHover(e)) return;
  canvas.style.cursor = housingAt(e) || splitters.hoversGate(e) || belts.hoversBelt(e) ? "pointer" : "";
});

// ---- Camera: the pad at the bottom of the screen, and keys ----

const view = createView({
  camera, controls, host: document.getElementById("view-pad")!, onMove: followView,
  bounds: () => {
    const box = new THREE.Box3().setFromObject(arm.root);
    for (const root of [shapes.layer.root, belts.layer.root, line.binLayer.root, robots.layer.root]) box.union(new THREE.Box3().setFromObject(root));
    return box;
  },
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

  if (program) {
    runProgram(dt);
  } else if (state.demo) {
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
  splitters.update(dt); // swings the gates' flaps
  robots.update(dt); // the automated robots, always at work

  // getWorldPosition walks up the hierarchy and refreshes world matrices first,
  // so it's correct even though the joints changed since the last render.
  arm.tcp.getWorldPosition(tcpWorld);
  if (state.trail) trail.push(tcpWorld);
  panel.update(arm.anglesDeg, tcpWorld, forwardKinematics(ARM, arm.anglesRad()));

  view.update(dt); // camera pad and keys, then the mouse's orbit controls
  controls.update();
  renderer.render(scene, camera);
});
