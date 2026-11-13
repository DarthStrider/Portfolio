/** Conveyor belts as the inventory API stores them (snack5-inventory/api/src/domain/conveyors.ts). */
export interface Conveyor {
  id: string;
  name: string;
  /** Meters along the direction of travel: a curve's arc at the middle of the belt; a transfer's side. */
  length: number;
  /** Meters across. */
  width: number;
  /** Height of the belt surface, meters. */
  height: number;
  /** Meters per second along the belt's own +x; negative runs it backwards. */
  speed: number;
  /** A straight's or transfer's center; for a curve, the point it turns about. */
  position: { x: number; z: number };
  /** Degrees about the vertical axis: the way a straight runs, or a curve's or transfer's heading in. */
  rotationY: number;
  /** A line is built from sections: straight belts, curves, and transfers at square corners. */
  kind: SectionKind;
  /** Degrees a curve or transfer turns, positive to the left; 0 for a straight. */
  turn: number;
  /** A curve's radius at the middle of the belt, meters; 0 otherwise. */
  radius: number;
  /** The line this section belongs to, or null for a belt on its own. */
  lineId: string | null;
  /** Its place in the line, from 0. */
  lineIndex: number;
  createdAt: string;
  updatedAt: string;
}

export type SectionKind = "straight" | "curve" | "transfer";

export type NewConveyor = Omit<Conveyor, "id" | "createdAt" | "updatedAt" | "kind" | "turn" | "radius" | "lineId" | "lineIndex">
  & Partial<Pick<Conveyor, "kind" | "turn" | "radius" | "lineId" | "lineIndex">>;
export type ConveyorPatch = Partial<Pick<Conveyor, "name" | "position" | "rotationY" | "speed" | "lineId" | "lineIndex">>;
