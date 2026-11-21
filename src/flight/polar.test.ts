import { describe, expect, it } from 'vitest';
import {
  attitudeCommandDeg,
  bestGlideAlphaDeg,
  groundEffectGain,
  steadyAirspeed,
  steadyAlphaForAttitude,
  steadyGlide,
  trimAttitudeDeg,
} from './aero';
import { frameAt, mean, peak, trough } from './metrics';
import { runScenario, stubScenario } from './scripting';
import { GROUND_EFFECT, WINGSUIT as W } from './tuning';

// Stage 8: the glide ratio is an outcome of the polar and the flight state, not a commanded
// constant. Targets from the brief and docs/research/wingsuit-sims.md: typical 2.5 to 3.0,
// about 3.3 to 3.5 at best-glide speed, 1.5 or less in a full dive, 100 to 180 km/h.

function held(pitch: number, roll = 0, durationS = 40): ReturnType<typeof runScenario> {
  const sc = stubScenario(`held-${pitch}-${roll}`, durationS, (t, _st, input) => {
    if (t >= 10) input.pitch = pitch;
    if (t >= 14 && t < 14.6 && roll) input.roll = Math.sign(roll);
    if (t >= 14.6) input.roll = roll;
  });
  sc.exit = { x: 0, y: 4000, z: 0 };
  return runScenario(sc);
}

describe('the polar', () => {
  it('has a best-glide alpha above trim with L/D 3.3 to 3.6, and a lower L/D either side', () => {
    const a = bestGlideAlphaDeg();
    expect(a).toBeGreaterThan(W.trimAlphaDeg);
    expect(a).toBeLessThan(W.stallAlphaDeg);
    const best = steadyGlide(a);
    expect(best).toBeGreaterThan(3.3);
    expect(best).toBeLessThan(3.6);
    expect(steadyGlide(a - 3)).toBeLessThan(best);
    expect(steadyGlide(a + 3)).toBeLessThan(best);
  });

  it('flies faster at lower alpha, so a faster steady dive has a lower L/D', () => {
    let prevV = Infinity;
    for (let a = -1; a <= W.stallAlphaDeg; a += 1) {
      const v = steadyAirspeed(a);
      expect(v).toBeLessThan(prevV);
      prevV = v;
    }
    expect(steadyGlide(0)).toBeLessThan(steadyGlide(W.trimAlphaDeg));
    expect(steadyAirspeed(0)).toBeGreaterThan(60);
    expect(steadyGlide(-1)).toBeLessThan(1);
  });

  it('has a stall region: L/D collapses past the stall alpha', () => {
    expect(steadyGlide(W.stallAlphaDeg)).toBeLessThan(2.2);
    expect(steadyGlide(W.stallAlphaDeg + 10)).toBeLessThan(steadyGlide(W.stallAlphaDeg));
  });

  it('the attitude table inverts alpha - gamma(alpha) on the fast branch', () => {
    for (const a of [-1, 0, 2, W.trimAlphaDeg, 6]) {
      const theta = a - (Math.atan(1 / steadyGlide(a)) * 180) / Math.PI;
      expect(steadyAlphaForAttitude(theta)).toBeCloseTo(a, 0);
    }
    expect(steadyAlphaForAttitude(trimAttitudeDeg())).toBeCloseTo(W.trimAlphaDeg, 1);
    // Too nose-high for any steady glide: the alpha protection limit.
    expect(steadyAlphaForAttitude(trimAttitudeDeg() + W.pitchUpRangeDeg)).toBe(W.alphaProtectDeg);
  });
});

