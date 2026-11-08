/**
 * Per-frame streaming work limits. In flight they come from the quality preset (small on phones, so
 * a burst of new chunks or tiles never lands in one frame). While the countdown holds the screen is a
 * loading screen, so the work runs as fast as frames allow whatever the preset says.
 */

/** Chunk geometries built per frame while the countdown holds. */
export const WARMUP_BUILDS_PER_FRAME = 48;
/** Texture tiles uploaded per frame while the countdown holds (about 1 to 3 ms each on a desktop, more on a phone). */
export const WARMUP_UPLOADS_PER_FRAME = 6;
/** Node-error measurement time slice per frame in flight, and while the countdown holds. */
export const MEASURE_BUDGET_MS = 2;
export const WARMUP_MEASURE_BUDGET_MS = 8;

export interface StreamingBudgets {
  buildsPerFrame: number;
  uploadsPerFrame: number;
  measureMs: number;
}

export function streamingBudgets(warming: boolean, flightBuilds: number, flightUploads: number): StreamingBudgets {
  if (warming) {
    return {
      buildsPerFrame: Math.max(flightBuilds, WARMUP_BUILDS_PER_FRAME),
      uploadsPerFrame: Math.max(flightUploads, WARMUP_UPLOADS_PER_FRAME),
      measureMs: WARMUP_MEASURE_BUDGET_MS,
    };
  }
  return { buildsPerFrame: flightBuilds, uploadsPerFrame: flightUploads, measureMs: MEASURE_BUDGET_MS };
}
