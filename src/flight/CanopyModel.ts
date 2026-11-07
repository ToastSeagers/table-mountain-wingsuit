import type { FlightInput } from '../types/flight';
import type { Quat, Vec3 } from '../types/math';
import {
  clamp,
  DEG_TO_RAD,
  headingDegOf,
  lerp,
  qbasis,
  qFromHeadingPitchBank,
  qintegrate,
  RAD_TO_DEG,
  smoothstep,
  vaddScaled,
  vcross,
  vlen,
  vnormalize,
  vscale,
} from './math3';
import type { LandingClass, WingsuitFlightState } from './state';
import { CANOPY as C, LANDING, OPENING as O, SIM, WINGSUIT } from './tuning';

/** Landing classification table (spec section 3). */
export function classifyLanding(verticalMps: number, forwardMps: number): LandingClass {
  if (verticalMps > LANDING.hardMaxVerticalMps || forwardMps > LANDING.crashForwardMps) {
    return 'crash';
  }
  if (verticalMps > LANDING.okMaxVerticalMps) return 'hard';
  if (verticalMps > LANDING.softMaxVerticalMps) return 'ok';
  return 'soft';
}

/**
 * Parachute opening, canopy flight, brakes, flare. Same integrator as the wingsuit, its own
 * parameter set. A ram-air canopy is pendulum-stable, so instead of deriving alpha from the
 * body quaternion the coefficients come straight from the inputs and the lift acts
 * perpendicular to the velocity in the vertical plane, tilted by the bank angle.
 */
export class CanopyModel {
  /** Time since deploy, or -1 when not opening. */
  openingT = -1;
  flareEnergy = 1;
  bankDeg = 0;
  headingDeg = 0;

  private brakeBlend = 0;
  private prevGammaDeg = 0;
  private hasPrevGamma = false;
  private gammaRateFiltered = 0;
  private readonly vhat: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly lhat: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly side: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly f: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly u: Vec3 = { x: 0, y: 1, z: 0 };
  private readonly r: Vec3 = { x: 1, y: 0, z: 0 };
  private readonly qtmp: Quat = { x: 0, y: 0, z: 0, w: 1 };

  reset(): void {
    this.openingT = -1;
    this.flareEnergy = 1;
    this.bankDeg = 0;
    this.headingDeg = 0;
    this.brakeBlend = 0;
    this.hasPrevGamma = false;
    this.gammaRateFiltered = 0;
  }

  beginOpening(st: WingsuitFlightState): void {
    this.openingT = 0;
    this.flareEnergy = 1;
    this.bankDeg = 0;
    this.brakeBlend = 0;
    this.hasPrevGamma = false;
    this.gammaRateFiltered = 0;
    this.headingDeg = st.headingDeg;
  }

