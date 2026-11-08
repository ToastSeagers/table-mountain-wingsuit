import { describe, expect, it } from 'vitest';
import { CAM, CameraRig, forwardOf, type CameraSubject } from './CameraRig';

const flat = (): number => 0;

function subject(over: Partial<CameraSubject> = {}): CameraSubject {
  // Heading 90 (east): forward is +X. Quaternion about +Y by -90 degrees.
  const a = -Math.PI / 4;
  return {
    position: { x: 0, y: 500, z: 0 },
    velocity: { x: 42, y: -14, z: 0 },
    orientation: { x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) },
    airspeedMps: 44,
    aglM: 500,
    gLoad: 1,
    bankDeg: 0,
    phase: 'wingsuit',
    ...over,
  };
}

function settle(rig: CameraRig, s: CameraSubject, mode: Parameters<CameraRig['update']>[1] = 'chase', seconds = 3): void {
  for (let i = 0; i < seconds * 60; i++) rig.update(1 / 60, mode, s);
}

describe('CameraRig', () => {
  it('derives forward from the quaternion the way the flight model does', () => {
    const f = forwardOf(subject().orientation, { x: 0, y: 0, z: 0 });
    expect(f.x).toBeCloseTo(1, 6);
    expect(f.z).toBeCloseTo(0, 6);
  });

  it('chases behind and above the pilot, looking ahead', () => {
    const rig = new CameraRig(flat);
    rig.shakeEnabled = false;
    const s = subject();
    rig.reset(s);
    settle(rig, s);
    expect(rig.pose.position.x).toBeLessThan(-6);
    expect(rig.pose.position.y).toBeGreaterThan(s.position.y);
    expect(rig.pose.target.x).toBeGreaterThan(5);
  });

  it('stretches the FOV from 70 at trim to 85 at the fastest dive', () => {
    const rig = new CameraRig(flat);
    rig.shakeEnabled = false;
    const trim = subject({ airspeedMps: CAM.trimSpeedMps });
    rig.reset(trim);
    settle(rig, trim);
    expect(rig.pose.fovDeg).toBeCloseTo(70, 0);
    const fast = subject({ airspeedMps: CAM.maxSpeedMps });
    settle(rig, fast, 'chase', 6);
    expect(rig.pose.fovDeg).toBeCloseTo(85, 0);
  });

  it('lags the pilot by roughly the spec half-second window and catches up', () => {
    const rig = new CameraRig(flat);
    rig.shakeEnabled = false;
    const s = subject();
    rig.reset(s);
    settle(rig, s);
    const before = rig.pose.position.z;
    s.position = { x: 0, y: 500, z: 40 }; // sidestep 40 m
    rig.update(1 / 60, 'chase', s);
    expect(Math.abs(rig.pose.position.z - before)).toBeLessThan(5); // not a snap
    settle(rig, s, 'chase', 3);
    expect(rig.pose.position.z).toBeGreaterThan(35);
  });

  it('keeps the camera above the ground', () => {
    const rig = new CameraRig((x) => (x < 0 ? 600 : 0));
    rig.shakeEnabled = false;
    const s = subject({ position: { x: 5, y: 500, z: 0 } });
    rig.reset(s);
    settle(rig, s);
    expect(rig.pose.position.y).toBeGreaterThanOrEqual(600 + CAM.groundClearanceM - 1e-6);
  });

  it('shakes only above 60 m/s, and can be switched off', () => {
    const quiet = new CameraRig(flat);
    const s = subject({ airspeedMps: 50 });
    quiet.reset(s);
    const a = quiet.update(1 / 60, 'chase', s).position.y;
    const b = quiet.update(1 / 60, 'chase', s).position.y;
    expect(b).toBeCloseTo(a, 6);
    const fast = subject({ airspeedMps: 74 });
    const rig = new CameraRig(flat);
    rig.reset(fast);
    const ys = new Set<number>();
    for (let i = 0; i < 20; i++) ys.add(Math.round(rig.update(1 / 60, 'chase', fast).position.y * 1e4));
    expect(ys.size).toBeGreaterThan(5);
    rig.shakeEnabled = false;
    settle(rig, fast, 'chase', 3);
    const y1 = rig.update(1 / 60, 'chase', fast).position.y;
    const y2 = rig.update(1 / 60, 'chase', fast).position.y;
    expect(Math.abs(y1 - y2)).toBeLessThan(0.01);
  });

  it('puts the landing cam on the ground ahead of the pilot', () => {
    const rig = new CameraRig(flat);
    rig.shakeEnabled = false;
    const s = subject({ position: { x: 0, y: 2, z: 0 }, velocity: { x: 10, y: 0, z: 0 }, phase: 'landed', airspeedMps: 0 });
    rig.reset(s);
    settle(rig, s, 'landing', 3);
    expect(rig.pose.position.x).toBeGreaterThan(30);
    expect(rig.pose.position.y).toBeLessThan(CAM.landingEyeM + CAM.groundClearanceM + 0.5);
    expect(rig.pose.fovDeg).toBeLessThan(60);
  });

  it('ends the intro flyover exactly on the chase start pose', () => {
    const rig = new CameraRig(flat);
    const exit = { x: 100, y: 1000, z: 200 };
    const end = CameraRig.startPose(exit, 265);
    const pose = rig.introPose(1, exit, 265, [
      { x: 700, y: 1300, z: 0 },
      { x: 300, y: 1100, z: 100 },
    ]);
    expect(pose.position.x).toBeCloseTo(end.position.x, 3);
    expect(pose.position.y).toBeCloseTo(end.position.y, 3);
    expect(pose.target.x).toBeCloseTo(end.target.x, 3);
    expect(pose.fovDeg).toBeCloseTo(70, 3);
    const start = rig.introPose(0, exit, 265, [{ x: 700, y: 1300, z: 0 }]);
    expect(start.position.x).toBeCloseTo(700, 3);
  });

  it('flies an intro with no authored path from a generated start', () => {
    const rig = new CameraRig(flat);
    const p = rig.introPose(0.5, { x: 0, y: 1000, z: 0 }, 90, []);
    expect(Number.isFinite(p.position.x + p.position.y + p.position.z)).toBe(true);
  });
});
