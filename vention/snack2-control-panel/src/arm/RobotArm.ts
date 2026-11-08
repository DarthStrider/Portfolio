import * as THREE from "three";
import { clamp, DEG, type ArmDimensions } from "./kinematics";
import type { JointSpec } from "./jointSpecs";

const HOUSING_COLOR = 0x2563eb;
const SELECTED_GLOW = 0x60a5fa;

/**
 * The arm as a Three.js scene-graph hierarchy:
 *
 *   root
 *   ├── pedestal
 *   └── Joint1 (yaw, Y)        ← turret, column
 *       └── Joint2 (pitch, Z)  ← shoulder housing, upper arm
 *           └── Joint3 (pitch, Z)  ← elbow housing, forearm
 *               └── Joint4 (pitch, Z)  ← wrist housing, wrist link
 *                   └── toolMount  ← gripper (glTF) attaches here
 *                       └── tcp    ← tool center point
 *
 * Each joint is an empty Object3D placed at the end of its parent link. Rotating
 * a joint moves everything below it, exactly like parenting Transforms in Unity.
 * Link meshes are offset by half their length so they extend from the joint.
 */
export class RobotArm {
  readonly root = new THREE.Group();
  readonly joints: THREE.Object3D[] = [];
  /** Clickable joint housings; userData.jointIndex says which joint each belongs to. */
  readonly housings: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  readonly toolMount = new THREE.Object3D();
  readonly tcp = new THREE.Object3D();

  private readonly dims: ArmDimensions;
  private readonly specs: readonly JointSpec[];
  private readonly angles: number[]; // degrees

  constructor(dims: ArmDimensions, specs: readonly JointSpec[]) {
    this.dims = dims;
    this.specs = specs;
    this.angles = specs.map((s) => s.home);
    this.build();
    specs.forEach((s, i) => this.setAngle(i, s.home));
  }

  /** Sets joint `index` in degrees, clamped to its limits. Returns the applied angle. */
  setAngle(index: number, degrees: number): number {
    const spec = this.specs[index];
    const value = clamp(degrees, spec.min, spec.max);
    this.angles[index] = value;
    this.joints[index].rotation[spec.axis] = value * DEG;
    return value;
  }

  getAngle(index: number): number {
    return this.angles[index];
  }

  get anglesDeg(): readonly number[] {
    return this.angles;
  }

  anglesRad(): number[] {
    return this.angles.map((a) => a * DEG);
  }

  /** Makes the selected joint's housing glow; pass null to clear. */
  highlight(index: number | null): void {
    this.housings.forEach((h, i) => {
      h.material.emissive.setHex(i === index ? SELECTED_GLOW : 0x000000);
    });
  }

  private build(): void {
    const d = this.dims;
    const linkMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.7, roughness: 0.35 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.4, roughness: 0.6 });

    const pedestal = solid(new THREE.CylinderGeometry(0.16, 0.2, d.baseHeight, 48), baseMat);
    pedestal.position.y = d.baseHeight / 2;
    this.root.add(pedestal);

    // Joint 1: base yaw
    const j1 = this.addJoint(this.root, d.baseHeight);
    const turret = this.addHousing(j1, new THREE.CylinderGeometry(0.13, 0.13, 0.06, 48));
    turret.position.y = 0.03;
    j1.add(along(solid(new THREE.CylinderGeometry(0.07, 0.07, d.shoulderHeight, 32), linkMat), d.shoulderHeight));

    // Joint 2: shoulder pitch
    const j2 = this.addJoint(j1, d.shoulderHeight);
    this.addHousing(j2, zCylinder(0.085, 0.17));
    j2.add(along(solid(new THREE.BoxGeometry(0.09, d.upperArm, 0.09), linkMat), d.upperArm));

    // Joint 3: elbow pitch
    const j3 = this.addJoint(j2, d.upperArm);
    this.addHousing(j3, zCylinder(0.07, 0.15));
    j3.add(along(solid(new THREE.BoxGeometry(0.075, d.forearm, 0.075), linkMat), d.forearm));

    // Joint 4: wrist pitch
    const j4 = this.addJoint(j3, d.forearm);
    this.addHousing(j4, zCylinder(0.055, 0.12));
    j4.add(along(solid(new THREE.CylinderGeometry(0.04, 0.04, d.wrist, 32), linkMat), d.wrist));

    this.toolMount.name = "ToolMount";
    this.toolMount.position.y = d.wrist;
    j4.add(this.toolMount);

    this.tcp.name = "TCP";
    this.tcp.position.y = d.tool;
    this.tcp.add(new THREE.AxesHelper(0.06));
    this.toolMount.add(this.tcp);
  }

  private addJoint(parent: THREE.Object3D, offsetY: number): THREE.Object3D {
    const index = this.joints.length;
    const joint = new THREE.Object3D();
    joint.name = `Joint${index + 1}_${this.specs[index].name}`;
    joint.position.y = offsetY;
    parent.add(joint);
    this.joints.push(joint);
    return joint;
  }

  private addHousing(joint: THREE.Object3D, geometry: THREE.BufferGeometry) {
    // Each housing gets its own material so it can be highlighted on its own.
    const material = new THREE.MeshStandardMaterial({
      color: HOUSING_COLOR,
      metalness: 0.3,
      roughness: 0.45,
      emissiveIntensity: 0.6,
    });
    const housing = solid(geometry, material);
    housing.userData.jointIndex = this.housings.length;
    joint.add(housing);
    this.housings.push(housing);
    return housing;
  }
}

function solid<M extends THREE.Material>(geometry: THREE.BufferGeometry, material: M) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Shifts a link mesh so it runs from its joint (y = 0) to y = length. */
function along<T extends THREE.Object3D>(mesh: T, length: number): T {
  mesh.position.y = length / 2;
  return mesh;
}

/** Cylinder whose axis is Z, matching a pitch joint's rotation axis. */
function zCylinder(radius: number, length: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius, length, 40).rotateX(Math.PI / 2);
}
