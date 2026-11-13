import * as THREE from "three";
import { DEG } from "../arm/kinematics";
import { curveFrame, type Pose } from "./sections";
import type { Conveyor } from "./types";

/** One chevron per this many meters of belt. */
const CHEVRON_PITCH = 0.25;
const FRAME_DEPTH = 0.06; // the belt bed under the surface
const RAIL = 0.015; // side rail thickness and height above the belt

/** Enough to draw a section. Without a kind it's a straight belt. */
type Belt = Pick<Conveyor, "length" | "width" | "height"> & Partial<Pick<Conveyor, "kind" | "turn" | "radius" | "rotationY">>;

/** What the model depends on. A curve is built at its own angles, so its heading counts too. */
const shapeKey = (b: Belt) =>
  `${b.kind ?? "straight"}:${b.length}:${b.width}:${b.height}:${b.turn ?? 0}:${b.radius ?? 0}:${b.kind === "curve" ? b.rotationY : ""}`;

/**
 * Draws the conveyors. Each belt is a group in its own frame: x along its length (the way
 * it runs at a positive speed), z across, y up from the floor. The group's rotation about y
 * is the stored rotationY, which is the same convention transport.ts uses, so what you see
 * and what moves the shapes agree.
 *
 * Like ShapeLayer, sync() makes the scene match the API's list, keyed by id.
 *
 * Curves and transfers are drawn the same way: a curve's group sits at the point it turns
 * about, unrotated, and its ring segment is built at the right angles; a transfer's group is
 * at its center, turned to its heading like a straight's.
 */
export class ConveyorLayer {
  readonly root = new THREE.Group();
  private readonly belts = new Map<string, { group: THREE.Group; key: string; surface: THREE.Mesh; texture: THREE.CanvasTexture; frame: THREE.MeshStandardMaterial; speed: number; moves: boolean }>();
  /** An arrow at the open end of the selected line, where the next section will go. */
  private readonly endMarker = new THREE.Mesh(
    new THREE.ConeGeometry(0.035, 0.09, 16).rotateZ(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x1d4ed8 }),
  );
  private readonly ghost = new THREE.Group();
  private ghostKey = "";
  private readonly chevrons = chevronCanvas();
  private selectedId: string | null = null;

  constructor() {
    this.root.name = "Conveyors";
    this.ghost.visible = false;
    this.root.add(this.ghost);
    this.endMarker.visible = false;
    this.root.add(this.endMarker);
  }

  sync(list: readonly Conveyor[]): void {
    const keep = new Set(list.map((b) => b.id));
    for (const [id, belt] of this.belts) {
      if (!keep.has(id)) {
        this.root.remove(belt.group);
        disposeTree(belt.group);
        belt.texture.dispose();
        this.belts.delete(id);
      }
    }
    for (const b of list) {
      const key = shapeKey(b);
      let belt = this.belts.get(b.id);
      if (belt && belt.key !== key) {
        // A different size is a different model; rebuild it (sizes don't change from this app today).
        this.root.remove(belt.group);
        disposeTree(belt.group);
        belt.texture.dispose();
        belt = undefined;
      }
      if (!belt) {
        // A transfer's surface is a picture of rollers and an arrow; the others scroll chevrons.
        const moves = b.kind !== "transfer";
        const texture = new THREE.CanvasTexture(moves ? this.chevrons : transferCanvas(b.turn ?? 90));
        texture.wrapS = THREE.RepeatWrapping;
        if (moves) texture.repeat.set(b.length / CHEVRON_PITCH, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
        const frame = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.6, metalness: 0.4 });
        const { group, surface } = buildSection(b, frame, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, side: THREE.DoubleSide }));
        group.traverse((o) => (o.userData.beltId = b.id));
        belt = { group, key, surface, texture, frame, speed: b.speed, moves };
        this.belts.set(b.id, belt);
        this.root.add(group);
      }
      belt.speed = b.speed;
      belt.group.name = b.name;
      belt.group.position.set(b.position.x, 0, b.position.z);
      belt.group.rotation.y = b.kind === "curve" ? 0 : b.rotationY * DEG; // a curve is built at its own angles
    }
    this.select(this.selectedId && keep.has(this.selectedId) ? this.selectedId : null);
  }

  /** Slides each belt's chevrons along at its speed. Call every frame while running. */
  animate(dt: number): void {
    // With the texture repeated over the belt, moving the texture's offset by -d moves
    // the pattern +d·pitch along the belt.
    for (const belt of this.belts.values()) if (belt.moves) belt.texture.offset.x -= (belt.speed * dt) / CHEVRON_PITCH;
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const [beltId, belt] of this.belts) belt.frame.emissive.set(beltId === id ? 0x1e3a8a : 0x000000);
  }

  /** The belt under the ray, if any. */
  pick(raycaster: THREE.Raycaster): string | null {
    const hit = raycaster.intersectObjects([...this.belts.values()].map((b) => b.group), true)[0];
    return (hit?.object.userData.beltId as string | undefined) ?? null;
  }

  /** Where the ray first hits a belt's top surface, for placing shapes on belts. */
  surfacePoint(raycaster: THREE.Raycaster): { x: number; z: number } | null {
    const hit = raycaster.intersectObjects([...this.belts.values()].map((b) => b.surface), false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  /**
   * A see-through preview: a belt being placed or moved, or the next section of a line. (x, z)
   * is where its position would be: a straight's or transfer's center, or a curve's center of turning.
   */
  showGhost(b: Belt, x: number, z: number, rotationY: number): void {
    const key = shapeKey({ ...b, rotationY });
    if (key !== this.ghostKey) {
      for (const child of [...this.ghost.children]) {
        this.ghost.remove(child);
        disposeTree(child);
      }
      const see = () => new THREE.MeshStandardMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.4, depthWrite: false });
      const { group } = buildSection({ ...b, rotationY }, see(), see());
      this.ghost.add(group);
      this.ghostKey = key;
    }
    this.ghost.position.set(x, 0, z);
    this.ghost.rotation.y = b.kind === "curve" ? 0 : rotationY * DEG;
    this.ghost.visible = true;
  }

  /** Shows (or with null, hides) the arrow at the end of the selected line. */
  showEnd(end: Pose | null, height = 0): void {
    this.endMarker.visible = !!end;
    if (!end) return;
    this.endMarker.position.set(end.x, height + 0.06, end.z);
    this.endMarker.rotation.y = end.heading * DEG;
  }

  hideGhost(): void {
    this.ghost.visible = false;
  }
}

