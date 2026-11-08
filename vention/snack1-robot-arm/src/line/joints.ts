/**
 * Joining geometry: where a connection point is on an object, where to put one object so its
 * point meets another's, and where everything in an assembly is in the world. Pure math, no
 * Three.js, so it's unit-tested.
 *
 * Rotations are about the vertical axis in degrees, with Three.js's sign: turning a vector
 * (x, z) by θ gives (x cos θ + z sin θ, −x sin θ + z cos θ).
 */
import type { Shape } from "../shapes/types";
import type { Attachment, ConnectionPoint, Connectors, Owner } from "./types";

export const DEFAULT_POINTS: readonly ConnectionPoint[] = [
  { name: "top", x: 0, y: 0.5, z: 0 },
  { name: "bottom", x: 0, y: -0.5, z: 0 },
];

const DEG = Math.PI / 180;

export function ownerOf(shape: Pick<Shape, "sku" | "kind">): Owner {
  return shape.sku ? `part:${shape.sku}` : `kind:${shape.kind}`;
}

/** The points for a kind of object: what's stored, or the defaults. */
export function pointsFor(owner: Owner, stored: readonly Connectors[]): readonly ConnectionPoint[] {
  return stored.find((c) => c.owner === owner)?.points ?? DEFAULT_POINTS;
}

export function findPoint(owner: Owner, name: string, stored: readonly Connectors[]): ConnectionPoint | undefined {
  return pointsFor(owner, stored).find((p) => p.name.toLowerCase() === name.toLowerCase());
}

export function turn(x: number, z: number, degrees: number): { x: number; z: number } {
  const t = degrees * DEG;
  return { x: x * Math.cos(t) + z * Math.sin(t), z: -x * Math.sin(t) + z * Math.cos(t) };
}

/** A connection point in meters, in the object's own frame (from its center, before its turn). */
export function localPoint(shape: Pick<Shape, "size">, p: ConnectionPoint): { x: number; y: number; z: number } {
  return { x: p.x * shape.size.x, y: p.y * shape.size.y, z: p.z * shape.size.z };
}

/**
 * Where to put `attached` so its point meets `base`'s point, keeping the attached object's
 * current heading in the world. Returned in the base's frame, which is how it's stored: then
 * the pair moves and turns together.
 */
export function attachmentFor(
  base: Pick<Shape, "size" | "rotationY">, basePoint: ConnectionPoint,
  attached: Pick<Shape, "size" | "rotationY">, attachedPoint: ConnectionPoint,
): Attachment {
  const relative = attached.rotationY - base.rotationY;
  const b = localPoint(base, basePoint);
  const a = localPoint(attached, attachedPoint);
  const at = turn(a.x, a.z, relative); // the attached point, turned into the base's frame
  return { x: b.x - at.x, y: b.y - a.y, z: b.z - at.z, rotationY: relative };
}

export interface Pose {
  /** Center of the object in the world. */
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

/**
 * The world pose of every shape. Shapes on their own come from `rootPose` (where they stand,
 * or where the belts have carried them); joined shapes follow their base, through any number
 * of joins.
 */
export function poses(
  shapes: readonly Shape[],
  rootPose: (s: Shape) => Pose,
  links: ReadonlyMap<string, { parentId: string; attach: Attachment }> = new Map(),
): Map<string, Pose> {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const out = new Map<string, Pose>();
  const linkOf = (s: Shape) => links.get(s.id) ?? (s.attachedTo && s.attach ? { parentId: s.attachedTo, attach: s.attach } : undefined);
  const visit = (s: Shape, depth: number): Pose => {
    const done = out.get(s.id);
    if (done) return done;
    const link = linkOf(s);
    const parent = link && byId.get(link.parentId);
    let pose: Pose;
    if (!link || !parent || depth > 50) pose = rootPose(s);
    else {
      const p = visit(parent, depth + 1);
      const o = turn(link.attach.x, link.attach.z, p.rotationY);
      pose = { x: p.x + o.x, y: p.y + link.attach.y, z: p.z + o.z, rotationY: p.rotationY + link.attach.rotationY };
    }
    out.set(s.id, pose);
    return pose;
  };
  for (const s of shapes) visit(s, 0);
  return out;
}

/** The shape at the bottom of a chain of joins: the one that stands on the floor or a belt. */
export function rootOf(id: string, shapes: readonly Shape[], links: ReadonlyMap<string, { parentId: string }> = new Map()): string {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  let cur = id;
  for (let i = 0; i < 50; i++) {
    const s = byId.get(cur);
    const parent = links.get(cur)?.parentId ?? s?.attachedTo ?? null;
    if (!parent || !byId.has(parent)) return cur;
    cur = parent;
  }
  return cur;
}
