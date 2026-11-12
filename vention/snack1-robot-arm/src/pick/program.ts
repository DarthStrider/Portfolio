/**
 * Pick and place as a robot program: a list of steps, the way an industrial robot (or
 * Vention's MachineLogic) is programmed. Adapted from Snack 2 for real shapes from the
 * inventory, with a roll joint to line the fingers up and to turn what's being carried.
 *
 * - moveJ:   joint move. Solve IK for the end point once, then interpolate each joint.
 *            Smooth and quick, but the tool's path in space is a curve: used in the air.
 * - moveL:   linear move. Interpolate the tool position in a straight line and solve IK
 *            every frame: used to go straight down to a shape and back up.
 * - gripper: open or close the fingers to a gap. `grab` takes hold of the shape when it
 *            ends; `release` lets go when it starts.
 * - home:    joint move back to the home pose.
 *
 * Nothing here knows about Three.js: the planner and the player work on plain numbers, so
 * both are unit-tested (tests/pick.test.ts).
 */
import { DEG, forwardKinematics, type ArmDimensions, type Vec3 } from "../arm/kinematics";
import { fingerYaw, rollFor, solveTopDown, withinLimits, wrapDeg } from "../arm/ik";
import { BASE, ROLL, type JointSpec } from "../arm/jointSpecs";
import { GAP_OPEN } from "../arm/gripperSpec";
import { reachOf, type Reach } from "../shapes/reach";
import type { Shape } from "../shapes/types";
import { graspFor } from "./grasp";
import { CLEARANCE } from "./clearance";

export { CLEARANCE };

export type Step =
  | { kind: "moveJ"; label: string; to: Vec3; roll: number; duration: number }
  | { kind: "moveL"; label: string; to: Vec3; roll: number; duration: number }
  | { kind: "gripper"; label: string; gap: number; duration: number; grab?: boolean; release?: boolean }
  | { kind: "home"; label: string; duration: number };

/** Let go a couple of millimeters above the surface, so the shape settles onto it. */
export const RELEASE_DROP = 0.002;
/** How finely the straight moves are checked for reach before running (meters). */
const CHECK_STEP = 0.01;

export interface PickRequest {
  shape: Pick<Shape, "name" | "kind" | "size" | "position" | "rotationY">;
  /** Height of what the shape stands on now (0 on the floor, a belt's height on a belt). */
  fromBaseY: number;
  /** Where to put it, and the height of what's there. */
  to: { x: number; z: number };
  toBaseY: number;
  /** Degrees to turn the shape on the way (positive turns it like rotationY does). */
  turn: number;
}

export type Plan =
  | { ok: true; steps: Step[]; /** the shape's rotationY once placed */ rotationY: number; /** gap when gripping */ width: number }
  | { ok: false; reason: string };

