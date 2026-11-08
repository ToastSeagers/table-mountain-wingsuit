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

  constructor(options: AutopilotOptions) {
    this.o = { deployAglM: 130, flareAglM: 3.5, earlyDiveS: 2.5, straightS: 8, cruisePitch: 0.15, ...options };
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
    const rollCmd = Math.max(-1, Math.min(1, err / 25));
    if (st.phase === 'freefall' || st.phase === 'wingsuit') {
      input.pitch = st.elapsedS < this.o.earlyDiveS ? -0.4 : this.o.cruisePitch;
      // Hold the arc straight; turn once the suit is flying.
      if (st.phase === 'wingsuit' && st.elapsedS > this.o.straightS) input.roll = rollCmd;
      // Open when the target is within canopy glide of this height, or for safety when low.
      const dist = Math.hypot(dx, dz);
      const reachable = st.elapsedS > 10 && st.aglM <= 450 && dist <= st.aglM * 2.2;
      input.deploy = st.phase === 'wingsuit' && (reachable || (st.elapsedS > 6 && st.aglM <= this.o.deployAglM));
    } else if (st.phase === 'deploying' || st.phase === 'canopy') {
      input.roll = rollCmd;
      input.flare = st.phase === 'canopy' && st.aglM <= this.o.flareAglM;
    }
  }
}
