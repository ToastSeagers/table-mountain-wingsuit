import { stubScenario } from '../../src/flight/scripting';

export const DEPLOY_S = 10;
export const BRAKE_START_S = 22;
export const BRAKE_END_S = 32;
export const TURN_START_S = 36;
export const TURN_END_S = 42;
export const FLARE_AGL_M = 3.5;

/**
 * Spec section 3 canopy numbers in one run: deploy at trim, full flight, ten seconds of brakes,
 * a full turn, then straight full flight to a flared landing.
 */
export const canopy = stubScenario(
  'canopy',
  240,
  (t, st, input) => {
    input.deploy = t >= DEPLOY_S;
    if (st.phase !== 'canopy') return;
    if (t >= BRAKE_START_S && t < BRAKE_END_S) input.brake = true;
    if (t >= TURN_START_S && t < TURN_END_S) input.roll = 1;
    if (st.aglM <= FLARE_AGL_M) input.flare = true;
  },
  'Deploy at 10 s, brakes 22-32 s, full turn 36-42 s, flare at 3.5 m',
);

/** Spec section 7 "flare": deploy at trim, fly straight, flare at 3.5 m AGL. */
export const flare = stubScenario(
  'flare',
  240,
  (t, st, input) => {
    input.deploy = t >= DEPLOY_S;
    if (st.phase === 'canopy' && st.aglM <= FLARE_AGL_M) input.flare = true;
  },
  'Deploy at 10 s, straight full flight, flare at 3.5 m',
);

/** Same as flare but no flare at all: the baseline landing class. */
export const noFlare = stubScenario(
  'no-flare',
  240,
  (t, _st, input) => {
    input.deploy = t >= DEPLOY_S;
  },
  'Deploy at 10 s, straight full flight, no flare',
);
