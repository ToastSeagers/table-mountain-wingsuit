import { describe, expect, it } from 'vitest';
import { OPENING } from '../flight/tuning';
import { trimAttitudeDeg } from '../flight/aero';
import {
  CanopyStateFilter,
  defaultCue,
  inflationCurve,
  MotionCueEstimator,
  PilotPoseFilter,
  pilotPoseTarget,
  type AvatarCue,
} from './avatarPose';

const DEG = Math.PI / 180;

function cue(patch: Partial<AvatarCue>): AvatarCue {
  return { ...defaultCue(), ...patch };
}

describe('pilot pose', () => {
  it('is prone in the suit with the arms a little back and the head up', () => {
    const p = pilotPoseTarget(cue({}));
    expect(p.hang).toBe(0);
    expect(p.armSweep).toBeGreaterThan(0);
    expect(p.armSweep).toBeLessThan(20 * DEG);
    expect(p.headPitch).toBeGreaterThan(40 * DEG);
    expect(p.armRaise).toBe(0);
  });

  it('sweeps the arms back and brings the legs together in a dive, forward on a pull', () => {
    const level = pilotPoseTarget(cue({}));
    const dive = pilotPoseTarget(cue({ pitchInput: -1 }));
    const pull = pilotPoseTarget(cue({ pitchInput: 1 }));
    expect(dive.armSweep).toBeGreaterThan(level.armSweep + 20 * DEG);
    expect(dive.legSpread).toBeLessThan(level.legSpread);
    expect(pull.armSweep).toBeLessThan(level.armSweep);
  });

  it('dips the inside wing and leans the body into a bank', () => {
    const right = pilotPoseTarget(cue({ bankDeg: 45 }));
    expect(right.dihedralR).toBeLessThan(-8 * DEG);
    expect(right.dihedralL).toBeGreaterThan(0);
    expect(right.bodyRoll).toBeGreaterThan(0);
    const left = pilotPoseTarget(cue({ bankDeg: -45 }));
    expect(left.dihedralL).toBeLessThan(-8 * DEG);
    expect(left.bodyRoll).toBeLessThan(0);
    // The stick anticipates the bank a little.
    expect(pilotPoseTarget(cue({ rollInput: 1 })).dihedralR).toBeLessThan(0);
  });

  it('flutter grows with speed and vanishes under canopy', () => {
    expect(pilotPoseTarget(cue({ airspeedMps: 20 })).flutterAmp).toBe(0);
    const slow = pilotPoseTarget(cue({ airspeedMps: 40 })).flutterAmp;
    const fast = pilotPoseTarget(cue({ airspeedMps: 70 })).flutterAmp;
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(pilotPoseTarget(cue({ phase: 'canopy', airspeedMps: 12 })).flutterAmp).toBe(0);
  });

  it('hangs upright under canopy with the hands at the toggles, pulled down to flare', () => {
    const hang = pilotPoseTarget(cue({ phase: 'canopy', airspeedMps: 12 }));
    expect(hang.hang).toBe(1);
    expect(hang.armRaise).toBe(1);
    expect(hang.kneeBend).toBeGreaterThan(0);
    expect(hang.dihedralL).toBe(0);
    const flare = pilotPoseTarget(cue({ phase: 'canopy', flare: true, brakeDeflection: 1 }));
    expect(flare.armRaise).toBeLessThan(0.3);
    const brake = pilotPoseTarget(cue({ phase: 'canopy', brakeDeflection: 0.55 }));
    expect(brake.armRaise).toBeGreaterThan(flare.armRaise);
    expect(brake.armRaise).toBeLessThan(hang.armRaise);
  });

  it('swings up during the opening as the progress passes the snivel', () => {
    expect(pilotPoseTarget(cue({ phase: 'deploying', openingProgress: 0.05 })).hang).toBe(0);
    const mid = pilotPoseTarget(cue({ phase: 'deploying', openingProgress: 0.5 })).hang;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
    expect(pilotPoseTarget(cue({ phase: 'deploying', openingProgress: 0.95 })).hang).toBe(1);
  });

  it('the filter approaches the target smoothly and advances the flutter phase with speed', () => {
    const f = new PilotPoseFilter();
    f.reset(cue({}));
    const target = pilotPoseTarget(cue({ pitchInput: -1 }));
    f.update(cue({ pitchInput: -1 }), 1 / 60);
    expect(f.pose.armSweep).toBeGreaterThan(neutralSweep());
    expect(f.pose.armSweep).toBeLessThan(target.armSweep);
    for (let i = 0; i < 120; i++) f.update(cue({ pitchInput: -1 }), 1 / 60);
    expect(f.pose.armSweep).toBeCloseTo(target.armSweep, 2);
    const phaseBefore = f.pose.flutterPhase;
    f.update(cue({ pitchInput: -1 }), 1 / 60);
    expect(f.pose.flutterPhase).not.toBe(phaseBefore);
  });
});