function buildSection(b: Belt, frame: THREE.Material, belt: THREE.Material): { group: THREE.Group; surface: THREE.Mesh } {
  if (b.kind === "curve") return buildCurve(b, frame, belt);
  if (b.kind === "transfer") return buildTransfer(b, frame, belt);
  return buildBelt(b, frame, belt);
}

/**
 * A curve, in a frame centered on the point it turns about (unrotated): a ring segment for
 * the bed, a surface whose texture runs round the curve, rails on both edges and legs.
 */
function buildCurve(b: Belt, frame: THREE.Material, belt: THREE.Material): { group: THREE.Group; surface: THREE.Mesh } {
  const group = new THREE.Group();
  const { side, startAngle } = curveFrame({ rotationY: b.rotationY ?? 0, turn: b.turn ?? 90 });
  const sweep = Math.abs(b.turn ?? 90);
  const R = b.radius ?? 0.5;
  const inner = R - b.width / 2;
  const outer = R + b.width / 2;
  const a0 = startAngle * DEG;
  const a1 = (startAngle + side * sweep) * DEG;
  const bed = Math.min(FRAME_DEPTH, b.height);
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Flat ring segments are drawn in 2D, then laid on the floor: rotateX(-90°) takes 2D (px, py)
  // to (px, 0, -py), so a heading h, which points along (cos h, -sin h), is the 2D angle h.
  const ring = (r0: number, r1: number, depth: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0));
    shape.absarc(0, 0, r1, a0, a1, side < 0);
    shape.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1));
    shape.absarc(0, 0, r0, a1, a0, side > 0);
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 32 }).rotateX(-Math.PI / 2);
  };
  mesh(ring(inner, outer, bed), frame, b.height - bed);
  mesh(ring(outer, outer + RAIL, RAIL * 2), frame, b.height - RAIL / 2);
  mesh(ring(inner - RAIL, inner, RAIL * 2), frame, b.height - RAIL / 2);

  // The surface: a strip of quads round the curve, U along it (0 at the start), V across.
  const n = Math.max(8, Math.round(sweep / 3));
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    for (const [r, v] of [[inner, 0], [outer, 1]] as const) {
      positions.push(r * Math.cos(a), 0, -r * Math.sin(a));
      uvs.push(i / n, v);
    }
    if (i < n) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const surface = mesh(geometry, belt, b.height + 0.001);
  surface.castShadow = false;

  const legHeight = b.height - bed;
  if (legHeight > 0.01) {
    for (const t of [0.08, 0.5, 0.92]) {
      const a = a0 + (a1 - a0) * t;
      for (const r of [inner + 0.02, outer - 0.02]) {
        const leg = mesh(new THREE.BoxGeometry(0.03, legHeight, 0.03), frame, legHeight / 2);
        leg.position.x = r * Math.cos(a);
        leg.position.z = -r * Math.sin(a);
      }
    }
  }
  return { group, surface };
}

