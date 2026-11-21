import { OPENING, WINGSUIT } from '../flight/tuning';
import { qbasis, RAD_TO_DEG } from '../flight/math3';
import { trimAttitudeDeg } from '../flight/aero';
import type { FlightPhase } from '../types/flight';
import type { Quat, Vec3 } from '../types/math';

// Pose logic for the pilot and canopy visuals: pure maths, no Three.js, so it runs under
// Vitest. PlayerAvatar turns these numbers into mesh transforms.

/** What the avatar needs to know each frame. Live play fills it from the flight state and the
 *  input; replays estimate it from the recorded motion (MotionCueEstimator). */
export interface AvatarCue {
  phase: FlightPhase;
  airspeedMps: number;
  gLoad: number;
  /** Right wing down positive, degrees. */
  bankDeg: number;
  /** Nose above the horizon, degrees. */
  pitchDeg: number;
  /** Pitch and roll input, -1..1 (nose up and right wing down positive). */
  pitchInput: number;
  rollInput: number;
  flare: boolean;
  /** 0..1 tail deflection the canopy should show (brakes part, flare full). */
  brakeDeflection: number;
  /** Canopy inflation progress from the model, 0 before deploy to 1 under canopy. */
  openingProgress: number;
  aglM: number;
}

export function defaultCue(): AvatarCue {
  return {
    phase: 'wingsuit',
    airspeedMps: 45,
    gLoad: 1,
    bankDeg: 0,
    pitchDeg: trimAttitudeDeg(),
    pitchInput: 0,
    rollInput: 0,
    flare: false,
    brakeDeflection: 0,
    openingProgress: 0,
    aglM: 500,
  };
}

const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function approach(current: number, target: number, dtS: number, tauS: number): number {
  if (tauS <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dtS / tauS));
}

/** Joint angles and blend weights for the pilot. Angles in radians. */
export interface PilotPose {
  /** 0 prone in the suit .. 1 hanging upright in the harness. */
  hang: number;
  /** Arms swept back from straight-out, positive = back. */
  armSweep: number;
  /** Wing dihedral per side, positive = wing up, negative = wing down. */
  dihedralL: number;
  dihedralR: number;
  /** Extra lean of the torso into the bank, positive = right side down. */
  bodyRoll: number;
  /** Half-angle between the legs. */
  legSpread: number;
  /** Knee bend (hanging). */
  kneeBend: number;
  /** 0 arms down at the hips .. 1 hands up at the toggles (hanging). */
  armRaise: number;
  /** Head raised relative to the prone body. */
  headPitch: number;
  /** Trailing-edge flutter amplitude in avatar metres and its running phase. */
  flutterAmp: number;
  flutterPhase: number;
}

export function neutralPilotPose(): PilotPose {
  return {
    hang: 0,
    armSweep: 10 * DEG,
    dihedralL: 0,
    dihedralR: 0,
    bodyRoll: 0,
    legSpread: 14 * DEG,
    kneeBend: 0,
    armRaise: 0,
    headPitch: 55 * DEG,
    flutterAmp: 0,
    flutterPhase: 0,
  };
}

