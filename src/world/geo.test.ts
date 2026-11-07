import { describe, expect, it } from 'vitest';
import checkpoints from '../../data/checkpoints.json';
import { latLonToWorld, worldToLatLon } from './geo';

// Self-consistency test: elevations are not checked here (Stage 1 validates the DEM).
describe('geo frame', () => {
  it('maps the origin to (0, 0, 0)', () => {
    const o = latLonToWorld(checkpoints.origin.lat, checkpoints.origin.lon);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.y).toBe(0);
    expect(o.z).toBeCloseTo(0, 6);
  });

  it('puts north at negative Z and east at positive X', () => {
    expect(latLonToWorld(-33.94, 18.41).z).toBeLessThan(0);
    expect(latLonToWorld(-33.95, 18.42).x).toBeGreaterThan(0);
  });

  for (const pt of checkpoints.points) {
    it(`${pt.name}: matches the formula and round-trips within 2 m`, () => {
      const w = latLonToWorld(pt.lat, pt.lon, pt.expectedY);
      expect(Math.abs(w.x - (pt.lon - 18.41) * 92_380)).toBeLessThan(2);
      expect(Math.abs(w.z - -(pt.lat - -33.95) * 110_940)).toBeLessThan(2);
      expect(w.y).toBe(pt.expectedY);

      const back = worldToLatLon(w);
      const rt = latLonToWorld(back.lat, back.lon, back.elevationM);
      expect(Math.hypot(rt.x - w.x, rt.z - w.z)).toBeLessThan(2);
    });
  }
});
