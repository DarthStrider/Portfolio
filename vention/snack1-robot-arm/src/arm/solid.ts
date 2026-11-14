/**
 * The solid world, as the arm and the robots see it every frame: obstacles from what's in the
 * scene (shapes where they're drawn, belts, bins), and "would this arm, as it is now, hit
 * any of them?". The math is in collision.ts; this file only gathers the pieces.
 */
import * as THREE from "three";
import { beltBoxes, binBox, boxPoints, firstHit, type Obstacle, type V3 } from "./collision";
import type { RobotArm } from "./RobotArm";
import type { Gripper } from "./Gripper";
import type { Conveyor } from "../conveyors/types";
import type { Bin } from "../line/types";
import type { Shape } from "../shapes/types";
import type { ShapeLayer } from "../shapes/ShapeLayer";

const DEG = 180 / Math.PI;

interface Sources {
  shapes: () => readonly Shape[];
  layer: ShapeLayer;
  belts: () => readonly Conveyor[];
  bins: () => readonly Bin[];
}

export function createSolidWorld(src: Sources) {
  /** Every shape where it's drawn now (not those in a bin, nor any gripper's), every belt and bin. */
  function obstacles(): Obstacle[] {
    const out: Obstacle[] = [];
    const v = new THREE.Vector3();
    for (const s of src.shapes()) {
      const mesh = src.layer.meshOf(s.id);
      if (!mesh || !mesh.visible || mesh.parent !== src.layer.root) continue;
      mesh.getWorldPosition(v);
      out.push({ name: s.name, id: s.id, center: { x: v.x, y: v.y, z: v.z }, half: { x: s.size.x / 2, y: s.size.y / 2, z: s.size.z / 2 }, yaw: mesh.rotation.y * DEG });
    }
    for (const b of src.belts()) out.push(...beltBoxes(b));
    for (const b of src.bins()) out.push(binBox(b));
    return out;
  }

  /** Points through a held shape's box, wherever the claw has it now. */
  function heldPoints(id: string): { part: string; p: V3 }[] {
    const s = src.shapes().find((x) => x.id === id);
    const mesh = src.layer.meshOf(id);
    if (!s || !mesh) return [];
    mesh.updateWorldMatrix(true, false);
    const e = mesh.matrixWorld.elements;
    const axis = (i: number): V3 => {
      const a = new THREE.Vector3(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]).normalize();
      return { x: a.x, y: a.y, z: a.z };
    };
    const c = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    // A few millimeters in from its faces, so resting on what it was picked from isn't a hit.
    const half = { x: Math.max(0, s.size.x / 2 - 0.004), y: Math.max(0, s.size.y / 2 - 0.004), z: Math.max(0, s.size.z / 2 - 0.004) };
    return boxPoints({ x: c.x, y: c.y, z: c.z }, half, [axis(0), axis(1), axis(2)]).map((p) => ({ part: s.name, p }));
  }

  /**
   * What an arm would hit as it stands now: its links, its palm, its claw's fingers (at
   * `gap` if given), and what it's holding. `ignore` are shapes it's allowed to touch (the
   * one it's closing on, the one it holds).
   */
  function hit(arm: RobotArm, gripper: Gripper | null, ignore: ReadonlySet<string>, opts: { gap?: number; holding?: string | null; obstacles?: Obstacle[] } = {}) {
    const all = (opts.obstacles ?? obstacles()).filter((o) => !o.id || !ignore.has(o.id));
    const capsules = [...arm.linkCapsules()];
    if (gripper) for (const seg of gripper.segments(opts.gap)) capsules.push({ part: "claw", a: seg.a, b: seg.b, r: seg.r });
    const points = [...arm.palmPoints(), ...(opts.holding ? heldPoints(opts.holding) : [])];
    return firstHit(capsules, points, all);
  }

  return { obstacles, hit };
}

export type SolidWorld = ReturnType<typeof createSolidWorld>;