/** The pose the pilot is moving toward for a cue (no smoothing). */
export function pilotPoseTarget(cue: AvatarCue): PilotPose {
  const p = neutralPilotPose();
  const hang =
    cue.phase === 'deploying'
      ? smoothstep(0.15, 0.8, cue.openingProgress)
      : cue.phase === 'canopy' || cue.phase === 'landed'
        ? 1
        : 0;
  p.hang = hang;
  const dive = clamp(-cue.pitchInput, 0, 1);
  const pull = clamp(cue.pitchInput, 0, 1);
  // Pitch-forward sweeps the arms back (and the legs together); a pull brings the arms forward.
  p.armSweep = (10 + 35 * dive - 12 * pull) * DEG;
  p.legSpread = (14 - 6 * dive + 4 * pull) * DEG;
  // Bank: the body leans into the turn and the inside wing dips; the stick anticipates it.
  const bankK = clamp(cue.bankDeg / 60, -1, 1);
  const lean = clamp(bankK + 0.3 * cue.rollInput, -1, 1);
  const dip = 16 * DEG * lean;
  p.dihedralR = -dip + 4 * DEG * Math.abs(lean) * (lean < 0 ? 1 : 0);
  p.dihedralL = dip + 4 * DEG * Math.abs(lean) * (lean > 0 ? 1 : 0);
  p.bodyRoll = 6 * DEG * lean;
  p.headPitch = (55 - 12 * dive + 6 * pull) * DEG;
  // Flutter on the trailing edges, scaled by speed, gone when the suit is not flying.
  const flying = cue.phase === 'freefall' || cue.phase === 'wingsuit';
  p.flutterAmp = flying ? 0.012 * clamp((cue.airspeedMps - 22) / 45, 0, 1.3) : 0;
  if (hang > 0) {
    // Hanging: knees bent, legs together, hands up at the toggles unless flaring or braking.
    const toggles = cue.flare ? 0.1 : cue.brakeDeflection > 0.2 ? 0.5 : 1;
    p.armRaise = cue.phase === 'landed' ? 0 : toggles;
    p.kneeBend = (cue.phase === 'landed' ? 5 : 28) * DEG;
    p.legSpread = 6 * DEG;
    p.armSweep = 0;
    p.headPitch = 10 * DEG;
    p.dihedralL = 0;
    p.dihedralR = 0;
    p.bodyRoll = 0;
  }
  return p;
}

/** First-order smoothing of the pilot pose toward its target; the flutter phase advances with speed. */
export class PilotPoseFilter {
  readonly pose = neutralPilotPose();

  reset(cue: AvatarCue): void {
    Object.assign(this.pose, pilotPoseTarget(cue));
    this.pose.flutterPhase = 0;
  }

  update(cue: AvatarCue, dtS: number): PilotPose {
    const t = pilotPoseTarget(cue);
    const o = this.pose;
    const tau = 0.14;
    o.hang = approach(o.hang, t.hang, dtS, 0.08);
    o.armSweep = approach(o.armSweep, t.armSweep, dtS, tau);
    o.dihedralL = approach(o.dihedralL, t.dihedralL, dtS, tau);
    o.dihedralR = approach(o.dihedralR, t.dihedralR, dtS, tau);
    o.bodyRoll = approach(o.bodyRoll, t.bodyRoll, dtS, tau);
    o.legSpread = approach(o.legSpread, t.legSpread, dtS, tau);
    o.kneeBend = approach(o.kneeBend, t.kneeBend, dtS, 0.3);
    o.armRaise = approach(o.armRaise, t.armRaise, dtS, 0.22);
    o.headPitch = approach(o.headPitch, t.headPitch, dtS, tau);
    o.flutterAmp = approach(o.flutterAmp, t.flutterAmp, dtS, 0.1);
    const hz = 5 + cue.airspeedMps * 0.06;
    o.flutterPhase = (o.flutterPhase + dtS * hz * Math.PI * 2) % (Math.PI * 2);
    return o;
  }
}

/** What the canopy mesh should show this frame. */
export interface CanopyState {
  visible: boolean;
  /** Cell fullness 0..1: bulge, opacity and the ribs' depth. */
  inflation: number;
  spanScale: number;
  chordScale: number;
  /** 0..1 of the suspension lines paid out (canopy height above the risers). */
  lineExtension: number;
  /** 0..1 tail deflection, lagged like a toggle stroke. */
  tailDeflection: number;
  /** Canopy rotation relative to the pilot about the risers: pitch (canopy back positive)
   *  and roll (canopy right side down positive), radians. */
  swingPitch: number;
  swingRoll: number;
  /** 0..1 collapse onto the ground after landing. */
  collapse: number;
}

export function neutralCanopyState(): CanopyState {
  return {
    visible: false,
    inflation: 0,
    spanScale: 0.12,
    chordScale: 0.5,
    lineExtension: 0,
    tailDeflection: 0,
    swingPitch: 0,
    swingRoll: 0,
    collapse: 0,
  };
}

