/**
 * The work cell, in meters. Physics and rendering both build from these numbers,
 * so what you see is exactly what collides.
 */

export const GRAVITY = -9.81;
export const FIXED_STEP = 1 / 120; // physics runs at 120 Hz whatever the display does
export const MAX_SUBSTEPS = 8; // per frame; beyond this we drop time instead of spiralling
export const MAX_BODIES = 4096;
export const DENSITY = 500; // kg/m³, roughly cardboard boxes with something in them

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface StaticCollider {
  name: string;
  min: V3;
  max: V3;
  /** The conveyor belt: its surface drags boxes along at the belt speed through friction. */
  conveyor?: boolean;
  /** Draw it? The floor is drawn separately as a grid. */
  visible?: boolean;
}

export const BELT = { minX: -1.6, maxX: 0.6, halfWidth: 0.25, topY: 0.6, thickness: 0.05 };
export const BIN = { minX: 0.6, maxX: 1.5, halfDepth: 0.55, height: 0.5, wall: 0.04 };
export const SPAWN = { x: -1.45, y: 0.95, zJitter: 0.14 };

const RAIL_HEIGHT = 0.1;
const RAIL_THICKNESS = 0.02;

export const STATICS: readonly StaticCollider[] = [
  // A thick floor, so fast-falling boxes can't step right through it in one physics step.
  { name: "floor", min: { x: -8, y: -1, z: -8 }, max: { x: 8, y: 0, z: 8 }, visible: false },
  {
    name: "belt",
    min: { x: BELT.minX, y: BELT.topY - BELT.thickness, z: -BELT.halfWidth },
    max: { x: BELT.maxX, y: BELT.topY, z: BELT.halfWidth },
    conveyor: true,
  },
  {
    name: "rail-left",
    min: { x: BELT.minX, y: BELT.topY, z: -BELT.halfWidth - RAIL_THICKNESS },
    max: { x: BELT.maxX, y: BELT.topY + RAIL_HEIGHT, z: -BELT.halfWidth },
  },
  {
    name: "rail-right",
    min: { x: BELT.minX, y: BELT.topY, z: BELT.halfWidth },
    max: { x: BELT.maxX, y: BELT.topY + RAIL_HEIGHT, z: BELT.halfWidth + RAIL_THICKNESS },
  },
  {
    name: "backstop",
    min: { x: BELT.minX - RAIL_THICKNESS, y: BELT.topY, z: -BELT.halfWidth - RAIL_THICKNESS },
    max: { x: BELT.minX, y: BELT.topY + RAIL_HEIGHT, z: BELT.halfWidth + RAIL_THICKNESS },
  },
  // The bin: four walls on the floor, open at the top.
  {
    name: "bin-near",
    min: { x: BIN.minX, y: 0, z: -BIN.halfDepth },
    max: { x: BIN.minX + BIN.wall, y: BIN.height, z: BIN.halfDepth },
  },
  {
    name: "bin-far",
    min: { x: BIN.maxX - BIN.wall, y: 0, z: -BIN.halfDepth },
    max: { x: BIN.maxX, y: BIN.height, z: BIN.halfDepth },
  },
  {
    name: "bin-left",
    min: { x: BIN.minX, y: 0, z: -BIN.halfDepth },
    max: { x: BIN.maxX, y: BIN.height, z: -BIN.halfDepth + BIN.wall },
  },
  {
    name: "bin-right",
    min: { x: BIN.minX, y: 0, z: BIN.halfDepth - BIN.wall },
    max: { x: BIN.maxX, y: BIN.height, z: BIN.halfDepth },
  },
];

/**
 * A handful of box sizes (half extents). Using presets rather than random sizes
 * lets the cannon-es backend share one shape per size, and gives each size a color.
 */
export const SIZE_PRESETS: readonly V3[] = [
  { x: 0.05, y: 0.05, z: 0.05 },
  { x: 0.06, y: 0.04, z: 0.05 },
  { x: 0.04, y: 0.04, z: 0.04 },
  { x: 0.055, y: 0.03, z: 0.045 },
  { x: 0.035, y: 0.05, z: 0.035 },
  { x: 0.06, y: 0.05, z: 0.06 },
];
export const MAX_HALF_EXTENT = 0.06;

/** Where a stress-test burst rains down: over the belt end, the bin and the floor around it. */
export const BURST_AREA = { minX: -0.2, maxX: 2.6, minZ: -1.4, maxZ: 1.4, baseY: 1.0, spacing: 0.14 };

/** Boxes outside this are removed (fell off the world, or got flung away). */
export const BOUNDS = { minY: -2, maxAbsXZ: 6 };
