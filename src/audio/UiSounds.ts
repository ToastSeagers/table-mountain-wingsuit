import type { EventBus } from '../core/EventBus';
import type { AudioEngine } from './AudioEngine';

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

/** Title loop: 4 bars of 4/4 at 116 bpm in A minor (Am, F, C, G), about 8.3 s, scheduled live. */
const BPM = 116;
const BEAT_S = 60 / BPM;
const LOOP_BEATS = 16;
const CHORDS: readonly (readonly number[])[] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const BASS = [45, 41, 48, 43];
const LEAD: readonly (number | null)[] = [
  76,
  null,
  79,
  76,
  72,
  null,
  76,
  null,
  77,
  null,
  81,
  77,
  72,
  null,
  69,
  null,
  72,
  76,
  79,
  null,
  84,
  null,
  79,
  76,
  74,
  null,
  71,
  74,
  79,
  null,
  null,
  null,
];

/**
 * All the interface sounds, synthesised from oscillators (no sample files): move, select, back,
 * countdown drums, tally tick, the high-score fanfare, the WIPEOUT sting and the title loop.
 */
export class UiSounds {
  private loopOn = false;
  private loopStartT = 0;
  private scheduledStep = 0;

  constructor(private readonly audio: AudioEngine) {}

  /** Subscribes to the game bus; returns an unsubscribe function. */
  attach(bus: EventBus): () => void {
    const offs = [
      bus.on('ui-move', () => this.move()),
      bus.on('ui-select', () => this.select()),
      bus.on('ui-back', () => this.back()),
      bus.on('countdown', (n) => this.countdown(n)),
      bus.on('tally-tick', () => this.tally()),
      bus.on('fanfare', () => this.fanfare()),
      bus.on('stamp', () => this.stamp()),
      bus.on('run-end', (e) => {
        if (e.reason !== 'landed' && e.reason !== 'water') this.wipeout();
      }),
    ];
    return () => offs.forEach((o) => o());
  }

  private get dest(): GainNode {
    return this.audio.ui;
  }

  move(): void {
    this.audio.tone(this.dest, { freq: 660, durS: 0.04, gain: 0.14, type: 'square' });
  }

  select(): void {
    const t = this.audio.now;
    this.audio.tone(this.dest, { at: t, freq: 523, durS: 0.06, gain: 0.18, type: 'square' });
    this.audio.tone(this.dest, { at: t + 0.06, freq: 784, durS: 0.1, gain: 0.18, type: 'square' });
  }

  back(): void {
    const t = this.audio.now;
    this.audio.tone(this.dest, { at: t, freq: 440, durS: 0.06, gain: 0.16, type: 'square' });
    this.audio.tone(this.dest, { at: t + 0.06, freq: 294, durS: 0.1, gain: 0.16, type: 'square' });
  }

  /** 3, 2, 1: a tom hit each; GO: a bigger hit with a bright blip on top. */
  countdown(n: number): void {
    const a = this.audio;
    const t = a.now;
    const go = n === 0;
    a.tone(this.dest, {
      at: t,
      freq: go ? 190 : 140,
      slideTo: go ? 70 : 50,
      durS: go ? 0.4 : 0.22,
      gain: go ? 0.7 : 0.55,
      type: 'sine',
    });
    a.burst(this.dest, {
      at: t,
      durS: go ? 0.18 : 0.1,
      gain: go ? 0.35 : 0.22,
      freq: 1800,
      q: 0.7,
    });
    if (go) a.tone(this.dest, { at: t, freq: 1046, durS: 0.3, gain: 0.2, type: 'square' });
  }

  tally(): void {
    this.audio.tone(this.dest, {
      freq: 1200 + Math.random() * 120,
      durS: 0.025,
      gain: 0.1,
      type: 'square',
    });
  }

  stamp(): void {
    const t = this.audio.now;
    this.audio.tone(this.dest, { at: t, freq: 880, durS: 0.05, gain: 0.15, type: 'square' });
    this.audio.tone(this.dest, { at: t + 0.05, freq: 1320, durS: 0.1, gain: 0.15, type: 'square' });
  }

