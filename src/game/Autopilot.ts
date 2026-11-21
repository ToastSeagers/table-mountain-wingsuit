import type { WingsuitFlightState } from '../flight/state';
import type { FlightInput } from '../types/flight';
import type { Vec3 } from '../types/math';

export interface AutopilotOptions {
  /** Where to land (x, z). */
  target: Vec3;
  /** AGL at which to open the canopy regardless of the target, metres. */
  deployAglM?: number;
  /** AGL at which to start the flare, metres. */
  flareAglM?: number;
  /** Seconds to fly straight after exit before turning toward the target. */
  straightS?: number;
  /** Seconds of nose-down at the start to shorten the arc. */
  earlyDiveS?: number;
  /** Pitch input held while cruising (positive pulls up). */
  cruisePitch?: number;
  /** Largest roll input the autopilot uses, 0 to 1. Gentle turns keep more energy. */
  maxRoll?: number;
  /** Under canopy below this AGL the turn is limited, and under a third of it the wings are
   *  level for the flare: no low turns, as a real canopy pilot flies it (Stage 8). */
  lowTurnAglM?: number;
  /** Largest roll input under canopy: half input is a 27 deg bank, enough to circle down over a
   *  zone without the forward speed a 55 deg bank adds. */
  canopyMaxRoll?: number;
  /** AGL under which canopyMaxRoll applies; above it the spiral may use maxRoll. */
  canopyRollCapAglM?: number;
}

const DEG = 180 / Math.PI;

/** Smallest signed angle from a to b, degrees. */
export function headingError(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * A scripted pilot for tests, headless measurement of exits, and `?dev=1&auto=1` demo runs. It
 * steers toward a target point with roll, holds a cruise pitch, opens at a set AGL and flares
 * just above the ground. Not a player: it knows nothing about terrain ahead.
 */
export class Autopilot {
  private readonly o: Required<AutopilotOptions>;
  /** AGL at the previous update, to tell a slope falling away (AGL rising) from a real low pass. */
  private lastAglM = Infinity;

  constructor(options: AutopilotOptions) {
    this.o = { deployAglM: 130, flareAglM: 3.5, earlyDiveS: 2.5, straightS: 8, cruisePitch: 0.15, maxRoll: 1, lowTurnAglM: 15, canopyMaxRoll: 0.5, canopyRollCapAglM: 60, ...options };
  }

  /** Writes this step's input. `input` is mutated in place. */
  update(st: Readonly<WingsuitFlightState>, input: FlightInput): void {
    input.pitch = 0;
    input.roll = 0;
    input.yaw = 0;
    input.deploy = false;
    input.flare = false;
    input.brake = false;
    const dx = this.o.target.x - st.position.x;
    const dz = this.o.target.z - st.position.z;
    const wanted = (Math.atan2(dx, -dz) * DEG + 360) % 360;
    const err = headingError(st.headingDeg, wanted);
    // Look at the velocity heading rather than the nose once moving, so a bank does not fool it.
    const rollCmd = Math.max(-this.o.maxRoll, Math.min(this.o.maxRoll, err / 25));
    if (st.phase === 'freefall' || st.phase === 'wingsuit') {
      input.pitch = st.elapsedS < this.o.earlyDiveS ? -0.4 : this.o.cruisePitch;
      // Hold the arc straight; turn once the suit is flying.
      if (st.phase === 'wingsuit' && st.elapsedS > this.o.straightS) input.roll = rollCmd;
      // Open when the target is within canopy glide of this height, or for safety when low.
      const dist = Math.hypot(dx, dz);
      const reachable = st.elapsedS > 10 && st.aglM <= 450 && dist <= st.aglM * 2.2;
      // The safety deploy ignores AGL that is still rising: off a cliff the ground falls away
      // faster than the suit, so a low reading there is not a reason to open (Lion's Head).
      const closing = st.aglM <= this.lastAglM;
      const lowPull = st.elapsedS > 6 && st.aglM <= this.o.deployAglM && (closing || st.aglM <= this.o.deployAglM / 2);
      input.deploy = st.phase === 'wingsuit' && (reachable || lowPull);
    } else if (st.phase === 'deploying' || st.phase === 'canopy') {
      // Spiralling off spare height is fine up high; low, the bank would carry into the flare
      // (a 55 deg bank adds 3 m/s of forward speed, which is the difference between an ok landing
      // and a crash by the classification table), so the turn fades out and the flare is level.
      const low = this.o.lowTurnAglM;
      const turnScale = st.aglM >= low ? 1 : st.aglM <= low / 3 ? 0 : (st.aglM - low / 3) / (low - low / 3);
      // Full roll (a tight spiral) is allowed while high; under canopyRollCapAglM the cap applies.
      const cap = st.aglM >= this.o.canopyRollCapAglM ? this.o.maxRoll : this.o.canopyMaxRoll;
      input.roll = Math.max(-cap, Math.min(cap, rollCmd)) * turnScale;
      input.flare = st.phase === 'canopy' && st.aglM <= this.o.flareAglM;
    }
    this.lastAglM = st.aglM;
  }
}
