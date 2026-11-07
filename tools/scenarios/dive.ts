import { stubScenario } from '../../src/flight/scripting';

export const DIVE_START_S = 10;
export const DIVE_END_S = 16;
export const PULL_END_S = 19;

/** Spec section 7 "dive": trim first, then full nose down for 6 s, then a full pull-up (g-load). */
export const dive = stubScenario(
  'dive',
  24,
  (t, _st, input) => {
    if (t >= DIVE_START_S && t < DIVE_END_S) input.pitch = -1;
    else if (t >= DIVE_END_S && t < PULL_END_S) input.pitch = 1;
  },
  'Trim to 10 s, full nose down 10-16 s, full pull 16-19 s',
);
