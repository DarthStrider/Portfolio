import * as CANNON from "cannon-es";
import { DENSITY, GRAVITY, STATICS, type StaticCollider, type V3 } from "../layout";
import type { SlotPool } from "../sim/SlotPool";
import type { BodyDesc, PhysicsBackend, PhysicsStats, Quat } from "./types";

const WAKE_MARGIN = 0.02;

/**
 * The same scene on cannon-es, a full rigid-body engine: boxes rotate and tumble,
 * contacts are solved as constraints, and the broad phase is sweep-and-prune.
 * It sits behind the same PhysicsBackend interface as the custom engine, and is
 * stepped by the same fixed-step loop, so the two can be compared fairly.
 */
export class CannonWorld implements PhysicsBackend {
  readonly name = "cannon-es";
  readonly stats: PhysicsStats = { pairsTested: -1, contacts: 0, awake: 0 };
  readonly world: CANNON.World;

  private readonly bodies: (CANNON.Body | null)[];
  /** Previous position + quaternion per slot (7 numbers), for interpolation. */
  private readonly prev: Float64Array;
  private readonly belt: CANNON.Body;
  private readonly beltHome: CANNON.Vec3;
  /** One shape per box size, shared by every box of that size. */
  private readonly shapes = new Map<string, CANNON.Box>();
  private speed = 0;
  private lastPool: SlotPool | null = null;

  constructor(capacity: number, statics: readonly StaticCollider[] = STATICS) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0), allowSleep: true });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 8;
    this.world.defaultContactMaterial.friction = 0.5;
    this.world.defaultContactMaterial.restitution = 0.1;

    this.bodies = new Array<CANNON.Body | null>(capacity).fill(null);
    this.prev = new Float64Array(capacity * 7);

    let belt: CANNON.Body | null = null;
    for (const s of statics) {
      const body = new CANNON.Body({
        mass: 0,
        // The belt is kinematic: it has a velocity, so friction carries boxes along,
        // but we put it back in place every step so it never actually moves.
        type: s.conveyor ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3((s.max.x - s.min.x) / 2, (s.max.y - s.min.y) / 2, (s.max.z - s.min.z) / 2)),
        position: new CANNON.Vec3((s.min.x + s.max.x) / 2, (s.min.y + s.max.y) / 2, (s.min.z + s.max.z) / 2),
      });
      if (s.conveyor) {
        body.allowSleep = false;
        belt = body;
      }
      this.world.addBody(body);
    }
    if (!belt) throw new Error("The layout has no conveyor belt");
    this.belt = belt;
    this.beltHome = belt.position.clone();
    this.beltSpeed = 0.8;
  }

  get beltSpeed(): number {
    return this.speed;
  }

  set beltSpeed(v: number) {
    this.speed = v;
    this.belt.velocity.set(v, 0, 0);
  }

  add(slot: number, d: BodyDesc): void {
    const key = `${d.hx}|${d.hy}|${d.hz}`;
    let shape = this.shapes.get(key);
    if (!shape) {
      shape = new CANNON.Box(new CANNON.Vec3(d.hx, d.hy, d.hz));
      this.shapes.set(key, shape);
    }
    const body = new CANNON.Body({
      mass: 8 * d.hx * d.hy * d.hz * DENSITY,
      shape,
      position: new CANNON.Vec3(d.x, d.y, d.z),
      sleepSpeedLimit: 0.06,
      sleepTimeLimit: 0.4,
      linearDamping: 0.01,
      angularDamping: 0.05,
    });
    this.world.addBody(body);
    this.bodies[slot] = body;
    this.writePrev(slot, body);
  }

  remove(slot: number): void {
    const body = this.bodies[slot];
    if (!body) return;
    this.world.removeBody(body);
    this.bodies[slot] = null;
    // cannon-es doesn't wake bodies resting on a removed one, so do it ourselves,
    // spreading through anything touching (the same island idea as the custom engine).
    this.wakeAround(body);
  }

  savePrevious(pool: SlotPool): void {
    const { dense, count } = pool;
    for (let k = 0; k < count; k++) {
      const body = this.bodies[dense[k]];
      if (body) this.writePrev(dense[k], body);
    }
  }

  step(dt: number, pool: SlotPool): void {
    this.lastPool = pool;
    this.belt.position.copy(this.beltHome);
    this.world.step(dt); // one fixed step; our FixedStepper does the accumulating

    this.stats.contacts = this.world.contacts.length;
    let awake = 0;
    const { dense, count } = pool;
    for (let k = 0; k < count; k++) {
      const body = this.bodies[dense[k]];
      if (body && body.sleepState !== CANNON.Body.SLEEPING) awake++;
    }
    this.stats.awake = awake;
  }

  getPosition(slot: number, out: V3): void {
    const p = this.bodies[slot]!.position;
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
  }

  readTransform(slot: number, alpha: number, pos: V3, quat: Quat): void {
    const body = this.bodies[slot]!;
    const o = slot * 7;
    const prev = this.prev;
    pos.x = prev[o] + (body.position.x - prev[o]) * alpha;
    pos.y = prev[o + 1] + (body.position.y - prev[o + 1]) * alpha;
    pos.z = prev[o + 2] + (body.position.z - prev[o + 2]) * alpha;

    // Normalized lerp between the two rotations: close enough to slerp over one 1/120 s step.
    const q = body.quaternion;
    const sign = prev[o + 3] * q.x + prev[o + 4] * q.y + prev[o + 5] * q.z + prev[o + 6] * q.w < 0 ? -1 : 1;
    const x = prev[o + 3] + (sign * q.x - prev[o + 3]) * alpha;
    const y = prev[o + 4] + (sign * q.y - prev[o + 4]) * alpha;
    const z = prev[o + 5] + (sign * q.z - prev[o + 5]) * alpha;
    const w = prev[o + 6] + (sign * q.w - prev[o + 6]) * alpha;
    const len = Math.hypot(x, y, z, w) || 1;
    quat.x = x / len;
    quat.y = y / len;
    quat.z = z / len;
    quat.w = w / len;
  }

  isAsleep(slot: number): boolean {
    return this.bodies[slot]?.sleepState === CANNON.Body.SLEEPING;
  }

  private writePrev(slot: number, body: CANNON.Body): void {
    const o = slot * 7;
    this.prev[o] = body.position.x;
    this.prev[o + 1] = body.position.y;
    this.prev[o + 2] = body.position.z;
    this.prev[o + 3] = body.quaternion.x;
    this.prev[o + 4] = body.quaternion.y;
    this.prev[o + 5] = body.quaternion.z;
    this.prev[o + 6] = body.quaternion.w;
  }

  /** Wakes sleeping bodies whose bounding spheres touch `start`'s, and so on outward. */
  private wakeAround(start: CANNON.Body): void {
    const pool = this.lastPool;
    if (!pool) return;
    const queue: CANNON.Body[] = [start];
    while (queue.length > 0) {
      const a = queue.pop()!;
      for (let k = 0; k < pool.count; k++) {
        const b = this.bodies[pool.dense[k]];
        if (!b || b === a || b.sleepState !== CANNON.Body.SLEEPING) continue;
        const reach = a.boundingRadius + b.boundingRadius + WAKE_MARGIN;
        if (a.position.distanceSquared(b.position) < reach * reach) {
          b.wakeUp();
          queue.push(b);
        }
      }
    }
  }
}
