import * as THREE from "three";
import { DEG } from "../arm/kinematics";
import type { Shape, ShapeKind, Size } from "./types";

/**
 * Draws the stored shapes in the scene, plus a see-through "ghost" that follows the mouse
 * while placing one, and a faint ring on the floor showing how far the arm reaches.
 *
 * sync() is the only way shapes change: give it the list from the API and it adds, updates
 * and removes meshes to match, keyed by shape id, so polling the API is enough to show
 * changes made from another browser.
 */
export class ShapeLayer {
  readonly root = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>();
  private readonly ghost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private ghostKey = "";
  private selectedId: string | null = null;

  constructor(reachRadius: number) {
    this.root.name = "Shapes";

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.root.add(this.ghost);

    // Floor-level reach: a thin ring, drawn just above the grid to avoid z-fighting.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(reachRadius - 0.006, reachRadius + 0.006, 128),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    ring.name = "ReachRing";
    this.root.add(ring);
  }

  /** Makes the scene match `shapes` exactly. */
  sync(shapes: readonly Shape[]): void {
    const keep = new Set(shapes.map((s) => s.id));
    for (const [id, mesh] of this.meshes) {
      if (!keep.has(id)) {
        this.root.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.meshes.delete(id);
      }
    }
    for (const s of shapes) {
      let mesh = this.meshes.get(s.id);
      const key = geometryKey(s.kind, s.size);
      if (!mesh) {
        mesh = new THREE.Mesh(geometryFor(s.kind, s.size), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.shapeId = s.id;
        mesh.userData.geometryKey = key;
        this.meshes.set(s.id, mesh);
        this.root.add(mesh);
      } else if (mesh.userData.geometryKey !== key) {
        mesh.geometry.dispose();
        mesh.geometry = geometryFor(s.kind, s.size);
        mesh.userData.geometryKey = key;
      }
      mesh.name = s.name;
      mesh.material.color.set(s.color);
      place(mesh, s.size, s.position.x, s.position.z, s.rotationY);
    }
    this.select(this.selectedId && keep.has(this.selectedId) ? this.selectedId : null);
  }

  /** Highlights one shape (or none) by making it glow slightly. */
  select(id: string | null): void {
    this.selectedId = id;
    for (const [shapeId, mesh] of this.meshes) {
      mesh.material.emissive.set(shapeId === id ? 0x3b3b3b : 0x000000);
    }
  }

  /** The id of the nearest shape under the ray, if any. */
  pick(raycaster: THREE.Raycaster): string | null {
    const hit = raycaster.intersectObjects([...this.meshes.values()], false)[0];
    return (hit?.object.userData.shapeId as string | undefined) ?? null;
  }

  showGhost(kind: ShapeKind, size: Size, color: string, x: number, z: number, rotationY: number): void {
    const key = geometryKey(kind, size);
    if (key !== this.ghostKey) {
      this.ghost.geometry.dispose();
      this.ghost.geometry = geometryFor(kind, size);
      this.ghostKey = key;
    }
    this.ghost.material.color.set(color);
    place(this.ghost, size, x, z, rotationY);
    this.ghost.visible = true;
  }

  hideGhost(): void {
    this.ghost.visible = false;
  }
}

/** Three.js builds every shape centered on its origin; ours rest on the floor. */
function place(mesh: THREE.Object3D, size: Size, x: number, z: number, rotationY: number) {
  mesh.position.set(x, size.y / 2, z);
  mesh.rotation.y = rotationY * DEG;
}

function geometryKey(kind: ShapeKind, s: Size): string {
  return `${kind}:${s.x}:${s.y}:${s.z}`;
}

function geometryFor(kind: ShapeKind, s: Size): THREE.BufferGeometry {
  switch (kind) {
    case "box":
      return new THREE.BoxGeometry(s.x, s.y, s.z);
    case "cylinder":
      return new THREE.CylinderGeometry(s.x / 2, s.x / 2, s.y, 40);
    case "cone":
      return new THREE.ConeGeometry(s.x / 2, s.y, 40);
    case "sphere":
      return new THREE.SphereGeometry(s.x / 2, 40, 20);
  }
}