function neutralSweep(): number {
  return pilotPoseTarget(cue({})).armSweep;
}

describe('canopy state', () => {
  it('opening curve: lines pay out first, cells stay small through the snivel, then snap', () => {
    const snivelEnd = OPENING.snivelS / OPENING.durationS;
    expect(inflationCurve(0).lineExtension).toBe(0);
    expect(inflationCurve(0.25).lineExtension).toBeCloseTo(1, 5);
    expect(inflationCurve(snivelEnd * 0.9).inflation).toBeLessThan(0.15);
    expect(inflationCurve(snivelEnd * 0.9).spanScale).toBeLessThan(0.35);
    expect(inflationCurve(0.85).inflation).toBeGreaterThan(0.95);
    expect(inflationCurve(0.85).spanScale).toBeGreaterThan(0.95);
    expect(inflationCurve(1).spanScale).toBeCloseTo(1, 5);
    expect(inflationCurve(1).inflation).toBe(1);
    let prev = -1;
    for (let p = 0; p <= 1; p += 0.02) {
      const i = inflationCurve(p).inflation;
      expect(i).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = i;
    }
  });

  it('is hidden in the suit, starts behind the pilot at deploy and swings overhead', () => {
    const f = new CanopyStateFilter();
    expect(f.update(cue({}), 1 / 60).visible).toBe(false);
    const first = f.update(cue({ phase: 'deploying', openingProgress: 0.01, gLoad: 1 }), 1 / 60);
    expect(first.visible).toBe(true);
    expect(first.swingPitch).toBeLessThan(-0.3);
    let s = first;
    for (let i = 0; i < 60 * 12; i++)
      s = f.update(cue({ phase: 'canopy', gLoad: 1, airspeedMps: 12 }), 1 / 60);
    expect(Math.abs(s.swingPitch)).toBeLessThan(0.08);
    expect(Math.abs(s.swingRoll)).toBeLessThan(0.05);
    expect(s.inflation).toBe(1);
  });

  it('a load above 1 g swings the pilot forward (canopy pitches back) and rings down', () => {
    const f = new CanopyStateFilter();
    for (let i = 0; i < 60 * 6; i++) f.update(cue({ phase: 'canopy', gLoad: 1 }), 1 / 60);
    let peak = -1;
    for (let i = 0; i < 60 * 2; i++) {
      const s = f.update(
        cue({ phase: 'canopy', gLoad: 1.6, flare: true, brakeDeflection: 1 }),
        1 / 60,
      );
      peak = Math.max(peak, s.swingPitch);
    }
    expect(peak).toBeGreaterThan(0.08);
    expect(f.state.tailDeflection).toBeGreaterThan(0.9);
  });

  it('the tail deflection follows the brakes with a toggle lag', () => {
    const f = new CanopyStateFilter();
    for (let i = 0; i < 60; i++) f.update(cue({ phase: 'canopy' }), 1 / 60);
    const first = f.update(cue({ phase: 'canopy', brakeDeflection: 1 }), 1 / 60).tailDeflection;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);
    for (let i = 0; i < 90; i++) f.update(cue({ phase: 'canopy', brakeDeflection: 1 }), 1 / 60);
    expect(f.state.tailDeflection).toBeGreaterThan(0.95);
  });

  it('collapses after landing', () => {
    const f = new CanopyStateFilter();
    for (let i = 0; i < 60; i++) f.update(cue({ phase: 'canopy' }), 1 / 60);
    expect(f.update(cue({ phase: 'landed', airspeedMps: 0 }), 1 / 60).collapse).toBeLessThan(0.05);
    for (let i = 0; i < 120; i++) f.update(cue({ phase: 'landed', airspeedMps: 0 }), 1 / 60);
    expect(f.state.collapse).toBeCloseTo(1, 2);
  });
});

