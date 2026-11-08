import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Distance from a finger's origin to the inner face of its grip pad (see Snack 1's build-gripper.ts). */
const PAD_INSET = 0.022;

/**
 * Parallel two-finger gripper loaded from glTF (the same model as Snack 1).
 * Unlike Snack 1, it doesn't animate itself: the simulation decides the gap
 * between the pads each frame and the viewer passes it to setGap().
 */
export class Gripper {
  readonly object: THREE.Object3D;
  private readonly left: THREE.Object3D;
  private readonly right: THREE.Object3D;

  private constructor(object: THREE.Object3D, left: THREE.Object3D, right: THREE.Object3D) {
    this.object = object;
    this.left = left;
    this.right = right;
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

  /** Sets the distance between the grip pads, in meters. */
  setGap(gap: number): void {
    const x = gap / 2 + PAD_INSET;
    this.left.position.x = -x;
    this.right.position.x = x;
  }
}
