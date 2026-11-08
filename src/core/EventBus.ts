/**
 * Tiny typed event bus. Stage 5 (audio, FX) subscribes to the game events here instead of
 * reaching into screens or the run controller.
 */
export interface GameEvents {
  /** UI sounds: cursor moved, item chosen, backed out. */
  'ui-move': undefined;
  'ui-select': undefined;
  'ui-back': undefined;
  /** Countdown number shown (3, 2, 1) or 0 for GO. */
  countdown: number;
  /** One tick per 100 points counted on the results tally. */
  'tally-tick': undefined;
  /** The high score fanfare. */
  fanfare: undefined;
  /** A style bonus stamp: id and points. */
  stamp: { id: string; label: string; points: number };
  /** Flight phase changed (deploy, canopy, landed, crashed). */
  phase: { from: string; to: string };
  /** Game state changed (title, exitSelect, ...). */
  state: { from: string; to: string };
  /** The run ended; carries the end reason. */
  'run-end': { reason: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const entry = handler as Handler<never>;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  emit<K extends keyof GameEvents>(type: K, ...payload: GameEvents[K] extends undefined ? [] : [GameEvents[K]]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) (h as Handler<GameEvents[K] | undefined>)(payload[0]);
  }
}
