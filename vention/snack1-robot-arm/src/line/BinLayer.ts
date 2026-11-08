import * as THREE from "three";
import { DEG } from "../arm/kinematics";
import { fromBelt } from "../conveyors/transport";
import type { Conveyor } from "../conveyors/types";
import { BIN_SIZE, type Bin, type Machine } from "./types";

const WALL = 0.015;

interface Model {
  group: THREE.Group;
  fill: THREE.Mesh;
  label: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture };
  chute: THREE.Line | null;
  rim: THREE.MeshStandardMaterial;
  key: string;
  shown: string;
}

/**
 * Draws bins: an open box with a fill level showing how full it is, a label with the count, and
 * a dashed line to whatever it feeds (a spot on a belt, or a machine). Like the other layers,
 * sync() matches the API's list; fill() updates the levels during a run without a reload.
 */
export class BinLayer {
  readonly root = new THREE.Group();
  private readonly models = new Map<string, Model>();
  private readonly ghost: THREE.Group;
  private selectedId: string | null = null;

  constructor() {
    this.root.name = "Bins";
    this.ghost = new THREE.Group();
    const see = new THREE.MeshStandardMaterial({ color: 0x14b8a6, transparent: true, opacity: 0.4, depthWrite: false });
    for (const m of walls(see)) this.ghost.add(m);
    this.ghost.visible = false;
    this.root.add(this.ghost);
  }

  sync(bins: readonly Bin[], belts: readonly Conveyor[], machines: readonly Machine[], colorOf: (b: Bin) => string): void {
    const keep = new Set(bins.map((b) => b.id));
    for (const [id, m] of this.models) if (!keep.has(id)) this.drop(id, m);
    for (const b of bins) {
      const target = feedPoint(b, belts, machines);
      const key = JSON.stringify([b.position, b.rotationY, target, colorOf(b)]);
      const old = this.models.get(b.id);
      if (old && old.key === key) {
        this.setCount(old, b.count, b.capacity);
        continue;
      }
      if (old) this.drop(b.id, old);
      const m = build(b, colorOf(b), target);
      m.key = key;
      m.group.traverse((o) => (o.userData.binId = b.id));
      this.models.set(b.id, m);
      this.root.add(m.group);
      this.setCount(m, b.count, b.capacity);
    }
    this.select(this.selectedId);
  }

  /** Counts during a run, from the stations. */
  fill(counts: ReadonlyMap<string, number>, bins: readonly Bin[]): void {
    for (const b of bins) {
      const m = this.models.get(b.id);
      if (m) this.setCount(m, counts.get(b.id) ?? b.count, b.capacity);
    }
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const [bid, m] of this.models) m.rim.emissive.setHex(bid === id ? 0x0f766e : 0x000000);
  }

  pick(raycaster: THREE.Raycaster): string | null {
    const hit = raycaster.intersectObjects([...this.models.values()].map((m) => m.group), true)[0];
    return (hit?.object.userData.binId as string | undefined) ?? null;
  }

  showGhost(x: number, z: number, rotationY: number): void {
    this.ghost.position.set(x, 0, z);
    this.ghost.rotation.y = rotationY * DEG;
    this.ghost.visible = true;
  }

  hideGhost(): void {
    this.ghost.visible = false;
  }

  private setCount(m: Model, count: number, capacity: number) {
    const text = `${count}/${capacity}`;
    if (m.shown === text) return;
    m.shown = text;
    const level = Math.max(0.001, (BIN_SIZE.y - 0.03) * Math.min(1, count / capacity));
    m.fill.scale.y = level;
    m.fill.position.y = WALL + level / 2;
    m.fill.visible = count > 0;
    drawLabel(m.label.canvas, text);
    m.label.texture.needsUpdate = true;
  }

  private drop(id: string, m: Model) {
    this.root.remove(m.group);
    m.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite) {
        (o as THREE.Mesh).geometry?.dispose();
        ((o as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
    m.label.texture.dispose();
    this.models.delete(id);
  }
}

/** Where a bin's items come out: the spot on its belt, or the machine. */
function feedPoint(b: Bin, belts: readonly Conveyor[], machines: readonly Machine[]): { x: number; y: number; z: number } | null {
  if (b.feed.type === "belt") {
    const conveyorId = b.feed.conveyorId;
    const belt = belts.find((c) => c.id === conveyorId);
    if (!belt) return null;
    const p = fromBelt(belt, b.feed.along - belt.length / 2, 0);
    return { ...p, y: belt.height + 0.02 };
  }
  if (b.feed.type === "machine") {
    const machineId = b.feed.machineId;
    const mc = machines.find((m) => m.id === machineId);
    const belt = mc && belts.find((c) => c.id === mc.conveyorId);
    if (!mc || !belt) return null;
    const p = fromBelt(belt, mc.along - belt.length / 2, 0);
    return { ...p, y: belt.height + 0.25 };
  }
  return null;
}

function walls(mat: THREE.Material): THREE.Mesh[] {
  const { x: w, y: h, z: d } = BIN_SIZE;
  const parts: [number, number, number, number, number, number][] = [
    [w, WALL, d, 0, WALL / 2, 0], // floor
    [w, h, WALL, 0, h / 2, d / 2 - WALL / 2],
    [w, h, WALL, 0, h / 2, -d / 2 + WALL / 2],
    [WALL, h, d, w / 2 - WALL / 2, h / 2, 0],
    [WALL, h, d, -w / 2 + WALL / 2, h / 2, 0],
  ];
  return parts.map(([sx, sy, sz, x, y, z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  });
}

function build(b: Bin, color: string, target: { x: number; y: number; z: number } | null): Model {
  const group = new THREE.Group();
  group.position.set(b.position.x, 0, b.position.z);
  group.rotation.y = b.rotationY * DEG;
  const rim = new THREE.MeshStandardMaterial({ color: 0x0d9488, roughness: 0.6, metalness: 0.1 });
  for (const m of walls(rim)) group.add(m);

  // The fill: a box scaled to the level, in the color of what the bin holds.
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(BIN_SIZE.x - 2 * WALL - 0.01, 1, BIN_SIZE.z - 2 * WALL - 0.01),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true, opacity: 0.85 }),
  );
  group.add(fill);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 48;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  label.scale.set(0.24, 0.09, 1);
  label.position.set(0, BIN_SIZE.y + 0.1, 0);
  label.renderOrder = 10;
  group.add(label);

  let chute: THREE.Line | null = null;
  if (target) {
    // Drawn in the world, not the bin's frame: undo the group's transform for the target.
    group.updateMatrixWorld(true);
    const local = group.worldToLocal(new THREE.Vector3(target.x, target.y, target.z));
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, BIN_SIZE.y, 0), local]);
    chute = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0x2dd4bf, dashSize: 0.04, gapSize: 0.03 }));
    chute.computeLineDistances();
    group.add(chute);
  }
  return { group, fill, label: { canvas, texture }, chute, rim, key: "", shown: "" };
}

function drawLabel(c: HTMLCanvasElement, text: string) {
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = "rgba(15, 23, 42, 0.85)";
  g.beginPath();
  g.roundRect(4, 4, c.width - 8, c.height - 8, 12);
  g.fill();
  g.fillStyle = "#e2e8f0";
  g.font = "600 26px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 1);
}
