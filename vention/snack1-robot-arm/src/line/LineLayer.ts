import * as THREE from "three";
import { DEG } from "../arm/kinematics";
import { fromBelt, toBelt } from "../conveyors/transport";
import type { Conveyor } from "../conveyors/types";
import type { MachineStatus } from "./stations";
import type { Machine, Merger } from "./types";

const GREEN = 0x22c55e;
const AMBER = 0xf59e0b;
const RED = 0xef4444;
const BLUE = 0x3b82f6;

interface MergerModel { group: THREE.Group; light: THREE.MeshStandardMaterial; key: string }
interface MachineModel { group: THREE.Group; light: THREE.MeshStandardMaterial; head: THREE.Object3D; headTop: number; key: string }

/**
 * Draws mergers and joining machines.
 *
 * A merger is a signal post beside the merge point (green: clear, red: holding an item) and a
 * translucent patch on the main belt showing the gap it keeps clear. A machine is a portal
 * over the belt whose press head comes down while it joins, with a light: green idle, amber
 * holding one item, blue joining, red when it couldn't join.
 *
 * Both are rebuilt from the API's lists by sync(), like the other layers, and animated from the
 * stations' snapshot every frame while the belts run.
 */
export class LineLayer {
  readonly root = new THREE.Group();
  private readonly mergers = new Map<string, MergerModel>();
  private readonly machines = new Map<string, MachineModel>();

  constructor() {
    this.root.name = "Line";
  }

  sync(mergers: readonly Merger[], machines: readonly Machine[], belts: readonly Conveyor[], mergePoint: (m: Merger) => { x: number; z: number; u: number } | null): void {
    const byId = new Map(belts.map((b) => [b.id, b]));

    const keepM = new Set<string>();
    for (const m of mergers) {
      const main = byId.get(m.conveyorId);
      const at = mergePoint(m);
      if (!main || !at) continue;
      keepM.add(m.id);
      // The post stands on the side away from the (first) feeder, so it doesn't block it.
      const f = byId.get(m.feederIds[0]);
      const side = f && toBelt(main, f.position.x, f.position.z).v > 0 ? -1 : 1;
      const key = JSON.stringify([main.position, main.rotationY, main.width, main.height, m.gap, at.u, side]);
      const old = this.mergers.get(m.id);
      if (old?.key === key) continue;
      if (old) this.drop(old.group);
      const model = buildMerger(main, at.u, side, m.gap);
      this.mergers.set(m.id, { ...model, key });
      this.root.add(model.group);
    }
    for (const [id, m] of this.mergers) if (!keepM.has(id)) {
      this.drop(m.group);
      this.mergers.delete(id);
    }

    const keepK = new Set<string>();
    for (const mc of machines) {
      const belt = byId.get(mc.conveyorId);
      if (!belt) continue;
      keepK.add(mc.id);
      const key = JSON.stringify([belt.position, belt.rotationY, belt.length, belt.width, belt.height, mc.along]);
      const old = this.machines.get(mc.id);
      if (old?.key === key) continue;
      if (old) this.drop(old.group);
      const model = buildMachine(belt, mc.along);
      this.machines.set(mc.id, { ...model, key });
      this.root.add(model.group);
    }
    for (const [id, m] of this.machines) if (!keepK.has(id)) {
      this.drop(m.group);
      this.machines.delete(id);
    }
  }

  /** Lights and press heads from the stations' state. Pass empty maps to show everything idle. */
  show(mergersHolding: ReadonlyMap<string, number>, machines: ReadonlyMap<string, MachineStatus>): void {
    for (const [id, m] of this.mergers) setLight(m.light, (mergersHolding.get(id) ?? 0) > 0 ? RED : GREEN);
    for (const [id, m] of this.machines) {
      const s = machines.get(id) ?? { state: "idle" as const };
      setLight(m.light, s.state === "joining" ? BLUE : s.state === "waiting" ? AMBER : s.state === "error" ? RED : GREEN);
      // The head comes down over the first half of the cycle and goes back up over the second.
      const p = s.state === "joining" ? Math.sin(Math.PI * s.progress) : 0;
      m.head.position.y = m.headTop - p * 0.12;
    }
  }

  private drop(group: THREE.Object3D) {
    this.root.remove(group);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

function setLight(mat: THREE.MeshStandardMaterial, color: number) {
  mat.color.setHex(color);
  mat.emissive.setHex(color);
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Built in the main belt's frame: x along it, z across. */
function buildMerger(main: Conveyor, u: number, side: number, gap: number) {
  const group = new THREE.Group();
  const p = fromBelt(main, 0, 0);
  group.position.set(p.x, 0, p.z);
  group.rotation.y = main.rotationY * DEG;

  const zone = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(2 * gap, main.length), main.width).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  zone.position.set(u, main.height + 0.004, 0);
  group.add(zone);

  const post = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 });
  const top = main.height + 0.35;
  const z = side * (main.width / 2 + 0.07);
  box(0.03, top, 0.03, post, u, top / 2, z, group);
  const light = new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 0.8 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), light);
  bulb.position.set(u, top + 0.03, z);
  group.add(bulb);
  return { group, light };
}

function buildMachine(belt: Conveyor, along: number) {
  const group = new THREE.Group();
  const p = fromBelt(belt, along - belt.length / 2, 0);
  group.position.set(p.x, 0, p.z);
  group.rotation.y = belt.rotationY * DEG;

  const frame = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.5, metalness: 0.2 });
  const w = belt.width;
  const top = belt.height + 0.42;
  for (const s of [-1, 1]) box(0.05, top, 0.12, frame, 0, top / 2, s * (w / 2 + 0.06), group);
  box(0.16, 0.08, w + 0.17, frame, 0, top, 0, group);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xc4b5fd, roughness: 0.4, metalness: 0.3 });
  const headTop = top - 0.12;
  const head = box(0.1, 0.06, Math.min(0.16, w * 0.6), headMat, 0, headTop, 0, group);
  box(0.02, 0.1, 0.02, headMat, 0, 0.06, 0, head); // the rod up to the beam
  const light = new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 0.8 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), light);
  bulb.position.set(0, top + 0.07, w / 2 + 0.06);
  group.add(bulb);
  return { group, light, head, headTop };
}
