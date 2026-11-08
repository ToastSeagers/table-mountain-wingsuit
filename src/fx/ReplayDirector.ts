import type { CameraMode, CameraPose, CameraRig, CameraSubject } from '../game/CameraRig';
import type { ReplayFrame } from '../types/game';
import type { Vec3 } from '../types/math';

export type ShotKind = 'ground' | 'chase' | 'side' | 'canopy' | 'landing';

export interface Shot {
  kind: ShotKind;
  t0: number;
  t1: number;
  /** Fixed camera position for ground shots. */
  anchor?: Vec3;
}

const GROUND_SHOT_S = 3.4;
const GROUND_OFFSET_M = 24;
const GROUND_EYE_M = 2;
const MIN_SEPARATION_S = 4;
const LANDING_SHOT_S = 3.2;
const CHASE_CHUNK_S = 3.6;
const HOLD_AFTER_S = 3;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Cuts a recorded run into a shot list and drives the camera for it: ground cams at the three
 * closest approaches to the terrain, chase and side cams in between (cut about every 3.6 s), a
 * canopy wide shot once the canopy is out, and the landing. The chase, canopy and landing
 * framing come from CameraRig; ground and side cams are placed here. Pure maths, no Three.js.
 */
export class ReplayDirector {
  readonly shots: Shot[];
  readonly durationS: number;
  private index = 0;
  private fresh = true;
  private readonly pose: CameraPose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fovDeg: 60, rollDeg: 0 };

  constructor(
    frames: readonly ReplayFrame[],
    private readonly rig: CameraRig,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.durationS = frames.length ? frames[frames.length - 1].t : 0;
    this.shots = this.plan(frames);
  }

  private plan(frames: readonly ReplayFrame[]): Shot[] {
    const end = this.durationS;
    if (frames.length < 2) return [{ kind: 'chase', t0: 0, t1: end + HOLD_AFTER_S }];
    const special: Shot[] = [];
    const landingStart = Math.max(0, end - LANDING_SHOT_S + 0.4);
    special.push({ kind: 'landing', t0: landingStart, t1: end + HOLD_AFTER_S });

    const canopyFrame = frames.find((f) => f.phase === 'deploying' || f.phase === 'canopy');
    const tCanopy = canopyFrame ? canopyFrame.t : end;
    if (canopyFrame && landingStart - tCanopy > 2.5) {
      special.push({ kind: 'canopy', t0: tCanopy + 0.4, t1: Math.min(landingStart, tCanopy + 4.4) });
    }

    // Closest approach to the ground, sampled twice a second while still in the wingsuit.
    const cand: { t: number; clearance: number; i: number }[] = [];
    for (let i = 0; i < frames.length; i += 15) {
      const f = frames[i];
      if (f.t < 1.5 || f.t > tCanopy - 1) continue;
      cand.push({ t: f.t, clearance: f.p.y - this.groundAt(f.p.x, f.p.z), i });
    }
    cand.sort((a, b) => a.clearance - b.clearance);
    const picked: typeof cand = [];
    for (const c of cand) {
      if (picked.length === 3) break;
      if (picked.every((p) => Math.abs(p.t - c.t) >= MIN_SEPARATION_S)) picked.push(c);
    }
    for (const c of picked) {
      const f = frames[c.i];
      const nxt = frames[Math.min(frames.length - 1, c.i + 6)];
      const prv = frames[Math.max(0, c.i - 6)];
      let dx = nxt.p.x - prv.p.x;
      let dz = nxt.p.z - prv.p.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // Stand to one side of the track (alternating), on the ground, so the pilot streaks past.
      const side = picked.indexOf(c) % 2 === 0 ? 1 : -1;
      const x = f.p.x + -dz * GROUND_OFFSET_M * side;
      const z = f.p.z + dx * GROUND_OFFSET_M * side;
      const y = Math.max(this.groundAt(x, z) + GROUND_EYE_M, 0);
      special.push({ kind: 'ground', t0: f.t - GROUND_SHOT_S / 2, t1: f.t + GROUND_SHOT_S / 2, anchor: { x, y, z } });
    }

    special.sort((a, b) => a.t0 - b.t0);
    const fixed: Shot[] = [];
    for (const s of special) {
      const prev = fixed[fixed.length - 1];
      const shot = { ...s, t0: Math.max(s.t0, prev ? prev.t1 : 0) };
      if (shot.t1 - shot.t0 >= 1) fixed.push(shot);
    }

    // Fill the gaps with chase and side cams.
    const out: Shot[] = [];
    let cursor = 0;
    let alt = 0;
    const fill = (until: number): void => {
      while (until - cursor > 0.8) {
        const len = until - cursor < CHASE_CHUNK_S * 1.5 ? until - cursor : CHASE_CHUNK_S;
        out.push({ kind: alt++ % 2 === 0 ? 'chase' : 'side', t0: cursor, t1: cursor + len });
        cursor += len;
      }
      if (out.length && until > cursor) out[out.length - 1].t1 = until;
      cursor = until;
    };
    for (const s of fixed) {
      fill(s.t0);
      out.push(s);
      cursor = s.t1;
    }
    return out;
  }

  /** Index of the shot playing at time `t`. */
  shotAt(t: number): number {
    let i = this.index;
    if (t < this.shots[i].t0) i = 0;
    while (i < this.shots.length - 1 && t >= this.shots[i].t1) i++;
    return i;
  }

  /** Time of the start of the next shot (for skipping); wraps to 0 after the last. */
  nextShotStart(t: number): number {
    const i = this.shotAt(t);
    return i + 1 < this.shots.length ? this.shots[i + 1].t0 : 0;
  }

  /** Call when the timeline jumps (loop, skip) so the rig does not swoop from the last shot. */
  restart(): void {
    this.index = 0;
    this.fresh = true;
  }

  /** The camera pose for time `t`. `subject` must already hold the pilot's pose at `t`. */
  update(t: number, dtS: number, subject: CameraSubject): CameraPose {
    const i = this.shotAt(t);
    const shot = this.shots[i];
    const changed = i !== this.index || this.fresh;
    this.index = i;
    this.fresh = false;
    switch (shot.kind) {
      case 'ground':
        return this.groundCam(shot, subject);
      case 'side':
        return this.sideCam(subject);
      default: {
        if (changed) this.rig.reset(subject);
        const mode: CameraMode = shot.kind === 'landing' ? 'landing' : shot.kind === 'canopy' ? 'canopy' : 'chase';
        return this.rig.update(dtS, mode, subject);
      }
    }
  }

  private groundCam(shot: Shot, s: CameraSubject): CameraPose {
    const a = shot.anchor as Vec3;
    const p = this.pose;
    p.position.x = a.x;
    p.position.y = a.y;
    p.position.z = a.z;
    p.target.x = s.position.x;
    p.target.y = s.position.y;
    p.target.z = s.position.z;
    const dist = Math.hypot(s.position.x - a.x, s.position.y - a.y, s.position.z - a.z);
    // Long lens when the pilot is far, wider as they pass so the pass feels fast.
    p.fovDeg = 26 + 30 * clamp01(1 - dist / 220);
    p.rollDeg = 0;
    return p;
  }

  private sideCam(s: CameraSubject): CameraPose {
    const p = this.pose;
    const v = s.velocity;
    let hx = v.x;
    let hz = v.z;
    const hl = Math.hypot(hx, hz);
    if (hl < 1) {
      hx = 0;
      hz = -1;
    } else {
      hx /= hl;
      hz /= hl;
    }
    // Right-hand side of travel, a little ahead and above.
    const x = s.position.x + -hz * 17 + hx * 5;
    const z = s.position.z + hx * 17 + hz * 5;
    const y = Math.max(s.position.y + 3, this.groundAt(x, z) + 2.5);
    p.position.x = x;
    p.position.y = y;
    p.position.z = z;
    p.target.x = s.position.x + hx * 6;
    p.target.y = s.position.y;
    p.target.z = s.position.z + hz * 6;
    p.fovDeg = 58;
    p.rollDeg = 0;
    return p;
  }
}
