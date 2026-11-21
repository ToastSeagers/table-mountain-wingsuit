import { clamp, lerp, smoothstep } from './math3';
import { GROUND_EFFECT, SIM, WINGSUIT } from './tuning';

// Pure aerodynamic and control-authority curves for the wingsuit. No state, no allocation.

const W = WINGSUIT;
const CL_MAX = W.clSlopePerDeg * (W.stallAlphaDeg - W.zeroLiftAlphaDeg);
const CL_MIN = W.clSlopePerDeg * (W.negStallAlphaDeg - W.zeroLiftAlphaDeg);
const COS_STALL = Math.cos((W.stallAlphaDeg * Math.PI) / 180);
const COS_NEG_STALL = Math.cos((W.negStallAlphaDeg * Math.PI) / 180);

/** Lift coefficient from angle of attack in degrees: linear, then a soft stall decaying to zero at 90 deg. */
export function liftCoefficient(alphaDeg: number): number {
  if (alphaDeg >= W.negStallAlphaDeg && alphaDeg <= W.stallAlphaDeg) {
    return W.clSlopePerDeg * (alphaDeg - W.zeroLiftAlphaDeg);
  }
  const a = clamp(alphaDeg, -180, 180);
  const rad = (a * Math.PI) / 180;
  if (a > W.stallAlphaDeg) {
    const loss =
      1 - W.postStallLoss * smoothstep(W.stallAlphaDeg, W.stallAlphaDeg + W.postStallWidthDeg, a);
    return (CL_MAX * loss * Math.cos(rad)) / COS_STALL;
  }
  const loss =
    1 -
    W.postStallLoss * smoothstep(W.negStallAlphaDeg, W.negStallAlphaDeg - W.postStallWidthDeg, a);
  return (CL_MIN * loss * Math.cos(rad)) / COS_NEG_STALL;
}

/**
 * Drag coefficient: parabolic polar in CL plus pre-stall separation drag, flat-plate drag past
 * the stall, sideslip drag, the mush sink term and the high-speed flutter wall.
 */
export function dragCoefficient(
  alphaDeg: number,
  cl: number,
  betaDeg: number,
  mush: number,
  airspeedMps: number,
): number {
  const dCl = cl - W.clMinDrag;
  let cd = W.cd0 + W.cdK * dCl * dCl;
  const absA = Math.abs(alphaDeg);
  // Separation drag between sepAlpha and the stall; saturates so the flat-plate term takes over.
  const sepDeg = clamp(absA - W.sepAlphaDeg, 0, W.sepEndAlphaDeg - W.sepAlphaDeg);
  cd += W.sepKPerDeg2 * sepDeg * sepDeg;
  const sinA = Math.sin((absA * Math.PI) / 180);
  cd += W.cdFlatPlate * sinA * sinA * smoothstep(W.stallAlphaDeg - 4, W.stallAlphaDeg + 16, absA);
  const sinB = Math.sin((betaDeg * Math.PI) / 180);
  cd += W.cdSideslip * sinB * sinB;
  cd += W.mushDragCd * mush;
  const over = airspeedMps - W.fastDragOnsetMps;
  if (over > 0) cd += W.cdFastKPerMps2 * over * over;
  return cd;
}

// --- Steady-state views of the polar (clean suit, full area, no sideslip, no mush, no
//     flutter). Used by the tuning tests, the harness and the trim attitude; the model itself
//     integrates the forces and never assumes steady flight.

/** Lift over drag at an angle of attack, which is the steady glide ratio flown at that alpha. */
export function steadyGlide(alphaDeg: number): number {
  const cl = liftCoefficient(alphaDeg);
  return cl / dragCoefficient(alphaDeg, cl, 0, 0, 0);
}

/** Path angle below the horizon, degrees, of a steady glide at an angle of attack. */
export function steadyGammaDeg(alphaDeg: number): number {
  return (Math.atan(1 / steadyGlide(alphaDeg)) * 180) / Math.PI;
}

/** Airspeed of a steady glide at an angle of attack: weight balances the resultant force. */
export function steadyAirspeed(alphaDeg: number): number {
  const cl = liftCoefficient(alphaDeg);
  const cd = dragCoefficient(alphaDeg, cl, 0, 0, 0);
  const resultant = Math.sqrt(cl * cl + cd * cd);
  return Math.sqrt((2 * SIM.massKg * SIM.gravityMps2) / (SIM.rhoKgM3 * W.wingAreaM2 * resultant));
}

/** The angle of attack of the polar's best glide (searched once at module load). */
export function bestGlideAlphaDeg(): number {
  return BEST_ALPHA;
}

/**
 * Body pitch attitude at zero input: the trim angle of attack minus the trim path angle. Zero
 * input therefore settles at the trim alpha, and the trim glide is whatever the polar gives
 * there (3.0 with the Stage 3 anchors), not a commanded constant.
 */
