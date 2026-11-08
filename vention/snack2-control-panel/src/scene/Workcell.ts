import * as THREE from "three";
import { FLOOR_SPOT, PART_SIZE, PLATFORM } from "../sim/program";

const GRAVITY = 9.81;
const GRAB_DISTANCE = 0.02; // the part's center must be this close to the TCP to be grabbed

/**
 * Everything the robot works on: the platform, a marker for the floor spot, and
 * the part. Handles picking up (re-parenting the part to the gripper), letting
 * go, and the part dropping onto whatever is under it.
 */
export class Workcell {
  readonly part: THREE.Mesh;
  private readonly scene: THREE.Scene;
  private holder: THREE.Object3D | null = null;
  private fallSpeed = 0;
  private readonly partWorld = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(PLATFORM.size, PLATFORM.height, PLATFORM.size),
      new THREE.MeshStandardMaterial({ color: 0x8a93a3, metalness: 0.3, roughness: 0.6 }),
    );
    platform.position.set(PLATFORM.x, PLATFORM.height / 2, PLATFORM.z);
    platform.castShadow = true;
    platform.receiveShadow = true;
    scene.add(platform);

    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.09, 0.09).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.35 }),
    );
    marker.position.set(FLOOR_SPOT.x, 0.002, FLOOR_SPOT.z);
    marker.rotation.y = yawAt(FLOOR_SPOT.x, FLOOR_SPOT.z);
    scene.add(marker);

    this.part = new THREE.Mesh(
      new THREE.BoxGeometry(PART_SIZE, PART_SIZE, PART_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x14b8a6, metalness: 0.1, roughness: 0.5 }),
    );
    this.part.name = "Part";
    this.part.castShadow = true;
    this.part.receiveShadow = true;
    scene.add(this.part);
    this.reset();
  }

  /** Puts the part back on the floor spot, turned to line up with the gripper's fingers. */
  reset(): void {
    if (this.holder) this.scene.attach(this.part);
    this.holder = null;
    this.fallSpeed = 0;
    this.part.position.set(FLOOR_SPOT.x, FLOOR_SPOT.y, FLOOR_SPOT.z);
    this.part.rotation.set(0, yawAt(FLOOR_SPOT.x, FLOOR_SPOT.z), 0);
  }

  /**
   * Called every frame. Grabs or releases the part based on the commanded finger
   * gap, and returns the gap to draw: never narrower than the part while it's
   * between the fingers, so the fingers stop at the part instead of passing through it.
   */
  update(dt: number, tcp: THREE.Vector3, commandedGap: number, gripper: THREE.Object3D | null): number {
    this.part.getWorldPosition(this.partWorld);
    const between = this.holder !== null || this.partWorld.distanceTo(tcp) < GRAB_DISTANCE;

    if (!this.holder && gripper && between && commandedGap <= PART_SIZE + 0.001) {
      // attach() re-parents while keeping the world transform (Unity: SetParent(parent, true)).
      gripper.attach(this.part);
      this.holder = gripper;
      this.fallSpeed = 0;
    } else if (this.holder && commandedGap > PART_SIZE + 0.002) {
      this.scene.attach(this.part);
      this.holder = null;
    }

    if (!this.holder) this.settle(dt);
    return between ? Math.max(commandedGap, PART_SIZE) : commandedGap;
  }

  /** Falls under gravity until resting on the platform or the floor. */
  private settle(dt: number): void {
    const p = this.part.position; // the part is a direct child of the scene here, so this is world space
    const onPlatform =
      Math.abs(p.x - PLATFORM.x) < PLATFORM.size / 2 && Math.abs(p.z - PLATFORM.z) < PLATFORM.size / 2;
    const restY = (onPlatform ? PLATFORM.height : 0) + PART_SIZE / 2;

    if (p.y > restY) {
      this.fallSpeed += GRAVITY * dt;
      p.y = Math.max(restY, p.y - this.fallSpeed * dt);
    }
    if (p.y <= restY) {
      p.y = restY;
      this.fallSpeed = 0;
    }
  }
}

/** The base yaw the arm uses to reach (x, z): lines a part up with the fingers. */
function yawAt(x: number, z: number): number {
  return Math.atan2(z, -x);
}
