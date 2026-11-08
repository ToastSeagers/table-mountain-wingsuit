/** Fixed simulation step, 120 Hz (docs/01-architecture.md section 6). */
export const SIM_STEP_S = 1 / 120;
/** A stalled tab or a breakpoint must not queue seconds of simulation. */
export const MAX_FRAME_DT_S = 0.1;

/**
 * Accumulator for a fixed-step simulation with render interpolation. Feed it the wall-clock
 * frame time; it calls `step` zero or more times and returns the interpolation alpha (0..1)
 * between the last two simulated states, for the renderer to blend.
 */
export class FixedStepLoop {
  private accumulatorS = 0;
  /** Total fixed steps run since construction or reset. */
  stepsRun = 0;

  constructor(
    readonly stepS: number = SIM_STEP_S,
    private readonly maxStepsPerFrame = 12,
  ) {}

  advance(frameDtS: number, step: (dtS: number) => void): number {
    this.accumulatorS += Math.min(Math.max(frameDtS, 0), MAX_FRAME_DT_S);
    let n = 0;
    while (this.accumulatorS >= this.stepS) {
      if (n >= this.maxStepsPerFrame) {
        // Spiral of death: drop the backlog rather than fall further behind.
        this.accumulatorS = 0;
        break;
      }
      step(this.stepS);
      this.accumulatorS -= this.stepS;
      this.stepsRun++;
      n++;
    }
    return this.accumulatorS / this.stepS;
  }

  reset(): void {
    this.accumulatorS = 0;
    this.stepsRun = 0;
  }
}
