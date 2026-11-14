/**
 * Writes public/models/gripper.glb: a four-finger claw as a binary glTF 2.0 file.
 *
 * No dependencies: geometry, buffer layout and the GLB container are built by hand, which
 * keeps the asset reproducible from source. Run with `npm run build:gripper`. Every
 * measurement comes from src/arm/claw.ts, which the app and the planner use too.
 *
 * Node hierarchy (names matter, Gripper.ts looks them up):
 *   Gripper
 *   ├── Palm
 *   ├── Mount0 (turned 0° about the axis)
 *   │   └── Finger0   upper finger, hinged at the palm: turns about its Z to open
 *   │       └── Knuckle0  the elbow: lower finger with the pad, turns back the same
 *   ├── Mount1 (90°) … Mount3 (270°)
 *
 * Units are meters, +Y points away from the wrist flange, matching the glTF convention.
 * The file is written with the claw fully open.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { angleForGap, HINGE_Y, LOWER, PAD_FROM, PAD_INSET, PAD_TO, ROOT_RADIUS, UPPER } from "../src/arm/claw";
import { GAP_OPEN } from "../src/arm/gripperSpec";

type V3 = [number, number, number];

interface Box {
  center: V3;
  size: V3;
  /** Turn about Z, degrees (the claw's curled tips). */
  rotZ?: number;
}

// For each face: outward normal n, and in-plane axes u, v with u × v = n,
// so the corners below wind counter-clockwise when seen from outside (glTF front faces).
const FACES: { n: V3; u: V3; v: V3 }[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/** Boxes merged into one flat-shaded mesh: 4 vertices and 2 triangles per face. */
function boxesToMesh(boxes: Box[]) {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const { center, size, rotZ = 0 } of boxes) {
    const c = Math.cos((rotZ * Math.PI) / 180);
    const s = Math.sin((rotZ * Math.PI) / 180);
    const turn = (p: V3): V3 => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
    for (const { n, u, v } of FACES) {
      const first = positions.length / 3;
      for (const [su, sv] of CORNERS) {
        const local: V3 = [0, 1, 2].map((k) => ((n[k] + su * u[k] + sv * v[k]) * size[k]) / 2) as V3;
        const p = turn(local);
        positions.push(center[0] + p[0], center[1] + p[1], center[2] + p[2]);
        normals.push(...turn(n));
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  return { positions, normals, indices };
}

// ---- Geometry ----

const palm: Box[] = [
  { center: [0, 0.01, 0], size: [0.09, 0.02, 0.09] }, // mounting flange
  { center: [0, 0.04, 0], size: [0.13, 0.04, 0.13] }, // body: its underside is HINGE_Y
];

/** Upper finger, in its own frame: from the root hinge (origin) up its +Y to the elbow. */
const upper: Box[] = [
  { center: [0, 0, 0], size: [0.02, 0.02, 0.026] }, // root hinge barrel
  { center: [0, UPPER / 2, 0], size: [0.016, UPPER, 0.022] },
];
const elbow: Box[] = [{ center: [0, UPPER, 0], size: [0.024, 0.024, 0.028] }]; // the elbow joint

/** Lower finger, from the elbow (origin): the bar, the curled tip, and the pad on the inside (-X). */
const lower: Box[] = [
  { center: [0, LOWER / 2, 0], size: [0.016, LOWER, 0.022] },
  { center: [-0.006, LOWER + 0.006, 0], size: [0.014, 0.024, 0.02], rotZ: 35 }, // curls in toward the axis
];
const padFace = -PAD_INSET;
const padBox: Box[] = [{ center: [padFace + 0.003, (PAD_FROM + PAD_TO) / 2, 0], size: [0.006, PAD_TO - PAD_FROM, 0.02] }];

// ---- glTF JSON + binary buffer ----

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;

const binChunks: Buffer[] = [];
let binLength = 0;
const bufferViews: object[] = [];
const accessors: object[] = [];
const meshes: object[] = [];

function addBufferView(data: Buffer, target: number): number {
  const padding = (4 - (binLength % 4)) % 4; // keep every view 4-byte aligned
  if (padding) {
    binChunks.push(Buffer.alloc(padding));
    binLength += padding;
  }
  bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: data.length, target });
  binChunks.push(data);
  binLength += data.length;
  return bufferViews.length - 1;
}

function addAccessor(accessor: object): number {
  accessors.push(accessor);
  return accessors.length - 1;
}

function addMesh(name: string, parts: { boxes: Box[]; material: number }[]): number {
  meshes.push({ name, primitives: parts.map(({ boxes, material }) => primitive(boxes, material)) });
  return meshes.length - 1;
}

function primitive(boxes: Box[], material: number) {
  const { positions, normals, indices } = boxesToMesh(boxes);
  const pos = new Float32Array(positions);
  const count = pos.length / 3;

  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    min[i % 3] = Math.min(min[i % 3], pos[i]);
    max[i % 3] = Math.max(max[i % 3], pos[i]);
  }

  const position = addAccessor({
    bufferView: addBufferView(Buffer.from(pos.buffer), ARRAY_BUFFER),
    componentType: FLOAT, count, type: "VEC3", min, max,
  });
  const normal = addAccessor({
    bufferView: addBufferView(Buffer.from(new Float32Array(normals).buffer), ARRAY_BUFFER),
    componentType: FLOAT, count, type: "VEC3",
  });
  const index = addAccessor({
    bufferView: addBufferView(Buffer.from(new Uint16Array(indices).buffer), ELEMENT_ARRAY_BUFFER),
    componentType: UNSIGNED_SHORT, count: indices.length, type: "SCALAR",
  });

  return { attributes: { POSITION: position, NORMAL: normal }, indices: index, material };
}

