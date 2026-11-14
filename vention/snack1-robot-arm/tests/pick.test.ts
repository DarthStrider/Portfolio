import { test } from "node:test";
import assert from "node:assert/strict";
import { DEG, forwardKinematics } from "../src/arm/kinematics";
import { fingerYaw, wrapDeg } from "../src/arm/ik";
import { ARM, JOINTS, ROLL } from "../src/arm/jointSpecs";
import { GAP_OPEN, PALM_ABOVE_TCP, FINGERTIP_BELOW_TCP } from "../src/arm/gripperSpec";
import { contactGap, graspFor, MAX_GRIP } from "../src/pick/grasp";
import { planPickPlace, ProgramPlayer, type ArmState, type PickRequest, type PlayerEvent } from "../src/pick/program";
import type { ShapeKind } from "../src/shapes/types";

const shape = (kind: ShapeKind, w: number, h: number, d = w, at = { x: 0.55, z: 0.1 }, rotationY = 0) => ({
  name: `${kind}`, kind, size: { x: w, y: h, z: d }, position: at, rotationY,
});

// ---- Grasping ----

test("the claw closes on a box until the pair across its longer side touches, fingers square to its faces", () => {
  const long = graspFor(shape("box", 0.08, 0.1, 0.12, undefined, 20));
  assert.ok(long.ok);
  assert.ok(Math.abs(long.width - 0.12) < 1e-9); // the 12 cm side stops the claw; the 8 cm pair doesn't touch
  assert.equal(long.fingerYaw, 20);
  const square = graspFor(shape("box", 0.06, 0.1, 0.06, undefined, -35));
  assert.ok(square.ok && Math.abs(square.width - 0.06) < 1e-9); // a square box: all four fingers touch
});

test("turned 45° to a box, the claw would close on its corners: a wider reach", () => {
  const box = shape("box", 0.06, 0.1, 0.06);
  assert.ok(Math.abs(contactGap(box, 0, 0.05) - 0.06) < 1e-9);
  assert.ok(Math.abs(contactGap(box, 45, 0.05) - 0.06 * Math.SQRT2) < 1e-9);
});

test("shapes wider than the open gripper, or thinner than the closed one, are refused with a reason", () => {
  const wide = graspFor(shape("box", 0.2, 0.2));
  assert.ok(!wide.ok);
  assert.match(wide.reason, /Too wide.*20 cm × 20 cm/);
  assert.ok(!graspFor(shape("cylinder", MAX_GRIP + 0.01, 0.1)).ok);
  assert.ok(graspFor(shape("cylinder", MAX_GRIP, 0.1)).ok);
  const thin = graspFor(shape("box", 0.004, 0.1, 0.004));
  assert.ok(!thin.ok);
  assert.match(thin.reason, /Too thin/);
});

test("the palm stays above the shape's top and the fingertips above the floor", () => {
  for (const kind of ["box", "cylinder", "sphere", "cone"] as const) {
    for (const h of [0.01, 0.04, 0.1, 0.3]) {
      const g = graspFor(shape(kind, 0.06, kind === "sphere" ? 0.06 : h));
      if (!g.ok) continue;
      const top = kind === "sphere" ? 0.06 : h;
      assert.ok(g.height + PALM_ABOVE_TCP > top, `${kind} h=${h}: palm hits the top`);
      assert.ok(g.height - FINGERTIP_BELOW_TCP > 0, `${kind} h=${h}: fingertips hit the floor`);
    }
  }
});

test("round shapes can be gripped from any side, and a cone where it's narrower", () => {
  const cyl = graspFor(shape("cylinder", 0.06, 0.12));
  assert.ok(cyl.ok && cyl.fingerYaw === null && cyl.width === 0.06);
  const cone = graspFor(shape("cone", 0.1, 0.2));
  assert.ok(cone.ok && cone.width < 0.1);
  const ball = graspFor(shape("sphere", 0.08, 0.08));
  assert.ok(ball.ok && Math.abs(ball.width - 0.08) < 1e-9); // small enough to grip at its middle
});

// ---- Planning ----

const request = (overrides: Partial<PickRequest> = {}): PickRequest => ({
  shape: shape("box", 0.06, 0.08, 0.1, { x: 0.55, z: 0.1 }, 15),
  fromBaseY: 0,
  to: { x: -0.2, z: 0.6 },
  toBaseY: 0,
  turn: 0,
  ...overrides,
});

