/**
 * The game states of docs/01-architecture.md section 7:
 *   title -> exitSelect -> intro -> countdown -> flying -> results -> highScoreEntry -> title
 * plus `highScores` (the table, reached from the title or after saving initials). `paused` overlays
 * `flying`; `settings` overlays `title` and `paused`. Pure logic: the Game turns transitions into
 * screens and camera moves.
 */
export type GameState = 'title' | 'highScores' | 'exitSelect' | 'intro' | 'countdown' | 'flying' | 'results' | 'highScoreEntry';

export type GameEvent =
  | 'JUMP' // title: go pick an exit
  | 'SHOW_SCORES' // title: open the table
  | 'SELECT_EXIT' // exitSelect: confirmed an exit
  | 'SKIP_INTRO' // intro: finished or skipped
  | 'COUNTDOWN_DONE'
  | 'RUN_ENDED'
  | 'ENTER_INITIALS' // results: the run made the table
  | 'SCORE_SAVED' // highScoreEntry: initials entered
  | 'JUMP_AGAIN' // results / highScores / paused: new run at the same exit
  | 'CHANGE_EXIT'
  | 'BACK' // menus: step back one screen
  | 'TO_TITLE'
  | 'PAUSE'
  | 'RESUME'
  | 'OPEN_SETTINGS'
  | 'CLOSE_SETTINGS';

type Table = Partial<Record<GameState, Partial<Record<GameEvent, GameState>>>>;

const TABLE: Table = {
  title: { JUMP: 'exitSelect', SHOW_SCORES: 'highScores' },
  highScores: { BACK: 'title', TO_TITLE: 'title', JUMP_AGAIN: 'countdown', CHANGE_EXIT: 'exitSelect' },
  exitSelect: { SELECT_EXIT: 'intro', BACK: 'title', TO_TITLE: 'title' },
  intro: { SKIP_INTRO: 'countdown', BACK: 'exitSelect' },
  countdown: { COUNTDOWN_DONE: 'flying', BACK: 'exitSelect' },
  flying: { RUN_ENDED: 'results', JUMP_AGAIN: 'countdown', TO_TITLE: 'title', CHANGE_EXIT: 'exitSelect' },
  results: { ENTER_INITIALS: 'highScoreEntry', JUMP_AGAIN: 'countdown', CHANGE_EXIT: 'exitSelect', TO_TITLE: 'title' },
  highScoreEntry: { SCORE_SAVED: 'highScores' },
};

export type StateListener = (to: GameState, from: GameState) => void;

export class GameStateMachine {
  private current: GameState;
  private pausedFlag = false;
  private settingsFlag = false;
  private readonly listeners = new Set<StateListener>();

  constructor(initial: GameState = 'title') {
    this.current = initial;
  }

  get state(): GameState {
    return this.current;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  get settingsOpen(): boolean {
    return this.settingsFlag;
  }

  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** True if `event` would do something right now. */
  can(event: GameEvent): boolean {
    switch (event) {
      case 'PAUSE':
        return this.current === 'flying' && !this.pausedFlag;
      case 'RESUME':
        return this.pausedFlag && !this.settingsFlag;
      case 'OPEN_SETTINGS':
        return !this.settingsFlag && (this.current === 'title' || this.pausedFlag);
      case 'CLOSE_SETTINGS':
        return this.settingsFlag;
      default:
        break;
    }
    // While paused only the pause menu's own exits apply.
    if (this.pausedFlag) return event === 'JUMP_AGAIN' || event === 'TO_TITLE' || event === 'CHANGE_EXIT';
    if (this.settingsFlag) return false;
    return TABLE[this.current]?.[event] !== undefined;
  }

  /** Applies an event. Returns false (and changes nothing) when it does not apply in this state. */
  dispatch(event: GameEvent): boolean {
    if (!this.can(event)) return false;
    switch (event) {
      case 'PAUSE':
        this.pausedFlag = true;
        return true;
      case 'RESUME':
        this.pausedFlag = false;
        return true;
      case 'OPEN_SETTINGS':
        this.settingsFlag = true;
        return true;
      case 'CLOSE_SETTINGS':
        this.settingsFlag = false;
        return true;
      default:
        break;
    }
    // Paused exits leave the flying state with the same table.
    const to = TABLE[this.current]?.[event];
    if (!to) return false;
    const from = this.current;
    this.pausedFlag = false;
    this.current = to;
    for (const l of this.listeners) l(to, from);
    return true;
  }
}
