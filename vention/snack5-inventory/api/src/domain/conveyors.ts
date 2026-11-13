/**
 * Conveyor belts placed in the robot arm's scene (Snack 1), stored beside its shapes.
 *
 * A belt is a box on the floor: its top surface is at `height`, it runs along its own
 * length, and it carries what rests on it at `speed` meters per second. Positive speed
 * moves things toward the belt's +x end (before rotation); negative runs it backwards.
 *
 * Belts can be built into a line, one section at a time, each starting where the last ends.
 * A section is one of three kinds:
 * - straight: a box as above; `position` is its center, `rotationY` the way it runs.
 * - curve: a quarter or eighth of a ring turning `turn` degrees (positive turns left, seen
 *   from above, at a positive speed); `position` is the center the ring turns about, `radius`
 *   the radius of the belt's middle, `rotationY` the heading at its start.
 * - transfer: a square module at a corner that carries items to its middle and pushes them
 *   out sideways, `turn` ±90 degrees; `position` is its center, `rotationY` the heading in.
 * Sections of one line share `lineId` and are ordered by `lineIndex`. The arm app places
 * each section from the one before; the API checks each section on its own, and
 * PATCH /api/conveyors updates several at once so a line moves as one.
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
  /** Degrees about the vertical axis; 0 means travel along +x. For a curve or transfer, the heading in. */
  rotationY: number;
  /** What kind of section this is (see above). Belts made before lines existed are straight. */
  kind: SectionKind;
  /** Degrees a curve or transfer turns, positive to the left; 0 for a straight section. */
  turn: number;
  /** A curve's radius at the middle of the belt, meters; 0 for the other kinds. */
  radius: number;
  /** The line this section belongs to, or null for a belt on its own. */
  lineId: string | null;
  /** Its place in the line, from 0. */
  lineIndex: number;
  createdAt: string;
  updatedAt: string;
}

export type SectionKind = "straight" | "curve" | "transfer";
export const SECTION_KINDS: readonly SectionKind[] = ["straight", "curve", "transfer"];

/** The section fields have defaults (a straight belt on its own), so older clients still work. */
export type NewConveyor = Omit<Conveyor, "id" | "createdAt" | "updatedAt" | "kind" | "turn" | "radius" | "lineId" | "lineIndex">
  & Partial<Pick<Conveyor, "kind" | "turn" | "radius" | "lineId" | "lineIndex">>;
/** A placed belt can be moved, turned, renamed, have its speed changed and join or leave a line. Its size and shape are fixed. */
export type ConveyorPatch = Partial<Pick<Conveyor, "name" | "position" | "rotationY" | "speed" | "lineId" | "lineIndex">>;
/** One entry of PATCH /api/conveyors: which belt, and what to change. */
export type ConveyorUpdate = { id: string; patch: ConveyorPatch };

/** A new belt with every field filled in: what the databases store. */
export function withSectionDefaults(c: NewConveyor): Required<NewConveyor> {
  return { kind: "straight", turn: 0, radius: 0, lineId: null, lineIndex: 0, ...c };
}

