import { DEG, forwardKinematics, type ArmDimensions, type Vec3 } from "../arm/kinematics";
import { solveTopDown, withinLimits } from "../arm/ik";
import type { JointSpec } from "../arm/jointSpecs";
import type { Step } from "./program";

/** The commanded state of the robot. Joints in degrees, gripper gap in meters. */
export interface ArmState {
  joints: number[];
  gap: number;
}

export type PlayerStatus = "idle" | "playing" | "paused" | "done" | "error";

/** Smoothstep: starts and ends with zero velocity, so moves don't jerk. */
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const format = (p: Vec3) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;

/**
 * Runs a robot program step by step. It has no Three.js or React dependency:
 * each frame it reads and writes a plain ArmState, which makes it easy to test.
 */
export class SequencePlayer {
  status: PlayerStatus = "idle";
  steps: Step[];
  index = 0;
  elapsed = 0; // seconds into the current step (scaled by speed)
  cycle = 0;
  loop = true;
  speed = 1;
  error: string | null = null;

  private readonly dims: ArmDimensions;
  private readonly specs: readonly JointSpec[];
  private readonly program: (cycle: number) => Step[];

  // Captured when a step begins, so the step interpolates from where the arm really is.
  private startJoints: number[] = [];
  private startGap = 0;
  private startTcp: Vec3 = { x: 0, y: 0, z: 0 };
  private targetJoints: number[] | null = null;

  constructor(dims: ArmDimensions, specs: readonly JointSpec[], program: (cycle: number) => Step[]) {
    this.dims = dims;
    this.specs = specs;
    this.program = program;
    this.steps = program(0);
  }

  /** 0..1 through the current step. */
  get progress(): number {
    const step = this.steps[this.index];
    return step ? Math.min(1, this.elapsed / step.duration) : 0;
  }

  /**
   * Idle or error: start from cycle 0. Done: start the next cycle. Paused: resume.
   * In every case the current step restarts from the arm's current pose, so if
   * someone moved a joint while paused, the arm glides back instead of jumping.
   */
  play(state: ArmState): void {
    if (this.status === "playing") return;
    if (this.status === "idle" || this.status === "error") this.rewind();
    this.error = null;
    this.status = "playing";
    this.beginStep(state);
  }

  pause(): void {
    if (this.status === "playing") this.status = "paused";
  }

  stop(): void {
    this.rewind();
    this.status = "idle";
    this.error = null;
  }

  /** Advances by dt seconds, writing the new joint angles and gap into `state`. */
  update(dt: number, state: ArmState): void {
    if (this.status !== "playing") return;
    const step = this.steps[this.index];
    this.elapsed += dt * this.speed;
    const t = Math.min(1, this.elapsed / step.duration);
    const s = ease(t);

    switch (step.kind) {
      case "moveJ":
      case "home": {
        const target = this.targetJoints!;
        for (let i = 0; i < state.joints.length; i++) {
          state.joints[i] = lerp(this.startJoints[i], target[i], s);
        }
        break;
      }
      case "moveL": {
        const p = {
          x: lerp(this.startTcp.x, step.to.x, s),
          y: lerp(this.startTcp.y, step.to.y, s),
          z: lerp(this.startTcp.z, step.to.z, s),
        };
        const q = solveTopDown(this.dims, p);
        if (!q || !withinLimits(this.specs, q)) {
          this.fail(`Can't reach ${format(p)} during "${step.label}"`);
          return;
        }
        for (let i = 0; i < q.length; i++) state.joints[i] = q[i];
        break;
      }
      case "gripper":
        state.gap = lerp(this.startGap, step.gap, s);
        break;
    }

    if (t < 1) return;

    // Step finished: move to the next one, or the next cycle.
    this.index++;
    if (this.index >= this.steps.length) {
      this.cycle++;
      this.steps = this.program(this.cycle);
      this.index = 0;
      if (!this.loop) {
        this.status = "done";
        this.elapsed = 0;
        return;
      }
    }
    this.beginStep(state);
  }

  private rewind(): void {
    this.cycle = 0;
    this.steps = this.program(0);
    this.index = 0;
    this.elapsed = 0;
  }

  private beginStep(state: ArmState): void {
    const step = this.steps[this.index];
    this.elapsed = 0;
    this.startJoints = [...state.joints];
    this.startGap = state.gap;
    this.startTcp = forwardKinematics(this.dims, state.joints.map((a) => a * DEG));
    this.targetJoints = null;

    if (step.kind === "moveJ") {
      const q = solveTopDown(this.dims, step.to);
      if (!q || !withinLimits(this.specs, q)) {
        this.fail(`Can't reach ${format(step.to)} for "${step.label}"`);
        return;
      }
      this.targetJoints = q;
    } else if (step.kind === "home") {
      this.targetJoints = this.specs.map((s) => s.home);
    }
  }

  private fail(message: string): void {
    this.status = "error";
    this.error = message;
  }
}
