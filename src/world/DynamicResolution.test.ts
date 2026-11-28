import { describe, expect, it } from 'vitest';
import {
  DynamicResolution,
  MAX_SAMPLE_MS,
  MIN_INTERVAL_S,
  scaleLevels,
  UP_HOLD_S,
  type DynamicResolutionConfig,
} from './DynamicResolution';

const CFG: DynamicResolutionConfig = { minScale: 0.6, maxScale: 1, targetMs: 1000 / 60 };
const VSYNC_MS = 1000 / 60;

interface Trace {
  /** [time s, scale] at each change. */
  changes: [number, number][];
  finalScale: number;
}

/**
 * Plays `seconds` of frames. The "GPU" takes `costMs(scale)` per frame; a vsynced display cannot show a
 * frame faster than 16.7 ms, so the frame time the controller sees is max(vsync, cost).
 */
function simulate(ctl: DynamicResolution, seconds: number, costMs: (scale: number) => number, startS = 0): Trace {
  const changes: [number, number][] = [];
  let t = startS;
  while (t < startS + seconds) {
    const frameMs = Math.max(VSYNC_MS, costMs(ctl.scale));
    const next = ctl.update(frameMs);
    t += frameMs / 1000;
    if (next !== null) changes.push([t, next]);
  }
  return { changes, finalScale: ctl.scale };
}

