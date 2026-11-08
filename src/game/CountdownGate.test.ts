import { describe, expect, it } from 'vitest';
import { CountdownGate, PRELOAD_WAIT_MAX_S, WARMUP_WAIT_MAX_S } from './CountdownGate';

const open = { terrainReady: true, preloadDone: true };

describe('CountdownGate', () => {
  it('holds on the terrain gate, then on the warm-up, and goes once the queues drain', () => {
    const g = new CountdownGate();
    expect(g.update(0.016, { terrainReady: false, preloadDone: false, warmSettled: false })).toBe('terrain');
    expect(g.update(0.016, { terrainReady: true, preloadDone: false, warmSettled: false })).toBe('terrain');
    expect(g.update(0.016, { ...open, warmSettled: false })).toBe('warmup');
    expect(g.update(0.016, { ...open, warmSettled: false })).toBe('warmup');
    expect(g.update(0.016, { ...open, warmSettled: true })).toBe('go');
  });

  it('does not start the warm-up clock until the terrain gate has opened', () => {
    const g = new CountdownGate();
    // Five seconds on the terrain gate must not eat into the warm-up allowance.
    for (let t = 0; t < 5; t += 0.5) g.update(0.5, { terrainReady: true, preloadDone: false, warmSettled: false });
    for (let t = 0; t < WARMUP_WAIT_MAX_S - 0.5; t += 0.5) {
      expect(g.update(0.5, { ...open, warmSettled: false })).toBe('warmup');
    }
  });

  it('gives up on the warm-up after 4 s on top of the terrain gate', () => {
    const g = new CountdownGate();
    let held = 0;
    while (g.update(0.1, { ...open, warmSettled: false }) === 'warmup') {
      held += 0.1;
      expect(held).toBeLessThan(WARMUP_WAIT_MAX_S + 0.5);
    }
    expect(held).toBeGreaterThanOrEqual(WARMUP_WAIT_MAX_S);
  });

  it('still gives up on an unfinished preload after 6 s, as before', () => {
    const g = new CountdownGate();
    let held = 0;
    while (g.update(0.1, { terrainReady: true, preloadDone: false, warmSettled: true }) === 'terrain') held += 0.1;
    expect(held).toBeGreaterThan(PRELOAD_WAIT_MAX_S);
    expect(held).toBeLessThan(PRELOAD_WAIT_MAX_S + 0.5);
  });

  it('never goes without a ready sampler, however long it waits', () => {
    const g = new CountdownGate();
    for (let i = 0; i < 400; i++) expect(g.update(0.1, { terrainReady: false, preloadDone: true, warmSettled: true })).toBe('terrain');
  });

  it('latches once the warm-up has passed, so a refilled queue does not restart the 3-2-1', () => {
    const g = new CountdownGate();
    g.update(0.016, { ...open, warmSettled: false });
    expect(g.update(0.016, { ...open, warmSettled: true })).toBe('go');
    expect(g.update(0.016, { ...open, warmSettled: false })).toBe('go');
  });

  it('reset starts the whole hold again', () => {
    const g = new CountdownGate();
    g.update(0.016, { ...open, warmSettled: true });
    g.reset();
    expect(g.update(0.016, { ...open, warmSettled: false })).toBe('warmup');
  });
});
