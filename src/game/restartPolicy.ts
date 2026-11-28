import type { GameState } from './GameStateMachine';

/**
 * A retry is a brief interruption, not a loading screen (research note 2.3: Superflight's most praised
 * trait). A cold start holds GO for the terrain, preload and warm-up gates and then counts 3-2-1; a retry
 * at the same line with the terrain already settled shows a single GO this long and jumps.
 * 0.6 s: long enough that the camera cut, the pilot standing on the ledge and the GO beep register, so
 * the jump does not feel like it fired by itself; short enough to read as a restart. Compare 2.7 s for
 * the 3-2-1 (3 x 0.9 s) before the warm-up wait on top.
 */
export const QUICK_COUNTDOWN_S = 0.6;

/** The exit and heading of the last run that reached GO. */
export interface FlownLine {
  exitId: string;
  headingDeg: number;
}

export interface RestartFacts {
  /** The state the countdown was entered from: `intro` is a cold start, anything else is a retry. */
  from: GameState;
  line: FlownLine;
  lastFlown: FlownLine | null;
  /** The terrain reports nothing queued (`Terrain.isSettled()`), read before the countdown's own warm-up begins. */
  terrainSettled: boolean;
  /** The CPU height sampler can answer around the exit. */
  samplerReady: boolean;
  /** The exit's texture and height preload resolved. */
  preloadDone: boolean;
  /** Every shader the flight draws is already compiled (from an earlier countdown). */
  shadersReady: boolean;
}

/**
 * True when the countdown may skip the warm-up wait: a restart (not the first jump from the intro) at the
 * same exit and the same line as the run just flown, with everything the gate waits for already done.
 * Any other case, a different exit or heading, an unsettled terrain, a first jump, keeps the full gate.
 */
export function isQuickRestart(f: RestartFacts): boolean {
  if (f.from === 'intro' || f.from === 'title' || f.from === 'exitSelect') return false;
  if (!f.lastFlown) return false;
  if (f.lastFlown.exitId !== f.line.exitId || f.lastFlown.headingDeg !== f.line.headingDeg) return false;
  return f.terrainSettled && f.samplerReady && f.preloadDone && f.shadersReady;
}
