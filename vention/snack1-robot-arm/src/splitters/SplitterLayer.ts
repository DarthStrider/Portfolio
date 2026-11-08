import * as THREE from "three";
import { DEG } from "../arm/kinematics";
import type { Conveyor } from "../conveyors/types";
import type { Exit, Splitter } from "./types";

const FLAP_ANGLE = 50 * DEG; // how far a flap swings into the belt
const SWING_RATE = 10; // 1/s: flaps ease toward their target, fast but visibly
const HOLD = 0.9; // seconds a flap stays out after an item was sent its way

interface Gate {
  group: THREE.Group;
  /** Hinged on the +z (right, going forward) and -z (left) rails of the gate's own frame. */
  flaps: { right: THREE.Object3D; left: THREE.Object3D };
  /** Current and target swing, 0..1, and when each flap may close again. */
  swing: { right: number; left: number };
  until: { right: number; left: number };
  beam: THREE.MeshStandardMaterial;
  key: string;
}

/**
 * Draws each splitter as a diverter gate on its belt: an amber gantry across the belt at the
 * gate's position, and two flaps hinged on the side rails. When an item is sent left, the flap
 * on the right swings across the belt and guides it off the left side, and the other way round.
 *
 * Each gate is built in its own frame: x along the direction of travel (so the gate is turned
 * round on a reversed belt), z to the right, y up. Then "right" is always +z, whichever way
 * the belt is turned or running.
 */
export class SplitterLayer {
  readonly root = new THREE.Group();
  private readonly gates = new Map<string, Gate>();
  private readonly ghost: THREE.Group;
  private ghostKey = "";
  private time = 0;
  private selectedId: string | null = null;

  constructor() {
    this.root.name = "Splitters";
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.root.add(this.ghost);
  }

  /** Splitters whose belt is gone (deleted a moment ago) are skipped. */
  sync(splitters: readonly Splitter[], belts: readonly Conveyor[]): void {
    const byId = new Map(belts.map((b) => [b.id, b]));
    const keep = new Set(splitters.filter((s) => byId.has(s.conveyorId)).map((s) => s.id));
    for (const [id, g] of this.gates) {
      if (!keep.has(id)) {
        this.root.remove(g.group);
        dispose(g.group);
        this.gates.delete(id);
      }
    }
    for (const s of splitters) {
      const belt = byId.get(s.conveyorId);
      if (!belt) continue;
      const key = `${belt.width}:${belt.height}`;
      let g = this.gates.get(s.id);
      if (g && g.key !== key) {
        this.root.remove(g.group);
        dispose(g.group);
        g = undefined;
      }
      if (!g) {
        const beam = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5, metalness: 0.2 });
        const { group, flaps } = buildGate(belt, beam, new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.5 }));
        group.traverse((o) => (o.userData.splitterId = s.id));
        g = { group, flaps, swing: { right: 0, left: 0 }, until: { right: 0, left: 0 }, beam, key };
        this.gates.set(s.id, g);
        this.root.add(g.group);
      }
      g.group.name = s.name;
      placeOnBelt(g.group, belt, s.along);
    }
    this.select(this.selectedId);
  }

  /** An item was routed at this gate: swing the flap that guides it out. */
  trigger(id: string, exit: Exit): void {
    const g = this.gates.get(id);
    if (!g || exit === "straight") return;
    // Sending left needs the right-hand flap across the belt, and the other way round.
    const flap = exit === "left" ? "right" : "left";
    g.until[flap] = this.time + HOLD;
  }

  update(dt: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-SWING_RATE * dt);
    for (const g of this.gates.values()) {
      for (const side of ["right", "left"] as const) {
        const target = this.time < g.until[side] ? 1 : 0;
        g.swing[side] += (target - g.swing[side]) * k;
        // Positive rotation about y turns +x toward -z: the right flap swings left, into the belt.
        g.flaps[side].rotation.y = (side === "right" ? 1 : -1) * FLAP_ANGLE * g.swing[side];
      }
    }
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const [gid, g] of this.gates) g.beam.emissive.set(gid === id ? 0x7c2d12 : 0x000000);
  }

  pick(raycaster: THREE.Raycaster): string | null {
    const hit = raycaster.intersectObjects([...this.gates.values()].map((g) => g.group), true)[0];
    return (hit?.object.userData.splitterId as string | undefined) ?? null;
  }

  showGhost(belt: Conveyor, along: number): void {
    const key = `${belt.width}:${belt.height}`;
    if (key !== this.ghostKey) {
      for (const c of [...this.ghost.children]) {
        this.ghost.remove(c);
        dispose(c);
      }
      const see = () => new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.45, depthWrite: false });
      this.ghost.add(buildGate(belt, see(), see()).group);
      this.ghostKey = key;
    }
    placeOnBelt(this.ghost, belt, along);
    this.ghost.visible = true;
  }

  hideGhost(): void {
    this.ghost.visible = false;
  }
}

/** Puts a gate's frame on the belt: at `along` from the belt's start, facing the way it runs. */
function placeOnBelt(group: THREE.Object3D, belt: Conveyor, along: number): void {
  const t = belt.rotationY * DEG;
  const u = along - belt.length / 2;
  group.position.set(belt.position.x + u * Math.cos(t), 0, belt.position.z - u * Math.sin(t));
  group.rotation.y = t + (belt.speed < 0 ? Math.PI : 0);
}

function buildGate(belt: Pick<Conveyor, "width" | "height">, beam: THREE.Material, flap: THREE.Material) {
  const group = new THREE.Group();
  const w = belt.width;
  const top = belt.height + 0.22;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  // Gantry: two posts outside the rails and a beam across, so the gate is easy to spot and click.
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.03, top, 0.03), beam, 0, top / 2, side * (w / 2 + 0.04));
  add(new THREE.BoxGeometry(0.04, 0.04, w + 0.11), beam, 0, top, 0);

  // Flaps: hinged at the rail just upstream of the gate, lying along the rail when idle.
  const length = w * 0.9;
  const hingeX = -length * Math.cos(FLAP_ANGLE) * 0.5;
  const make = (side: 1 | -1) => {
    const hinge = new THREE.Group();
    hinge.position.set(hingeX, belt.height + 0.04, side * (w / 2 - 0.01));
    add(new THREE.BoxGeometry(length, 0.06, 0.012), flap, length / 2, 0, 0, hinge);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 12), beam, 0, 0, 0, hinge);
    group.add(hinge);
    return hinge;
  };
  return { group, flaps: { right: make(1), left: make(-1) } };
}

function dispose(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
    }
  });
}
