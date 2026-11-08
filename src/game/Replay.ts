import type { FlightPhase } from '../types/flight';
import type { ReplayFrame } from '../types/game';
import type { Quat, Vec3 } from '../types/math';

/** Replay sampling rate (spec: 30 Hz). */
export const REPLAY_HZ = 30;
const PHASES: readonly FlightPhase[] = ['freefall', 'wingsuit', 'deploying', 'canopy', 'landed', 'crashed'];

export interface ReplayPose {
  p: Vec3;
  q: Quat;
  phase: FlightPhase;
}

/** Records the pilot's pose at 30 Hz from the 120 Hz step; call `sample` every step. */
export class ReplayRecorder {
  readonly frames: ReplayFrame[] = [];
  private nextS = 0;

  /** Records a frame when the clock passes the next sample time. */
  sample(tS: number, p: Vec3, q: Quat, phase: FlightPhase): void {
    if (tS + 1e-9 < this.nextS) return;
    this.push(tS, p, q, phase);
    this.nextS += 1 / REPLAY_HZ;
    if (this.nextS <= tS) this.nextS = tS + 1 / REPLAY_HZ;
  }

  /** Always records (the final touchdown pose), even between sample times. */
  force(tS: number, p: Vec3, q: Quat, phase: FlightPhase): void {
    const last = this.frames[this.frames.length - 1];
    if (last && last.t >= tS - 1e-9) {
      last.p = { ...p };
      last.q = { ...q };
      last.phase = phase;
      return;
    }
    this.push(tS, p, q, phase);
  }

  private push(tS: number, p: Vec3, q: Quat, phase: FlightPhase): void {
    this.frames.push({ t: tS, p: { x: p.x, y: p.y, z: p.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w }, phase });
  }
}

/**
 * Compact JSON form for localStorage: one flat number array per frame
 * [t, px, py, pz, qx, qy, qz, qw, phaseIndex], rounded to 2 decimals (4 for the quaternion).
 */
export function packReplay(frames: readonly ReplayFrame[]): number[][] {
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const r4 = (v: number): number => Math.round(v * 10000) / 10000;
  return frames.map((f) => [r2(f.t), r2(f.p.x), r2(f.p.y), r2(f.p.z), r4(f.q.x), r4(f.q.y), r4(f.q.z), r4(f.q.w), PHASES.indexOf(f.phase)]);
}

export function unpackReplay(raw: unknown): ReplayFrame[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ReplayFrame[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 9 || row.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const phase = PHASES[row[8] as number];
    if (!phase) return null;
    out.push({
      t: row[0] as number,
      p: { x: row[1] as number, y: row[2] as number, z: row[3] as number },
      q: { x: row[4] as number, y: row[5] as number, z: row[6] as number, w: row[7] as number },
      phase,
    });
  }
  return out;
}

/** Samples a recorded replay at any time: linear position, shortest-path nlerp orientation. */
export class ReplayPlayer {
  private index = 0;
  private readonly pose: ReplayPose = { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, phase: 'freefall' };

  constructor(readonly frames: readonly ReplayFrame[]) {}

  get durationS(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  /** The pose at time `tS` (clamped to the recording). The returned object is reused. */
  at(tS: number): ReplayPose {
    const f = this.frames;
    const out = this.pose;
    if (f.length === 0) return out;
    if (tS <= f[0].t) return this.copy(f[0], f[0], 0);
    const last = f[f.length - 1];
    if (tS >= last.t) return this.copy(last, last, 0);
    if (this.index >= f.length - 1 || f[this.index].t > tS) this.index = 0;
    while (f[this.index + 1].t < tS) this.index++;
    const a = f[this.index];
    const b = f[this.index + 1];
    return this.copy(a, b, (tS - a.t) / Math.max(1e-9, b.t - a.t));
  }

  private copy(a: ReplayFrame, b: ReplayFrame, u: number): ReplayPose {
    const o = this.pose;
    o.p.x = a.p.x + (b.p.x - a.p.x) * u;
    o.p.y = a.p.y + (b.p.y - a.p.y) * u;
    o.p.z = a.p.z + (b.p.z - a.p.z) * u;
    const dot = a.q.x * b.q.x + a.q.y * b.q.y + a.q.z * b.q.z + a.q.w * b.q.w;
    const s = dot < 0 ? -1 : 1;
    const x = a.q.x + (s * b.q.x - a.q.x) * u;
    const y = a.q.y + (s * b.q.y - a.q.y) * u;
    const z = a.q.z + (s * b.q.z - a.q.z) * u;
    const w = a.q.w + (s * b.q.w - a.q.w) * u;
    const n = Math.hypot(x, y, z, w) || 1;
    o.q.x = x / n;
    o.q.y = y / n;
    o.q.z = z / n;
    o.q.w = w / n;
    o.phase = u < 1 ? a.phase : b.phase;
    return o;
  }
}
