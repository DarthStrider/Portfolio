import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GAP_CLOSED, GAP_OPEN } from "./gripperSpec";
import { angleForGap, fingerSegments, FINGERS, FINGER_RADIUS, HINGE_Y, LOWER, PAD_FROM, PAD_INSET, PAD_TO, ROOT_RADIUS, UPPER } from "./claw";

const SPEED = 2.5 * (GAP_OPEN - GAP_CLOSED); // a full stroke takes 0.4 s
const DEG = Math.PI / 180;

/**
 * The four-finger claw (src/arm/claw.ts), loaded from glTF. Each finger's two joints are
 * found by name (Finger0…3 at the palm, Knuckle0…3 at the elbows) and turned every time the
 * gap changes, so the asset stays a plain static file with no animation clips baked in.
 *
 * Three ways to drive it: setOpen() for the G key and the demo (the fingers travel at a fixed
 * speed), closeTo() when the G key closes it on something (it stops at the surface), or
 * setGap() for a robot program, which decides the gap every frame.
 */
export class Gripper {
  readonly object: THREE.Object3D;
  private readonly fingers: THREE.Object3D[];
  private readonly knuckles: THREE.Object3D[];
  private current = GAP_OPEN;
  private target = GAP_OPEN;
  private open = true;

  private constructor(object: THREE.Object3D, fingers: THREE.Object3D[], knuckles: THREE.Object3D[]) {
    this.object = object;
    this.fingers = fingers;
    this.knuckles = knuckles;
    this.apply();
  }

  static async load(url: string): Promise<Gripper> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    const find = (name: string) => {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`${url} has no ${name} node: rebuild it with npm run build:gripper`);
      return node;
    };
    const fingers = Array.from({ length: FINGERS }, (_, k) => find(`Finger${k}`));
    const knuckles = Array.from({ length: FINGERS }, (_, k) => find(`Knuckle${k}`));
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return new Gripper(root, fingers, knuckles);
  }

  /** The same claw from plain boxes, used if the glTF file can't be loaded. */
  static placeholder(): Gripper {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xf26b14 });
    const box = (w: number, h: number, d: number, x: number, y: number, material: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(x, y, 0);
      return m;
    };
    const root = new THREE.Group();
    const palm = box(0.13, 0.04, 0.13, 0, 0.04, dark);
    root.add(palm);
    const fingers: THREE.Object3D[] = [];
    const knuckles: THREE.Object3D[] = [];
    for (let k = 0; k < FINGERS; k++) {
      const mount = new THREE.Object3D();
      mount.rotation.y = k * 90 * DEG;
      const finger = new THREE.Object3D();
      finger.position.set(ROOT_RADIUS, HINGE_Y, 0);
      finger.add(box(0.016, UPPER, 0.022, 0, UPPER / 2, orange));
      const knuckle = new THREE.Object3D();
      knuckle.position.y = UPPER;
      knuckle.add(box(0.016, LOWER, 0.022, 0, LOWER / 2, orange), box(0.006, PAD_TO - PAD_FROM, 0.02, -PAD_INSET + 0.003, (PAD_FROM + PAD_TO) / 2, dark));
      finger.add(knuckle);
      mount.add(finger);
      root.add(mount);
      fingers.push(finger);
      knuckles.push(knuckle);
    }
    return new Gripper(root, fingers, knuckles);
  }

  /** True once it's been told to open, even if the fingers are still moving. */
  get isOpen(): boolean {
    return this.open;
  }

  /** The gap between opposite pads right now, in meters. */
  get gap(): number {
    return this.current;
  }

  /** Still moving toward where it was told to go. */
  get moving(): boolean {
    return this.current !== this.target;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.target = open ? GAP_OPEN : GAP_CLOSED;
  }

  /** Closes until the pads are `gap` apart: on the surface of what it's closing on. */
  closeTo(gap: number): void {
    this.open = false;
    this.target = Math.min(GAP_OPEN, Math.max(GAP_CLOSED, gap));
  }

  /** Puts the pads exactly `gap` meters apart, now. */
  setGap(gap: number): void {
    this.current = this.target = Math.min(GAP_OPEN, Math.max(GAP_CLOSED, gap));
    this.open = this.current > GAP_CLOSED + 1e-6;
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

  /**
   * The fingers as world-space segments, with their thickness, for collision checks. At
   * `gap` if given (where they'd be), else where they are now.
   */
  segments(gap = this.current): { a: THREE.Vector3; b: THREE.Vector3; r: number }[] {
    this.object.updateWorldMatrix(true, false);
    const m = this.object.matrixWorld;
    return fingerSegments(gap).map(([a, b]) => ({
      a: new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(m),
      b: new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(m),
      r: FINGER_RADIUS,
    }));
  }

  /** Each finger's horizontal direction in the world, from the claw's axis toward it. */
  fingerDirections(): THREE.Vector3[] {
    this.object.updateWorldMatrix(true, false);
    const q = this.object.getWorldQuaternion(new THREE.Quaternion());
    return Array.from({ length: FINGERS }, (_, k) =>
      new THREE.Vector3(Math.cos((k * Math.PI) / 2), 0, -Math.sin((k * Math.PI) / 2)).applyQuaternion(q).setY(0).normalize());
  }

  private apply(): void {
    // Open: each upper finger swings out by θ; its elbow turns back by θ to keep the pad upright.
    const theta = angleForGap(this.current) * DEG;
    for (let k = 0; k < FINGERS; k++) {
      this.fingers[k].rotation.set(0, 0, -theta);
      this.knuckles[k].rotation.set(0, 0, theta);
    }
  }
}
