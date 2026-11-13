/**
 * Automated robot arms in the arm app's scene (Snack 1): extra arms that work on their own.
 *
 * Each robot stands on the floor and watches a pick zone, a circle on the floor or on a belt.
 * When an item it can lift is in the zone, its rules decide where the item goes: the first
 * rule whose conditions all hold picks the target (a spot on the floor, a place on a belt, or
 * a bin). An item no rule matches goes to `otherwise`, or is left alone if that's null.
 *
 * Conditions are the same as a splitter's (shape kind, color, size, SKU, part category…), so
 * the API checks them with the same parser. Whether a target is within the robot's reach is
 * geometry with the arm's dimensions, which only the arm app knows; it says so when it can't.
 */
import { ValidationError } from "./errors.ts";
import { parseCondition, type Condition } from "./splitters.ts";
import { FLOOR_HALF, FLOOR_MESSAGE } from "./floor.ts";

export type Target =
  /** A spot on the floor: items are laid out in a grid around it. */
  | { type: "spot"; x: number; z: number }
  /** On a belt, `along` meters from its start, so the line carries them on. */
  | { type: "belt"; conveyorId: string; along: number }
  /** Into a bin: stored, as if it had fallen in. */
  | { type: "bin"; binId: string };

export interface RobotRule {
  conditions: Condition[];
  target: Target;
}

export interface Robot {
  id: string;
  name: string;
  /** Where its base stands, and which way it faces (degrees, like a belt's rotationY). */
  position: { x: number; z: number };
  rotationY: number;
  /** The circle it picks from. */
  pick: { x: number; z: number; radius: number };
  rules: RobotRule[];
  /** Where items no rule matches go; null leaves them alone. */
  otherwise: Target | null;
  createdAt: string;
  updatedAt: string;
}

export type NewRobot = Omit<Robot, "id" | "createdAt" | "updatedAt">;
export type RobotPatch = Partial<Pick<Robot, "name" | "position" | "rotationY" | "pick" | "rules" | "otherwise">>;

export const ROBOT_LIMITS = { rules: 10, conditions: 5, radius: [0.05, 0.6] as const, along: 4 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Body = Record<string, unknown>;
const asBody = (v: unknown): Body => (v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {});
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const onFloor = (v: unknown) => num(v, -FLOOR_HALF, FLOOR_HALF);

function position(v: unknown): { x: number; z: number } | null {
  const p = asBody(v);
  const x = onFloor(p.x);
  const z = onFloor(p.z);
  return x === null || z === null ? null : { x, z };
}

function parseTarget(v: unknown, where: string, problems: string[]): Target | null {
  const t = asBody(v);
  if (t.type === "spot") {
    const x = onFloor(t.x);
    const z = onFloor(t.z);
    if (x === null || z === null) {
      problems.push(`${where}: a spot's x and z must be meters from -${FLOOR_HALF} to ${FLOOR_HALF}`);
      return null;
    }
    return { type: "spot", x, z };
  }
  if (t.type === "belt") {
    const along = num(t.along, 0, ROBOT_LIMITS.along);
    const ok = typeof t.conveyorId === "string" && UUID.test(t.conveyorId);
    if (!ok) problems.push(`${where}: conveyorId must be a conveyor's id`);
    if (along === null) problems.push(`${where}: along must be 0 to ${ROBOT_LIMITS.along} m`);
    return ok && along !== null ? { type: "belt", conveyorId: t.conveyorId as string, along } : null;
  }
  if (t.type === "bin") {
    if (typeof t.binId === "string" && UUID.test(t.binId)) return { type: "bin", binId: t.binId };
    problems.push(`${where}: binId must be a bin's id`);
    return null;
  }
  problems.push(`${where}: type must be "spot", "belt" or "bin"`);
  return null;
}

function parseRules(v: unknown, problems: string[]): RobotRule[] | null {
  if (!Array.isArray(v) || v.length > ROBOT_LIMITS.rules) {
    problems.push(`rules must be a list of at most ${ROBOT_LIMITS.rules}`);
    return null;
  }
  const before = problems.length;
  const out = v.map((r, i): RobotRule | null => {
    const b = asBody(r);
    const where = `rule ${i + 1}`;
    if (!Array.isArray(b.conditions) || b.conditions.length < 1 || b.conditions.length > ROBOT_LIMITS.conditions) {
      problems.push(`${where}: conditions must be a list of 1 to ${ROBOT_LIMITS.conditions}`);
      return null;
    }
    const conditions = b.conditions.map((c, j) => parseCondition(c, `${where} condition ${j + 1}`, problems));
    const target = parseTarget(b.target, `${where} target`, problems);
    return conditions.every((c) => c !== null) && target ? { conditions: conditions as Condition[], target } : null;
  });
  return problems.length === before ? (out as RobotRule[]) : null;
}

function parsePick(v: unknown, problems: string[]): Robot["pick"] | null {
  const p = asBody(v);
  const at = position(p);
  const radius = num(p.radius ?? 0.15, ...ROBOT_LIMITS.radius);
  if (!at) problems.push(`pick: ${FLOOR_MESSAGE}`);
  if (radius === null) problems.push(`pick.radius must be ${ROBOT_LIMITS.radius[0]} to ${ROBOT_LIMITS.radius[1]} m`);
  return at && radius !== null ? { ...at, radius } : null;
}

const name = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().length <= 40 ? v.trim() : null);

