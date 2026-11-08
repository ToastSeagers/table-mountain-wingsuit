import type { Settings, SettingsStore } from '../core/Settings';

/** A white-noise buffer shared by every noise source (2 s loops cleanly because it is random). */
function makeNoise(ctx: BaseAudioContext, seconds: number, pink: boolean): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (pink) {
      // Paul Kellet's cheap pink filter: wind is pinker than white, which sounds like hiss.
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.28;
    } else d[i] = w;
  }
  return buf;
}

/**
 * Owns the Web Audio context, the three buses (master, world, UI) and the shared noise buffers.
 * The context starts suspended on every browser; it resumes on the first key, click, touch or
 * pad press. Volumes come from the persisted settings (SettingsStore saves them on change).
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly world: GainNode;
  readonly ui: GainNode;
  readonly noise: AudioBuffer;
  readonly pinkNoise: AudioBuffer;
  private unlocked = false;

  constructor(settings: SettingsStore) {
    const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });
    // A soft limiter on the master so stacked blips and a landing thump cannot clip.
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.master = this.ctx.createGain();
    this.world = this.ctx.createGain();
    this.ui = this.ctx.createGain();
    this.world.connect(this.master);
    this.ui.connect(this.master);
    this.master.connect(limiter).connect(this.ctx.destination);
    this.noise = makeNoise(this.ctx, 2, false);
    this.pinkNoise = makeNoise(this.ctx, 3, true);
    this.apply(settings.value);
    settings.onChange((s) => this.apply(s));
    const unlock = (): void => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'gamepadconnected'])
      window.addEventListener(type, unlock, { passive: true });
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** True once the context is running (after a user gesture). */
  get running(): boolean {
    return this.ctx.state === 'running';
  }

  unlock(): void {
    if (this.unlocked && this.ctx.state === 'running') return;
    void this.ctx.resume().then(() => {
      this.unlocked = this.ctx.state === 'running';
    });
  }

  private apply(s: Readonly<Settings>): void {
    const t = this.ctx.currentTime;
    // Volume sliders are perceptual: square them so 0.5 is audibly half.
    this.master.gain.setTargetAtTime(s.masterVolume ** 2, t, 0.03);
    this.world.gain.setTargetAtTime(s.worldVolume ** 2, t, 0.03);
    this.ui.gain.setTargetAtTime(s.uiVolume ** 2, t, 0.03);
  }

  /** A looping noise source into `dest`; the caller owns stop(). */
  loopNoise(dest: AudioNode, pink = true): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = pink ? this.pinkNoise : this.noise;
    src.loop = true;
    // Random start offset so two sources never phase-lock.
    src.start(0, Math.random() * (src.buffer.duration - 0.1));
    src.connect(dest);
    return src;
  }

  /** One-shot noise burst through a filter, with an exponential decay. */
  burst(dest: AudioNode, opts: { at?: number; durS: number; gain: number; freq: number; q?: number; type?: BiquadFilterType; sweepTo?: number }): void {
    const c = this.ctx;
    const t = opts.at ?? c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.Q.value = opts.q ?? 1;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.durS);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.durS);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, opts.durS + 0.05);
  }

  /** One oscillator note with a short attack and exponential release. */
  tone(dest: AudioNode, opts: { at?: number; freq: number; durS: number; gain: number; type?: OscillatorType; slideTo?: number }): void {
    const c = this.ctx;
    const t = opts.at ?? c.currentTime;
    const o = c.createOscillator();
    o.type = opts.type ?? 'square';
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + opts.durS);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.durS);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + opts.durS + 0.02);
  }
}
