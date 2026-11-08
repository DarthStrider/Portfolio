import { test } from "node:test";
import assert from "node:assert/strict";
import { DEG, forwardKinematics } from "../src/arm/kinematics";
import { ARM, JOINTS } from "../src/arm/jointSpecs";
import { SequencePlayer, type ArmState } from "../src/sim/SequencePlayer";
import { FLOOR_SPOT, GAP_OPEN, PART_SIZE, PLATFORM, PLATFORM_SPOT, programForCycle } from "../src/sim/program";

const DT = 1 / 60;
const FINGERTIP_BELOW_TCP = 0.015;

function freshState(): ArmState {
  return { joints: JOINTS.map((j) => j.home), gap: GAP_OPEN };
}

/** Runs until `stop` returns true (or a time limit), calling `each` after every frame. */
function run(player: SequencePlayer, state: ArmState, stop: () => boolean, each?: () => void) {
  for (let t = 0; t < 120 && !stop(); t += DT) {
    player.update(DT, state);
    each?.();
  }
}

test("a full cycle runs without errors and ends at home with the gripper open", () => {
  const state = freshState();
  const player = new SequencePlayer(ARM, JOINTS, programForCycle);
  player.loop = false;
  player.play(state);
  run(player, state, () => player.status !== "playing");

  assert.equal(player.status, "done", player.error ?? "");
  state.joints.forEach((a, i) => assert.ok(Math.abs(a - JOINTS[i].home) < 1e-9));
  assert.ok(Math.abs(state.gap - GAP_OPEN) < 1e-9);
  assert.equal(player.cycle, 1); // the next play will run the return trip
});

test("the gripper closes exactly on the part at each station", () => {
  const state = freshState();
  const player = new SequencePlayer(ARM, JOINTS, programForCycle);
  player.play(state);

  const grips: { cycle: number; tcp: ReturnType<typeof forwardKinematics> }[] = [];
  let lastLabel = "";
  run(player, state, () => grips.length === 2, () => {
    const label = player.steps[player.index].label;
    if (lastLabel === "Close gripper" && label !== "Close gripper") {
      grips.push({ cycle: player.cycle, tcp: forwardKinematics(ARM, state.joints.map((a) => a * DEG)) });
      assert.ok(Math.abs(state.gap - PART_SIZE) < 1e-9);
    }
    lastLabel = label;
  });

  const near = (p: { x: number; y: number; z: number }, q: typeof p) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-6;
  assert.ok(near(grips[0].tcp, FLOOR_SPOT), "first grip should be at the floor spot");
  assert.ok(near(grips[1].tcp, PLATFORM_SPOT), "second grip should be at the platform");
});

test("over two looping cycles the gripper never hits the floor or the platform", () => {
  const state = freshState();
  const player = new SequencePlayer(ARM, JOINTS, programForCycle);
  player.play(state);

  let lowestFloor = Infinity;
  run(player, state, () => player.cycle >= 2 || player.status === "error", () => {
    const tcp = forwardKinematics(ARM, state.joints.map((a) => a * DEG));
    const overPlatform =
      Math.abs(tcp.x - PLATFORM.x) < PLATFORM.size / 2 + 0.05 && Math.abs(tcp.z - PLATFORM.z) < PLATFORM.size / 2 + 0.05;
    const surface = overPlatform ? PLATFORM.height : 0;
    lowestFloor = Math.min(lowestFloor, tcp.y - FINGERTIP_BELOW_TCP - surface);
  });

  assert.notEqual(player.status, "error", player.error ?? "");
  assert.ok(lowestFloor > 0, `fingertips go ${(-lowestFloor * 1000).toFixed(1)} mm into a surface`);
});

test("pause holds the pose, and resuming continues from where the arm is", () => {
  const state = freshState();
  const player = new SequencePlayer(ARM, JOINTS, programForCycle);
  player.play(state);
  for (let i = 0; i < 30; i++) player.update(DT, state);

  player.pause();
  const held = [...state.joints];
  for (let i = 0; i < 30; i++) player.update(DT, state);
  assert.deepEqual(state.joints, held);

  // Someone nudges a joint while paused; resuming must not jump back.
  state.joints[0] += 10;
  const nudged = [...state.joints];
  player.play(state);
  player.update(DT, state);
  state.joints.forEach((a, i) => assert.ok(Math.abs(a - nudged[i]) < 1, `joint ${i} jumped`));
});

test("speed scales how fast steps complete", () => {
  const timeToFinishFirstStep = (speed: number) => {
    const state = freshState();
    const player = new SequencePlayer(ARM, JOINTS, programForCycle);
    player.speed = speed;
    player.play(state);
    let frames = 0;
    while (player.index === 0) {
      player.update(DT, state);
      frames++;
    }
    return frames;
  };
  const normal = timeToFinishFirstStep(1);
  const double = timeToFinishFirstStep(2);
  assert.ok(Math.abs(normal / double - 2) < 0.1, `${normal} vs ${double} frames`);
});
