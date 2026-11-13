/** Automated robots as the inventory API stores them (snack5-inventory/api/src/domain/robots.ts). */
import type { Condition } from "../splitters/types";

export type Target =
  /** A spot on the floor: items are laid out in a grid around it. */
  | { type: "spot"; x: number; z: number }
  /** On a straight belt, `along` meters from its start. */
  | { type: "belt"; conveyorId: string; along: number }
  /** Into a bin. */
  | { type: "bin"; binId: string };

export interface RobotRule {
  conditions: Condition[];
  target: Target;
}

export interface Robot {
  id: string;
  name: string;
  position: { x: number; z: number };
  /** Which way it faces, degrees, like a belt's rotationY. */
  rotationY: number;
  /** The circle it picks from. */
  pick: { x: number; z: number; radius: number };
  rules: RobotRule[];
  /** Where items no rule matches go; null leaves them alone. */
  otherwise: Target | null;
  createdAt: string;
  updatedAt: string;
}

export type NewRobot = Omit<Robot, "id" | "createdAt" | "updatedAt" | "pick"> & { pick?: Robot["pick"] };
export type RobotPatch = Partial<Pick<Robot, "name" | "position" | "rotationY" | "pick" | "rules" | "otherwise">>;
