/**
 * The floor you can build on: a square FLOOR_HALF meters each way from the arm's base, so
 * 20 m × 20 m. The inventory API (Snack 5) checks positions against the same number.
 */
export const FLOOR_HALF = 10;

/** True if (x, z) is on the floor, keeping `margin` meters from the edge. */
export function onFloor(x: number, z: number, margin = 0): boolean {
  return Math.abs(x) <= FLOOR_HALF - margin && Math.abs(z) <= FLOOR_HALF - margin;
}
