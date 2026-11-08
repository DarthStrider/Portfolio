/** Conveyor belts as the inventory API stores them (snack5-inventory/api/src/domain/conveyors.ts). */
export interface Conveyor {
  id: string;
  name: string;
  /** Meters along the direction of travel. */
  length: number;
  /** Meters across. */
  width: number;
  /** Height of the belt surface, meters. */
  height: number;
  /** Meters per second along the belt's own +x; negative runs it backwards. */
  speed: number;
  position: { x: number; z: number };
  /** Degrees about the vertical axis. */
  rotationY: number;
  createdAt: string;
  updatedAt: string;
}

export type NewConveyor = Omit<Conveyor, "id" | "createdAt" | "updatedAt">;
export type ConveyorPatch = Partial<Pick<Conveyor, "name" | "position" | "rotationY" | "speed">>;
