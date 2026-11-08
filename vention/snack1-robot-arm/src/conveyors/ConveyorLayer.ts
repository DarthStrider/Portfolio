import * as THREE from "three";
import { DEG } from "../arm/kinematics";
import type { Conveyor } from "./types";

/** One chevron per this many meters of belt. */
const CHEVRON_PITCH = 0.25;
const FRAME_DEPTH = 0.06; // the belt bed under the surface
const RAIL = 0.015; // side rail thickness and height above the belt

type Belt = Pick<Conveyor, "length" | "width" | "height">;

/**
 * Draws the conveyors. Each belt is a group in its own frame: x along its length (the way
 * it runs at a positive speed), z across, y up from the floor. The group's rotation about y
 * is the stored rotationY, which is the same convention transport.ts uses, so what you see
 * and what moves the shapes agree.
 *
 * Like ShapeLayer, sync() makes the scene match the API's list, keyed by id.
 */
export class ConveyorLayer {
  readonly root = new THREE.Group();
  private readonly belts = new Map<string, { group: THREE.Group; key: string; surface: THREE.Mesh; texture: THREE.CanvasTexture; frame: THREE.MeshStandardMaterial; speed: number }>();
  private readonly ghost = new THREE.Group();
  private ghostKey = "";
  private readonly chevrons = chevronCanvas();
  private selectedId: string | null = null;

  constructor() {
    this.root.name = "Conveyors";
    this.ghost.visible = false;
    this.root.add(this.ghost);
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
      const key = `${b.length}:${b.width}:${b.height}`;
      let belt = this.belts.get(b.id);
      if (belt && belt.key !== key) {
        // A different size is a different model; rebuild it (sizes don't change from this app today).
        this.root.remove(belt.group);
        disposeTree(belt.group);
        belt.texture.dispose();
        belt = undefined;
      }
      if (!belt) {
        const texture = new THREE.CanvasTexture(this.chevrons);
        texture.wrapS = THREE.RepeatWrapping;
        texture.repeat.set(b.length / CHEVRON_PITCH, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
        const frame = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.6, metalness: 0.4 });
        const { group, surface } = buildBelt(b, frame, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
        group.traverse((o) => (o.userData.beltId = b.id));
        belt = { group, key, surface, texture, frame, speed: b.speed };
        this.belts.set(b.id, belt);
        this.root.add(group);
      }
      belt.speed = b.speed;
      belt.group.name = b.name;
      belt.group.position.set(b.position.x, 0, b.position.z);
      belt.group.rotation.y = b.rotationY * DEG;
    }
    this.select(this.selectedId && keep.has(this.selectedId) ? this.selectedId : null);
  }

  /** Slides each belt's chevrons along at its speed. Call every frame while running. */
  animate(dt: number): void {
    // With the texture repeated over the belt, moving the texture's offset by -d moves
    // the pattern +d·pitch along the belt.
    for (const belt of this.belts.values()) belt.texture.offset.x -= (belt.speed * dt) / CHEVRON_PITCH;
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

  showGhost(b: Belt, x: number, z: number, rotationY: number): void {
    const key = `${b.length}:${b.width}:${b.height}`;
    if (key !== this.ghostKey) {
      for (const child of [...this.ghost.children]) {
        this.ghost.remove(child);
        disposeTree(child);
      }
      const see = () => new THREE.MeshStandardMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.4, depthWrite: false });
      const { group } = buildBelt(b, see(), see());
      this.ghost.add(group);
      this.ghostKey = key;
    }
    this.ghost.position.set(x, 0, z);
    this.ghost.rotation.y = rotationY * DEG;
    this.ghost.visible = true;
  }

  hideGhost(): void {
    this.ghost.visible = false;
  }
}

/** The model: a bed, the moving surface on top, side rails, end rollers and legs. */
function buildBelt(b: Belt, frame: THREE.Material, belt: THREE.Material): { group: THREE.Group; surface: THREE.Mesh } {
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

  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(b.length, RAIL * 2, RAIL), frame, 0, b.height + RAIL / 2, side * (b.width / 2 + RAIL / 2));
  }
  for (const end of [-1, 1]) {
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

function disposeTree(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      // The texture is disposed by the caller; materials are per belt.
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
    }
  });
}
