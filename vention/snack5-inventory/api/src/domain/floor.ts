/**
 * The robot arm's floor: positions of shapes, belts and bins are meters from the arm's base,
 * at most FLOOR_HALF each way (a 20 m × 20 m area). The arm app uses the same number, and
 * schema.sql's CHECK constraints spell it out for PostgreSQL.
 */
export const FLOOR_HALF = 10;

export const FLOOR_MESSAGE = `position must be { x, z } in meters, each from -${FLOOR_HALF} to ${FLOOR_HALF}`;
