import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const CLOSED_X = 0.025;
const OPEN_X = 0.07;
const SPEED = 2.5; // full open/close strokes per second

/**
 * Parallel two-finger gripper loaded from glTF. The model's finger nodes are
 * found by name and slid along X, so the asset stays a plain static file with
 * no animation clips baked in.
 */
export class Gripper {
  readonly object: THREE.Object3D;
  private readonly left: THREE.Object3D;
  private readonly right: THREE.Object3D;
  private openness = 1; // 0 = closed, 1 = open
  private target = 1;

  private constructor(object: THREE.Object3D, left: THREE.Object3D, right: THREE.Object3D) {
    this.object = object;
    this.left = left;
    this.right = right;
    this.apply();
  }

  static async load(url: string): Promise<Gripper> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    const left = root.getObjectByName("FingerLeft");
    const right = root.getObjectByName("FingerRight");
    if (!left || !right) throw new Error(`${url} has no FingerLeft/FingerRight nodes`);

    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return new Gripper(root, left, right);
  }

  /** Simple boxes, used if the glTF file can't be loaded. */
  static placeholder(): Gripper {
    const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const root = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.07), material);
    palm.position.y = 0.03;
    const finger = () => {
      const pivot = new THREE.Object3D();
      pivot.position.y = 0.06;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.05), material);
      mesh.position.y = 0.035;
      pivot.add(mesh);
      return pivot;
    };
    const left = finger();
    const right = finger();
    root.add(palm, left, right);
    return new Gripper(root, left, right);
  }

  get isOpen(): boolean {
    return this.target === 1;
  }

  setOpen(open: boolean): void {
    this.target = open ? 1 : 0;
  }

  update(dt: number): void {
    if (this.openness === this.target) return;
    const step = SPEED * dt;
    this.openness =
      this.openness < this.target
        ? Math.min(this.target, this.openness + step)
        : Math.max(this.target, this.openness - step);
    this.apply();
  }

  private apply(): void {
    const x = CLOSED_X + (OPEN_X - CLOSED_X) * this.openness;
    this.left.position.x = -x;
    this.right.position.x = x;
  }
}
