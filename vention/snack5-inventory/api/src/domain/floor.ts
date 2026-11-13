/**
 * The robot arm's floor: positions of shapes, belts, bins and robots are meters from the arm's
 * base, at most FLOOR_HALF each way.
 *
 * THE ONE PLACE TO CHANGE THE FLOOR SIZE: set FLOOR_SIZE (meters, the full width) in the API's
 * environment, e.g. `FLOOR_SIZE=30 npm start` or in docker-compose.yml, or change
 * DEFAULT_FLOOR_SIZE below. The arm app reads it from GET /api/config, and PostgreSQL's floor
 * checks are rebuilt from it every time the API starts.
 */
export const DEFAULT_FLOOR_SIZE = 20;
export const FLOOR_SIZE_LIMITS = [2, 200] as const;

/** The floor size from the environment: FLOOR_SIZE if it's a number in range, else the default. */
export function floorSizeFrom(env: Record<string, string | undefined>): number {
  const raw = env.FLOOR_SIZE?.trim();
  if (!raw) return DEFAULT_FLOOR_SIZE;
  const size = Number(raw);
  if (!Number.isFinite(size) || size < FLOOR_SIZE_LIMITS[0] || size > FLOOR_SIZE_LIMITS[1]) {
    throw new Error(`FLOOR_SIZE must be meters from ${FLOOR_SIZE_LIMITS[0]} to ${FLOOR_SIZE_LIMITS[1]}, not "${raw}"`);
  }
  return size;
}

export const FLOOR_SIZE = floorSizeFrom(process.env);
export const FLOOR_HALF = FLOOR_SIZE / 2;

export const FLOOR_MESSAGE = `position must be { x, z } in meters, each from -${FLOOR_HALF} to ${FLOOR_HALF}`;
