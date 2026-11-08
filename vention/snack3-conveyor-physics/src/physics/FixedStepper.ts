/**
 * Fixed-timestep loop with an accumulator ("Fix your timestep").
 *
 * Physics always advances in identical steps of `step` seconds, however long a
 * frame took. That keeps the simulation stable and repeatable on a 60 Hz laptop
 * and a 144 Hz monitor alike. Leftover time carries to the next frame, and
 * `alpha` (0..1) says how far between the last two physics states the frame
 * falls, so rendering can interpolate instead of stuttering.
 */
export class FixedStepper {
  readonly step: number;
  readonly maxSteps: number;
  accumulator = 0;
  /** How far between the previous and current physics state this frame is (0..1). */
  alpha = 0;
  /** Simulated time thrown away because a frame needed more than maxSteps. */
  droppedTime = 0;

  constructor(step: number, maxSteps: number) {
    this.step = step;
    this.maxSteps = maxSteps;
  }

  /** Runs as many fixed steps as `frameDt` calls for. Returns how many ran. */
  advance(frameDt: number, stepOnce: () => void): number {
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      stepOnce();
      this.accumulator -= this.step;
      steps++;
    }
    // If physics can't keep up, drop the backlog rather than trying to catch up
    // next frame, which would take even longer (the "spiral of death").
    if (this.accumulator >= this.step) {
      this.droppedTime += this.accumulator - (this.accumulator % this.step);
      this.accumulator %= this.step;
    }
    this.alpha = this.accumulator / this.step;
    return steps;
  }
}