describe('glide as an outcome of state', () => {
  it('trim settles at the polar glide of the trim alpha (about 3.0) at 100 to 180 km/h', () => {
    const f = held(0);
    expect(mean(f, 'glide', 35, 40)).toBeCloseTo(steadyGlide(W.trimAlphaDeg), 1);
    expect(mean(f, 'alpha', 35, 40)).toBeCloseTo(W.trimAlphaDeg, 0);
    const kmh = mean(f, 'groundSpeed', 35, 40) * 3.6;
    expect(kmh).toBeGreaterThan(100);
    expect(kmh).toBeLessThan(180);
  });

  it('a slight pull reaches the best glide, 3.3 to 3.5, slower than trim', () => {
    let best = { glide: 0, airspeed: 0 };
    for (const p of [0.3, 0.4, 0.5]) {
      const f = held(p);
      const glide = mean(f, 'glide', 35, 40);
      if (glide > best.glide) best = { glide, airspeed: mean(f, 'airspeed', 35, 40) };
    }
    expect(best.glide).toBeGreaterThanOrEqual(3.3);
    expect(best.glide).toBeLessThanOrEqual(3.5);
    expect(best.airspeed).toBeLessThan(40);
    expect(best.airspeed * 3.6).toBeGreaterThan(100);
  });

  it('pitch-forward trades glide for speed: 1.5 or less in a full dive, faster means lower L/D', () => {
    const half = held(-0.5);
    const full = held(-1);
    const quarter = held(-0.25);
    const g = (f: ReturnType<typeof held>) => mean(f, 'glide', 35, 40);
    const v = (f: ReturnType<typeof held>) => mean(f, 'airspeed', 35, 40);
    expect(g(full)).toBeLessThan(1.5);
    expect(g(full)).toBeLessThan(g(half));
    expect(g(half)).toBeLessThan(g(quarter));
    expect(g(quarter)).toBeLessThan(2.8);
    expect(v(full)).toBeGreaterThan(v(half));
    expect(v(half)).toBeGreaterThan(v(quarter));
    expect(v(full)).toBeLessThanOrEqual(80);
  });

  it('bank raises the load factor and the sink rate and lowers the glide', () => {
    const level = held(0);
    const banked = held(0, 0.3);
    expect(Math.abs(mean(banked, 'bank', 25, 30))).toBeGreaterThan(35);
    expect(mean(banked, 'gLoad', 25, 30)).toBeGreaterThan(1.2);
    expect(mean(banked, 'sink', 25, 30)).toBeGreaterThan(mean(level, 'sink', 25, 30) + 1.5);
    expect(mean(banked, 'glide', 25, 30)).toBeLessThan(mean(level, 'glide', 25, 30) - 0.3);
  });

  it('pull-back floats (glide rises, sink falls), then decays into mush', () => {
    const f = held(1, 0, 30);
    const before = frameAt(f, 10);
    const floatPeak = peak(f, 'glide', 10, 20);
    expect(floatPeak.value).toBeGreaterThan(before.glide + 1.5);
    expect(trough(f, 'sink', 10, 20).value).toBeLessThan(before.sink * 0.6);
    // Then speed decays below the mush onset and the sink comes back up.
    const slow = trough(f, 'airspeed', 20, 30);
    expect(slow.value).toBeLessThan(W.mushOnsetMps);
    expect(frameAt(f, slow.t).mush).toBeGreaterThan(0.3);
    expect(frameAt(f, slow.t).sink).toBeGreaterThan(trough(f, 'sink', 10, 20).value + 3);
  });

  it('releasing the stick returns to the trim speed within a few seconds', () => {
    const f = held(0);
    expect(frameAt(f, 30).airspeed).toBeGreaterThan(42);
    expect(frameAt(f, 30).airspeed).toBeLessThan(48);
    expect(attitudeCommandDeg(0, 30)).toBeLessThan(attitudeCommandDeg(0));
    expect(attitudeCommandDeg(0, 60)).toBeGreaterThan(attitudeCommandDeg(0));
    expect(attitudeCommandDeg(1, 30)).toBeCloseTo(attitudeCommandDeg(1), 9);
  });
});

describe('ground effect', () => {
  it('is off by default and would be a capped lift gain under 20 m', () => {
    expect(GROUND_EFFECT.maxLiftGain).toBe(0);
    expect(groundEffectGain(0)).toBe(1);
    expect(groundEffectGain(500)).toBe(1);
  });
});