  /** The only long UI sound: a rising arpeggio into a held major chord, about 2.2 s. */
  fanfare(): void {
    const a = this.audio;
    const t = a.now;
    const notes = [60, 64, 67, 72, 67, 72, 76];
    notes.forEach((n, i) =>
      a.tone(this.dest, { at: t + i * 0.12, freq: midi(n), durS: 0.16, gain: 0.2, type: 'square' }),
    );
    const t2 = t + notes.length * 0.12;
    for (const n of [60, 64, 67, 72]) {
      a.tone(this.dest, { at: t2, freq: midi(n), durS: 1.2, gain: 0.13, type: 'square' });
      a.tone(this.dest, { at: t2, freq: midi(n - 12), durS: 1.2, gain: 0.1, type: 'triangle' });
    }
  }

  /** Falling minor-second slide plus a low noise thud. */
  wipeout(): void {
    const a = this.audio;
    const t = a.now + 0.05;
    a.tone(this.dest, { at: t, freq: 392, slideTo: 98, durS: 0.7, gain: 0.25, type: 'sawtooth' });
    a.tone(this.dest, {
      at: t + 0.2,
      freq: 370,
      slideTo: 92,
      durS: 0.7,
      gain: 0.2,
      type: 'sawtooth',
    });
    a.burst(this.dest, { at: t, durS: 0.5, gain: 0.4, freq: 200, type: 'lowpass', q: 0.5 });
  }

  // ----- title loop ---------------------------------------------------------------------

  startLoop(): void {
    if (this.loopOn || !this.audio.running) return;
    this.loopOn = true;
    this.loopStartT = this.audio.now + 0.05;
    this.scheduledStep = 0;
  }

  stopLoop(): void {
    this.loopOn = false;
  }

  get looping(): boolean {
    return this.loopOn;
  }

  /** Schedules eighth-note steps up to 0.3 s ahead; call every frame while the loop is on. */
  update(): void {
    if (!this.loopOn) return;
    const a = this.audio;
    const stepS = BEAT_S / 2;
    while (this.loopStartT + this.scheduledStep * stepS < a.now + 0.3) {
      this.scheduleStep(this.scheduledStep, this.loopStartT + this.scheduledStep * stepS);
      this.scheduledStep++;
    }
  }

  private scheduleStep(step: number, at: number): void {
    const a = this.audio;
    const s = step % (LOOP_BEATS * 2);
    const bar = Math.floor(s / 8);
    const inBar = s % 8;
    const quiet = 0.5; // the loop sits under the UI blips
    // Bass on the beat, octave pop on the off-beats.
    if (inBar % 2 === 0)
      a.tone(this.dest, {
        at,
        freq: midi(BASS[bar] + (inBar % 4 === 2 ? 12 : 0)),
        durS: 0.22,
        gain: 0.16 * quiet,
        type: 'triangle',
      });
    // Chord arpeggio on every step.
    const ch = CHORDS[bar];
    a.tone(this.dest, {
      at,
      freq: midi(ch[inBar % 3] + 12),
      durS: 0.12,
      gain: 0.07 * quiet,
      type: 'square',
    });
    const lead = LEAD[s];
    if (lead != null)
      a.tone(this.dest, {
        at,
        freq: midi(lead),
        durS: BEAT_S * 0.45,
        gain: 0.13 * quiet,
        type: 'square',
      });
    // Drums: kick on 1 and 3, hat on offbeats, snare-ish noise on 2 and 4.
    if (inBar % 4 === 0)
      a.tone(this.dest, {
        at,
        freq: 130,
        slideTo: 45,
        durS: 0.16,
        gain: 0.3 * quiet,
        type: 'sine',
      });
    if (inBar % 4 === 2)
      a.burst(this.dest, { at, durS: 0.12, gain: 0.16 * quiet, freq: 1600, q: 0.6 });
    if (inBar % 2 === 1)
      a.burst(this.dest, { at, durS: 0.04, gain: 0.07 * quiet, freq: 7000, type: 'highpass' });
  }
}
