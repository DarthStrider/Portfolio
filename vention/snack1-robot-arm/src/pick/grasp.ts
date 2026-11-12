/**
 * How the gripper takes hold of a shape: how wide the fingers close, how high up the shape
 * they grip, and which way they face. Pure math on the shape and the gripper's
 * measurements, so it's unit-tested (tests/pick.test.ts).
 *
 * The gripper always comes down from above with its fingers level, so a shape is gripped
 * across a horizontal width: a box across one pair of its sides, a round shape across its
 * diameter at the grip height.
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
      // Across the box's width (its X sides) or its depth (Z sides): the narrower one that fits.
      const options = [
        { width: w, fingerYaw: shape.rotationY },
        { width: d, fingerYaw: shape.rotationY + 90 },
      ].filter((o) => o.width >= MIN_GRIP && o.width <= MAX_GRIP);
      if (options.length === 0) return Math.min(w, d) < MIN_GRIP ? tooThin : tooWide(`${cm(w)} × ${cm(d)}`);
      const best = options.reduce((a, b) => (b.width < a.width ? b : a));
      return { ok: true, height, ...best };
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
