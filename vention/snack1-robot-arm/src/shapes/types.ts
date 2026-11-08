/** Shapes as the inventory API stores them (snack5-inventory/api/src/domain/shapes.ts). */

export type ShapeKind = "box" | "cylinder" | "sphere" | "cone";
export const SHAPE_KINDS: readonly ShapeKind[] = ["box", "cylinder", "sphere", "cone"];

/** Bounding box in meters: width, height, depth. Round shapes have depth = width. */
export interface Size {
  x: number;
  y: number;
  z: number;
}

export interface Shape {
  id: string;
  name: string;
  kind: ShapeKind;
  size: Size;
  color: string;
  /** Floor position of the center, in meters. */
  position: { x: number; z: number };
  /** Degrees about the vertical axis. */
  rotationY: number;
  /** The inventory part this shape stands for, or null for a plain shape. */
  sku: string | null;
  /** Set once a machine has joined it onto another shape: it then moves with that shape. */
  attachedTo?: string | null;
  /** Where it sits on that shape: its center in that shape's frame (meters), and its turn relative to it. */
  attach?: { x: number; y: number; z: number; rotationY: number } | null;
  createdAt: string;
  updatedAt: string;
}

export type NewShape = Omit<Shape, "id" | "createdAt" | "updatedAt" | "attachedTo" | "attach">;
export type ShapePatch = Partial<Pick<Shape, "name" | "color" | "position" | "rotationY">>;
