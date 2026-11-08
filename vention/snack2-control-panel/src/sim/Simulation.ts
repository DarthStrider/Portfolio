import { clamp, DEG, forwardKinematics, type Vec3 } from "../arm/kinematics";
import { ARM, JOINTS } from "../arm/jointSpecs";
import { SequencePlayer, type ArmState, type PlayerStatus } from "./SequencePlayer";
import { GAP_CLOSED, GAP_OPEN, programForCycle, type Step } from "./program";

/** What React sees: an immutable copy of the simulation, replaced (never mutated) on each publish. */
export interface Snapshot {
  joints: readonly number[];
  gap: number;
  tcp: Vec3;
  status: PlayerStatus;
  steps: readonly Step[];
  stepIndex: number;
  stepProgress: number;
  cycle: number;
  speed: number;
  loop: boolean;
  error: string | null;
}

const PUBLISH_INTERVAL = 1 / 15; // seconds: React re-renders at most ~15x/s while things move
const GRIPPER_SPEED = 0.25; // m/s for manual open/close

/**
 * The single source of truth for the robot, living outside React.
 *
 * The 3D viewer calls tick() every frame (60+ times a second) and reads `state`
 * directly. React reads `snapshot` through useSyncExternalStore, and only gets a
 * new one when something changes, throttled while the arm is moving. So the
 * scene animates at full frame rate while the panel re-renders a few times a second.
 */
export class Simulation {
  /** Live, mutable state. The viewer reads this every frame. */
  readonly state: ArmState = { joints: JOINTS.map((j) => j.home), gap: GAP_OPEN };
  readonly player = new SequencePlayer(ARM, JOINTS, programForCycle);
  /** Bumped on reset, so the viewer knows to put the part back. */
  resetVersion = 0;
  /** Frames simulated so far, shown in the panel's stats line. */
  frames = 0;

  private manualGap = GAP_OPEN;
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private sincePublish = 0;
  private wasMoving = false;

  constructor() {
    this.snapshot = this.makeSnapshot();
  }

  // ---- The external-store contract for useSyncExternalStore ----
  // Arrow functions so `this` is bound and React gets the same function every time.

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  // ---- Commands from the UI ----

  play(): void {
    this.player.play(this.state);
    this.publish();
  }

  pause(): void {
    this.interrupt();
    this.publish();
  }

  reset(): void {
    this.player.stop();
    JOINTS.forEach((j, i) => (this.state.joints[i] = j.home));
    this.state.gap = this.manualGap = GAP_OPEN;
    this.resetVersion++;
    this.publish();
  }

  /** Manual jog. Takes control away from the program, like a robot's teach pendant. */
  setJoint(index: number, degrees: number): void {
    this.interrupt();
    const spec = JOINTS[index];
    this.state.joints[index] = clamp(degrees, spec.min, spec.max);
    this.publish();
  }

  setGripper(open: boolean): void {
    this.interrupt();
    this.manualGap = open ? GAP_OPEN : GAP_CLOSED;
    this.publish();
  }

  setSpeed(speed: number): void {
    this.player.speed = speed;
    this.publish();
  }

  setLoop(loop: boolean): void {
    this.player.loop = loop;
    this.publish();
  }

  // ---- Called by the viewer once per frame ----

  tick(dt: number): void {
    this.frames++;
    const { status, index } = this.player;
    let moving = false;

    if (this.player.status === "playing") {
      this.player.update(dt, this.state);
      moving = true;
    } else if (this.state.gap !== this.manualGap) {
      const step = GRIPPER_SPEED * dt;
      this.state.gap =
        this.state.gap < this.manualGap
          ? Math.min(this.manualGap, this.state.gap + step)
          : Math.max(this.manualGap, this.state.gap - step);
      moving = true;
    }

    // Publish right away when the step or status changes, otherwise at most
    // every PUBLISH_INTERVAL while moving, plus once more when motion stops.
    this.sincePublish += dt;
    const discreteChange = status !== this.player.status || index !== this.player.index;
    const stopped = this.wasMoving && !moving;
    if (discreteChange || stopped || (moving && this.sincePublish >= PUBLISH_INTERVAL)) this.publish();
    this.wasMoving = moving;
  }

  // ---- Internals ----

  /** If the program is running, pause it and hold the gripper where it is. */
  private interrupt(): void {
    if (this.player.status === "playing") {
      this.player.pause();
      this.manualGap = this.state.gap;
    }
  }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    this.sincePublish = 0;
    this.listeners.forEach((listener) => listener());
  }

  private makeSnapshot(): Snapshot {
    const p = this.player;
    return {
      joints: [...this.state.joints],
      gap: this.state.gap,
      tcp: forwardKinematics(ARM, this.state.joints.map((a) => a * DEG)),
      status: p.status,
      steps: p.steps,
      stepIndex: p.index,
      stepProgress: p.progress,
      cycle: p.cycle,
      speed: p.speed,
      loop: p.loop,
      error: p.error,
    };
  }
}