export function trimAttitudeDeg(): number {
  return W.trimAlphaDeg - steadyGammaDeg(W.trimAlphaDeg);
}

/**
 * Steady angle of attack the suit settles at for a held pitch attitude: the alpha at which
 * attitude plus the polar's path angle equals that alpha (fast branch, from a table built at
 * load). Attitudes too nose-high for any steady solution return the alpha protection limit.
 */
export function steadyAlphaForAttitude(thetaDeg: number): number {
  const u = (thetaDeg - TABLE_THETA_MIN) / TABLE_STEP_DEG;
  const i = clamp(Math.floor(u), 0, ATTITUDE_TABLE.length - 2);
  const f = clamp(u - i, 0, 1);
  return ATTITUDE_TABLE[i] + (ATTITUDE_TABLE[i + 1] - ATTITUDE_TABLE[i]) * f;
}

/**
 * Pitch attitude the pilot holds for a pitch input in -1..1 (positive nose up), plus the speed
 * trim: slower than the steady speed of that attitude, the nose goes down a little (and up when
 * faster), fading with input so a full pull or push is the raw attitude. Steady state is
 * unchanged by the trim; it only shortens the approach.
 */
export function attitudeCommandDeg(pitchIn: number, airspeedMps?: number, foldFactor = 1): number {
  const trim = trimAttitudeDeg();
  const theta =
    pitchIn >= 0
      ? trim + pitchIn * W.pitchUpRangeDeg
      : trim - Math.pow(-pitchIn, W.diveInputExponent) * W.pitchDownRangeDeg;
  if (airspeedMps === undefined) return theta;
  const handsOff = 1 - Math.min(1, Math.abs(pitchIn));
  const vRef =
    steadyAirspeed(steadyAlphaForAttitude(theta)) / Math.sqrt(Math.max(0.25, foldFactor));
  const speedTrim = clamp(
    W.speedTrimDegPerMps * (airspeedMps - vRef) * handsOff,
    -W.speedTrimMaxDeg,
    W.speedTrimMaxDeg,
  );
  return theta + speedTrim;
}

/** Lift multiplier from ground effect: 1 at and above GROUND_EFFECT.heightM, rising to 1 + gain. */
export function groundEffectGain(aglM: number): number {
  const h = GROUND_EFFECT.heightM;
  if (GROUND_EFFECT.maxLiftGain <= 0 || aglM >= h) return 1;
  const u = 1 - Math.max(0, aglM) / h;
  return 1 + GROUND_EFFECT.maxLiftGain * u * u;
}

const TABLE_STEP_DEG = 0.5;
const TABLE_THETA_MIN = trimAttitudeDeg() - W.pitchDownRangeDeg - W.speedTrimMaxDeg - 2;
const TABLE_THETA_MAX = trimAttitudeDeg() + W.pitchUpRangeDeg + W.speedTrimMaxDeg + 2;
/** alpha_ss(theta): first alpha above zero lift where alpha - gamma(alpha) reaches theta. */
const ATTITUDE_TABLE = (() => {
  const out: number[] = [];
  for (let theta = TABLE_THETA_MIN; theta <= TABLE_THETA_MAX + 1e-9; theta += TABLE_STEP_DEG) {
    let found: number = W.alphaProtectDeg;
    for (let a = W.zeroLiftAlphaDeg + 0.05; a <= W.alphaProtectDeg; a += 0.05) {
      if (a - steadyGammaDeg(a) >= theta) {
        found = a;
        break;
      }
    }
    out.push(found);
  }
  return out;
})();

const BEST_ALPHA = (() => {
  let best = -Infinity;
  let bestA = 0;
  for (let a = W.zeroLiftAlphaDeg; a <= W.stallAlphaDeg; a += 0.05) {
    const g = steadyGlide(a);
    if (g > best) {
      best = g;
      bestA = a;
    }
  }
  return bestA;
})();

/** Control authority: clamp(v / vTrim, 0.3, 1.2)^2 (spec section 4). */
export function controlAuthority(airspeedMps: number): number {
  const r = clamp(airspeedMps / W.vTrimMps, W.authorityMin, W.authorityMax);
  return r * r;
}

/** Mush factor 0..1: 0 at and above the onset speed, 1 at and below the full-mush speed. */
export function mushFactor(airspeedMps: number): number {
  return smoothstep(W.mushOnsetMps, W.mushFullMps, airspeedMps);
}

/** Start-arc wing area ramp 0.3 -> 1.0, time- and airspeed-gated (spec section 4). */
export function areaRamp(timeSinceExitS: number, airspeedMps: number): number {
  const byTime = smoothstep(0, W.areaRampS, timeSinceExitS);
  const bySpeed = smoothstep(W.areaGateLowMps, W.areaGateHighMps, airspeedMps);
  return lerp(W.areaRampStart, 1, Math.min(byTime, bySpeed));
}