export const CONVEYOR_LIMITS = {
  length: [0.3, 4],
  /** A curve's middle radius: at least half the width plus 5 cm, so the inside edge isn't a point. */
  radius: [0.1, 2],
  turns: { curve: [-90, -45, 45, 90], transfer: [-90, 90] } as Record<"curve" | "transfer", readonly number[]>,
  lineIndex: [0, 999],
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
  kind: `kind must be ${SECTION_KINDS.join(", ")}`,
  lineId: "lineId must be a UUID, or null for a belt on its own",
  lineIndex: `lineIndex must be a whole number from ${CONVEYOR_LIMITS.lineIndex[0]} to ${CONVEYOR_LIMITS.lineIndex[1]}`,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lineId = (v: unknown) => (v === null ? null : typeof v === "string" && UUID.test(v) ? v.toLowerCase() : undefined);
const lineIndex = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= CONVEYOR_LIMITS.lineIndex[0] && (v as number) <= CONVEYOR_LIMITS.lineIndex[1] ? (v as number) : null;

/**
 * Checks a section's shape and works out its length: a straight's is given; a curve's is its
 * arc at the middle of the belt; a transfer is square, as long as it is wide.
 */
function section(b: Body, width: number | undefined, problems: string[]) {
  const kind = (b.kind ?? "straight") as SectionKind;
  if (!SECTION_KINDS.includes(kind)) {
    problems.push(MESSAGES.kind);
    return {};
  }
  if (kind === "straight") {
    if ((b.turn ?? 0) !== 0 || (b.radius ?? 0) !== 0) problems.push("a straight section has no turn or radius");
    return { kind, turn: 0, radius: 0 };
  }
  const turns = CONVEYOR_LIMITS.turns[kind];
  const turn = turns.includes(b.turn as number) ? (b.turn as number) : null;
  if (turn === null) problems.push(`a ${kind}'s turn must be one of ${turns.join(", ")} degrees (positive turns left)`);
  if (kind === "transfer") {
    if ((b.radius ?? 0) !== 0) problems.push("a transfer has no radius");
    return { kind, turn: turn ?? 0, radius: 0, length: width };
  }
  const min = width === undefined ? CONVEYOR_LIMITS.radius[0] : Math.max(CONVEYOR_LIMITS.radius[0], width / 2 + 0.05);
  const radius = typeof b.radius === "number" && b.radius >= min - 1e-9 && b.radius <= CONVEYOR_LIMITS.radius[1] ? b.radius : null;
  if (radius === null) problems.push(`a curve's radius must be ${Math.round(min * 100) / 100} to ${CONVEYOR_LIMITS.radius[1]} m (half its width plus 5 cm, at least)`);
  const length = radius !== null && turn !== null ? Math.round(radius * Math.abs(turn) * (Math.PI / 180) * 1e6) / 1e6 : undefined;
  return { kind, turn: turn ?? 0, radius: radius ?? 0, length };
}

export function parseNewConveyor(input: unknown): NewConveyor {
  const b = asBody(input);
  const problems: string[] = [];
  const width = field(problems, num(b.width, CONVEYOR_LIMITS.width), MESSAGES.width);
  const shape = section(b, width, problems);
  const line = lineId(b.lineId ?? null);
  if (line === undefined) problems.push(MESSAGES.lineId);
  const index = lineIndex(b.lineIndex ?? 0);
  if (index === null) problems.push(MESSAGES.lineIndex);
  const out = {
    name: field(problems, name(b.name), MESSAGES.name),
    // A curve's or transfer's length follows from its shape; a straight's is given.
    length: shape.kind === "straight" ? field(problems, num(b.length, CONVEYOR_LIMITS.length), MESSAGES.length) : shape.length,
    width,
    height: field(problems, num(b.height, CONVEYOR_LIMITS.height), MESSAGES.height),
    speed: field(problems, num(b.speed ?? 0.2, CONVEYOR_LIMITS.speed), MESSAGES.speed),
    position: field(problems, position(b.position), MESSAGES.position),
    rotationY: field(problems, num(b.rotationY ?? 0, [-360, 360]), MESSAGES.rotationY),
    kind: shape.kind, turn: shape.turn, radius: shape.radius, lineId: line ?? null, lineIndex: index ?? 0,
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
  if (b.lineId !== undefined) {
    const id = lineId(b.lineId);
    if (id === undefined) problems.push(MESSAGES.lineId);
    else patch.lineId = id;
  }
  if (b.lineIndex !== undefined) patch.lineIndex = field(problems, lineIndex(b.lineIndex), MESSAGES.lineIndex);
  const allowed = ["name", "position", "rotationY", "speed", "lineId", "lineIndex"];
  const unknown = Object.keys(b).filter((k) => !allowed.includes(k));
  if (unknown.length) problems.push(`can't change ${unknown.join(", ")}; delete and re-create the belt instead`);
  if (!problems.length && Object.keys(patch).length === 0) problems.push(`nothing to change: send ${allowed.join(", ")}`);
  if (problems.length) throw new ValidationError(problems);
  return patch;
}

/**
 * PATCH /api/conveyors: { updates: [{ id, ...changes }] }, all applied or none. This is how a
 * line moves, turns or changes speed as one, and how deleting a middle section splits it.
 */
export function parseConveyorUpdates(input: unknown): ConveyorUpdate[] {
  const updates = asBody(input).updates;
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 200) {
    throw new ValidationError(["send { updates: [{ id, ...changes }] }, 1 to 200 of them"]);
  }
  const problems: string[] = [];
  const out: ConveyorUpdate[] = [];
  const seen = new Set<string>();
  updates.forEach((u, i) => {
    const { id, ...rest } = asBody(u);
    if (typeof id !== "string" || id === "") return void problems.push(`updates[${i}]: id is required`);
    if (seen.has(id)) return void problems.push(`updates[${i}]: ${id} appears twice`);
    seen.add(id);
    try {
      out.push({ id, patch: parseConveyorPatch(rest) });
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      for (const p of err.problems) problems.push(`updates[${i}]: ${p}`);
    }
  });
  if (problems.length) throw new ValidationError(problems);
  return out;
}
