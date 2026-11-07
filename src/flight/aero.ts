import { clamp, lerp, smoothstep } from './math3';
import { SIM, WINGSUIT } from './tuning';

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

/**
 * Lift coefficient that holds a given glide ratio in steady flight on the clean polar (fast
 * branch). Above the polar's best glide the best-glide CL is returned.
 */
export function clForGlide(glide: number): number {
  const k = W.cdK;
  const m = W.clMinDrag;
  const r = Math.max(0, glide);
  // r k CL^2 - (2 r k m + 1) CL + r (CD0 + k m^2) = 0, smaller root.
  const a = r * k;
  const b = -(2 * r * k * m + 1);
  const c = r * (W.cd0 + k * m * m);
  let cl: number;
  if (a < 1e-6) {
    cl = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    cl = disc < 0 ? Math.sqrt(W.cd0 / k + m * m) : (-b - Math.sqrt(disc)) / (2 * a);
  }
  return cl;
}

/** Angle of attack for clForGlide. */
export function alphaForGlide(glide: number): number {
  return clForGlide(glide) / W.clSlopePerDeg + W.zeroLiftAlphaDeg;
}

/** Steady airspeed on the clean polar at full area for a given glide ratio. */
export function equilibriumSpeedForGlide(glide: number): number {
  const cl = clForGlide(glide);
  const d = cl - W.clMinDrag;
  const cd = W.cd0 + W.cdK * d * d;
  const resultant = Math.sqrt(cl * cl + cd * cd);
  return Math.sqrt((2 * SIM.massKg * SIM.gravityMps2) / (SIM.rhoKgM3 * W.wingAreaM2 * resultant));
}

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
