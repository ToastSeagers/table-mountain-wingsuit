import { stubScenario } from '../../src/flight/scripting';

export const FLATTEN_START_S = 10;

/** Spec section 7 "flatten": trim first, then full nose up held until mush. */
export const flatten = stubScenario(
  'flatten',
  22,
  (t, _st, input) => {
    if (t >= FLATTEN_START_S) input.pitch = 1;
  },
  'Trim to 10 s, then full nose up',
);
