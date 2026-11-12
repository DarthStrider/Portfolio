/**
 * Writes public/models/gripper.glb: a two-finger parallel gripper as a binary glTF 2.0 file.
 *
 * No dependencies: geometry, buffer layout and the GLB container are built by hand, which
 * keeps the asset reproducible from source. Run with `npm run build:gripper`.
 *
 * Node hierarchy (names matter, Gripper.ts looks them up):
 *   Gripper
 *   ├── Palm
 *   ├── FingerLeft   (origin at the finger root, slides along X)
 *   └── FingerRight
 *
 * Units are meters, +Y points away from the wrist flange, matching the glTF convention.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

type V3 = [number, number, number];

interface Box {
  center: V3;
  size: V3;
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
  for (const { center, size } of boxes) {
    for (const { n, u, v } of FACES) {
      const first = positions.length / 3;
      for (const [su, sv] of CORNERS) {
        for (let k = 0; k < 3; k++) {
          positions.push(center[k] + ((n[k] + su * u[k] + sv * v[k]) * size[k]) / 2);
        }
        normals.push(...n);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  return { positions, normals, indices };
}

// ---- Geometry ----

const palm: Box[] = [
  { center: [0, 0.01, 0], size: [0.09, 0.02, 0.09] }, // mounting flange
  { center: [0, 0.04, 0], size: [0.18, 0.04, 0.07] }, // body, top face at y = 0.06
];

/** side = +1 for the left finger (pad faces +X, toward the center), -1 for the right. */
function finger(side: 1 | -1): Box[] {
  return [
    { center: [0, 0.035, 0], size: [0.02, 0.07, 0.05] }, // finger
    { center: [side * 0.016, 0.055, 0], size: [0.012, 0.03, 0.044] }, // grip pad
  ];
}

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

function addMesh(name: string, boxes: Box[], material: number): number {
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

  meshes.push({ name, primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices: index, material }] });
  return meshes.length - 1;
}

const ANODIZED = 0;
const ACCENT = 1;
const palmMesh = addMesh("Palm", palm, ANODIZED);
const leftMesh = addMesh("FingerLeft", finger(1), ACCENT);
const rightMesh = addMesh("FingerRight", finger(-1), ACCENT);

const OPEN_X = 0.085; // fully open: 12.6 cm between the grip pads (src/arm/Gripper.ts)
const gltf = {
  asset: { version: "2.0", generator: "robot-arm/scripts/build-gripper.ts" },
  scene: 0,
  scenes: [{ name: "Gripper", nodes: [0] }],
  nodes: [
    { name: "Gripper", children: [1, 2, 3] },
    { name: "Palm", mesh: palmMesh },
    { name: "FingerLeft", mesh: leftMesh, translation: [-OPEN_X, 0.06, 0] },
    { name: "FingerRight", mesh: rightMesh, translation: [OPEN_X, 0.06, 0] },
  ],
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