/**
 * A transfer: a square module at a corner. Items come in along its x, stop at the middle and
 * go out to the side: -z for a left turn, +z for a right one. Rails close the far end and the
 * side opposite the way out.
 */
function buildTransfer(b: Belt, frame: THREE.Material, belt: THREE.Material): { group: THREE.Group; surface: THREE.Mesh } {
  const w = b.width;
  const out = (b.turn ?? 90) > 0 ? -1 : 1;
  const { group, surface } = buildBelt({ length: w, width: w, height: b.height }, frame, belt, { rails: false, rollers: false });
  const rail = (sx: number, sz: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, RAIL * 2, sz), frame);
    m.position.set(x, b.height + RAIL / 2, z);
    m.castShadow = true;
    group.add(m);
  };
  rail(RAIL, w + 2 * RAIL, w / 2 + RAIL / 2, 0); // the far end
  rail(w, RAIL, 0, -out * (w / 2 + RAIL / 2)); // the side it doesn't go out of
  return { group, surface };
}

/** The model: a bed, the moving surface on top, side rails, end rollers and legs. */
function buildBelt(b: Belt, frame: THREE.Material, belt: THREE.Material, parts = { rails: true, rollers: true }): { group: THREE.Group; surface: THREE.Mesh } {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const bed = Math.min(FRAME_DEPTH, b.height);
  add(new THREE.BoxGeometry(b.length, bed, b.width), frame, 0, b.height - bed / 2, 0);

  // The surface is a flat plane a hair above the bed, facing up. Its UVs run along x, so
  // the chevron texture repeats along the belt's length.
  const surface = add(new THREE.PlaneGeometry(b.length, b.width).rotateX(-Math.PI / 2), belt, 0, b.height + 0.001, 0);
  surface.castShadow = false;

  for (const side of parts.rails ? [-1, 1] : []) {
    add(new THREE.BoxGeometry(b.length, RAIL * 2, RAIL), frame, 0, b.height + RAIL / 2, side * (b.width / 2 + RAIL / 2));
  }
  for (const end of parts.rollers ? [-1, 1] : []) {
    const roller = add(new THREE.CylinderGeometry(bed / 2, bed / 2, b.width, 20).rotateX(Math.PI / 2), frame, end * (b.length / 2), b.height - bed / 2, 0);
    roller.castShadow = false;
  }

  const legHeight = b.height - bed;
  if (legHeight > 0.01) {
    const inset = Math.min(0.1, b.length / 4);
    for (const end of [-1, 1]) {
      for (const side of [-1, 1]) {
        add(new THREE.BoxGeometry(0.03, legHeight, 0.03), frame, end * (b.length / 2 - inset), legHeight / 2, side * (b.width / 2 - 0.02));
      }
    }
  }
  return { group, surface };
}

/** A dark belt with one light chevron pointing along +x (the direction of travel). */
function chevronCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1f2937";
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#9ca3af";
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(22, 10);
  g.lineTo(42, 32);
  g.lineTo(22, 54);
  g.stroke();
  return c;
}

/**
 * A transfer's top: rollers across the way in, and an arrow that comes in from the left and
 * turns to the way out. On the plane, the canvas's top edge is the module's -z side, which is
 * where a left turn goes out.
 */
function transferCanvas(turn: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1f2937";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#374151";
  g.lineWidth = 6;
  for (let x = 10; x < 128; x += 16) {
    g.beginPath();
    g.moveTo(x, 4);
    g.lineTo(x, 124);
    g.stroke();
  }
  const outY = turn > 0 ? 18 : 110;
  g.strokeStyle = "#9ca3af";
  g.lineWidth = 9;
  g.lineCap = g.lineJoin = "round";
  g.beginPath();
  g.moveTo(14, 64);
  g.lineTo(64, 64);
  g.lineTo(64, outY);
  g.stroke();
  g.beginPath();
  const tip = turn > 0 ? 1 : -1;
  g.moveTo(48, outY + tip * 18);
  g.lineTo(64, outY);
  g.lineTo(80, outY + tip * 18);
  g.stroke();
  return c;
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      // The texture is disposed by the caller; materials are per belt.
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
    }
  });
}
