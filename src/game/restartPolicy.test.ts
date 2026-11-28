import { describe, expect, it } from 'vitest';
import { CountdownGate } from './CountdownGate';
import { isQuickRestart, QUICK_COUNTDOWN_S, type RestartFacts } from './restartPolicy';

const LINE = { exitId: 'the-table', headingDeg: 265 };
const READY: RestartFacts = {
  from: 'flying',
  line: LINE,
  lastFlown: { ...LINE },
  terrainSettled: true,
  samplerReady: true,
  preloadDone: true,
  shadersReady: true,
};

describe('isQuickRestart', () => {
  it('skips the warm-up for a retry at the same exit and line with everything settled, from every way of restarting', () => {
    // Pause RESTART and the R key both leave `flying`; JUMP AGAIN leaves `results` or `highScores`.
    for (const from of ['flying', 'results', 'highScores'] as const) {
      expect(isQuickRestart({ ...READY, from })).toBe(true);
    }
  });

  it('never for a first jump: the intro leads to the full countdown, and so do the menus', () => {
    for (const from of ['intro', 'title', 'exitSelect'] as const) {
      expect(isQuickRestart({ ...READY, from })).toBe(false);
    }
  });

  it('never before a run has reached GO', () => {
    expect(isQuickRestart({ ...READY, lastFlown: null })).toBe(false);
  });

  it('keeps the full countdown for a different exit or a different heading on the same exit', () => {
    expect(isQuickRestart({ ...READY, line: { exitId: 'platteklip', headingDeg: 350 } })).toBe(false);
    expect(isQuickRestart({ ...READY, line: { exitId: 'the-table', headingDeg: 240 } })).toBe(false);
  });

  it('keeps the full countdown while the terrain, the sampler, the preload or the shaders are not ready', () => {
    expect(isQuickRestart({ ...READY, terrainSettled: false })).toBe(false);
    expect(isQuickRestart({ ...READY, samplerReady: false })).toBe(false);
    expect(isQuickRestart({ ...READY, preloadDone: false })).toBe(false);
    expect(isQuickRestart({ ...READY, shadersReady: false })).toBe(false);
  });

  it('is a single short beat, well under the 2.7 s of 3-2-1', () => {
    expect(QUICK_COUNTDOWN_S).toBeLessThanOrEqual(1);
    expect(QUICK_COUNTDOWN_S).toBeGreaterThan(0);
  });
});

describe('CountdownGate.skip', () => {
  it('goes at once, whatever the terrain and the warm-up say', () => {
    const g = new CountdownGate();
    g.skip();
    expect(g.update(0.016, { terrainReady: false, preloadDone: false, warmSettled: false })).toBe('go');
    expect(g.update(0.016, { terrainReady: false, preloadDone: false, warmSettled: false })).toBe('go');
  });

  it('is cleared by reset, so the next cold start waits again', () => {
    const g = new CountdownGate();
    g.skip();
    g.reset();
    expect(g.update(0.016, { terrainReady: false, preloadDone: false, warmSettled: false })).toBe('terrain');
  });
});