describe('motion cue estimator (replays)', () => {
  const level: [number, number, number, number] = [0, 0, 0, 1];
  // Nose-down attitude about X: q = (sin(a/2), 0, 0, cos(a/2)) pitches the nose down for a < 0.
  function pitchQuat(deg: number): { x: number; y: number; z: number; w: number } {
    const a = (deg * DEG) / 2;
    return { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) };
  }

  it('reads a steady glide as 1 g at the right airspeed with a near-zero pitch input', () => {
    const e = new MotionCueEstimator();
    const [x, y, z, w] = level;
    const q = pitchQuat(trimAttitudeDeg());
    let c = e.cue;
    for (let i = 0; i < 90; i++) {
      c = e.update(1 / 30, { x: 42 * (i / 30), y: 1000 - 14 * (i / 30), z: 0 }, q, 'wingsuit', 400);
    }
    expect(c.airspeedMps).toBeCloseTo(Math.hypot(42, 14), 0);
    expect(c.gLoad).toBeCloseTo(1, 1);
    expect(Math.abs(c.pitchInput)).toBeLessThan(0.1);
    expect(c.openingProgress).toBe(0);
    expect({ x, y, z, w }).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('reads a nose-down attitude as a dive input and a bank as a roll input', () => {
    const e = new MotionCueEstimator();
    const c = e.update(
      1 / 30,
      { x: 0, y: 0, z: 0 },
      pitchQuat(trimAttitudeDeg() - 40),
      'wingsuit',
      400,
    );
    expect(c.pitchInput).toBeLessThan(-0.5);
    const a = (40 * DEG) / 2;
    const banked = e.update(
      1 / 30,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -Math.sin(a), w: Math.cos(a) },
      'wingsuit',
      400,
    );
    expect(Math.abs(banked.bankDeg)).toBeCloseTo(40, 0);
    expect(Math.abs(banked.rollInput)).toBeGreaterThan(0.5);
  });

  it('times the opening from the first deploying frame and flares low under canopy', () => {
    const e = new MotionCueEstimator();
    const q = pitchQuat(0);
    e.update(1 / 30, { x: 0, y: 0, z: 0 }, q, 'wingsuit', 300);
    let c = e.update(1 / 30, { x: 1, y: 0, z: 0 }, q, 'deploying', 300);
    expect(c.openingProgress).toBeCloseTo(0, 2);
    for (let i = 0; i < 30 * 1.25; i++)
      c = e.update(1 / 30, { x: 1, y: 0, z: 0 }, q, 'deploying', 300);
    expect(c.openingProgress).toBeCloseTo(0.5, 1);
    c = e.update(1 / 30, { x: 1, y: 0, z: 0 }, q, 'canopy', 200);
    expect(c.openingProgress).toBe(1);
    expect(c.flare).toBe(false);
    c = e.update(1 / 30, { x: 1, y: 0, z: 0 }, q, 'canopy', 3);
    expect(c.flare).toBe(true);
    expect(c.brakeDeflection).toBe(1);
  });
});