/** Opening geometry as a function of the model's opening progress: snivel, then snap, then settle. */
export function inflationCurve(progress: number): {
  inflation: number;
  spanScale: number;
  chordScale: number;
  lineExtension: number;
} {
  const p = clamp(progress, 0, 1);
  const snivelEnd = OPENING.snivelS / OPENING.durationS;
  const snapEnd = snivelEnd + 0.32;
  const lineExtension = smoothstep(0, 0.22, p);
  if (p < snivelEnd) {
    const u = p / snivelEnd;
    return {
      inflation: 0.12 * u,
      spanScale: 0.12 + 0.2 * u,
      chordScale: 0.5 + 0.1 * u,
      lineExtension,
    };
  }
  if (p < snapEnd) {
    const u = smoothstep(snivelEnd, snapEnd, p);
    return {
      inflation: 0.12 + 0.88 * u,
      spanScale: 0.32 + 0.76 * u,
      chordScale: 0.6 + 0.4 * u,
      lineExtension,
    };
  }
  // Settle: a small overshoot that rings out by full progress.
  const u = (p - snapEnd) / (1 - snapEnd);
  const ring = 0.06 * Math.sin(u * Math.PI) * (1 - u);
  return { inflation: 1, spanScale: 1.08 - 0.08 * u + ring, chordScale: 1, lineExtension };
}

/** Pendulum of the pilot under the canopy plus a toggle lag; stepped per frame. */
export class CanopyStateFilter {
  readonly state = neutralCanopyState();
  private pitchAngle = 0;
  private rollAngle = 0;
  private pitchRate = 0;
  private rollRate = 0;
  private bankLagged = 0;
  private lastPhase: FlightPhase = 'wingsuit';
  private timeS = 0;
  private landedS = 0;

  reset(): void {
    Object.assign(this.state, neutralCanopyState());
    this.pitchAngle = 0;
    this.rollAngle = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.bankLagged = 0;
    this.lastPhase = 'wingsuit';
    this.timeS = 0;
    this.landedS = 0;
  }

  update(cue: AvatarCue, dtS: number): CanopyState {
    const s = this.state;
    this.timeS += dtS;
    const out = cue.phase === 'deploying' || cue.phase === 'canopy' || cue.phase === 'landed';
    if (cue.phase === 'deploying' && this.lastPhase !== 'deploying') {
      // The canopy comes off the back as the pilot pitches up, so it starts behind and swings
      // overhead as the pilot decelerates under it.
      this.pitchAngle = -0.55;
      this.pitchRate = 0;
      this.rollAngle = 0;
      this.rollRate = 0;
      s.collapse = 0;
      this.bankLagged = cue.bankDeg;
    }
    if (cue.phase === 'landed' && this.lastPhase !== 'landed') this.landedS = 0;
    this.lastPhase = cue.phase;
    s.visible = out;
    if (!out) {
      s.inflation = 0;
      s.collapse = 0;
      return s;
    }
    const curve = inflationCurve(cue.phase === 'deploying' ? cue.openingProgress : 1);
    s.inflation = curve.inflation;
    s.spanScale = curve.spanScale;
    s.chordScale = curve.chordScale;
    s.lineExtension = curve.lineExtension;
    s.tailDeflection = approach(s.tailDeflection, clamp(cue.brakeDeflection, 0, 1), dtS, 0.25);

    // Pendulum: the pilot swings about the canopy, so a load above 1 g (a flare, the opening)
    // pitches the pilot forward, which is the canopy pitching back relative to the pilot. The
    // canopy also rolls ahead of the pilot into a bank. A 6 m pendulum at 0.2 Hz, damped.
    const omega = Math.sqrt(9.81 / 6.3);
    const zeta = 0.28;
    const drivePitch = (clamp(cue.gLoad, 0, 4) - 1) * 0.35;
    this.bankLagged = approach(this.bankLagged, cue.bankDeg, dtS, 0.35);
    const targetRoll = (cue.bankDeg - this.bankLagged) * DEG * 0.35;
    const step = Math.min(dtS, 0.05);
    this.pitchRate +=
      (-(omega * omega) * this.pitchAngle - 2 * zeta * omega * this.pitchRate + drivePitch) * step;
    this.pitchAngle = clamp(this.pitchAngle + this.pitchRate * step, -0.8, 0.5);
    this.rollRate +=
      (-(omega * omega) * (this.rollAngle - targetRoll) - 2 * zeta * omega * this.rollRate) * step;
    this.rollAngle = clamp(this.rollAngle + this.rollRate * step, -0.5, 0.5);
    if (cue.phase === 'landed') {
      this.landedS += dtS;
      s.collapse = smoothstep(0.1, 1.6, this.landedS);
      this.pitchAngle = approach(this.pitchAngle, 0.3, dtS, 0.4);
      this.rollAngle = approach(this.rollAngle, 0, dtS, 0.4);
      this.pitchRate = 0;
      this.rollRate = 0;
    }
    // Idle breathing on top of the pendulum so the canopy never looks frozen.
    const idle = s.inflation * (1 - s.collapse);
    s.swingPitch = this.pitchAngle + 1.2 * DEG * Math.sin(this.timeS * 2 * Math.PI * 0.22) * idle;
    s.swingRoll = this.rollAngle + 0.8 * DEG * Math.sin(this.timeS * 2 * Math.PI * 0.17 + 1) * idle;
    return s;
  }
}