/** Plans one pick and place, or explains why it can't be done, before anything moves. */
export function planPickPlace(dims: ArmDimensions, specs: readonly JointSpec[], req: PickRequest): Plan {
  const { shape } = req;
  const grasp = graspFor(shape);
  if (!grasp.ok) return grasp;

  const fromReach = reachOf(shape, dims, req.fromBaseY);
  if (fromReach !== "reachable") return { ok: false, reason: `${shape.name} ${WHY[fromReach]}.` };
  const toReach = reachOf({ ...shape, position: req.to }, dims, req.toBaseY);
  if (toReach !== "reachable") return { ok: false, reason: `Put there, ${shape.name} ${WHY[toReach]}.` };

  const { x, z } = shape.position;
  const pick: Vec3 = { x, y: req.fromBaseY + grasp.height, z };
  const drop: Vec3 = { x: req.to.x, y: req.toBaseY + grasp.height + RELEASE_DROP, z: req.to.z };
  const carryY = Math.max(req.fromBaseY, req.toBaseY) + CLEARANCE + grasp.height;
  const abovePick: Vec3 = { ...pick, y: Math.max(carryY, pick.y) };
  const aboveDrop: Vec3 = { ...drop, y: Math.max(carryY, drop.y) };

  // Before the grab, either way round will do, so turn the fingers the least. Round shapes
  // can be gripped from any side: keep the roll at 0.
  const pickBase = baseYaw(pick);
  const pickRoll = grasp.fingerYaw === null ? 0 : rollFor(pickBase, grasp.fingerYaw);
  // Once it's held, the shape turns with the fingers, so the drop must turn them by exactly
  // `turn`: the fingers' direction there is the pick direction plus the turn.
  const dropFingers = fingerYaw(pickBase, pickRoll) + req.turn;
  const dropRoll = wrapDeg(baseYaw(drop) - dropFingers);

  // Check every point the tool will pass through, including along the straight moves.
  for (const [a, b, roll, what] of [
    [abovePick, pick, pickRoll, `pick up ${shape.name}`],
    [aboveDrop, drop, dropRoll, "put it there"],
  ] as const) {
    const n = Math.max(1, Math.ceil(Math.abs(a.y - b.y) / CHECK_STEP));
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x, y: a.y + ((b.y - a.y) * i) / n, z: a.z };
      if (!reachable(dims, specs, p, roll)) return { ok: false, reason: `The arm can't bend to ${what} from straight above.` };
    }
  }

  const name = shape.name;
  const steps: Step[] = [
    { kind: "gripper", label: "Open gripper", gap: GAP_OPEN, duration: 0.4 },
    { kind: "moveJ", label: `Move above ${name}`, to: abovePick, roll: pickRoll, duration: 2 },
    { kind: "moveL", label: `Descend to ${name}`, to: pick, roll: pickRoll, duration: 1.2 },
    { kind: "gripper", label: `Grip ${name}`, gap: grasp.width, duration: 0.6, grab: true },
    { kind: "moveL", label: "Lift", to: abovePick, roll: pickRoll, duration: 1 },
    { kind: "moveJ", label: req.turn ? `Carry, turning ${fmtTurn(req.turn)}` : "Carry", to: aboveDrop, roll: dropRoll, duration: 2.4 },
    { kind: "moveL", label: "Lower", to: drop, roll: dropRoll, duration: 1.2 },
    { kind: "gripper", label: "Let go", gap: Math.min(GAP_OPEN, grasp.width + 0.03), duration: 0.4, release: true },
    { kind: "moveL", label: "Back up", to: aboveDrop, roll: dropRoll, duration: 0.9 },
    { kind: "home", label: "Return home", duration: 2 },
  ];
  return { ok: true, steps, rotationY: wrapDeg(shape.rotationY + req.turn), width: grasp.width };
}

const WHY: Record<Exclude<Reach, "reachable">, string> = {
  "too-far": "is out of the arm's reach",
  "too-close": "is too close to the arm to reach from above",
  "overlaps-base": "would hit the arm's base",
};

function baseYaw(p: Vec3): number {
  return Math.atan2(p.z, -p.x) / DEG; // the same as solveTopDown's base
}

function reachable(dims: ArmDimensions, specs: readonly JointSpec[], p: Vec3, roll: number): boolean {
  const q = solveTopDown(dims, p);
  if (!q) return false;
  q[ROLL] = roll;
  return withinLimits(specs, q);
}

function fmtTurn(deg: number): string {
  return `${deg > 0 ? "+" : ""}${Math.round(deg)}°`;
}

// ---- Running a program ----

/** The commanded state of the robot: joints in degrees, gripper gap in meters. */
export interface ArmState {
  joints: number[];
  gap: number;
}

export type PlayerStatus = "playing" | "done" | "error";
export type PlayerEvent = "grab" | "release" | "done" | "error";

/** Smoothstep: starts and ends with zero velocity, so moves don't jerk. */
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Runs a program once, step by step. Each frame it reads and writes a plain ArmState and
 * reports what happened (took hold, let go, finished, failed), so main.ts can move the
 * shape between the scene and the gripper.
 */