export function parseNewRobot(input: unknown): NewRobot {
  const b = asBody(input);
  const problems: string[] = [];
  const n = name(b.name);
  if (!n) problems.push("name must be text up to 40 characters");
  const pos = position(b.position);
  if (!pos) problems.push(FLOOR_MESSAGE);
  const rotationY = num(b.rotationY ?? 0, -360, 360);
  if (rotationY === null) problems.push("rotationY must be degrees from -360 to 360");
  // The pick zone defaults to half a meter in front of the robot.
  const front = pos && rotationY !== null
    ? { x: pos.x + 0.5 * Math.cos((rotationY * Math.PI) / 180), z: pos.z - 0.5 * Math.sin((rotationY * Math.PI) / 180) }
    : { x: 0, z: 0 };
  const pick = parsePick(b.pick ?? front, problems);
  const rules = parseRules(b.rules ?? [], problems);
  const otherwise = b.otherwise == null ? null : parseTarget(b.otherwise, "otherwise", problems);
  if (problems.length) throw new ValidationError(problems);
  return { name: n!, position: pos!, rotationY: rotationY!, pick: pick!, rules: rules!, otherwise };
}

export function parseRobotPatch(input: unknown): RobotPatch {
  const b = asBody(input);
  const problems: string[] = [];
  const patch: RobotPatch = {};
  if (b.name !== undefined) {
    const n = name(b.name);
    if (n) patch.name = n;
    else problems.push("name must be text up to 40 characters");
  }
  if (b.position !== undefined) {
    const p = position(b.position);
    if (p) patch.position = p;
    else problems.push(FLOOR_MESSAGE);
  }
  if (b.rotationY !== undefined) {
    const r = num(b.rotationY, -360, 360);
    if (r === null) problems.push("rotationY must be degrees from -360 to 360");
    else patch.rotationY = r;
  }
  if (b.pick !== undefined) {
    const p = parsePick(b.pick, problems);
    if (p) patch.pick = p;
  }
  if (b.rules !== undefined) {
    const r = parseRules(b.rules, problems);
    if (r) patch.rules = r;
  }
  if (b.otherwise !== undefined) {
    if (b.otherwise === null) patch.otherwise = null;
    else {
      const t = parseTarget(b.otherwise, "otherwise", problems);
      if (t) patch.otherwise = t;
    }
  }
  const unknown = Object.keys(b).filter((k) => !["name", "position", "rotationY", "pick", "rules", "otherwise"].includes(k));
  if (unknown.length) problems.push(`can't change ${unknown.join(", ")}`);
  if (!problems.length && Object.keys(patch).length === 0) problems.push("nothing to change");
  if (problems.length) throw new ValidationError(problems);
  return patch;
}

/** Every target a robot uses: its rules' and its otherwise. */
export function targetsOf(r: Pick<Robot, "rules" | "otherwise">): Target[] {
  return [...r.rules.map((x) => x.target), ...(r.otherwise ? [r.otherwise] : [])];
}
