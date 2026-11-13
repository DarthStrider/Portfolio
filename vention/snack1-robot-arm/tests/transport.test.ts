import { test } from "node:test";
import assert from "node:assert/strict";
import { floorHalf } from "../src/scene/floor";
import { beltUnder, beltVelocity, step, supportHeight, toBelt, type Body } from "../src/conveyors/transport";

const belt = (over: Partial<{ length: number; width: number; height: number; speed: number; x: number; z: number; rotationY: number }> = {}) => {
  const b = { length: 1, width: 0.3, height: 0.2, speed: 0.5, x: 0, z: 0, rotationY: 0, ...over };
  return { length: b.length, width: b.width, height: b.height, speed: b.speed, position: { x: b.x, z: b.z }, rotationY: b.rotationY };
};
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

function run(bodies: Body[], belts: ReturnType<typeof belt>[], seconds: number, dt = 1 / 120) {
  for (let t = 0; t < seconds - 1e-9; t += dt) step(bodies, belts, dt);
}

test("a belt's frame: u along its length, v across, following its rotation", () => {
  const b = belt({ x: 1, z: 1, rotationY: 90 }); // turned 90°: travels toward -z
  const p = toBelt(b, 1, 0.6); // 0.4 m in the direction of travel
  close(p.u, 0.4);
  close(p.v, 0);
  const v = beltVelocity(b);
  close(v.vx, 0);
  close(v.vz, -0.5);
});

test("support: the highest belt under a point, ignoring belts above a given height", () => {
  const low = belt({ height: 0.2 });
  const high = belt({ height: 0.5, width: 0.1 });
  assert.equal(supportHeight([low, high], 0, 0), 0.5);
  assert.equal(supportHeight([low, high], 0, 0.1), 0.2); // outside the narrow high belt
  assert.equal(supportHeight([low, high], 0, 0, 0.3), 0.2); // a body at 0.3 m sits on the low one
  assert.equal(supportHeight([low, high], 2, 0), 0); // floor
  assert.equal(beltUnder([low], 0.5, 0.15), low); // edges count
});

test("a shape on a running belt rides at the belt's speed", () => {
  const b = belt({ length: 2 }); // 0.5 m/s along +x, from x = -1 to 1
  const body: Body = { x: -0.8, z: 0, y: 0.2, vx: 0, vy: 0, vz: 0 };
  run([body], [b], 1);
  close(body.x, -0.3, 1e-6);
  close(body.y, 0.2);
});

test("it falls off the end, keeping its forward speed, and stops on the floor", () => {
  const b = belt({ length: 1, height: 0.5, speed: 0.5 });
  const body: Body = { x: 0.3, z: 0, y: 0.5, vx: 0, vy: 0, vz: 0 };
  run([body], [b], 3);
  assert.equal(body.y, 0);
  // A 0.5 m fall takes sqrt(2·0.5/9.81) = 0.32 s, at 0.5 m/s forward: lands about 0.16 m past the end.
  close(body.x, 0.5 + 0.5 * Math.sqrt(1 / 9.81), 0.01);
  assert.deepEqual([body.vx, body.vz], [0, 0]);
});

test("falling takes the time gravity says", () => {
  const body: Body = { x: 5, z: 0, y: 0.4905, vx: 0, vy: 0, vz: 0 }; // h = g t²/2 with t = 0.316 s
  let t = 0;
  while (body.y > 0) {
    step([body], [], 1 / 1000);
    t += 1 / 1000;
  }
  close(t, Math.sqrt((2 * 0.4905) / 9.81), 0.003);
});

test("a higher belt hands over to a lower one, which carries it on", () => {
  const upper = belt({ x: 0, length: 1, height: 0.4, speed: 0.4 });
  const lower = belt({ x: 0.6, length: 1, height: 0.15, speed: 0.4, rotationY: 90 }); // runs toward -z
  const body: Body = { x: 0, z: 0, y: 0.4, vx: 0, vy: 0, vz: 0 };
  run([body], [upper, lower], 2.5);
  close(body.y, 0.15);
  assert.ok(body.z < -0.3, `carried along the lower belt to z = ${body.z}`);
});

test("shapes on the floor, or under a belt that's above them, don't move", () => {
  const b = belt({ height: 0.5 });
  const onFloor: Body = { x: 2, z: 0, y: 0, vx: 0, vy: 0, vz: 0 };
  const under: Body = { x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0 }; // e.g. a flat plate beneath a high belt
  run([onFloor, under], [b], 1);
  assert.deepEqual([onFloor.x, under.x, under.y], [2, 0, 0]);
});

test("a stopped belt holds things in place, and a reversed one runs backwards", () => {
  const body: Body = { x: 0, z: 0, y: 0.2, vx: 0, vy: 0, vz: 0 };
  run([body], [belt({ speed: 0 })], 1);
  assert.equal(body.x, 0);
  run([body], [belt({ speed: -0.2 })], 1);
  close(body.x, -0.2, 1e-6);
});

test("carried shapes stop at the edge of the floor area", () => {
  const edge = floorHalf() - 0.05;
  const body: Body = { x: edge - 0.15, z: 0, y: 0.2, vx: 0, vy: 0, vz: 0 };
  run([body], [belt({ x: edge - 0.45, length: 1.5, speed: 1 })], 1);
  assert.equal(body.x, edge);
});
