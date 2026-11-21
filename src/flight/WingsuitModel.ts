import type { FlightInput } from '../types/flight';
import type { Vec3 } from '../types/math';
import {
  areaRamp,
  attitudeCommandDeg,
  controlAuthority,
  dragCoefficient,
  groundEffectGain,
  liftCoefficient,
  mushFactor,
} from './aero';
import {
  clamp,
  DEG_TO_RAD,
  lerp,
  qbasis,
  qintegrate,
  RAD_TO_DEG,
  smoothstep,
  vaddScaled,
  vdot,
  vlen,
  vnormalize,
  vscale,
} from './math3';
import type { WingsuitFlightState } from './state';
import { SIM, WINGSUIT as W } from './tuning';

/**
 * Wingsuit forces and body rates for the freefall and wingsuit phases.
 *
 * Frame: world X east, Y up, Z south. Body forward = -Z, up = +Y, right = +X at the identity
 * orientation, so identity is level and facing north; heading h is a rotation of -h about +Y.
 * Positive roll = right wing down, positive pitch = nose up, positive yaw = nose right.
 *
 * Inputs are assumed to be already smoothed by the caller (spec section 5: 120 ms low-pass on
 * keyboard). step() allocates nothing: every vector is a preallocated scratch field.
 */
export class WingsuitModel {
  /** Start-arc area ramp, 0.3 .. 1.0, before any dive fold. */
  rampFactor: number = W.areaRampStart;
  /** Elapsed time at which the ramp reached the flying fraction, or -1 while still in the arc. */
  flyingSinceS = -1;
  /** Elapsed time at which the start arc was caught (path recovered), or -1 before that. */
  arcDoneS = -1;

  private rollRateDeg = 0;
  private readonly f: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly u: Vec3 = { x: 0, y: 1, z: 0 };
  private readonly r: Vec3 = { x: 1, y: 0, z: 0 };
  private readonly vhat: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly lhat: Vec3 = { x: 0, y: 0, z: 0 };

  reset(): void {
    this.rampFactor = W.areaRampStart;
    this.flyingSinceS = -1;
    this.arcDoneS = -1;
    this.rollRateDeg = 0;
  }

