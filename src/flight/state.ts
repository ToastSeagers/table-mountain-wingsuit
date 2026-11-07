import type { FlightState } from '../types/flight';

export type LandingClass = 'soft' | 'ok' | 'hard' | 'crash';

export interface LandingReport {
  /** Downward speed at touchdown, m/s (positive down). */
  verticalMps: number;
  /** Horizontal speed at touchdown, m/s. */
  forwardMps: number;
  classification: LandingClass;
}

/**
 * The frozen FlightState plus read-outs for the HUD, scoring and tuning. One instance is
 * owned by FlightModelImpl and mutated in place every step; copy it if you need history.
 */
export interface WingsuitFlightState extends FlightState {
  /** Angle of attack and sideslip of the body against the velocity, degrees. */
  alphaDeg: number;
  betaDeg: number;
  /** 0 flying cleanly .. 1 fully mushed (spec section 4). */
  mushFactor: number;
  /** Effective wing area over full area: the start-arc ramp times any dive fold. */
  wingAreaFactor: number;
  /** Euler read-outs of `orientation`: heading clockwise from north, nose up, right wing down. */
  headingDeg: number;
  pitchDeg: number;
  bankDeg: number;
  /** Downward speed (positive down) and horizontal speed, m/s. */
  sinkMps: number;
  groundSpeedMps: number;
  /** AGL at the moment deploy was latched, or null before deploy. */
  deployAglM: number | null;
  /** Deploy happened under the minimum safe AGL (game rule, spec section 3). */
  lowPull: boolean;
  /** Set once at touchdown (phase landed or crashed), null while airborne. */
  landing: LandingReport | null;
  /** Remaining flare, 0..1. 1 while not under canopy. */
  flareEnergy: number;
}

export function createFlightState(): WingsuitFlightState {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    phase: 'freefall',
    airspeedMps: 0,
    aglM: 0,
    elapsedS: 0,
    glideRatio: 0,
    gLoad: 0,
    alphaDeg: 0,
    betaDeg: 0,
    mushFactor: 0,
    wingAreaFactor: 0,
    headingDeg: 0,
    pitchDeg: 0,
    bankDeg: 0,
    sinkMps: 0,
    groundSpeedMps: 0,
    deployAglM: null,
    lowPull: false,
    landing: null,
    flareEnergy: 1,
  };
}
