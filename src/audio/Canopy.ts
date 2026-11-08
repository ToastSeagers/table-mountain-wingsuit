import type { WingsuitFlightState } from '../flight/state';
import type { AudioEngine } from './AudioEngine';

export type SurfaceKind = 'grass' | 'sand' | 'tarmac' | 'water' | 'rock';

/** Landing thump voicing per surface: body frequency, noise colour, noise length. */
const SURFACE: Record<SurfaceKind, { thump: number; noiseHz: number; noiseS: number; q: number }> =
  {
    grass: { thump: 70, noiseHz: 500, noiseS: 0.25, q: 0.7 },
    sand: { thump: 55, noiseHz: 1400, noiseS: 0.4, q: 0.5 },
    tarmac: { thump: 95, noiseHz: 2800, noiseS: 0.12, q: 1.2 },
    water: { thump: 45, noiseHz: 900, noiseS: 0.8, q: 0.4 },
    rock: { thump: 85, noiseHz: 2200, noiseS: 0.16, q: 1 },
  };

/**
 * Canopy sounds: the opening snap (one hard noise crack plus a sub thump, then quiet), line
 * flutter that scales with speed, a flare swoosh and the landing thump by surface.
 */
export class Canopy {
  private readonly flutterGain: GainNode;
  private readonly flutterFilter: BiquadFilterNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private lastFlare = 1;
  private lastPhase = '';
  private nextSwooshT = 0;

  constructor(private readonly audio: AudioEngine) {
    const c = audio.ctx;
    this.flutterFilter = c.createBiquadFilter();
    this.flutterFilter.type = 'bandpass';
    this.flutterFilter.frequency.value = 1500;
    this.flutterFilter.Q.value = 2;
    // Fast amplitude wobble makes the noise read as fabric rather than hiss.
    const wob = c.createGain();
    wob.gain.value = 0.6;
    const lfo = c.createOscillator();
    lfo.frequency.value = 9;
    const depth = c.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(wob.gain);
    lfo.start();
    this.sources.push(lfo);
    this.flutterGain = c.createGain();
    this.flutterGain.gain.value = 0;
    this.sources.push(audio.loopNoise(this.flutterFilter, false));
    this.flutterFilter.connect(wob).connect(this.flutterGain).connect(audio.world);
  }

  reset(): void {
    this.lastFlare = 1;
    this.lastPhase = '';
    this.flutterGain.gain.setTargetAtTime(0, this.audio.now, 0.05);
  }

  /** Per frame. `surface` is only read at touchdown. */
  update(s: WingsuitFlightState | null, surface: () => SurfaceKind): void {
    if (!s) return;
    const t = this.audio.now;
    if (s.phase !== this.lastPhase) {
      if (s.phase === 'deploying') this.snap();
      if (s.phase === 'landed' || s.phase === 'crashed') this.landing(s, surface());
      this.lastPhase = s.phase;
    }
    const under = s.phase === 'canopy' || s.phase === 'deploying';
    const sp = Math.min(1, s.airspeedMps / 30);
    this.flutterGain.gain.setTargetAtTime(under ? 0.03 + 0.12 * sp : 0, t, 0.2);
    this.flutterFilter.frequency.setTargetAtTime(900 + 1800 * sp, t, 0.2);
    // Flare: the energy meter drains while the player holds it.
    if (s.phase === 'canopy' && s.flareEnergy < this.lastFlare - 0.002 && t >= this.nextSwooshT) {
      this.audio.burst(this.audio.world, {
        durS: 0.45,
        gain: 0.22,
        freq: 700,
        sweepTo: 2600,
        q: 0.8,
      });
      this.nextSwooshT = t + 0.4;
    }
    this.lastFlare = s.flareEnergy;
  }

  private snap(): void {
    const a = this.audio;
    a.burst(a.world, { durS: 0.14, gain: 0.9, freq: 3200, q: 0.5, type: 'highpass' });
    a.burst(a.world, { durS: 0.5, gain: 0.5, freq: 400, q: 0.6, type: 'lowpass', sweepTo: 120 });
    a.tone(a.world, { freq: 90, slideTo: 38, durS: 0.45, gain: 0.7, type: 'sine' });
  }

  private landing(s: WingsuitFlightState, surface: SurfaceKind): void {
    const a = this.audio;
    const v = SURFACE[surface];
    const hard = s.phase === 'crashed' ? 1 : Math.min(1, (s.landing?.verticalMps ?? 2) / 6);
    a.tone(a.world, {
      freq: v.thump * (1 + 0.5 * hard),
      slideTo: 28,
      durS: 0.3 + 0.25 * hard,
      gain: 0.5 + 0.5 * hard,
      type: 'sine',
    });
    a.burst(a.world, {
      durS: v.noiseS * (0.7 + 0.6 * hard),
      gain: 0.3 + 0.5 * hard,
      freq: v.noiseHz,
      q: v.q,
    });
    if (s.phase === 'crashed')
      a.burst(a.world, { durS: 0.6, gain: 0.7, freq: 300, type: 'lowpass', q: 0.5 });
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
  }
}
