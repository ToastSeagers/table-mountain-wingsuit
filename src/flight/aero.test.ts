import { describe, expect, it } from 'vitest';
import {
  alphaForGlide,
  areaRamp,
  controlAuthority,
  dragCoefficient,
  equilibriumSpeedForGlide,
  liftCoefficient,
  mushFactor,
} from './aero';
import { WINGSUIT as W } from './tuning';

describe('lift curve', () => {
  it('is linear between the negative and positive stall', () => {
    expect(liftCoefficient(W.zeroLiftAlphaDeg)).toBeCloseTo(0, 9);
    expect(liftCoefficient(W.trimAlphaDeg)).toBeCloseTo(W.trimCl, 2);
    expect(liftCoefficient(W.stallAlphaDeg)).toBeCloseTo(
      W.clSlopePerDeg * (W.stallAlphaDeg - W.zeroLiftAlphaDeg),
      9,
    );
  });

  it('stalls softly and reaches zero lift at 90 degrees', () => {
    const atStall = liftCoefficient(W.stallAlphaDeg);
    let prev = atStall;
    for (let a = W.stallAlphaDeg + 1; a <= 90; a++) {
      const cl = liftCoefficient(a);
      expect(cl).toBeLessThanOrEqual(prev + 1e-9);
      prev = cl;
    }
    expect(liftCoefficient(30)).toBeGreaterThan(0.4 * atStall);
    expect(liftCoefficient(90)).toBeCloseTo(0, 6);
  });

  it('is continuous across both stalls', () => {
    expect(liftCoefficient(W.stallAlphaDeg + 1e-6)).toBeCloseTo(
      liftCoefficient(W.stallAlphaDeg),
      4,
    );
    expect(liftCoefficient(W.negStallAlphaDeg - 1e-6)).toBeCloseTo(
      liftCoefficient(W.negStallAlphaDeg),
      4,
    );
  });
});

describe('drag polar', () => {
  it('gives the trim anchor: glide 3.0 at CL 0.40', () => {
    const cl = liftCoefficient(W.trimAlphaDeg);
    const cd = dragCoefficient(W.trimAlphaDeg, cl, 0, 0, 45);
    expect(cl / cd).toBeGreaterThan(2.9);
    expect(cl / cd).toBeLessThan(3.1);
  });

  it('peaks between glide 3.2 and 3.6 and falls off past the stall', () => {
    let best = 0;
    let bestAlpha = 0;
    for (let a = -5; a <= 30; a += 0.25) {
      const cl = liftCoefficient(a);
      const ld = cl / dragCoefficient(a, cl, 0, 0, 40);
      if (ld > best) {
        best = ld;
        bestAlpha = a;
      }
    }
    expect(best).toBeGreaterThan(3.2);
    expect(best).toBeLessThan(3.6);
    expect(bestAlpha).toBeGreaterThan(W.trimAlphaDeg);
    const clStall = liftCoefficient(25);
    expect(clStall / dragCoefficient(25, clStall, 0, 0, 40)).toBeLessThan(2);
  });

  it('adds drag for sideslip, mush and high speed', () => {
    const cl = liftCoefficient(W.trimAlphaDeg);
    const base = dragCoefficient(W.trimAlphaDeg, cl, 0, 0, 45);
    expect(dragCoefficient(W.trimAlphaDeg, cl, 20, 0, 45)).toBeGreaterThan(base);
    expect(dragCoefficient(W.trimAlphaDeg, cl, 0, 1, 45)).toBeCloseTo(base + W.mushDragCd, 9);
    expect(dragCoefficient(W.trimAlphaDeg, cl, 0, 0, 78)).toBeGreaterThan(base + 0.1);
    expect(dragCoefficient(W.trimAlphaDeg, cl, 0, 0, W.fastDragOnsetMps)).toBeCloseTo(base, 9);
  });
});

describe('control authority, mush, area ramp', () => {
  it('authority is clamp(v / vTrim, 0.3, 1.2)^2', () => {
    expect(controlAuthority(45)).toBeCloseTo(1, 9);
    expect(controlAuthority(30)).toBeCloseTo((30 / 45) ** 2, 9);
    expect(controlAuthority(5)).toBeCloseTo(0.09, 9);
    expect(controlAuthority(90)).toBeCloseTo(1.44, 9);
  });

  it('mush is 0 at and above the onset and 1 at the full-mush speed', () => {
    expect(mushFactor(W.mushOnsetMps)).toBe(0);
    expect(mushFactor(40)).toBe(0);
    expect(mushFactor(W.mushFullMps)).toBe(1);
    expect(mushFactor((W.mushOnsetMps + W.mushFullMps) / 2)).toBeCloseTo(0.5, 9);
  });

  it('area ramps 0.3 -> 1.0 over 3 s and is gated by airspeed', () => {
    expect(areaRamp(0, 0)).toBeCloseTo(W.areaRampStart, 9);
    expect(areaRamp(3, 40)).toBeCloseTo(1, 9);
    expect(areaRamp(5, 10)).toBeLessThan(0.7);
    expect(areaRamp(1.5, 40)).toBeCloseTo(W.areaRampStart + 0.7 * 0.5, 9);
  });

  it('inverts the polar for the pilot feed-forward', () => {
    expect(alphaForGlide(3)).toBeCloseTo(W.trimAlphaDeg, 1);
    expect(equilibriumSpeedForGlide(3)).toBeCloseTo(45, 0);
    expect(alphaForGlide(10)).toBeGreaterThan(alphaForGlide(3));
    expect(alphaForGlide(0.3)).toBeLessThan(0);
  });
});