const ANODIZED = 0;
const ACCENT = 1;
const RUBBER = 2;
const palmMesh = addMesh("Palm", [{ boxes: palm, material: ANODIZED }]);
// One mesh for all four upper fingers, one for the lower ones: glTF nodes can share a mesh.
const upperMesh = addMesh("UpperFinger", [{ boxes: upper, material: ACCENT }, { boxes: elbow, material: ANODIZED }]);
const lowerMesh = addMesh("LowerFinger", [{ boxes: lower, material: ACCENT }, { boxes: padBox, material: RUBBER }]);

/** A unit quaternion turning `deg` about an axis. */
const quat = (axis: "y" | "z", deg: number): number[] => {
  const h = (deg * Math.PI) / 360;
  return axis === "y" ? [0, Math.sin(h), 0, Math.cos(h)] : [0, 0, Math.sin(h), Math.cos(h)];
};

const OPEN = angleForGap(GAP_OPEN); // written fully open; Gripper.ts sets the angle every frame
const nodes: object[] = [
  { name: "Gripper", children: [1, 2, 5, 8, 11] },
  { name: "Palm", mesh: palmMesh },
];
for (let k = 0; k < 4; k++) {
  const mount = nodes.length;
  nodes.push(
    // Turning the mount turns the finger's "outward" (+X) to its side of the claw.
    { name: `Mount${k}`, rotation: quat("y", k * 90), children: [mount + 1] },
    // Opening swings the upper finger outward: a turn of -θ about its Z takes +Y toward +X.
    { name: `Finger${k}`, mesh: upperMesh, translation: [ROOT_RADIUS, HINGE_Y, 0], rotation: quat("z", -OPEN), children: [mount + 2] },
    // The elbow turns back by +θ, so the lower finger and its pad stay upright.
    { name: `Knuckle${k}`, mesh: lowerMesh, translation: [0, UPPER, 0], rotation: quat("z", OPEN) },
  );
}

const gltf = {
  asset: { version: "2.0", generator: "robot-arm/scripts/build-gripper.ts" },
  scene: 0,
  scenes: [{ name: "Gripper", nodes: [0] }],
  nodes,
  meshes,
  materials: [
    {
      name: "Anodized",
      pbrMetallicRoughness: { baseColorFactor: [0.16, 0.17, 0.19, 1], metallicFactor: 0.6, roughnessFactor: 0.45 },
    },
    {
      name: "Accent",
      pbrMetallicRoughness: { baseColorFactor: [0.95, 0.42, 0.08, 1], metallicFactor: 0.1, roughnessFactor: 0.55 },
    },
    {
      name: "Rubber",
      pbrMetallicRoughness: { baseColorFactor: [0.08, 0.08, 0.09, 1], metallicFactor: 0, roughnessFactor: 0.9 },
    },
  ],
  accessors,
  bufferViews,
  buffers: [{ byteLength: binLength }],
};

// ---- GLB container: 12-byte header, JSON chunk (space padded), BIN chunk (zero padded) ----

function pad(data: Buffer, fill: number): Buffer {
  const padding = (4 - (data.length % 4)) % 4;
  return padding ? Buffer.concat([data, Buffer.alloc(padding, fill)]) : data;
}

const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
const bin = pad(Buffer.concat(binChunks), 0x00);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);

function chunkHeader(length: number, type: number): Buffer {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(length, 0);
  h.writeUInt32LE(type, 4);
  return h;
}

const glb = Buffer.concat([
  header,
  chunkHeader(json.length, 0x4e4f534a), // "JSON"
  json,
  chunkHeader(bin.length, 0x004e4942), // "BIN\0"
  bin,
]);

const out = fileURLToPath(new URL("../public/models/gripper.glb", import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
console.log(`Wrote ${out} (${glb.length} bytes)`);
