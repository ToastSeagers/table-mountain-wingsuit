import { describe, expect, it } from 'vitest';
import { trim } from '../../tools/scenarios/trim';
import { trimMetrics } from './metrics';
import { runScenario } from './scripting';

// Spec section 7 "trim test": hold zero input from exit for 20 s; after the start arc,
// glide 2.8 to 3.2 and airspeed 42 to 48. Spec table: trim sink 13 to 17 m/s.
describe('trim', () => {
  const frames = runScenario(trim);
  const m = trimMetrics(frames, 14, 20);

  it('glides at 2.8 to 3.2', () => {
    expect(m.glide).toBeGreaterThanOrEqual(2.8);
    expect(m.glide).toBeLessThanOrEqual(3.2);
  });

  it('flies at 42 to 48 m/s', () => {
    expect(m.airspeed).toBeGreaterThanOrEqual(42);
    expect(m.airspeed).toBeLessThanOrEqual(48);
  });

  it('sinks at 13 to 17 m/s with a steady 1 g', () => {
    expect(m.sink).toBeGreaterThanOrEqual(13);
    expect(m.sink).toBeLessThanOrEqual(17);
    expect(m.gLoad).toBeGreaterThan(0.95);
    expect(m.gLoad).toBeLessThan(1.05);
  });

  it('is still flying a wingsuit, wings level, on the exit heading', () => {
    const last = frames[frames.length - 1];
    expect(last.phase).toBe('wingsuit');
    expect(Math.abs(last.bank)).toBeLessThan(1);
    expect(Math.abs(last.heading - 90)).toBeLessThan(1);
    expect(Math.abs(last.z)).toBeLessThan(5);
  });
});