test("a plan picks, carries and places, and says where the shape ends up facing", () => {
  const plan = planPickPlace(ARM, JOINTS, request({ turn: 45 }));
  assert.ok(plan.ok, plan.ok ? "" : plan.reason);
  assert.deepEqual(plan.steps.map((s) => s.kind), ["gripper", "moveJ", "moveL", "gripper", "moveL", "moveJ", "moveL", "gripper", "moveL", "home"]);
  assert.equal(plan.rotationY, 60);
  assert.ok(Math.abs(plan.width - 0.1) < 1e-9); // the claw closes on the box's 10 cm side
  assert.ok(plan.steps.some((s) => s.kind === "gripper" && s.grab));
  assert.ok(plan.steps.some((s) => s.kind === "gripper" && s.release));
});

test("plans are refused, with a reason, when the shape or the spot can't be reached", () => {
  const far = planPickPlace(ARM, JOINTS, request({ shape: shape("box", 0.06, 0.08, 0.06, { x: 1.5, z: 0 }) }));
  assert.ok(!far.ok && /out of the arm's reach/.test(far.reason));
  const spot = planPickPlace(ARM, JOINTS, request({ to: { x: 0, z: 0.1 } }));
  assert.ok(!spot.ok && /hit the arm's base/.test(spot.reason));
  const wide = planPickPlace(ARM, JOINTS, request({ shape: shape("box", 0.3, 0.1) }));
  assert.ok(!wide.ok && /Too wide/.test(wide.reason));
});

// ---- Running ----

function run(req: PickRequest) {
  const plan = planPickPlace(ARM, JOINTS, req);
  assert.ok(plan.ok, plan.ok ? "" : plan.reason);
  const state: ArmState = { joints: JOINTS.map((j) => j.home), gap: GAP_OPEN };
  const player = new ProgramPlayer(ARM, JOINTS, plan.steps, state);
  const log: { event: PlayerEvent; joints: number[]; gap: number }[] = [];
  for (let i = 0; i < 2000 && player.status === "playing"; i++) {
    for (const event of player.update(1 / 60, state)) log.push({ event, joints: [...state.joints], gap: state.gap });
    state.joints.forEach((a, j) => assert.ok(a >= JOINTS[j].min - 1e-9 && a <= JOINTS[j].max + 1e-9, `${JOINTS[j].name} = ${a}`));
  }
  return { plan, player, log, state };
}

test("running the program grabs at the shape, lets go at the spot, turned as asked, and ends at home", () => {
  const req = request({ turn: -60 });
  const { plan, player, log, state } = run(req);
  assert.equal(player.status, "done");
  assert.deepEqual(log.map((l) => l.event), ["grab", "release", "done"]);
  assert.ok(plan.ok);

  const tcp = (q: number[]) => forwardKinematics(ARM, q.map((a) => a * DEG));
  const [grab, release] = log;
  // Grabbed with the TCP inside the shape, at its grip height, and the fingers closed on it.
  const g = graspFor(req.shape);
  assert.ok(g.ok);
  const atGrab = tcp(grab.joints);
  assert.ok(Math.hypot(atGrab.x - 0.55, atGrab.y - g.height, atGrab.z - 0.1) < 1e-6);
  assert.ok(Math.abs(grab.gap - 0.1) < 1e-9);
  // Let go just above the spot...
  const atRelease = tcp(release.joints);
  assert.ok(Math.hypot(atRelease.x - req.to.x, atRelease.z - req.to.z) < 1e-6);
  assert.ok(atRelease.y > g.height && atRelease.y < g.height + 0.01);
  // ...with the fingers turned by exactly the requested turn since the grab.
  const turned = fingerYaw(release.joints[0], release.joints[ROLL]) - fingerYaw(grab.joints[0], grab.joints[ROLL]);
  assert.ok(Math.abs(wrapDeg(turned - req.turn)) < 1e-6, `turned ${turned}°`);
  // And home again.
  state.joints.forEach((a, i) => assert.ok(Math.abs(a - JOINTS[i].home) < 1e-9));
});

test("picking from one side and placing on the other side stays within the joint limits", () => {
  const { player } = run(request({ shape: shape("cylinder", 0.05, 0.1, 0.05, { x: -0.5, z: -0.05 }), to: { x: -0.5, z: 0.05 }, turn: 170 }));
  assert.equal(player.status, "done");
});
