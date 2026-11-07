import type { ScriptFrame } from './scripting';

// Measurements over recorded runs, shared by tests and the harness report.

export type FrameKey = {
  [K in keyof ScriptFrame]: ScriptFrame[K] extends number ? K : never;
}[keyof ScriptFrame];

export function frameAt(frames: ScriptFrame[], t: number): ScriptFrame {
  let best = frames[0];
  for (const f of frames) {
    if (f.t <= t + 1e-9) best = f;
    else break;
  }
  return best;
}

export function lastFrame(frames: ScriptFrame[]): ScriptFrame {
  return frames[frames.length - 1];
}

export function mean(frames: ScriptFrame[], key: FrameKey, fromS: number, toS: number): number {
  let sum = 0;
  let n = 0;
  for (const f of frames) {
    if (f.t >= fromS && f.t <= toS) {
      sum += f[key];
      n++;
    }
  }
  return n ? sum / n : NaN;
}

export function peak(
  frames: ScriptFrame[],
  key: FrameKey,
  fromS = 0,
  toS = Infinity,
): { value: number; t: number } {
  let value = -Infinity;
  let t = NaN;
  for (const f of frames) {
    if (f.t >= fromS && f.t <= toS && f[key] > value) {
      value = f[key];
      t = f.t;
    }
  }
  return { value, t };
}

export function trough(
  frames: ScriptFrame[],
  key: FrameKey,
  fromS = 0,
  toS = Infinity,
): { value: number; t: number } {
  let value = Infinity;
  let t = NaN;
  for (const f of frames) {
    if (f.t >= fromS && f.t <= toS && f[key] < value) {
      value = f[key];
      t = f.t;
    }
  }
  return { value, t };
}

/** First frame at or after fromS satisfying the predicate, or undefined. */
export function firstFrame(
  frames: ScriptFrame[],
  pred: (f: ScriptFrame) => boolean,
  fromS = 0,
): ScriptFrame | undefined {
  for (const f of frames) if (f.t >= fromS && pred(f)) return f;
  return undefined;
}

/** First time at which `key` crosses `value` downward (previous frame above, this one at or below). */
export function firstDownCrossing(
  frames: ScriptFrame[],
  key: FrameKey,
  value: number,
  fromS = 0,
): ScriptFrame | undefined {
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (b.t >= fromS && a[key] > value && b[key] <= value) return b;
  }
  return undefined;
}

export interface TrimMetrics {
  glide: number;
  airspeed: number;
  sink: number;
  gLoad: number;
  groundSpeed: number;
}

export function trimMetrics(frames: ScriptFrame[], fromS: number, toS: number): TrimMetrics {
  return {
    glide: mean(frames, 'glide', fromS, toS),
    airspeed: mean(frames, 'airspeed', fromS, toS),
    sink: mean(frames, 'sink', fromS, toS),
    gLoad: mean(frames, 'gLoad', fromS, toS),
    groundSpeed: mean(frames, 'groundSpeed', fromS, toS),
  };
}

export interface ArcMetrics {
  /** Time from exit until the glide ratio first exceeds 2.5 after its initial collapse. */
  durationS: number;
  heightLostM: number;
  horizontalM: number;
  /** Elapsed time when the phase became wingsuit. */
  wingsuitAtS: number;
  peakSinkMps: number;
  peakGLoad: number;
}

export function arcMetrics(frames: ScriptFrame[], glideThreshold = 2.5): ArcMetrics {
  const start = frames[0];
  // The glide read-out is huge for the first fraction of a second (no sink yet); wait until it
  // has collapsed below the threshold before looking for the recovery.
  const fell = firstFrame(frames, (f) => f.glide < glideThreshold);
  const caught = fell ? firstFrame(frames, (f) => f.glide > glideThreshold, fell.t) : undefined;
  const wing = firstFrame(frames, (f) => f.phase === 'wingsuit');
  const end = caught ?? lastFrame(frames);
  return {
    durationS: caught ? caught.t : NaN,
    heightLostM: start.y - end.y,
    horizontalM: Math.hypot(end.x - start.x, end.z - start.z),
    wingsuitAtS: wing ? wing.t : NaN,
    peakSinkMps: peak(frames, 'sink', 0, end.t).value,
    peakGLoad: peak(frames, 'gLoad', 0, end.t).value,
  };
}

/** Mean rate of change of `key` over a window, in units per second (for heading and roll rates). */
export function meanRate(frames: ScriptFrame[], key: FrameKey, fromS: number, toS: number): number {
  const a = frameAt(frames, fromS);
  const b = frameAt(frames, toS);
  return (b[key] - a[key]) / (b.t - a.t);
}

/** Peak absolute per-step rate of change of `key` over a window, units per second. */
export function peakRate(frames: ScriptFrame[], key: FrameKey, fromS: number, toS: number): number {
  let best = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (b.t < fromS || b.t > toS) continue;
    let d = b[key] - a[key];
    if (key === 'heading' || key === 'bank') {
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
    }
    const rate = Math.abs(d / (b.t - a.t));
    if (rate > best) best = rate;
  }
  return best;
}