export class ProgramPlayer {
  status: PlayerStatus = "playing";
  index = 0;
  error: string | null = null;
  readonly steps: readonly Step[];

  private elapsed = 0;
  private startJoints: number[] = [];
  private startGap = 0;
  private startTcp: Vec3 = { x: 0, y: 0, z: 0 };
  private targetJoints: number[] | null = null;
  private readonly dims: ArmDimensions;
  private readonly specs: readonly JointSpec[];

  constructor(dims: ArmDimensions, specs: readonly JointSpec[], steps: readonly Step[], state: ArmState) {
    this.dims = dims;
    this.specs = specs;
    this.steps = steps;
    this.begin(state);
  }

  get step(): Step | undefined {
    return this.steps[this.index];
  }

  /** 0..1 through the current step. */
  get progress(): number {
    const step = this.step;
    return step ? Math.min(1, this.elapsed / step.duration) : 1;
  }

  /** Advances by dt seconds, writing the new joint angles and gap into `state`. */
  update(dt: number, state: ArmState): PlayerEvent[] {
    if (this.status !== "playing") return [];
    const events: PlayerEvent[] = [];
    const step = this.steps[this.index];
    const first = this.elapsed === 0;
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / step.duration);
    const s = ease(t);

    switch (step.kind) {
      case "moveJ":
      case "home": {
        const target = this.targetJoints!;
        for (let i = 0; i < state.joints.length; i++) state.joints[i] = lerp(this.startJoints[i], target[i], s);
        break;
      }
      case "moveL": {
        const p = { x: lerp(this.startTcp.x, step.to.x, s), y: lerp(this.startTcp.y, step.to.y, s), z: lerp(this.startTcp.z, step.to.z, s) };
        const q = solveTopDown(this.dims, p);
        if (!q) return this.fail(`Can't reach (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) during "${step.label}".`);
        q[ROLL] = lerp(this.startJoints[ROLL], step.roll, s);
        q[BASE] = this.nearest(q[BASE], this.startJoints[BASE]);
        if (!withinLimits(this.specs, q)) return this.fail(`A joint would pass its limit during "${step.label}".`);
        for (let i = 0; i < q.length; i++) state.joints[i] = q[i];
        break;
      }
      case "gripper":
        if (step.release && first) events.push("release"); // let go as the fingers start to open
        state.gap = lerp(this.startGap, step.gap, s);
        break;
    }

    if (t < 1) return events;
    if (step.kind === "gripper" && step.grab) events.push("grab");
    this.index++;
    if (this.index >= this.steps.length) {
      this.status = "done";
      events.push("done");
      return events;
    }
    if (!this.begin(state)) events.push("error");
    return events;
  }

  /** Each step starts from wherever the arm really is. Returns false if it can't start. */
  private begin(state: ArmState): boolean {
    const step = this.steps[this.index];
    this.elapsed = 0;
    this.startJoints = [...state.joints];
    this.startGap = state.gap;
    this.startTcp = forwardKinematics(this.dims, state.joints.map((a) => a * DEG));
    this.targetJoints = null;
    if (step.kind === "moveJ") {
      const q = solveTopDown(this.dims, step.to);
      if (!q) {
        this.fail(`Can't reach the start of "${step.label}".`);
        return false;
      }
      q[ROLL] = step.roll;
      q[BASE] = this.nearest(q[BASE], this.startJoints[BASE]);
      this.targetJoints = q;
    } else if (step.kind === "home") {
      this.targetJoints = this.specs.map((s) => s.home);
    }
    return true;
  }

  /**
   * The same base direction as `angle`, written as close to `from` as the base's limits
   * allow: 180° and -180° face the same way, and the base should turn the short way round.
   */
  private nearest(angle: number, from: number): number {
    const short = from + wrapDeg(angle - from);
    const { min, max } = this.specs[BASE];
    return short >= min && short <= max ? short : angle;
  }

  private fail(message: string): PlayerEvent[] {
    this.status = "error";
    this.error = message;
    return ["error"];
  }
}
