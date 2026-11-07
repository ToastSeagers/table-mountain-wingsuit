import { describe, expect, it } from 'vitest';
import {
  pitch,
  PITCH_START_S,
  roll,
  ROLL_START_S,
  yaw,
  YAW_START_S,
} from '../../tools/scenarios/roll';
import { firstDownCrossing, frameAt, meanRate, peakRate } from './metrics';
import { runScenario, stubScenario } from './scripting';

// Spec section 7 "roll": full roll at trim gives 100 to 150 deg/s; at 30 m/s under 75 deg/s.
// Spec table: pitch rate at trim 45 deg/s (35 to 60); yaw authority low.
describe('control rates', () => {
  it('rolls at 100 to 150 deg/s at trim', () => {
    const frames = runScenario(roll);
    expect(frameAt(frames, ROLL_START_S).airspeed).toBeGreaterThan(42);
    const rate = peakRate(frames, 'bank', ROLL_START_S, ROLL_START_S + 0.5);
    expect(rate).toBeGreaterThanOrEqual(100);
    expect(rate).toBeLessThanOrEqual(150);
    // Released, the suit levels itself again.
    expect(Math.abs(frameAt(frames, ROLL_START_S + 1).bank)).toBeGreaterThan(30);
    const last = frames[frames.length - 1];
    expect(Math.abs(last.bank)).toBeLessThan(Math.abs(frameAt(frames, ROLL_START_S + 1).bank));
  });

  it('rolls under 75 deg/s at 30 m/s', () => {
    const slow = stubScenario('slow-roll', 30, (t, st, input) => {
      if (t >= 10) input.pitch = 1;
      if (t >= 10 && st.airspeedMps <= 30) input.roll = 1;
    });
    const frames = runScenario(slow);
    const start = firstDownCrossing(frames, 'airspeed', 30, 10);
    expect(start).toBeDefined();
    const rate = peakRate(frames, 'bank', start!.t, start!.t + 0.5);
    expect(rate).toBeGreaterThan(10);
    expect(rate).toBeLessThan(75);
  });

  it('pitches at 35 to 60 deg/s at trim', () => {
    const frames = runScenario(pitch);
    const rate = peakRate(frames, 'pitch', PITCH_START_S, PITCH_START_S + 0.5);
    expect(rate).toBeGreaterThanOrEqual(35);
    expect(rate).toBeLessThanOrEqual(60);
  });

  it('direct yaw is only a nudge', () => {
    const frames = runScenario(yaw);
    const rate = meanRate(frames, 'heading', YAW_START_S + 1, YAW_START_S + 3);
    expect(Math.abs(rate)).toBeGreaterThan(0.5);
    expect(Math.abs(rate)).toBeLessThan(20);
  });

  it('a held bank turns the suit (coordinated through the lift vector)', () => {
    const turn = stubScenario('turn', 20, (t, _st, input) => {
      if (t >= 14 && t < 14.5) input.roll = 1;
      if (t >= 14.5) input.roll = 0.15;
    });
    const frames = runScenario(turn);
    const h0 = frameAt(frames, 14).heading;
    const h1 = frameAt(frames, 19).heading;
    expect(h1 - h0).toBeGreaterThan(20);
    expect(Math.abs(frameAt(frames, 19).bank)).toBeGreaterThan(10);
  });
});
