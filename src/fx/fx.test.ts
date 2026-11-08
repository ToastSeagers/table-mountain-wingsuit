import { describe, expect, it } from 'vitest';
import { CameraRig } from '../game/CameraRig';
import type { ReplayFrame } from '../types/game';
import { introEase } from './CameraEffects';
import { ReplayDirector } from './ReplayDirector';

function track(): ReplayFrame[] {
  const f: ReplayFrame[] = [];
  for (let i = 0; i <= 90 * 30; i += 1) {
    const t = i / 30;
    const phase = t < 60 ? 'wingsuit' : t < 85 ? 'canopy' : 'landed';
    // A descent with two low passes (clearance dips at 20 s and 40 s) over flat ground at y=0.
    const y =
      300 -
      t * 3 +
      150 * Math.exp(-((t - 20) ** 2) / 20) * -1 +
      120 * Math.exp(-((t - 40) ** 2) / 20) * -1;
    f.push({ t, p: { x: t * 30, y: Math.max(2, y), z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, phase });
  }
  return f;
}

describe('ReplayDirector', () => {
  const rig = new CameraRig(() => 0);
  const d = new ReplayDirector(track(), rig, () => 0);

  it('covers the whole run with contiguous shots ending in the landing', () => {
    expect(d.shots[0].t0).toBe(0);
    for (let i = 1; i < d.shots.length; i++)
      expect(d.shots[i].t0).toBeCloseTo(d.shots[i - 1].t1, 5);
    expect(d.shots[d.shots.length - 1].kind).toBe('landing');
    expect(d.shots.some((s) => s.kind === 'canopy')).toBe(true);
  });

  it('puts ground cams at the closest approaches, on the ground', () => {
    const ground = d.shots.filter((s) => s.kind === 'ground');
    expect(ground.length).toBeGreaterThanOrEqual(2);
    expect(ground.length).toBeLessThanOrEqual(3);
    for (const g of ground) expect(g.anchor?.y).toBeCloseTo(2, 5);
  });

  it('cuts on a rhythm: no wingsuit shot is longer than 6 s', () => {
    for (const s of d.shots.filter((x) => x.kind === 'chase' || x.kind === 'side'))
      expect(s.t1 - s.t0).toBeLessThan(9);
  });

  it('skips to the next shot start', () => {
    const t = d.nextShotStart(1);
    expect(t).toBeGreaterThan(1);
    expect(d.shots.some((s) => Math.abs(s.t0 - t) < 1e-9)).toBe(true);
  });
});

describe('introEase', () => {
  it('maps 0..1 monotonically onto 0..1', () => {
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const v = introEase(u);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(introEase(0)).toBe(0);
    expect(introEase(1)).toBeCloseTo(1, 10);
  });
});
