import type { FlightPhase } from '../types/flight';
import type { Quat, Vec3 } from '../types/math';

/** What the renderer needs to place the camera. */
export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  /** Roll about the view axis, degrees (positive leans the horizon clockwise). */
  rollDeg: number;
}

export type CameraMode = 'chase' | 'head' | 'canopy' | 'landing';

/** The pilot as the camera sees them: an interpolated pose plus a velocity. */
export interface CameraSubject {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  airspeedMps: number;
  aglM: number;
  gLoad: number;
  bankDeg: number;
  phase: FlightPhase;
}

// Look spec section 6: 0.25 s position lag and 0.12 s rotation lag at trim, tighter with speed;
// FOV 70 at trim to 85 at the maximum dive; shake only above 60 m/s and in the opening shock.
export const CAM = {
  posLagS: 0.25,
  rotLagS: 0.12,
  /** Lag is multiplied by this at maximum dive speed. */
  fastLagFactor: 0.5,
  trimSpeedMps: 45,
  maxSpeedMps: 75,
  fovTrimDeg: 70,
  fovMaxDeg: 85,
  chaseBackM: 9,
  chaseUpM: 2.8,
  chaseLookAheadM: 14,
  canopyBackM: 15,
  canopyUpM: 6.5,
  canopyFovDeg: 66,
  headFovDeg: 88,
  landingFovDeg: 48,
  landingAheadM: 38,
  landingSideM: 14,
  landingEyeM: 1.8,
  shakeStartMps: 60,
  shakeMaxM: 0.09,
  openingShakeM: 0.22,
  groundClearanceM: 2.5,
} as const;

const DEG = Math.PI / 180;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach. */
function approach(current: number, target: number, dtS: number, tauS: number): number {
  return tauS <= 0 ? target : current + (target - current) * (1 - Math.exp(-dtS / tauS));
}

/** Body forward (-Z at identity) of a unit quaternion. */
export function forwardOf(q: Quat, out: Vec3): Vec3 {
  out.x = -2 * (q.x * q.z + q.w * q.y);
  out.y = -2 * (q.y * q.z - q.w * q.x);
  out.z = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return out;
}

/** Body up (+Y at identity). */
export function upOf(q: Quat, out: Vec3): Vec3 {
  out.x = 2 * (q.x * q.y - q.w * q.z);
  out.y = 1 - 2 * (q.x * q.x + q.z * q.z);
  out.z = 2 * (q.y * q.z + q.w * q.x);
  return out;
}

function makePose(): CameraPose {
  return { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fovDeg: CAM.fovTrimDeg, rollDeg: 0 };
}

