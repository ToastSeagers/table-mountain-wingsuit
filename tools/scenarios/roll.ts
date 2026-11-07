import { stubScenario } from '../../src/flight/scripting';

export const ROLL_START_S = 14;
export const PITCH_START_S = 14;
export const YAW_START_S = 14;

/** Spec table "roll rate at trim": one second of full roll at trim. */
export const roll = stubScenario(
  'roll',
  16,
  (t, _st, input) => {
    if (t >= ROLL_START_S && t < ROLL_START_S + 1) input.roll = 1;
  },
  'Trim to 14 s, full roll for 1 s',
);

/** Spec table "pitch rate at trim": half a second of full nose up at trim. */
export const pitch = stubScenario(
  'pitch',
  16,
  (t, _st, input) => {
    if (t >= PITCH_START_S && t < PITCH_START_S + 0.5) input.pitch = 1;
  },
  'Trim to 14 s, full nose up for 0.5 s',
);

/** Spec table "yaw authority low": three seconds of full direct yaw at trim. */
export const yaw = stubScenario(
  'yaw',
  18,
  (t, _st, input) => {
    if (t >= YAW_START_S && t < YAW_START_S + 3) input.yaw = 1;
  },
  'Trim to 14 s, full yaw for 3 s',
);
