/**
 * How the gripper takes hold of a shape: how wide the fingers close, how high up the shape
 * they grip, and which way they face. Pure math on the shape and the gripper's
 * measurements, so it's unit-tested (tests/pick.test.ts).
 *
 * The claw always comes down from above, its four fingers level and 90° apart, and they
 * all close together, so they stop when the first pair touches: a box is held across its
 * longer side (the fingers square to its faces, so the other pair has the shorter side
 * between them), a round shape across its diameter at the grip height.
 */
import { FINGERTIP_BELOW_TCP, GAP_CLOSED, GAP_OPEN, PALM_ABOVE_TCP } from "../arm/gripperSpec";
import type { Shape } from "../shapes/types";

/** Widest grip: fully open, less a few millimeters each side to come down past the shape. */
export const MAX_GRIP = GAP_OPEN - 0.006;
/** Narrowest: anything thinner slips between the closed pads. */
export const MIN_GRIP = GAP_CLOSED + 0.002;
/** Keep this much air between the palm and the shape's top. */
const PALM_CLEARANCE = 0.005;
/** And between the fingertips and whatever the shape stands on. */
const FLOOR_CLEARANCE = 0.005;

export type Grasp =
  | {
      ok: true;
      /** Gap between the pads when they close on the shape, in meters. */
      width: number;
      /** Height of the TCP (the middle of the pads) above the shape's base. */
      height: number;
      /**
       * Which way the fingers close, as a turn about the vertical in degrees (like a shape's
       * rotationY), or null when any direction will do (round shapes).
       */
      fingerYaw: number | null;
    }
  | { ok: false; reason: string };

type Graspable = Pick<Shape, "kind" | "size" | "rotationY">;

/**
 * Height of the TCP above a shape's base when gripping it: halfway up, unless that would
 * push the palm into the top, and never so low that the fingertips touch the floor.
 */
export function gripHeight(h: number): number {
  return Math.max(h / 2, h - PALM_ABOVE_TCP + PALM_CLEARANCE, FINGERTIP_BELOW_TCP + FLOOR_CLEARANCE);
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;

export function graspFor(shape: Graspable): Grasp {
  const { x: w, y: h, z: d } = shape.size;

  const height = gripHeight(h);
  const tooWide = (width: string) => ({ ok: false as const, reason: `Too wide to grip: ${width}, and the gripper opens to ${cm(GAP_OPEN)}.` });
  const tooThin = { ok: false as const, reason: "Too thin to grip: it would slip between the closed fingers." };

  switch (shape.kind) {
    case "box": {
      // Fingers square to the faces: the pair across the longer side touches first.
      const width = contactGap(shape, shape.rotationY, height);
      if (width > MAX_GRIP) return tooWide(`${cm(w)} × ${cm(d)}`);
      if (width < MIN_GRIP) return tooThin;
      return { ok: true, height, width, fingerYaw: shape.rotationY };
    }
    case "cylinder":
      return w > MAX_GRIP ? tooWide(`⌀ ${cm(w)}`) : w < MIN_GRIP ? tooThin : { ok: true, width: w, height, fingerYaw: null };
    case "sphere": {
      // The width across the sphere at the grip height (a chord), not always the diameter.
      const r = w / 2;
      const off = height - r;
      const width = 2 * Math.sqrt(Math.max(0, r * r - off * off));
      if (width > MAX_GRIP) return tooWide(`⌀ ${cm(width)} at the grip`);
      return width < MIN_GRIP ? tooThin : { ok: true, width, height, fingerYaw: null };
    }
    case "cone": {
      // A cone narrows toward its tip: its width at the grip height.
      const width = w * Math.max(0, 1 - height / h);
      if (width > MAX_GRIP) return tooWide(`⌀ ${cm(width)} at the grip`);
      return width < MIN_GRIP ? tooThin : { ok: true, width, height, fingerYaw: null };
    }
  }
}

/**
 * Where the claw's fingers first touch a shape centered on its axis, as the gap between
 * opposite pads: the shape's widest reach along any of the four finger directions. Finger 0
 * points along `fingerYaw` (degrees, like rotationY); `height` is the pads' height above the
 * shape's base (round shapes narrow toward their top or tip).
 */
export function contactGap(shape: Graspable, fingerYaw: number, height: number): number {
  const { x: w, y: h, z: d } = shape.size;
  const DEG = Math.PI / 180;
  switch (shape.kind) {
    case "box": {
      // A box's support along a direction: its half-sizes along its own axes, projected.
      const r = shape.rotationY * DEG;
      let most = 0;
      for (let k = 0; k < 4; k++) {
        const a = (fingerYaw + 90 * k) * DEG;
        const along = Math.abs(Math.cos(a - r)); // toward its X faces
        const across = Math.abs(Math.sin(a - r)); // toward its Z faces
        most = Math.max(most, along * (w / 2) + across * (d / 2));
      }
      return 2 * most;
    }
    case "cylinder":
      return w;
    case "sphere": {
      const rad = w / 2;
      const off = height - rad;
      return 2 * Math.sqrt(Math.max(0, rad * rad - off * off));
    }
    case "cone":
      return w * Math.max(0, 1 - height / h);
  }
}
