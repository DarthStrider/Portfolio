import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GAP_CLOSED, GAP_OPEN, PAD_INSET } from "./gripperSpec";

const SPEED = 2.5 * (GAP_OPEN - GAP_CLOSED); // a full stroke takes 0.4 s

/**
 * Parallel two-finger gripper loaded from glTF. The model's finger nodes are
 * found by name and slid along X, so the asset stays a plain static file with
 * no animation clips baked in.
 *
 * Two ways to drive it: setOpen() for the G key and the demo (the fingers travel at
 * a fixed speed), or setGap() for a robot program, which decides the gap every frame
 * and closes it exactly on the part it's picking.
 */
export class Gripper {
  readonly object: THREE.Object3D;
  private readonly left: THREE.Object3D;
  private readonly right: THREE.Object3D;
  private current = GAP_OPEN;
  private target = GAP_OPEN;

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

  /** True once it's been told to open, even if the fingers are still moving. */
  get isOpen(): boolean {
    return this.target > GAP_CLOSED;
  }

  /** The gap between the pads right now, in meters. */
  get gap(): number {
    return this.current;
  }

  setOpen(open: boolean): void {
    this.target = open ? GAP_OPEN : GAP_CLOSED;
  }

  /** Puts the pads exactly `gap` meters apart, now. */
  setGap(gap: number): void {
    this.current = this.target = Math.min(GAP_OPEN, Math.max(GAP_CLOSED, gap));
    this.apply();
  }

  update(dt: number): void {
    if (this.current === this.target) return;
    const step = SPEED * dt;
    this.current =
      this.current < this.target
        ? Math.min(this.target, this.current + step)
        : Math.max(this.target, this.current - step);
    this.apply();
  }

  private apply(): void {
    const x = this.current / 2 + PAD_INSET;
    this.left.position.x = -x;
    this.right.position.x = x;
  }
}