  step(dt: number, input: FlightInput, st: WingsuitFlightState): void {
    const v = st.velocity;
    const q = st.orientation;
    const f = this.f;
    const u = this.u;
    const r = this.r;
    const vhat = this.vhat;
    const lhat = this.lhat;
    const mass = SIM.massKg;
    const g = SIM.gravityMps2;

    qbasis(q, f, u, r);
    const speed = vlen(v);
    const pitchIn = clamp(input.pitch, -1, 1);
    const rollIn = clamp(input.roll, -1, 1);
    const yawIn = clamp(input.yaw, -1, 1);

    // --- Start arc bookkeeping: area ramp, the moment the suit is "flying", the moment the
    //     path is caught. Pilot behaviour (mush, trimming, damping) fades in after the catch.
    this.rampFactor = areaRamp(st.elapsedS, speed);
    if (this.flyingSinceS < 0 && this.rampFactor >= W.flyingAreaFraction) {
      this.flyingSinceS = st.elapsedS;
    }
    const horizontal = Math.hypot(v.x, v.z);
    const sink = -v.y;
    if (
      this.arcDoneS < 0 &&
      this.flyingSinceS >= 0 &&
      sink > 0.01 &&
      horizontal / sink > W.arcDoneGlide
    ) {
      this.arcDoneS = st.elapsedS;
    }
    const settled =
      this.arcDoneS >= 0 ? smoothstep(0, W.arcRelaxS, st.elapsedS - this.arcDoneS) : 0;

    let areaFactor = this.rampFactor;
    if (pitchIn < 0) areaFactor *= 1 - W.diveFoldMax * -pitchIn;
    const area = W.wingAreaM2 * areaFactor;

    // --- Aerodynamic forces.
    let alphaDeg = 0;
    let betaDeg = 0;
    let mush = 0;
    let gammaDeg = 0;
    let ax = 0;
    let ay = -g;
    let az = 0;
    let gLoad = 0;
    const flying = speed > 0.5;
    if (flying) {
      const vf = vdot(v, f);
      const vu = vdot(v, u);
      const vr = vdot(v, r);
      alphaDeg = Math.atan2(-vu, vf) * RAD_TO_DEG;
      betaDeg = Math.atan2(vr, vf) * RAD_TO_DEG;
      mush = mushFactor(speed) * settled;
      vscale(vhat, v, 1 / speed);
      gammaDeg = Math.asin(clamp(-vhat.y, -1, 1)) * RAD_TO_DEG;

      const cl = liftCoefficient(alphaDeg) * (1 - W.mushLiftLoss * mush);
      const cd = dragCoefficient(alphaDeg, cl, betaDeg, mush, speed);
      const qS = 0.5 * SIM.rhoKgM3 * speed * speed * area;
      let lift = qS * cl * (1 + W.arcLiftBoost * (1 - settled)) * groundEffectGain(st.aglM);
      let drag = qS * cd;
      const side = -qS * W.cySideslip * Math.sin(betaDeg * DEG_TO_RAD);

      // G-load cap: lift beyond gMax is lost and most of it becomes buffet drag.
      const liftCap = W.gMax * mass * g;
      const absLift = Math.abs(lift);
      if (absLift > liftCap) {
        drag += W.buffetDragFraction * (absLift - liftCap);
        lift = lift > 0 ? liftCap : -liftCap;
        const totalCap = W.gMaxTotal * mass * g;
        const total = Math.sqrt(lift * lift + drag * drag);
        if (total > totalCap) {
          lift *= totalCap / total;
          drag *= totalCap / total;
        }
      }

      // Lift acts perpendicular to the velocity in the plane of body-up; none when falling flat.
      vaddScaled(lhat, u, vhat, -vdot(u, vhat));
      if (vnormalize(lhat, lhat) < 1e-6) lift = 0;

      const fx = lift * lhat.x - drag * vhat.x + side * r.x;
      const fy = lift * lhat.y - drag * vhat.y + side * r.y;
      const fz = lift * lhat.z - drag * vhat.z + side * r.z;
      gLoad = Math.sqrt(fx * fx + fy * fy + fz * fz) / (mass * g);
      ax += fx / mass;
      ay += fy / mass;
      az += fz / mass;
    }

    // Semi-implicit Euler: velocity first, the caller integrates position with the new velocity.
    v.x += ax * dt;
    v.y += ay * dt;
    v.z += az * dt;

    // --- Body rates.
    const auth = controlAuthority(speed);

    // Pitch: the input commands a body pitch attitude (nose above the horizon). The pilot's
    // alpha target is that attitude plus the path angle below the horizon, limited by alpha
    // protection, and a rate-limited spring tracks it. Nothing commands the glide: it is
    // whatever lift and drag at the resulting alpha give, and holding an attitude damps the
    // phugoid because alpha falls as the path rises. In the start arc a fixed arc alpha is held
    // until the path is caught; the spring is also the alignment that tilts the nose down the
    // velocity there.
    const alphaAttitude =
      attitudeCommandDeg(pitchIn, speed, 1 - W.diveFoldMax * Math.max(0, -pitchIn)) + gammaDeg;
    const alphaLoop = clamp(alphaAttitude, W.negStallAlphaDeg, W.alphaProtectDeg);
    const alphaCmd = lerp(W.arcAlphaDeg, alphaLoop, settled);
    const pitchLim = Math.max(W.alignFloorDegPerS, W.pitchRateTrimDegPerS * auth);
    let pitchRate = flying
      ? clamp(W.alphaGainPerS * (alphaCmd - alphaDeg), -pitchLim, pitchLim)
      : 0;
    // Mush: nose-up authority goes soft; nose-down, the recovery, keeps its rate.
    if (pitchRate > 0) pitchRate *= 1 - W.mushPitchLoss * mush;

    // Roll: lagged rate command, halved in mush, plus auto-level when the stick is released.
    const rollCmd = rollIn * W.rollRateTrimDegPerS * auth * (1 - W.mushRollLoss * mush);
    this.rollRateDeg += (rollCmd - this.rollRateDeg) * Math.min(1, dt / W.rollLagS);
    const bankRad = Math.atan2(-r.y, u.y);
    const rollRate =
      this.rollRateDeg - W.levelRateDegPerS * Math.sin(bankRad) * (1 - Math.abs(rollIn));

    // Yaw: a small direct nudge plus the weathercock that keeps the nose on the velocity.
    const yawRate = clamp(
      yawIn * W.yawNudgeDegPerS * auth + W.weathercockGainPerS * betaDeg,
      -W.yawRateMaxDegPerS,
      W.yawRateMaxDegPerS,
    );

    const p = rollRate * DEG_TO_RAD;
    const qq = pitchRate * DEG_TO_RAD;
    const rr = yawRate * DEG_TO_RAD;
    qintegrate(
      q,
      p * f.x + qq * r.x - rr * u.x,
      p * f.y + qq * r.y - rr * u.y,
      p * f.z + qq * r.z - rr * u.z,
      dt,
    );

    st.alphaDeg = alphaDeg;
    st.betaDeg = betaDeg;
    st.mushFactor = mush;
    st.wingAreaFactor = areaFactor;
    st.gLoad = gLoad;
  }
}
