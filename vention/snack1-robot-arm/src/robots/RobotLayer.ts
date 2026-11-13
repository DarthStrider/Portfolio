/**
 * The automated robots in the scene: each one's arm and gripper, the green circle it picks
 * from, the faint ring of its reach, and a marker on every spot its rules send items to.
 */
import * as THREE from "three";
import { ARM, JOINTS } from "../arm/jointSpecs";
import { Gripper } from "../arm/Gripper";
import { RobotArm } from "../arm/RobotArm";
import { reachRadiusAt } from "../shapes/reach";
import { PITCH } from "./cell";
import type { Robot } from "./types";

const DEG = Math.PI / 180;
/** How far a robot reaches from above, for the ring: the widest, at about the height of a belt's top. */
export const ROBOT_REACH = reachRadiusAt(0.3, ARM);

export interface RobotView {
  readonly arm: RobotArm;
  gripper: Gripper | null;
  readonly group: THREE.Group;
}

const ZONE = 0x22c55e;
const MARK = 0xf59e0b;

export class RobotLayer {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, RobotView & { zone: THREE.Mesh; marks: THREE.Group; key: string }>();
  private readonly ghost: THREE.Group;
  private selected: string | null = null;
  private readonly zoneMaterial = new THREE.MeshBasicMaterial({ color: ZONE, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  private readonly zoneSelected = new THREE.MeshBasicMaterial({ color: ZONE, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
  private readonly reachMaterial = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.25, depthWrite: false });
  private readonly markMaterial = new THREE.MeshBasicMaterial({ color: MARK, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  private gripperUrl = "";

  constructor() {
    this.root.name = "Robots";
    // Placing a new robot: a see-through base and its reach.
    this.ghost = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.12, 32),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    base.position.y = 0.06;
    this.ghost.add(base, this.ring(ROBOT_REACH, 0.01, this.reachMaterial));
    this.ghost.visible = false;
    this.root.add(this.ghost);
  }

  /** Where the gripper model is; each robot loads its own copy (the browser caches the file). */
  setGripperUrl(url: string) {
    this.gripperUrl = url;
  }

  view(id: string): RobotView | undefined {
    return this.views.get(id);
  }

  /** Makes the scene match `robots`: adds, moves and removes arms; redraws zones and markers. */
  sync(robots: readonly Robot[]): void {
    const keep = new Set(robots.map((r) => r.id));
    for (const [id, v] of this.views) {
      if (keep.has(id)) continue;
      v.group.removeFromParent();
      v.zone.removeFromParent();
      v.marks.removeFromParent();
      v.zone.geometry.dispose();
      this.views.delete(id);
    }
    for (const r of robots) {
      let v = this.views.get(r.id);
      if (!v) {
        const arm = new RobotArm(ARM, JOINTS);
        JOINTS.forEach((spec, i) => arm.setAngle(i, spec.home));
        arm.root.traverse((o) => (o.userData.robotId = r.id));
        const group = new THREE.Group();
        group.add(arm.root);
        const zone = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), this.zoneMaterial);
        zone.rotation.x = -Math.PI / 2;
        const marks = new THREE.Group();
        this.root.add(group, zone, marks);
        const view = { arm, gripper: null as Gripper | null, group, zone, marks, key: "" };
        // Placeholder fingers if the model can't be loaded, as for the main arm.
        void (this.gripperUrl ? Gripper.load(this.gripperUrl) : Promise.reject(new Error("no url")))
          .catch(() => Gripper.placeholder())
          .then((g) => {
            if (!this.views.has(r.id)) return;
            view.gripper = g;
            arm.toolMount.add(g.object);
          });
        this.views.set(r.id, view);
        v = view;
      }
      v.group.position.set(r.position.x, 0, r.position.z);
      v.group.rotation.y = r.rotationY * DEG;
      // The zone: a ring at the radius, on top of whatever is there (a belt's top, say).
      v.zone.geometry.dispose();
      v.zone.geometry = new THREE.RingGeometry(Math.max(0.01, r.pick.radius - 0.012), r.pick.radius, 48);
      v.zone.position.set(r.pick.x, 0.004, r.pick.z);
      const key = JSON.stringify([r.rules.map((x) => x.target), r.otherwise]);
      if (key !== v.key) {
        v.key = key;
        this.drawMarks(v.marks, r);
      }
    }
    this.select(this.selected);
  }

  /** Puts the zone (and markers) at the height of what's under them. */
  setZoneHeight(id: string, y: number) {
    const v = this.views.get(id);
    if (v) v.zone.position.y = y + 0.004;
  }

  private drawMarks(group: THREE.Group, r: Robot) {
    for (const c of [...group.children]) c.removeFromParent();
    const reach = this.ring(ROBOT_REACH, 0.008, this.reachMaterial);
    reach.position.set(r.position.x, 0.003, r.position.z);
    group.add(reach);
    for (const t of [...r.rules.map((x) => x.target), ...(r.otherwise ? [r.otherwise] : [])]) {
      if (t.type !== "spot") continue;
      // A square the size of the first ring of cells around the spot.
      const half = PITCH * 1.5;
      const square = new THREE.Mesh(new THREE.RingGeometry(half * Math.SQRT2 - 0.012, half * Math.SQRT2, 4, 1, Math.PI / 4), this.markMaterial);
      square.rotation.x = -Math.PI / 2;
      square.position.set(t.x, 0.003, t.z);
      group.add(square);
    }
  }

  private ring(radius: number, width: number, material: THREE.Material) {
    const m = new THREE.Mesh(new THREE.RingGeometry(radius - width, radius, 96), material);
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  select(id: string | null): void {
    this.selected = id;
    for (const [rid, v] of this.views) {
      v.zone.material = rid === id ? this.zoneSelected : this.zoneMaterial;
      v.marks.visible = rid === id;
    }
  }

  showGhost(at: { x: number; z: number } | null, rotationY = 0): void {
    this.ghost.visible = !!at;
    if (at) {
      this.ghost.position.set(at.x, 0, at.z);
      this.ghost.rotation.y = rotationY * DEG;
    }
  }

  /** The robot under the pointer, if any. */
  pick(raycaster: THREE.Raycaster): string | null {
    const groups = [...this.views.values()].map((v) => v.group);
    // The gripper is added after loading, so walk up to the arm's parts, which know their robot.
    for (let o: THREE.Object3D | null = raycaster.intersectObjects(groups, true)[0]?.object ?? null; o; o = o.parent) {
      if (o.userData.robotId) return o.userData.robotId as string;
    }
    return null;
  }
}