/**
 * Replays record only position, orientation and phase at 30 Hz. This estimates the rest from
 * the motion: airspeed and load factor from finite differences, bank and pitch from the
 * orientation, the pitch input from the attitude against trim, the roll input from the bank.
 */
export class MotionCueEstimator {
  readonly cue = defaultCue();
  private hasPrev = false;
  private readonly prevP: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly v: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly prevV: Vec3 = { x: 0, y: 0, z: 0 };
  private deployStartS = -1;
  private timeS = 0;
  private readonly f: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly u: Vec3 = { x: 0, y: 1, z: 0 };
  private readonly r: Vec3 = { x: 1, y: 0, z: 0 };

  reset(): void {
    this.hasPrev = false;
    this.deployStartS = -1;
    this.timeS = 0;
    Object.assign(this.cue, defaultCue());
  }

  update(dtS: number, p: Vec3, q: Quat, phase: FlightPhase, aglM: number): AvatarCue {
    const c = this.cue;
    this.timeS += dtS;
    if (this.hasPrev && dtS > 1e-4) {
      const inv = 1 / dtS;
      const vx = (p.x - this.prevP.x) * inv;
      const vy = (p.y - this.prevP.y) * inv;
      const vz = (p.z - this.prevP.z) * inv;
      const k = Math.min(1, dtS * 8);
      this.prevV.x = this.v.x;
      this.prevV.y = this.v.y;
      this.prevV.z = this.v.z;
      this.v.x += (vx - this.v.x) * k;
      this.v.y += (vy - this.v.y) * k;
      this.v.z += (vz - this.v.z) * k;
      const ax = (this.v.x - this.prevV.x) * inv;
      const ay = (this.v.y - this.prevV.y) * inv + 9.81;
      const az = (this.v.z - this.prevV.z) * inv;
      const g = Math.sqrt(ax * ax + ay * ay + az * az) / 9.81;
      c.gLoad += (clamp(g, 0, 4) - c.gLoad) * Math.min(1, dtS * 6);
    }
    this.prevP.x = p.x;
    this.prevP.y = p.y;
    this.prevP.z = p.z;
    this.hasPrev = true;
    const speed = Math.sqrt(this.v.x * this.v.x + this.v.y * this.v.y + this.v.z * this.v.z);
    c.airspeedMps = speed;
    qbasis(q, this.f, this.u, this.r);
    c.pitchDeg = Math.asin(clamp(this.f.y, -1, 1)) * RAD_TO_DEG;
    c.bankDeg = Math.atan2(-this.r.y, this.u.y) * RAD_TO_DEG;
    const trim = trimAttitudeDeg();
    const d = c.pitchDeg - trim;
    c.pitchInput = clamp(
      d >= 0 ? d / WINGSUIT.pitchUpRangeDeg : d / WINGSUIT.pitchDownRangeDeg,
      -1,
      1,
    );
    c.rollInput = clamp(c.bankDeg / 45, -1, 1);
    if (phase === 'deploying' && this.deployStartS < 0) this.deployStartS = this.timeS;
    if (phase !== 'deploying' && phase !== 'canopy' && phase !== 'landed') this.deployStartS = -1;
    c.openingProgress =
      phase === 'deploying'
        ? clamp((this.timeS - this.deployStartS) / OPENING.durationS, 0, 1)
        : phase === 'canopy' || phase === 'landed'
          ? 1
          : 0;
    c.phase = phase;
    c.aglM = aglM;
    c.flare = phase === 'canopy' && aglM < 6;
    c.brakeDeflection = c.flare ? 1 : 0;
    return c;
  }
}