/** Catmull-Rom through `pts` at parameter u in [0, pts.length - 1]. */
function spline(pts: readonly Vec3[], u: number, out: Vec3): Vec3 {
  const n = pts.length;
  if (n === 1) return Object.assign(out, pts[0]);
  const i = Math.min(n - 2, Math.max(0, Math.floor(u)));
  const t = u - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(n - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  out.x = f(p0.x, p1.x, p2.x, p3.x);
  out.y = f(p0.y, p1.y, p2.y, p3.y);
  out.z = f(p0.z, p1.z, p2.z, p3.z);
  return out;
}

/**
 * Camera behaviour for play: chase (with lag and speed FOV), first-person head cam, canopy cam,
 * landing tripod cam, the intro flyover and the title orbit. Pure maths: no Three.js, so it runs
 * under Vitest. The Game applies the returned pose to `world.camera`.
 */
export class CameraRig {
  readonly pose: CameraPose = makePose();
  shakeEnabled = true;
  /** Stage 5 camera effects: scale on the built-in shake, an additive FOV (deg) and a vertical target kick (m). */
  shakeScale = 1;
  fovOffsetDeg = 0;
  kickM = 0;
  private readonly smoothPos: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly smoothTarget: Vec3 = { x: 0, y: 0, z: 0 };
  private smoothFov: number = CAM.fovTrimDeg;
  private smoothRoll = 0;
  private readonly fwd: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly smoothFwd: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };
  private landingSpot: Vec3 | null = null;
  private lastMode: CameraMode | null = null;
  private timeS = 0;
  private openingShockS = 0;

  constructor(private readonly groundAt: (x: number, z: number) => number) {}

  /** Snaps all smoothing to the chase pose for `subject` (start of a run). */
  reset(subject: CameraSubject): void {
    this.landingSpot = null;
    this.lastMode = null;
    this.timeS = 0;
    this.openingShockS = 0;
    this.chaseDirection(subject, 0, true);
    this.smoothFwd.x = this.fwd.x;
    this.smoothFwd.y = this.fwd.y;
    this.smoothFwd.z = this.fwd.z;
    const d = this.desired('chase', subject);
    Object.assign(this.smoothPos, d.position);
    Object.assign(this.smoothTarget, d.target);
    this.smoothFov = d.fovDeg;
    this.smoothRoll = 0;
    this.apply(subject);
  }

  /** The chase camera pose at the ledge, where the intro flyover ends and the countdown sits. */
  static startPose(exitPos: Vec3, headingDeg: number): CameraPose {
    const h = headingDeg * DEG;
    const f = { x: Math.sin(h), y: 0, z: -Math.cos(h) };
    return {
      position: { x: exitPos.x - f.x * CAM.chaseBackM, y: exitPos.y + CAM.chaseUpM, z: exitPos.z - f.z * CAM.chaseBackM },
      target: { x: exitPos.x + f.x * CAM.chaseLookAheadM, y: exitPos.y, z: exitPos.z + f.z * CAM.chaseLookAheadM },
      fovDeg: CAM.fovTrimDeg,
      rollDeg: 0,
    };
  }

  /**
   * Intro flyover: `t01` 0..1 along the authored path, landing on the chase start pose. The
   * look target follows the ledge until the last third, then swings to the chase target.
   */
  introPose(t01: number, exitPos: Vec3, headingDeg: number, path: readonly Vec3[]): CameraPose {
    const end = CameraRig.startPose(exitPos, headingDeg);
    const pts = path.length > 0 ? [...path, end.position] : [CameraRig.defaultIntroStart(exitPos, headingDeg), end.position];
    const e = smoothstep(0, 1, clamp01(t01));
    spline(pts, e * (pts.length - 1), this.pose.position);
    const look = smoothstep(0.55, 1, t01);
    const ledge = { x: exitPos.x, y: exitPos.y + 6, z: exitPos.z };
    this.pose.target.x = ledge.x + (end.target.x - ledge.x) * look;
    this.pose.target.y = ledge.y + (end.target.y - ledge.y) * look;
    this.pose.target.z = ledge.z + (end.target.z - ledge.z) * look;
    this.pose.fovDeg = 58 + (CAM.fovTrimDeg - 58) * smoothstep(0.6, 1, t01);
    this.pose.rollDeg = 0;
    this.clampToGround(this.pose.position);
    return this.pose;
  }

  /** Fallback flyover start when an exit has no authored path: ahead, off to one side, high. */
  static defaultIntroStart(exitPos: Vec3, headingDeg: number): Vec3 {
    const h = headingDeg * DEG;
    const f = { x: Math.sin(h), z: -Math.cos(h) };
    return { x: exitPos.x + f.x * 260 + f.z * 150, y: exitPos.y + 110, z: exitPos.z + f.z * 260 - f.x * 150 };
  }

  /** Slow orbit around `centre`, for the title screen. */
  orbitPose(nowS: number, centre: Vec3, radiusM = 3600, heightM = 1500, periodS = 240): CameraPose {
    const a = (nowS / periodS) * Math.PI * 2;
    this.pose.position.x = centre.x - Math.cos(a) * radiusM;
    this.pose.position.y = heightM;
    this.pose.position.z = centre.z + Math.sin(a) * radiusM;
    this.pose.target.x = centre.x;
    this.pose.target.y = centre.y * 0.6;
    this.pose.target.z = centre.z;
    this.pose.fovDeg = 60;
    this.pose.rollDeg = 0;
    return this.pose;
  }

  /** Per-frame update for play and replay. Returns the (reused) pose. */
  update(dtS: number, mode: CameraMode, subject: CameraSubject): CameraPose {
    this.timeS += dtS;
    if (subject.phase === 'deploying' && subject.gLoad > 1.5) this.openingShockS = 0.6;
    else this.openingShockS = Math.max(0, this.openingShockS - dtS);

    if (mode !== this.lastMode) {
      if (mode === 'landing') this.landingSpot = this.pickLandingSpot(subject);
      this.lastMode = mode;
    }

    const speedK = clamp01((subject.airspeedMps - CAM.trimSpeedMps) / (CAM.maxSpeedMps - CAM.trimSpeedMps));
    const lagScale = 1 - (1 - CAM.fastLagFactor) * speedK;
    this.chaseDirection(subject, dtS, false);

    const d = this.desired(mode, subject);
    const posTau = mode === 'head' ? 0.03 : mode === 'landing' ? 0 : (mode === 'canopy' ? 0.45 : CAM.posLagS) * lagScale;
    const rotTau = mode === 'head' ? 0.03 : mode === 'landing' ? 0.07 : (mode === 'canopy' ? 0.25 : CAM.rotLagS) * lagScale;
    this.smoothPos.x = approach(this.smoothPos.x, d.position.x, dtS, posTau);
    this.smoothPos.y = approach(this.smoothPos.y, d.position.y, dtS, posTau);
    this.smoothPos.z = approach(this.smoothPos.z, d.position.z, dtS, posTau);
    this.smoothTarget.x = approach(this.smoothTarget.x, d.target.x, dtS, rotTau);
    this.smoothTarget.y = approach(this.smoothTarget.y, d.target.y, dtS, rotTau);
    this.smoothTarget.z = approach(this.smoothTarget.z, d.target.z, dtS, rotTau);
    this.smoothFov = approach(this.smoothFov, d.fovDeg, dtS, 0.4);
    const rollTarget = mode === 'head' ? subject.bankDeg * 0.9 : mode === 'landing' ? 0 : subject.bankDeg * 0.18;
    this.smoothRoll = approach(this.smoothRoll, rollTarget, dtS, 0.25);
    this.apply(subject);
    return this.pose;
  }

  private apply(subject: CameraSubject): void {
    const p = this.pose;
    p.position.x = this.smoothPos.x;
    p.position.y = this.smoothPos.y;
    p.position.z = this.smoothPos.z;
    p.target.x = this.smoothTarget.x;
    p.target.y = this.smoothTarget.y;
    p.target.z = this.smoothTarget.z;
    p.fovDeg = this.smoothFov + this.fovOffsetDeg;
    p.rollDeg = this.smoothRoll;
    p.target.y += this.kickM;
    if (this.shakeEnabled && this.shakeScale > 0) {
      let amp = CAM.shakeMaxM * smoothstep(CAM.shakeStartMps, CAM.maxSpeedMps, subject.airspeedMps);
      amp = Math.max(amp, CAM.openingShakeM * clamp01(this.openingShockS / 0.6));
      amp *= this.shakeScale;
      if (amp > 0) {
        const t = this.timeS;
        p.position.x += amp * Math.sin(t * 61.3) * Math.cos(t * 17.1);
        p.position.y += amp * Math.sin(t * 53.7 + 1.3);
        p.position.z += amp * Math.cos(t * 47.9 + 0.4);
        p.rollDeg += amp * 4 * Math.sin(t * 39.1);
      }
    }
    this.clampToGround(p.position);
  }

  private clampToGround(pos: Vec3): void {
    const g = this.groundAt(pos.x, pos.z) + CAM.groundClearanceM;
    if (pos.y < g) pos.y = g;
  }

  /** Smoothed flight direction: velocity when moving, body forward at a standstill. */
  private chaseDirection(s: CameraSubject, dtS: number, snap: boolean): void {
    const v = s.velocity;
    const sp = Math.hypot(v.x, v.y, v.z);
    const f = this.fwd;
    forwardOf(s.orientation, f);
    if (sp > 6) {
      // Blend toward velocity as speed builds; the body forward dominates the first moments.
      const w = smoothstep(6, 20, sp);
      f.x = f.x * (1 - w) + (v.x / sp) * w;
      f.y = f.y * (1 - w) + (v.y / sp) * w;
      f.z = f.z * (1 - w) + (v.z / sp) * w;
    }
    // Keep the camera from tipping: limit the look pitch to +-40 degrees for the offset.
    const horiz = Math.hypot(f.x, f.z) || 1;
    const maxY = Math.tan(40 * DEG) * horiz;
    f.y = Math.max(-maxY, Math.min(maxY, f.y));
    const n = Math.hypot(f.x, f.y, f.z) || 1;
    f.x /= n;
    f.y /= n;
    f.z /= n;
    const sm = this.smoothFwd;
    const k = snap ? 1 : 1 - Math.exp(-dtS / 0.2);
    sm.x += (f.x - sm.x) * k;
    sm.y += (f.y - sm.y) * k;
    sm.z += (f.z - sm.z) * k;
    const m = Math.hypot(sm.x, sm.y, sm.z) || 1;
    sm.x /= m;
    sm.y /= m;
    sm.z /= m;
  }

  private desired(mode: CameraMode, s: CameraSubject): CameraPose {
    const out = this.tmpPose;
    const f = this.smoothFwd;
    const p = s.position;
    const speedK = clamp01((s.airspeedMps - CAM.trimSpeedMps) / (CAM.maxSpeedMps - CAM.trimSpeedMps));
    out.rollDeg = 0;
    switch (mode) {
      case 'head': {
        const bf = forwardOf(s.orientation, this.tmp);
        out.position.x = p.x + bf.x * 0.5;
        out.position.y = p.y + bf.y * 0.5 + 0.3;
        out.position.z = p.z + bf.z * 0.5;
        out.target.x = p.x + bf.x * 60;
        out.target.y = p.y + bf.y * 60;
        out.target.z = p.z + bf.z * 60;
        out.fovDeg = CAM.headFovDeg + 8 * speedK;
        break;
      }
      case 'canopy': {
        // Lower and closer as the ground nears, so the flare reads.
        const low = 1 - smoothstep(10, 60, s.aglM);
        const up = CAM.canopyUpM - 3 * low;
        out.position.x = p.x - f.x * CAM.canopyBackM;
        out.position.y = p.y - f.y * CAM.canopyBackM + up;
        out.position.z = p.z - f.z * CAM.canopyBackM;
        out.target.x = p.x + f.x * 12;
        out.target.y = p.y + f.y * 12 - 3.5 * (1 - low * 0.6);
        out.target.z = p.z + f.z * 12;
        out.fovDeg = CAM.canopyFovDeg;
        break;
      }
      case 'landing': {
        const spot = this.landingSpot ?? this.pickLandingSpot(s);
        out.position.x = spot.x;
        out.position.y = spot.y;
        out.position.z = spot.z;
        out.target.x = p.x;
        out.target.y = p.y + 1.2;
        out.target.z = p.z;
        out.fovDeg = CAM.landingFovDeg;
        break;
      }
      default: {
        // Pull the camera in toward the pilot (and up) until terrain no longer hides them: at a
        // ledge below a wall the full 9 m back would put the camera behind the rock.
        let k = 1;
        for (let i = 0; i < 6; i++) {
          k = [1, 0.75, 0.55, 0.4, 0.28, 0.18][i];
          out.position.x = p.x - f.x * CAM.chaseBackM * k;
          out.position.y = p.y - f.y * CAM.chaseBackM * k + CAM.chaseUpM + (1 - k) * 4;
          out.position.z = p.z - f.z * CAM.chaseBackM * k;
          if (this.lineClear(out.position, p)) break;
        }
        out.target.x = p.x + f.x * CAM.chaseLookAheadM;
        out.target.y = p.y + f.y * CAM.chaseLookAheadM;
        out.target.z = p.z + f.z * CAM.chaseLookAheadM;
        out.fovDeg = CAM.fovTrimDeg + (CAM.fovMaxDeg - CAM.fovTrimDeg) * speedK;
        // If the ground still lifts the camera, tip the view down by part of that lift.
        const lift = Math.max(0, this.groundAt(out.position.x, out.position.z) + CAM.groundClearanceM - out.position.y);
        out.target.y -= lift * 0.9;
        out.position.y += lift;
      }
    }
    return out;
  }

  private readonly tmpPose: CameraPose = makePose();

  /** True when no terrain sample on the segment from `a` to `b` rises above it. */
  private lineClear(a: Vec3, b: Vec3): boolean {
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (this.groundAt(x, z) + 0.8 > a.y + (b.y - a.y) * t) return false;
    }
    return true;
  }

  /** A tripod spot ahead of and beside the pilot at ground level. */
  private pickLandingSpot(s: CameraSubject): Vec3 {
    const v = s.velocity;
    let hx = this.smoothFwd.x;
    let hz = this.smoothFwd.z;
    if (Math.hypot(v.x, v.z) > 2) {
      hx = v.x;
      hz = v.z;
    }
    const hn = Math.hypot(hx, hz) || 1;
    hx /= hn;
    hz /= hn;
    const x = s.position.x + hx * CAM.landingAheadM - hz * CAM.landingSideM;
    const z = s.position.z + hz * CAM.landingAheadM + hx * CAM.landingSideM;
    return { x, y: this.groundAt(x, z) + CAM.landingEyeM, z };
  }
}
