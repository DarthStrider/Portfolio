/**
 * The floor you can build on: a square floorHalf() meters each way from the arm's base.
 *
 * The size is the inventory API's setting (FLOOR_SIZE, see snack5-inventory/api/src/domain/
 * floor.ts): main.ts asks GET /api/config at startup and calls setFloorHalf. Until then, or
 * without the API, it's the API's default, 20 m × 20 m.
 */
let half = 10;
const listeners: ((half: number) => void)[] = [];

export function floorHalf(): number {
  return half;
}

export function setFloorHalf(h: number): void {
  if (!Number.isFinite(h) || h <= 0 || h === half) return;
  half = h;
  for (const fn of listeners) fn(half);
}

/** Called now and whenever the size changes: the grid, the camera limits. */
export function onFloorChange(fn: (half: number) => void): void {
  listeners.push(fn);
  fn(half);
}

/** True if (x, z) is on the floor, keeping `margin` meters from the edge. */
export function onFloor(x: number, z: number, margin = 0): boolean {
  return Math.abs(x) <= half - margin && Math.abs(z) <= half - margin;
}
