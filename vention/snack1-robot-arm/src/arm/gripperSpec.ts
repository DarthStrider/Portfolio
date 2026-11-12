/**
 * The gripper's measurements, from scripts/build-gripper.ts. Kept apart from Gripper.ts
 * (which needs Three.js) so the pick-and-place planner and its tests can use them.
 * Heights are along the tool axis, measured from the tool center point (TCP), which
 * sits between the grip pads.
 */

/** Gap between the grip pads, in meters, fully closed and fully open. */
export const GAP_CLOSED = 0.006;
export const GAP_OPEN = 0.126;

/** Distance from a finger node's origin to the inner face of its grip pad. */
export const PAD_INSET = 0.022;

/** The fingertips reach this far past the TCP... */
export const FINGERTIP_BELOW_TCP = 0.015;
/** ...and the gripper's body (the palm) starts this far back from it. */
export const PALM_ABOVE_TCP = 0.055;
