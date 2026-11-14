/**
 * The claw's measurements that the planner needs, from src/arm/claw.ts (which
 * scripts/build-gripper.ts and Gripper.ts build the model from). Kept apart from Gripper.ts
 * (which needs Three.js) so the pick-and-place planner and its tests can use them.
 * Heights are along the tool axis, measured from the tool center point (TCP), which sits
 * between the pads.
 */
import { elbowY, angleForGap, HINGE_Y, LOWER, TCP_Y, TIP_CURL } from "./claw";

/** Gap between opposite pads, in meters, fully closed and fully open. */
export const GAP_CLOSED = 0.02;
export const GAP_OPEN = 0.16;

/** The fingertips reach this far past the TCP (most when closed: the fingers lean in and down)... */
export const FINGERTIP_BELOW_TCP = Math.ceil((elbowY(angleForGap(GAP_CLOSED)) + LOWER + TIP_CURL - TCP_Y) * 1000) / 1000;
/** ...and the palm starts this far back from it. */
export const PALM_ABOVE_TCP = Math.round((TCP_Y - HINGE_Y) * 1000) / 1000;
/** A carried shape's bottom passes this far above the surfaces it's picked from and put on (meters). */
export const CLEARANCE = 0.1;
