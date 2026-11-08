import type { WingsuitFlightState } from '../flight/state';
import type { AudioEngine } from './AudioEngine';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Wind: the main instrument. Two decorrelated pink-noise voices (left and right) go through a
 * band-pass then a low-pass. Speed opens the cutoff and raises the gain; the stereo spread
 * widens with speed and the pair pans with bank angle. Under 20 m AGL a low rumble comes up
 * (ground effect and rushing air); in the start arc a flutter tremolo plays on the body.
 */
export class Wind {
  private readonly out: GainNode;
  private readonly bp: BiquadFilterNode[] = [];
  private readonly lp: BiquadFilterNode[] = [];
  private readonly voiceGain: GainNode[] = [];
  private readonly voicePan: StereoPannerNode[] = [];
  private readonly pan: StereoPannerNode;
  private readonly rumbleGain: GainNode;
  private readonly flutterGain: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(private readonly audio: AudioEngine) {
    const c = audio.ctx;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.pan = c.createStereoPanner();
    this.out.connect(this.pan).connect(audio.world);

    for (const side of [-1, 1]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.4;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      const g = c.createGain();
      const p = c.createStereoPanner();
      p.pan.value = side;
      this.sources.push(audio.loopNoise(bp));
      bp.connect(lp).connect(g).connect(p).connect(this.out);
      this.bp.push(bp);
      this.lp.push(lp);
      this.voiceGain.push(g);
      this.voicePan.push(p);
    }

    // Sub rumble: noise through a 70 Hz low-pass, near the ground only.
    const rumble = c.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 70;
    rumble.Q.value = 1.5;
    this.rumbleGain = c.createGain();
    this.rumbleGain.gain.value = 0;
    this.sources.push(audio.loopNoise(rumble));
    rumble.connect(this.rumbleGain).connect(audio.world);

    // Flutter: the wingsuit fabric snapping, a ~14 Hz tremolo on a high band of noise.
    const flutterBand = c.createBiquadFilter();
    flutterBand.type = 'bandpass';
    flutterBand.frequency.value = 2200;
    flutterBand.Q.value = 0.8;
    const trem = c.createGain();
    trem.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 14;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(trem.gain);
    lfo.start();
    this.sources.push(lfo);
    this.flutterGain = c.createGain();
    this.flutterGain.gain.value = 0;
    this.sources.push(audio.loopNoise(flutterBand, false));
    flutterBand.connect(trem).connect(this.flutterGain).connect(audio.world);
  }

  /** Call once per frame. `flying` false fades everything out. */
  update(s: WingsuitFlightState | null, flying: boolean): void {
    const t = this.audio.now;
    const k = 0.12;
    if (!s || !flying) {
      this.out.gain.setTargetAtTime(0, t, 0.15);
      this.rumbleGain.gain.setTargetAtTime(0, t, 0.15);
      this.flutterGain.gain.setTargetAtTime(0, t, 0.15);
      return;
    }
    const sp = clamp01(s.airspeedMps / 80);
    const canopy = s.phase === 'canopy' || s.phase === 'deploying';
    // Under canopy the wind stays low: the silence after the opening is the point.
    const level = canopy ? 0.12 + 0.2 * sp : 0.08 + 0.78 * Math.sqrt(sp) * sp;
    const cutoff = canopy ? 500 + 1400 * sp : 380 + 5200 * sp * sp;
    const centre = canopy ? 600 : 500 + 2800 * sp;
    this.out.gain.setTargetAtTime(level, t, k);
    for (const f of this.lp) f.frequency.setTargetAtTime(cutoff, t, k);
    for (const f of this.bp) f.frequency.setTargetAtTime(centre, t, k);
    // Stereo width: the two voices sit near the centre when slow and spread hard when fast.
    const width = 0.2 + 0.8 * sp;
    this.voicePan[0].pan.setTargetAtTime(-width, t, k);
    this.voicePan[1].pan.setTargetAtTime(width, t, k);
    // The bank pans the whole wind toward the low wing's side.
    this.pan.pan.setTargetAtTime(Math.max(-0.5, Math.min(0.5, s.bankDeg / 120)), t, 0.2);
    const near = clamp01((20 - s.aglM) / 20);
    this.rumbleGain.gain.setTargetAtTime(near * 0.55 * (0.4 + 0.6 * sp), t, 0.1);
    // Start arc: freefall phase, before the wing has pressurised.
    const flutter = s.phase === 'freefall' ? 0.28 : s.phase === 'wingsuit' ? 0.06 + 0.1 * sp : 0;
    this.flutterGain.gain.setTargetAtTime(flutter, t, 0.2);
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.out.disconnect();
  }
}
