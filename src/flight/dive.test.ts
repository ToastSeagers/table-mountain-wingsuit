import { describe, expect, it } from 'vitest';
import { dive, DIVE_END_S, DIVE_START_S, PULL_END_S } from '../../tools/scenarios/dive';
import { frameAt, peak } from './metrics';
import { runScenario, stubScenario } from './scripting';
import { WINGSUIT } from './tuning';

// Spec section 7 "dive": full nose down for 6 s reaches 70 to 80 m/s and does not exceed 80.
describe('dive', () => {
  const frames = runScenario(dive);

  it('reaches 70 to 80 m/s after 6 s of full nose down from trim', () => {
    const end = frameAt(frames, DIVE_END_S);
    expect(end.airspeed).toBeGreaterThanOrEqual(70);
    expect(end.airspeed).toBeLessThanOrEqual(80);
    expect(frameAt(frames, DIVE_START_S).airspeed).toBeLessThan(50);
  });

  it('never exceeds 80 m/s, even in a long dive', () => {
    expect(peak(frames, 'airspeed').value).toBeLessThanOrEqual(80);
    const long = stubScenario('long-dive', 30, (t, _st, input) => {
      if (t >= 10) input.pitch = -1;
    });
    long.exit = { x: 0, y: 4000, z: 0 };
    const longFrames = runScenario(long);
    expect(peak(longFrames, 'airspeed').value).toBeLessThanOrEqual(80);
    expect(peak(longFrames, 'airspeed').value).toBeGreaterThan(70);
  });

  it('caps the pull-out at the g limit and bleeds speed', () => {
    const g = peak(frames, 'gLoad', DIVE_END_S, PULL_END_S);
    expect(g.value).toBeGreaterThan(3);
    expect(g.value).toBeLessThanOrEqual(WINGSUIT.gMaxTotal + 0.01);
    expect(frameAt(frames, PULL_END_S).airspeed).toBeLessThan(
      frameAt(frames, DIVE_END_S).airspeed - 15,
    );
  });

  it('half nose down settles near glide 1.2 at about 70 m/s', () => {
    const half = stubScenario('half-dive', 22, (t, _st, input) => {
      if (t >= 10) input.pitch = -0.5;
    });
    half.exit = { x: 0, y: 3000, z: 0 };
    const f = frameAt(runScenario(half), 22);
    expect(f.glide).toBeGreaterThan(0.9);
    expect(f.glide).toBeLessThan(1.5);
    expect(f.airspeed).toBeGreaterThan(62);
    expect(f.airspeed).toBeLessThan(80);
  });
});
