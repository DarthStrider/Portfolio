import * as THREE from "three";
import { ARM, JOINTS } from "../arm/jointSpecs";
import { Gripper } from "../arm/Gripper";
import { RobotArm } from "../arm/RobotArm";
import type { Simulation } from "../sim/Simulation";
import { createStage } from "./stage";
import { Workcell } from "./Workcell";

/**
 * The 3D side. Owns the Three.js scene and the frame loop, and is the only thing
 * that advances the simulation. It reads `sim.state` directly every frame: no
 * React involved, so the scene never waits on a React render.
 */
export class Viewer {
  private readonly stage: ReturnType<typeof createStage>;
  private readonly sim: Simulation;
  private readonly arm = new RobotArm(ARM, JOINTS);
  private readonly workcell: Workcell;
  private readonly tcp = new THREE.Vector3();
  private gripper: Gripper | null = null;
  private seenReset: number;
  private lastTime = performance.now();
  private disposed = false;

  constructor(container: HTMLElement, sim: Simulation) {
    this.sim = sim;
    this.stage = createStage(container);
    this.stage.scene.add(this.arm.root);
    this.workcell = new Workcell(this.stage.scene);
    this.seenReset = sim.resetVersion;

    Gripper.load(`${import.meta.env.BASE_URL}models/gripper.glb`)
      .catch((err: unknown) => {
        console.error("Using a placeholder gripper:", err);
        return Gripper.placeholder();
      })
      .then((gripper) => {
        if (this.disposed) return; // unmounted while the model was loading
        this.gripper = gripper;
        this.arm.toolMount.add(gripper.object);
      });

    this.stage.renderer.setAnimationLoop(this.frame);
  }

  private frame = (time: number) => {
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;

    const { sim, arm } = this;
    sim.tick(dt);

    if (sim.resetVersion !== this.seenReset) {
      this.seenReset = sim.resetVersion;
      this.workcell.reset();
    }

    sim.state.joints.forEach((angle, i) => arm.setAngle(i, angle));
    arm.tcp.getWorldPosition(this.tcp);
    const gap = this.workcell.update(dt, this.tcp, sim.state.gap, this.gripper?.object ?? null);
    this.gripper?.setGap(gap);

    this.stage.controls.update();
    this.stage.renderer.render(this.stage.scene, this.stage.camera);
  };

  dispose(): void {
    this.disposed = true;
    this.stage.renderer.setAnimationLoop(null);
    this.stage.dispose();
  }
}
