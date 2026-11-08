import type { WingsuitFlightState } from '../flight/state';
import type { AudioEngine } from './AudioEngine';

export interface AltimeterThresholds {
  warnM: number;
  deployM: number;
  lowM: number;
}
export const DEFAULT_ALTIMETER: AltimeterThresholds = { warnM: 250, deployM: 160, lowM: 120 };
/** Below this AGL the beeps become a pulse that speeds up as the ground comes. */
const PULSE_START_AGL_M = 150;

/**
 * Altitude warnings. Each threshold crossing plays one cue (warning: one beep, deploy: two,
 * low: three sharp). Under 150 m a pulse repeats, faster the lower you are. Silent once the
 * canopy is out. The pulse rate is derived from AGL, so it follows the descent.
 */
export class Altimeter {
  private prevAgl = Infinity;
  private nextPulseT = 0;
  /** Fired on each pulse beep so the HUD (or tests) can sync to it. */
  onBeep: ((agl: number) => void) | null = null;

  constructor(
    private readonly audio: AudioEngine,
    readonly thresholds: AltimeterThresholds = { ...DEFAULT_ALTIMETER },
  ) {}

  reset(): void {
    this.prevAgl = Infinity;
    this.nextPulseT = 0;
  }

  update(s: WingsuitFlightState | null): void {
    if (!s) return;
    const under = s.phase === 'canopy' || s.phase === 'deploying' || s.phase === 'landed' || s.phase === 'crashed';
    const agl = s.aglM;
    if (under) {
      this.prevAgl = agl;
      return;
    }
    const th = this.thresholds;
    if (this.prevAgl > th.warnM && agl <= th.warnM) this.cue(1, 880, 0.12);
    if (this.prevAgl > th.deployM && agl <= th.deployM) this.cue(2, 1175, 0.1);
    if (this.prevAgl > th.lowM && agl <= th.lowM) this.cue(3, 1568, 0.08);
    this.prevAgl = agl;

    if (agl < PULSE_START_AGL_M && agl > 5 && this.audio.running) {
      const now = this.audio.now;
      if (now >= this.nextPulseT) {
        const k = (PULSE_START_AGL_M - agl) / PULSE_START_AGL_M;
        this.nextPulseT = now + 1 / (1.6 + 7 * k * k);
        this.audio.tone(this.audio.world, { freq: 1568 + 500 * k, durS: 0.06, gain: 0.12 + 0.1 * k, type: 'square' });
        this.onBeep?.(agl);
      }
    }
  }

  private cue(count: number, freq: number, gap: number): void {
    const t = this.audio.now;
    for (let i = 0; i < count; i++) this.audio.tone(this.audio.world, { at: t + i * (gap + 0.06), freq, durS: 0.09, gain: 0.2, type: 'square' });
  }
}