  /**
   * Scripted 2.5 s opening: wingsuit lift fades, the pilot drops and decelerates behind a
   * growing drag area, then the canopy inflates with the force capped at gCap (the slider).
   * Returns true on the step that completes the opening; the heading is preserved into canopy flight.
   */
  stepOpening(dt: number, _input: FlightInput, st: WingsuitFlightState): boolean {
    const t = this.openingT;
    this.openingT += dt;
    const v = st.velocity;
    const mass = SIM.massKg;
    const g = SIM.gravityMps2;
    const speed = vlen(v);

    let ax = 0;
    let ay = -g;
    let az = 0;
    let gLoad = 0;
    if (speed > 0.5) {
      const vhat = this.vhat;
      const lhat = this.lhat;
      vscale(vhat, v, 1 / speed);
      const q2 = 0.5 * SIM.rhoKgM3 * speed * speed;
      const liftFade = 1 - smoothstep(0, O.liftFadeS, t);
      const dragArea =
        t < O.snivelS
          ? lerp(O.dragAreaStartM2, O.dragAreaSnivelM2, t / O.snivelS)
          : lerp(O.dragAreaSnivelM2, O.dragAreaFullM2, (t - O.snivelS) / (O.durationS - O.snivelS));
      const canopyBlend = smoothstep(O.liftBlendStartS, O.durationS, t);
      let lift =
        q2 * (liftFade * WINGSUIT.trimCl * WINGSUIT.wingAreaM2 + canopyBlend * C.clFull * C.areaM2);
      let drag = q2 * dragArea;
      const total = Math.sqrt(lift * lift + drag * drag);
      const cap = O.gCap * mass * g;
      if (total > cap) {
        lift *= cap / total;
        drag *= cap / total;
      }
      // Lift straight up in the vertical plane of the velocity.
      lhat.x = -vhat.y * vhat.x;
      lhat.y = 1 - vhat.y * vhat.y;
      lhat.z = -vhat.y * vhat.z;
      if (vnormalize(lhat, lhat) < 1e-6) lift = 0;
      const fx = lift * lhat.x - drag * vhat.x;
      const fy = lift * lhat.y - drag * vhat.y;
      const fz = lift * lhat.z - drag * vhat.z;
      gLoad = Math.sqrt(fx * fx + fy * fy + fz * fz) / (mass * g);
      ax += fx / mass;
      ay += fy / mass;
      az += fz / mass;
    }
    v.x += ax * dt;
    v.y += ay * dt;
    v.z += az * dt;

    // The pilot swings upright under the opening canopy: pitch and bank relax to zero.
    const q = st.orientation;
    qbasis(q, this.f, this.u, this.r);
    const pitchDeg = Math.asin(clamp(this.f.y, -1, 1)) * RAD_TO_DEG;
    const bankDeg = Math.atan2(-this.r.y, this.u.y) * RAD_TO_DEG;
    const pitchRate = clamp(-pitchDeg * 2, -90, 90) * DEG_TO_RAD;
    const rollRate = clamp(-bankDeg * 2, -90, 90) * DEG_TO_RAD;
    qintegrate(
      q,
      rollRate * this.f.x + pitchRate * this.r.x,
      rollRate * this.f.y + pitchRate * this.r.y,
      rollRate * this.f.z + pitchRate * this.r.z,
      dt,
    );

    st.alphaDeg = 0;
    st.betaDeg = 0;
    st.mushFactor = 0;
    st.wingAreaFactor = 0;
    st.gLoad = gLoad;
    st.flareEnergy = 1;

    if (this.openingT >= O.durationS) {
      const gs = Math.hypot(v.x, v.z);
      if (gs > 0.5) this.headingDeg = headingDegOf(v.x, v.z);
      qFromHeadingPitchBank(q, this.qtmp, this.headingDeg, 0, 0);
      this.openingT = -1;
      return true;
    }
    return false;
  }

