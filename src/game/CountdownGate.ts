/** How long an unfinished terrain preload may hold the countdown on "LOADING TERRAIN" before we go on anyway. */
export const PRELOAD_WAIT_MAX_S = 6;
/** Extra time, after the terrain gate has opened, the warm-up (chunk builds, tile uploads, shaders) may hold GO. */
export const WARMUP_WAIT_MAX_S = 4;

export type GateStage = 'terrain' | 'warmup' | 'go';

export interface GateInputs {
  /** The CPU sampler can answer around the exit (every height tile it needs is loaded). */
  terrainReady: boolean;
  /** The exit's texture and height preload resolved. */
  preloadDone: boolean;
  /** Terrain build, measure and upload queues are empty and the shaders are compiled. */
  warmSettled: boolean;
}

/**
 * The countdown's hold. Two gates in a row: the terrain gate (sampler ready and the exit preload done,
 * or 6 s) and then the warm-up gate (queues drained, or 4 s more). The warm-up latches once passed,
 * so the 3-2-1 never restarts because a queue refilled while the camera moved.
 */
export class CountdownGate {
  private waitedS = 0;
  private warmWaitedS = 0;
  private warmDone = false;

  reset(): void {
    this.waitedS = 0;
    this.warmWaitedS = 0;
    this.warmDone = false;
  }

  update(dtS: number, input: GateInputs): GateStage {
    const terrainOpen = input.terrainReady && (this.waitedS > PRELOAD_WAIT_MAX_S || input.preloadDone);
    if (!terrainOpen) {
      this.waitedS += dtS;
      return 'terrain';
    }
    if (!this.warmDone) {
      if (input.warmSettled || this.warmWaitedS > WARMUP_WAIT_MAX_S) this.warmDone = true;
      else {
        this.warmWaitedS += dtS;
        return 'warmup';
      }
    }
    return 'go';
  }
}
