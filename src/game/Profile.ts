import { Persistence } from '../core/Persistence';
import type { ExitDefinition, RunResult } from '../types/game';
import { packReplay, unpackReplay } from './Replay';

export const MAX_SCORES_PER_EXIT = 10;
const SCORES = { name: 'scores', version: 1 };
const PROGRESS = { name: 'progress', version: 1 };
const BEST = { name: 'best', version: 1 };

export interface ScoreEntry {
  initials: string;
  total: number;
  recordedAt: string;
}

type ScoreTable = Record<string, ScoreEntry[]>;

export function cleanInitials(s: string): string {
  const letters = s.toUpperCase().replace(/[^A-Z]/g, '');
  return (letters + 'AAA').slice(0, 3);
}

function validateScores(raw: unknown): ScoreTable | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const out: ScoreTable = {};
  for (const [exitId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const entries: ScoreEntry[] = [];
    for (const e of list as unknown[]) {
      const r = e as Partial<ScoreEntry> | null;
      if (r && typeof r.total === 'number' && Number.isFinite(r.total) && typeof r.initials === 'string') {
        entries.push({
          initials: cleanInitials(r.initials),
          total: Math.max(0, Math.round(r.total)),
          recordedAt: typeof r.recordedAt === 'string' ? r.recordedAt : '',
        });
      }
    }
    out[exitId] = entries.sort((a, b) => b.total - a.total).slice(0, MAX_SCORES_PER_EXIT);
  }
  return out;
}

/** Packed form of a stored RunResult (replay as flat arrays). */
interface PackedRun extends Omit<RunResult, 'replay'> {
  replay: number[][];
}

function validateBest(raw: unknown): Record<string, RunResult> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const out: Record<string, RunResult> = {};
  for (const [exitId, v] of Object.entries(raw)) {
    const p = v as Partial<PackedRun> | null;
    if (!p || typeof p.total !== 'number' || typeof p.exitId !== 'string') continue;
    const replay = unpackReplay(p.replay);
    if (replay) out[exitId] = { ...(p as PackedRun), replay };
  }
  return out;
}

/**
 * Everything that persists between sessions besides settings: top-10 scores per exit
 * (`tmw.scores.v1`), which exits have been completed (`tmw.progress.v1`), and the best run per
 * exit with its replay (`tmw.best.v1`, for the attract mode and a future ghost).
 */
export class Profile {
  private scores: ScoreTable;
  private completed: Set<string>;
  private best: Record<string, RunResult>;

  constructor(private readonly persistence: Persistence) {
    this.scores = persistence.load(SCORES.name, SCORES.version, validateScores, () => ({}));
    const prog = persistence.load(
      PROGRESS.name,
      PROGRESS.version,
      (raw) => {
        const c = (raw as { completed?: unknown } | null)?.completed;
        return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : null;
      },
      () => [],
    );
    this.completed = new Set(prog);
    this.best = persistence.load(BEST.name, BEST.version, validateBest, () => ({}));
  }

  entries(exitId: string): readonly ScoreEntry[] {
    return this.scores[exitId] ?? [];
  }

  bestScore(exitId: string): number {
    return this.entries(exitId)[0]?.total ?? 0;
  }

  /** Whether `total` earns a place in the exit's top ten. Zero never does. */
  qualifies(exitId: string, total: number): boolean {
    if (total <= 0) return false;
    const list = this.entries(exitId);
    return list.length < MAX_SCORES_PER_EXIT || total > list[list.length - 1].total;
  }

  /** Inserts a score and returns its 0-based rank, or -1 if it did not make the table. */
  addScore(exitId: string, initials: string, total: number, recordedAt: string): number {
    if (!this.qualifies(exitId, total)) return -1;
    const entry: ScoreEntry = { initials: cleanInitials(initials), total, recordedAt };
    const list = [...this.entries(exitId), entry].sort((a, b) => b.total - a.total);
    // Stable for ties: an equal older score keeps its place above the new one.
    const rank = list.lastIndexOf(entry);
    this.scores = { ...this.scores, [exitId]: list.slice(0, MAX_SCORES_PER_EXIT) };
    this.persistence.save(SCORES.name, SCORES.version, this.scores);
    return rank < MAX_SCORES_PER_EXIT ? rank : -1;
  }

  isCompleted(exitId: string): boolean {
    return this.completed.has(exitId);
  }

  markCompleted(exitId: string): void {
    if (this.completed.has(exitId)) return;
    this.completed.add(exitId);
    this.persistence.save(PROGRESS.name, PROGRESS.version, { completed: [...this.completed] });
  }

  isUnlocked(exit: Pick<ExitDefinition, 'unlock'>): boolean {
    const u = exit.unlock;
    switch (u.type) {
      case 'always':
        return true;
      case 'completed':
        return this.isCompleted(u.exitId);
      case 'score':
        return this.bestScore(u.exitId) >= u.min;
    }
  }

  bestRun(exitId: string): RunResult | null {
    return this.best[exitId] ?? null;
  }

  /** The stored best run with the highest total across all exits (attract mode). */
  bestRunOverall(): RunResult | null {
    let top: RunResult | null = null;
    for (const r of Object.values(this.best)) if (!top || r.total > top.total) top = r;
    return top;
  }

  /** Keeps the run if it beats the stored best for its exit. Returns true if stored. */
  offerBestRun(run: RunResult): boolean {
    const old = this.best[run.exitId];
    if (old && old.total >= run.total) return false;
    this.best = { ...this.best, [run.exitId]: run };
    const packed: Record<string, PackedRun> = {};
    for (const [id, r] of Object.entries(this.best)) packed[id] = { ...r, replay: packReplay(r.replay) };
    if (!this.persistence.save(BEST.name, BEST.version, packed)) {
      // Too big for this storage: keep scores and unlocks, drop replays.
      const slim: Record<string, PackedRun> = {};
      for (const [id, r] of Object.entries(this.best)) slim[id] = { ...r, replay: [] };
      this.persistence.save(BEST.name, BEST.version, slim);
    }
    return true;
  }
}