  stepCanopy(dt: number, input: FlightInput, st: WingsuitFlightState): void {
    const v = st.velocity;
    const mass = SIM.massKg;
    const g = SIM.gravityMps2;
    const speed = vlen(v);

    // Flare: a timed effect. Holding it drains the energy along a rise-then-fade authority
    // curve, so a flare started too early is spent before touchdown. It refills once released.
    let flareAuthority = 0;
    const flaring = input.flare && this.flareEnergy > 0;
    if (flaring) {
      const spent = 1 - this.flareEnergy;
      flareAuthority =
        smoothstep(0, C.flareRiseFraction, spent) * (1 - smoothstep(C.flareFadeFrom, 1, spent));
      this.flareEnergy = Math.max(0, this.flareEnergy - dt / C.flareDurationS);
    } else if (!input.flare && speed > C.flareRechargeMinSpeedMps) {
      this.flareEnergy = Math.min(1, this.flareEnergy + dt / C.flareRechargeS);
    }

    const brakeTarget = input.brake && !flaring ? 1 : 0;
    this.brakeBlend += (brakeTarget - this.brakeBlend) * Math.min(1, dt / C.brakeLagS);
    const clBase = lerp(C.clFull, C.clBrake, this.brakeBlend);
    let cl = clBase;
    let cd = lerp(C.cdFull, C.cdBrake, this.brakeBlend);
    if (flareAuthority > 0 && speed > 0.5) {
      // Lift that would hold the target sink rate, limited by the flare authority.
      const qS = 0.5 * SIM.rhoKgM3 * speed * speed * C.areaM2;
      const demand = (mass * g * (1 + C.flareSinkGainPerMps * (-v.y - C.flareTargetSinkMps))) / qS;
      const extra = clamp(demand - clBase, 0, C.flareClGain * flareAuthority);
      cl += extra;
      cd += C.flareCdGain * (extra / C.flareClGain) + C.flareCdGain * 0.5 * flareAuthority;
    }

    const turnIn = clamp(input.roll + input.yaw, -1, 1);
    const bankTarget = turnIn * C.bankMaxDeg * (1 - C.bankBrakeLoss * this.brakeBlend);
    this.bankDeg += (bankTarget - this.bankDeg) * Math.min(1, dt / C.bankLagS);

    let ax = 0;
    let ay = -g;
    let az = 0;
    let gLoad = 0;
    if (speed > 0.5) {
      const vhat = this.vhat;
      const lhat = this.lhat;
      const side = this.side;
      vscale(vhat, v, 1 / speed);
      // Pendulum damping: the canopy resists rotation of the flight path.
      const gammaDeg = Math.asin(clamp(-vhat.y, -1, 1)) * RAD_TO_DEG;
      if (this.hasPrevGamma) {
        const raw = (gammaDeg - this.prevGammaDeg) / dt;
        this.gammaRateFiltered +=
          (raw - this.gammaRateFiltered) * Math.min(1, dt / C.pathRateFilterS);
      }
      cl += clamp(
        C.pathDampingClPerDegPerS * this.gammaRateFiltered,
        -C.pathDampingMaxCl,
        C.pathDampingMaxCl,
      );
      this.prevGammaDeg = gammaDeg;
      this.hasPrevGamma = true;
      // Lift perpendicular to the velocity in the vertical plane, then tilted by the bank.
      lhat.x = -vhat.y * vhat.x;
      lhat.y = 1 - vhat.y * vhat.y;
      lhat.z = -vhat.y * vhat.z;
      const qS = 0.5 * SIM.rhoKgM3 * speed * speed * C.areaM2;
      let lift = qS * cl;
      const drag = qS * cd;
      if (vnormalize(lhat, lhat) < 1e-6) {
        lift = 0;
      } else {
        vcross(side, vhat, lhat);
        const bankRad = this.bankDeg * DEG_TO_RAD;
        const cb = Math.cos(bankRad);
        const sb = Math.sin(bankRad);
        vscale(lhat, lhat, cb);
        vaddScaled(lhat, lhat, side, sb);
      }
      const fx = lift * lhat.x - drag * vhat.x;
      const fy = lift * lhat.y - drag * vhat.y;
      const fz = lift * lhat.z - drag * vhat.z;
      gLoad = Math.sqrt(fx * fx + fy * fy + fz * fz) / (mass * g);
      ax += fx / mass;
      ay += fy / mass;
      az += fz / mass;
    }
    v.x += ax * dt;
    v.y += ay * dt;
    v.z += az * dt;

    const gs = Math.hypot(v.x, v.z);
    if (gs > 0.5) this.headingDeg = headingDegOf(v.x, v.z);
    qFromHeadingPitchBank(st.orientation, this.qtmp, this.headingDeg, 0, this.bankDeg);

    st.alphaDeg = 0;
    st.betaDeg = 0;
    st.mushFactor = 0;
    st.wingAreaFactor = 0;
    st.gLoad = gLoad;
    st.flareEnergy = this.flareEnergy;
  }
}
