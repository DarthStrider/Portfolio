/**
 * Conveyor belts placed in the robot arm's scene (Snack 1), stored beside its shapes.
 *
 * A belt is a box on the floor: its top surface is at `height`, it runs along its own
 * length, and it carries what rests on it at `speed` meters per second. Positive speed
 * moves things toward the belt's +x end (before rotation); negative runs it backwards.
 */
import { ValidationError } from "./errors.ts";

export interface Conveyor {
  id: string;
  name: string;
  /** Meters along the direction of travel. */
  length: number;
  /** Meters across. */
  width: number;
  /** Height of the belt surface above the floor, meters. */
  height: number;
  /** Meters per second; negative runs it backwards. */
  speed: number;
  /** Floor position of the belt's center. */
  position: { x: number; z: number };
  /** Degrees about the vertical axis; 0 means travel along +x. */
  rotationY: number;
  createdAt: string;
  updatedAt: string;
}

export type NewConveyor = Omit<Conveyor, "id" | "createdAt" | "updatedAt">;
/** A placed belt can be moved, turned, renamed and have its speed changed. Its size is fixed. */
export type ConveyorPatch = Partial<Pick<Conveyor, "name" | "position" | "rotationY" | "speed">>;

export const CONVEYOR_LIMITS = {
  length: [0.3, 4],
  width: [0.1, 1.2],
  height: [0.05, 1.2],
  speed: [-1, 1],
  floor: 3,
} as const;

type Body = Record<string, unknown>;
const asBody = (v: unknown): Body => (v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {});
const num = (v: unknown, [min, max]: readonly [number, number]) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

function field<T>(problems: string[], value: T | null, message: string): T | undefined {
  if (value === null) {
    problems.push(message);
    return undefined;
  }
  return value;
}

function name(v: unknown) {
  return typeof v === "string" && v.trim() !== "" && v.trim().length <= 40 ? v.trim() : null;
}

function position(v: unknown) {
  const p = asBody(v);
  const range = [-CONVEYOR_LIMITS.floor, CONVEYOR_LIMITS.floor] as const;
  const x = num(p.x, range);
  const z = num(p.z, range);
  return x === null || z === null ? null : { x, z };
}

const MESSAGES = {
  name: "name must be text up to 40 characters",
  length: `length must be ${CONVEYOR_LIMITS.length[0]} to ${CONVEYOR_LIMITS.length[1]} m`,
  width: `width must be ${CONVEYOR_LIMITS.width[0]} to ${CONVEYOR_LIMITS.width[1]} m`,
  height: `height must be ${CONVEYOR_LIMITS.height[0]} to ${CONVEYOR_LIMITS.height[1]} m`,
  speed: `speed must be ${CONVEYOR_LIMITS.speed[0]} to ${CONVEYOR_LIMITS.speed[1]} m/s`,
  position: `position must be { x, z } in meters, each from -${CONVEYOR_LIMITS.floor} to ${CONVEYOR_LIMITS.floor}`,
  rotationY: "rotationY must be degrees from -360 to 360",
};

export function parseNewConveyor(input: unknown): NewConveyor {
  const b = asBody(input);
  const problems: string[] = [];
  const out = {
    name: field(problems, name(b.name), MESSAGES.name),
    length: field(problems, num(b.length, CONVEYOR_LIMITS.length), MESSAGES.length),
    width: field(problems, num(b.width, CONVEYOR_LIMITS.width), MESSAGES.width),
    height: field(problems, num(b.height, CONVEYOR_LIMITS.height), MESSAGES.height),
    speed: field(problems, num(b.speed ?? 0.2, CONVEYOR_LIMITS.speed), MESSAGES.speed),
    position: field(problems, position(b.position), MESSAGES.position),
    rotationY: field(problems, num(b.rotationY ?? 0, [-360, 360]), MESSAGES.rotationY),
  };
  if (problems.length) throw new ValidationError(problems);
  return out as NewConveyor;
}

export function parseConveyorPatch(input: unknown): ConveyorPatch {
  const b = asBody(input);
  const problems: string[] = [];
  const patch: ConveyorPatch = {};
  if (b.name !== undefined) patch.name = field(problems, name(b.name), MESSAGES.name);
  if (b.position !== undefined) patch.position = field(problems, position(b.position), MESSAGES.position);
  if (b.rotationY !== undefined) patch.rotationY = field(problems, num(b.rotationY, [-360, 360]), MESSAGES.rotationY);
  if (b.speed !== undefined) patch.speed = field(problems, num(b.speed, CONVEYOR_LIMITS.speed), MESSAGES.speed);
  const unknown = Object.keys(b).filter((k) => !["name", "position", "rotationY", "speed"].includes(k));
  if (unknown.length) problems.push(`can't change ${unknown.join(", ")}; delete and re-create the belt instead`);
  if (!problems.length && Object.keys(patch).length === 0) problems.push("nothing to change: send name, position, rotationY or speed");
  if (problems.length) throw new ValidationError(problems);
  return patch;
}
