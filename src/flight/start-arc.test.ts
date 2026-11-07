import { describe, expect, it } from 'vitest';
import { trim } from '../../tools/scenarios/trim';
import { arcMetrics, firstFrame, peak } from './metrics';
import { runScenario } from './scripting';

// Spec section 7 "start arc": time until glide exceeds 2.5 is 3 to 4.5 s; height lost under
// 120 m. Spec table: about 90 m lost and 60 m horizontal.
describe('start arc', () => {
  const frames = runScenario(trim);
  const arc = arcMetrics(frames);

  it('catches (glide > 2.5) between 3 and 4.5 s after exit', () => {
    expect(arc.durationS).toBeGreaterThanOrEqual(3);
    expect(arc.durationS).toBeLessThanOrEqual(4.5);
  });

  it('loses under 120 m of height doing it', () => {
    expect(arc.heightLostM).toBeLessThan(120);
    expect(arc.heightLostM).toBeGreaterThan(40);
    expect(arc.horizontalM).toBeGreaterThan(30);
  });

  it('falls first: near-zero g at exit, then a catch of more than 1.5 g', () => {
    expect(frames[12].gLoad).toBeLessThan(0.1);
    expect(peak(frames, 'gLoad', 0, arc.durationS).value).toBeGreaterThan(1.5);
    expect(arc.peakSinkMps).toBeGreaterThan(18);
  });

  it('enters the wingsuit phase when the wing area ramp reaches 90 %', () => {
    const wing = firstFrame(frames, (f) => f.phase === 'wingsuit');
    expect(wing).toBeDefined();
    expect(wing!.t).toBeGreaterThan(2);
    expect(wing!.t).toBeLessThan(3.5);
    expect(wing!.areaFactor).toBeGreaterThanOrEqual(0.9);
    expect(frames[1].phase).toBe('freefall');
  });
});
