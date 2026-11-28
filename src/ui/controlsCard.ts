import { el } from './dom';

/** One line on what earns points (playtest note 20: "how to score" was a tester first confusion). Stage 9: proximity now pays for narrowness, and the line says so. */
export const SCORING_HINT =
  'POINTS: FLY FAST AND CLOSE TO ROCK, NARROW GAPS PAY MOST. LAND IN A GREEN RING.';

const KEYBOARD_ROWS: [string, string][] = [
  ['W / S', 'DIVE / PULL UP'],
  ['A / D', 'BANK LEFT / RIGHT'],
  ['Q / E', 'YAW'],
  ['SPACE', 'DEPLOY, THEN FLARE'],
  ['SHIFT', 'BRAKE'],
  ['C  R  ESC', 'CAMERA  RESTART  PAUSE'],
  ['MOUSE', 'CLICK TO STEER'],
  ['PAD', 'STICK, TRIGGERS, A'],
];

const TOUCH_ROWS: [string, string][] = [
  ['DRAG SIDEWAYS', 'BANK'],
  ['DRAG UP / DOWN', 'PULL UP / DIVE'],
  ['HOLD A SIDE', 'GENTLE BANK'],
  ['PULL', 'DEPLOY, THEN FLARE'],
  ['BRAKE', 'UNDER CANOPY'],
];

/**
 * The controls cheat sheet: a keyboard grid and a touch grid (CSS shows one or the other) with the
 * scoring hint under both. Shared by the countdown, which shows it before a flight, and the pause
 * menu, where a tester asked to see it again (playtest note 22).
 */
export function controlsCard(): HTMLElement {
  const wrap = el('div', 'controls-card');
  const kb = el('div', 'controls kb-only');
  for (const [k, v] of KEYBOARD_ROWS) kb.append(el('b', '', k), el('span', '', v));
  const touch = el('div', 'controls touch-only');
  for (const [k, v] of TOUCH_ROWS) touch.append(el('b', '', k), el('span', '', v));
  wrap.append(kb, touch, el('div', 'hint', SCORING_HINT));
  return wrap;
}
