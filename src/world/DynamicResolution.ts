/**
 * Frame-time-driven scene resolution (research note 2.10: OpenSkyFlight's answer to weak GPUs and phones
 * that heat up). A small pure class like `StreamingBudgets`: feed it each frame's wall time while the
 * game is being played and it says what fraction of the full resolution to render the scene at.
 *
 * The signal is the frame interval, so a display locked to 60 Hz never shows how much headroom there is:
 * a frame that makes the vsync interval might have taken 5 ms or 15. So going up is a probe, not a
 * measurement: after a long run of frames on target the scale rises one step, and if that step costs
 * the budget the controller steps back down and waits twice as long before trying again (a back-off that
 * decays). That is what stops it hunting between two levels.
 */
export interface DynamicResolutionConfig {
  /** Lowest and highest scene scale, as a fraction of the full resolution. */
  minScale: number;
  maxScale: number;
  /** The frame time to hold, ms (16.7 for 60 fps). */
  targetMs: number;
}

/** Scale moves in steps of this much, and only to multiples of it, so the post stack can cache one target set per level. */
export const SCALE_STEP = 0.1;
/** Frame time is smoothed with this time constant, seconds: long enough to ride out a single slow frame. */
export const SMOOTHING_S = 0.5;
/** "Over budget" is a smoothed frame time above this multiple of the target; "on target" is at or below the second. */
export const OVER_FACTOR = 1.15;
export const UNDER_FACTOR = 1.05;
/** The smoothed time must stay over budget this long before the scale steps down, seconds. */
export const DOWN_HOLD_S = 0.5;
/** ...and stay on target this long before it steps up, seconds (base value; see back-off). */
export const UP_HOLD_S = 4;
/** No two changes closer than this, seconds (the brief's "about once a second"). */
export const MIN_INTERVAL_S = 1;
/** A step down within this long of a step up (a failed probe) doubles the up hold, to at most MAX_UP_HOLD_S... */
export const BACKOFF_WINDOW_S = 10;
export const MAX_UP_HOLD_S = 64;
/** ...and a spell this long without a step down restores it: the scene or the phone's temperature has changed. */
export const BACKOFF_RESET_S = 120;
/** Frames longer than this (a hidden tab, a tab switch, a shader compile) are not evidence about the GPU and are ignored, ms. */
export const MAX_SAMPLE_MS = 250;

const quantize = (v: number): number => Math.round(v / SCALE_STEP) * SCALE_STEP;

export class DynamicResolution {
  private cfg: DynamicResolutionConfig;
  private current: number;
  private smoothed = 0;
  private haveSample = false;
  private clockS = 0;
  private overForS = 0;
  private underForS = 0;
  private lastChangeS = -Infinity;
  private lastUpS = -Infinity;
  private lastDownS = -Infinity;
  private upHoldS = UP_HOLD_S;

  constructor(cfg: DynamicResolutionConfig) {
    this.cfg = { ...cfg };
    this.current = this.clamp(cfg.maxScale);
  }

  /** The scene scale now, 0..1 of the full resolution. */
  get scale(): number {
    return this.current;
  }

  /** The smoothed frame time, ms (0 before the first sample). */
  get smoothedMs(): number {
    return this.smoothed;
  }

  /** Seconds the scale must stay on target before it steps up (grows after a failed probe). */
  get upHold(): number {
    return this.upHoldS;
  }

  /** New limits (a quality preset change): the scale is clamped into them and the timers restart. */
  configure(cfg: DynamicResolutionConfig): void {
    this.cfg = { ...cfg };
    this.current = this.clamp(this.current);
    this.resetTimers();
  }

  /** Forget the running measurement: call when play resumes after a pause, a menu or a state change, so stale frame times do not count. */
  resetTimers(): void {
    this.haveSample = false;
    this.overForS = 0;
    this.underForS = 0;
  }

  /**
   * One frame's wall time in ms. Returns the new scale when it changed this frame, otherwise null.
   */
  update(frameMs: number): number | null {
    const dtS = frameMs / 1000;
    this.clockS += dtS;
    if (!(frameMs > 0) || frameMs > MAX_SAMPLE_MS) {
      this.resetTimers();
      return null;
    }
    if (!this.haveSample) {
      this.smoothed = frameMs;
      this.haveSample = true;
    } else {
      this.smoothed += (frameMs - this.smoothed) * (1 - Math.exp(-dtS / SMOOTHING_S));
    }
    const over = this.smoothed > this.cfg.targetMs * OVER_FACTOR;
    const under = this.smoothed <= this.cfg.targetMs * UNDER_FACTOR;
    this.overForS = over ? this.overForS + dtS : 0;
    this.underForS = under ? this.underForS + dtS : 0;

    // A long spell without a step down lets the probe interval relax again.
    if (this.upHoldS > UP_HOLD_S && this.clockS - this.lastDownS > BACKOFF_RESET_S) this.upHoldS = UP_HOLD_S;
    if (this.clockS - this.lastChangeS < MIN_INTERVAL_S) return null;

    if (over && this.overForS >= DOWN_HOLD_S && this.current > this.cfg.minScale + 1e-6) {
      if (this.clockS - this.lastUpS < BACKOFF_WINDOW_S) this.upHoldS = Math.min(MAX_UP_HOLD_S, this.upHoldS * 2);
      this.lastDownS = this.clockS;
      return this.move(-SCALE_STEP);
    }
    if (under && this.underForS >= this.upHoldS && this.current < this.cfg.maxScale - 1e-6) {
      this.lastUpS = this.clockS;
      return this.move(SCALE_STEP);
    }
    return null;
  }

  private move(delta: number): number {
    this.current = this.clamp(quantize(this.current + delta));
    this.lastChangeS = this.clockS;
    this.overForS = 0;
    this.underForS = 0;
    // The smoothed time describes the old scale; let the new one speak for itself.
    this.haveSample = false;
    return this.current;
  }

  private clamp(v: number): number {
    return Math.min(this.cfg.maxScale, Math.max(this.cfg.minScale, v));
  }
}

/** The scales a controller with these limits can visit, highest first (the post stack pre-allocates a target set for each). */
export function scaleLevels(minScale: number, maxScale: number): number[] {
  const out: number[] = [];
  for (let s = quantize(maxScale); s >= minScale - 1e-6; s = quantize(s - SCALE_STEP)) out.push(Number(s.toFixed(2)));
  return out;
}