describe('DynamicResolution', () => {
  it('starts at the ceiling and holds it while the frame time is on target', () => {
    const ctl = new DynamicResolution(CFG);
    expect(ctl.scale).toBe(1);
    const tr = simulate(ctl, 60, () => 12);
    expect(tr.changes).toEqual([]);
  });

  it('steps down under load, one step a time, until the frame makes the budget, then stays there', () => {
    const ctl = new DynamicResolution(CFG);
    // 30 ms at full scale; cost goes with the pixel count (scale squared): on target below about 0.75.
    const tr = simulate(ctl, 40, (s) => 30 * s * s);
    expect(tr.finalScale).toBeLessThan(1);
    expect(tr.finalScale).toBeGreaterThanOrEqual(0.7);
    expect(30 * tr.finalScale ** 2).toBeLessThan(CFG.targetMs * 1.15);
    // Every move on the way down is one step of 0.1.
    let prev = 1;
    for (const [, s] of tr.changes) {
      if (s < prev) expect(prev - s).toBeCloseTo(0.1, 5);
      prev = s;
    }
  });

  it('never changes twice within a second', () => {
    const ctl = new DynamicResolution(CFG);
    const tr = simulate(ctl, 120, (s) => 45 * s * s);
    for (let i = 1; i < tr.changes.length; i++) {
      expect(tr.changes[i][0] - tr.changes[i - 1][0]).toBeGreaterThanOrEqual(MIN_INTERVAL_S - 0.05);
    }
  });

  it('respects the floor even when nothing is enough', () => {
    const ctl = new DynamicResolution(CFG);
    // Pixel-bound but far too heavy: 80 ms at full scale is still 29 ms at the floor.
    const tr = simulate(ctl, 60, (s) => 80 * s * s);
    expect(tr.finalScale).toBeCloseTo(CFG.minScale, 5);
    expect(Math.min(...tr.changes.map((c) => c[1]))).toBeGreaterThanOrEqual(CFG.minScale - 1e-6);
  });

  it('steps up slowly when there is headroom: one step per UP_HOLD_S at the soonest, never above the ceiling', () => {
    const ctl = new DynamicResolution({ ...CFG });
    simulate(ctl, 30, (s) => 80 * s * s); // push it to the floor
    expect(ctl.scale).toBeCloseTo(0.6, 5);
    const tr = simulate(ctl, 60, (s) => 6 * s * s, 30);
    expect(tr.finalScale).toBeCloseTo(1, 5);
    for (let i = 1; i < tr.changes.length; i++) {
      expect(tr.changes[i][0] - tr.changes[i - 1][0]).toBeGreaterThanOrEqual(UP_HOLD_S - 0.5);
    }
    expect(Math.max(...tr.changes.map((c) => c[1]))).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('does not hunt between two levels: a failed probe backs off, so changes become rare', () => {
    const ctl = new DynamicResolution(CFG);
    // Full scale is too much (24 ms), 0.9 is fine (about 19 ms is over, 0.8 about 15 ms): only 0.8 holds the budget.
    const cost = (s: number): number => 24 * s * s;
    let overS = 0;
    const tr = simulate(ctl, 300, (s) => {
      const c = cost(s);
      if (c > CFG.targetMs * 1.15) overS += c / 1000;
      return c;
    });
    // Each failed probe costs a second or so over budget; with the back-off that is a few percent of the run.
    expect(overS).toBeLessThan(300 * 0.1);
    // Without a back-off there would be a probe every 5 or 6 s: over a hundred changes in 300 s. With it, a few.
    expect(tr.changes.length).toBeLessThanOrEqual(20);
    // The last minute is quiet.
    const lateChanges = tr.changes.filter(([t]) => t > 240);
    expect(lateChanges.length).toBeLessThanOrEqual(4);
  });

  it('leaves a display capped at 30 Hz alone: a step down that buys nothing is undone, and not tried again for a minute', () => {
    const ctl = new DynamicResolution(CFG);
    // Every frame is 33.3 ms at any scale: a 30 Hz cap or a CPU-bound scene, not a pixel-bound one.
    const tr = simulate(ctl, 50, () => 33.3);
    expect(tr.changes[0][1]).toBeCloseTo(0.9, 5); // it tries one step...
    expect(tr.changes[1][1]).toBeCloseTo(1, 5); // ...sees no gain and undoes it
    expect(tr.changes).toHaveLength(2);
    expect(tr.finalScale).toBe(1);
    // After the block it tries once more, and the block doubles.
    const later = simulate(ctl, 200, () => 33.3, 50);
    expect(later.changes.length).toBeLessThanOrEqual(4);
    expect(later.finalScale).toBe(1);
  });

  it('still keeps a step down that helps, so a real pixel-bound phone reaches its level', () => {
    const ctl = new DynamicResolution(CFG);
    const tr = simulate(ctl, 30, (s) => 36 * s * s);
    expect(tr.finalScale).toBeLessThanOrEqual(0.8);
    expect(tr.finalScale).toBeGreaterThanOrEqual(0.7);
  });

  it('ignores hitches: a 500 ms frame (tab switch, compile) is not evidence', () => {
    const ctl = new DynamicResolution(CFG);
    for (let i = 0; i < 600; i++) {
      expect(ctl.update(i % 60 === 0 ? MAX_SAMPLE_MS * 2 : 12)).toBeNull();
    }
    expect(ctl.scale).toBe(1);
  });

  it('rides out a single slow frame', () => {
    const ctl = new DynamicResolution(CFG);
    simulate(ctl, 2, () => 12);
    expect(ctl.update(60)).toBeNull();
    simulate(ctl, 3, () => 12);
    expect(ctl.scale).toBe(1);
  });

  it('does nothing with a floor equal to the ceiling (desktop presets)', () => {
    const ctl = new DynamicResolution({ minScale: 1, maxScale: 1, targetMs: CFG.targetMs });
    const tr = simulate(ctl, 30, () => 60);
    expect(tr.changes).toEqual([]);
    expect(ctl.scale).toBe(1);
  });

  it('clamps into new limits when the preset changes', () => {
    const ctl = new DynamicResolution(CFG);
    simulate(ctl, 20, (s) => 80 * s * s);
    ctl.configure({ minScale: 0.8, maxScale: 1, targetMs: CFG.targetMs });
    expect(ctl.scale).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });

  it('lists the levels it can visit, for pre-allocation', () => {
    expect(scaleLevels(0.6, 1)).toEqual([1, 0.9, 0.8, 0.7, 0.6]);
    expect(scaleLevels(1, 1)).toEqual([1]);
  });
});
