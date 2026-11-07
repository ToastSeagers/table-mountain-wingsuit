import type { Scenario } from '../../src/flight/scripting';
import { campsBay } from './camps-bay';
import { canopy, flare, noFlare } from './canopy';
import { dive } from './dive';
import { flatten } from './flatten';
import { pitch, roll, yaw } from './roll';
import { trim } from './trim';

export const scenarios: Record<string, Scenario> = {
  trim,
  dive,
  flatten,
  roll,
  pitch,
  yaw,
  canopy,
  flare,
  'no-flare': noFlare,
  'camps-bay': campsBay,
};
