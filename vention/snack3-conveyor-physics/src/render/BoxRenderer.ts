import * as THREE from "three";
import { SIZE_PRESETS } from "../layout";
import type { BoxFlow } from "../sim/BoxFlow";

const PALETTE = [0xf59e0b, 0x3b82f6, 0x10b981, 0xef4444, 0x8b5cf6, 0x14b8a6];
const SLEEPING = 0x4b5563;

export type RenderMode = "instanced" | "meshes";

/**
 * Draws every box, two ways:
 *
 * - "instanced": one InstancedMesh. All boxes share one geometry and one material,
 *   and each box is just a matrix and a color in a GPU buffer, so 3,000 boxes are a
 *   single draw call (plus one for the shadow map).
 * - "meshes": one THREE.Mesh per box, the straightforward way. Same picture, but
 *   one draw call per box per pass. Here for comparison.
 *
 * Both reuse their objects frame to frame; nothing is allocated per frame.
 */
export class BoxRenderer {
  readonly group = new THREE.Group();
  mode: RenderMode = "instanced";
  tintSleeping = false;

  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly instanced: THREE.InstancedMesh;
  private readonly colors = PALETTE.map((c) => new THREE.Color(c));
  private readonly sleepingColor = new THREE.Color(SLEEPING);
  private readonly materials = PALETTE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  private readonly sleepingMaterial = new THREE.MeshStandardMaterial({ color: SLEEPING, roughness: 0.7 });
  private readonly meshes: THREE.Mesh[] = [];
  private meshesShown = 0;

  // Scratch objects, reused every frame.
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();

  constructor(capacity: number) {
    // White base color: the per-instance color multiplies it.
    this.instanced = new THREE.InstancedMesh(
      this.geometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
      capacity,
    );
    this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanced.setColorAt(0, this.colors[0]); // creates the instanceColor buffer
    this.instanced.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.instanced.count = 0;
    this.instanced.castShadow = true;
    this.instanced.receiveShadow = true;
    // Instances move every frame, so a bounding sphere computed once would soon be wrong.
    this.instanced.frustumCulled = false;
    this.group.add(this.instanced);
  }

  update(flow: BoxFlow, alpha: number): void {
    const { dense, count } = flow.pool;
    const backend = flow.backend;

    if (this.mode === "instanced") {
      this.hideMeshes(0);
      this.instanced.visible = true;
      for (let k = 0; k < count; k++) {
        const slot = dense[k];
        this.composeMatrix(flow, slot, alpha);
        this.instanced.setMatrixAt(k, this.matrix);
        const sleeping = this.tintSleeping && backend.isAsleep(slot);
        this.instanced.setColorAt(k, sleeping ? this.sleepingColor : this.colors[flow.preset[slot]]);
      }
      this.instanced.count = count;
      this.instanced.instanceMatrix.needsUpdate = true;
      this.instanced.instanceColor!.needsUpdate = true;
      return;
    }

    this.instanced.visible = false;
    for (let k = 0; k < count; k++) {
      const slot = dense[k];
      const mesh = this.meshes[k] ?? this.createMesh();
      const sleeping = this.tintSleeping && backend.isAsleep(slot);
      mesh.material = sleeping ? this.sleepingMaterial : this.materials[flow.preset[slot]];
      backend.readTransform(slot, alpha, mesh.position, mesh.quaternion);
      const h = SIZE_PRESETS[flow.preset[slot]];
      mesh.scale.set(2 * h.x, 2 * h.y, 2 * h.z);
      mesh.visible = true;
    }
    this.hideMeshes(count);
  }

  private composeMatrix(flow: BoxFlow, slot: number, alpha: number): void {
    flow.backend.readTransform(slot, alpha, this.pos, this.quat);
    const h = SIZE_PRESETS[flow.preset[slot]];
    this.scale.set(2 * h.x, 2 * h.y, 2 * h.z); // the shared geometry is a 1 m cube
    this.matrix.compose(this.pos, this.quat, this.scale);
  }

  private createMesh(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, this.materials[0]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.meshes.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** Hides pooled meshes from index `from` up to however many were shown last frame. */
  private hideMeshes(from: number): void {
    for (let k = from; k < this.meshesShown; k++) this.meshes[k].visible = false;
    this.meshesShown = from;
  }
}
