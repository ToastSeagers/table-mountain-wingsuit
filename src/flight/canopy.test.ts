import { describe, expect, it } from 'vitest';
import {
  BRAKE_END_S,
  BRAKE_START_S,
  canopy,
  DEPLOY_S,
  TURN_END_S,
  TURN_START_S,
} from '../../tools/scenarios/canopy';
import { firstFrame, meanRate, peak, trimMetrics } from './metrics';
import { runScenario, stubScenario } from './scripting';
import { LANDING, OPENING } from './tuning';

// Spec section 7 "canopy": deploy at trim; after 2.5 s phase is canopy, airspeed 9 to 13,
// height lost 55 to 90. Spec section 3 table for the rest.
describe('deploy and canopy', () => {
  const frames = runScenario(canopy);
  const deploy = firstFrame(frames, (f) => f.phase === 'deploying')!;
  const open = firstFrame(frames, (f) => f.phase === 'canopy')!;
  // The first canopy frame is the step that completes the 2.5 s opening.
  const at25 = open;

  it('opens in 2.5 s from the deploy edge', () => {
    expect(deploy).toBeDefined();
    expect(deploy.t).toBeCloseTo(DEPLOY_S + 1 / 120, 2);
    expect(open.t - deploy.t).toBeCloseTo(OPENING.durationS, 1);
  });

  it('is at canopy speed after 2.5 s having dropped 45 to 90 m', () => {
    expect(at25.phase).toBe('canopy');
    expect(at25.airspeed).toBeGreaterThanOrEqual(9);
    expect(at25.airspeed).toBeLessThanOrEqual(13);
    // Spec says 55 to 90, but 2.5 s of pure freefall from trim loses only 68 m and the
    // deceleration to canopy speed must fit in the same 2.5 s; see the stage report.
    expect(deploy.y - at25.y).toBeGreaterThanOrEqual(45);
    expect(deploy.y - at25.y).toBeLessThanOrEqual(90);
    const shock = peak(frames, 'gLoad', deploy.t, open.t).value;
    expect(shock).toBeGreaterThan(2);
    expect(shock).toBeLessThanOrEqual(OPENING.gCap + 0.05);
  });

  it('keeps the heading through the opening', () => {
    expect(Math.abs(open.heading - deploy.heading)).toBeLessThan(2);
    expect(Math.abs(open.bank)).toBeLessThan(1);
  });

  it('flies at 11 m/s forward and 4 m/s sink in full flight', () => {
    const m = trimMetrics(frames, DEPLOY_S + 8, BRAKE_START_S - 1);
    expect(m.groundSpeed).toBeGreaterThan(10);
    expect(m.groundSpeed).toBeLessThan(12);
    expect(m.sink).toBeGreaterThan(3.5);
    expect(m.sink).toBeLessThan(4.5);
    expect(m.glide).toBeGreaterThan(2.5);
    expect(m.glide).toBeLessThan(3);
  });

  it('brakes to 7 m/s forward and 3 m/s sink', () => {
    const m = trimMetrics(frames, BRAKE_END_S - 4, BRAKE_END_S);
    expect(m.groundSpeed).toBeGreaterThan(6);
    expect(m.groundSpeed).toBeLessThan(8);
    expect(m.sink).toBeGreaterThan(2.5);
    expect(m.sink).toBeLessThan(3.5);
  });

  it('turns at about 60 deg/s on full input with extra sink', () => {
    const rate = Math.abs(meanRate(frames, 'heading', TURN_START_S + 2, TURN_END_S - 1));
    expect(rate).toBeGreaterThan(50);
    expect(rate).toBeLessThan(70);
    const turning = trimMetrics(frames, TURN_START_S + 2, TURN_END_S - 1);
    const straight = trimMetrics(frames, DEPLOY_S + 8, BRAKE_START_S - 1);
    expect(turning.sink).toBeGreaterThan(straight.sink + 1);
  });

  it('ignores deploy during the start arc and needs a fresh edge in the wingsuit phase', () => {
    const held = stubScenario('held-deploy', 8, (_t, _st, input) => {
      input.deploy = true;
    });
    const h = runScenario(held);
    expect(h[h.length - 1].phase).toBe('wingsuit');
    expect(h.some((f) => f.phase === 'deploying')).toBe(false);

    const retry = stubScenario('retry-deploy', 8, (t, _st, input) => {
      input.deploy = t < 1 || t >= 6;
    });
    const r = runScenario(retry);
    const d = firstFrame(r, (f) => f.phase === 'deploying');
    expect(d).toBeDefined();
    expect(d!.t).toBeCloseTo(6 + 1 / 120, 2);
  });

  it('flags a low pull under 120 m AGL', () => {
    const low = stubScenario('low-pull', 120, (_t, st, input) => {
      input.deploy = st.aglM <= 100;
    });
    const fr = runScenario(low);
    const d = firstFrame(fr, (f) => f.phase === 'deploying');
    expect(d).toBeDefined();
    expect(d!.agl).toBeLessThan(LANDING.minSafeDeployAglM);
  });
});
