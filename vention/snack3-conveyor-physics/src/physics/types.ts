import type { SlotPool } from "../sim/SlotPool";
import type { V3 } from "../layout";

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A box to add: center and half extents, in meters. */
export interface BodyDesc {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface PhysicsStats {
  /** Pairs checked in the narrow phase this step (custom engine only; -1 when not available). */
  pairsTested: number;
  /** Touching pairs this step. */
  contacts: number;
  /** Bodies not asleep. */
  awake: number;
}

/**
 * What the rest of the app needs from a physics engine. The custom engine and
 * cannon-es both implement it, so they can be swapped at runtime and benchmarked
 * on exactly the same scene.
 */
export interface PhysicsBackend {
  readonly name: string;
  readonly stats: PhysicsStats;
  beltSpeed: number;
  add(slot: number, desc: BodyDesc): void;
  remove(slot: number): void;
  /** Remember the current state as "previous", for interpolation. Call before each step. */
  savePrevious(pool: SlotPool): void;
  step(dt: number, pool: SlotPool): void;
  getPosition(slot: number, out: V3): void;
  /** Position and rotation blended `alpha` of the way from the previous step to the current one. */
  readTransform(slot: number, alpha: number, pos: V3, quat: Quat): void;
  isAsleep(slot: number): boolean;
}
