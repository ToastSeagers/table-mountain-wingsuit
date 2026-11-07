import { describe, expect, it } from 'vitest';
import { STUB_BEACH, STUB_SHORE_X, StubTerrain } from './stub-terrain';

describe('StubTerrain', () => {
  const t = new StubTerrain();

  it('is the table top, a 700 m drop, a 15 degree slope and the sea', () => {
    expect(t.heightAt(-1, 0)).toBe(1050);
    expect(t.heightAt(-2000, 500)).toBe(1050);
    expect(t.heightAt(0, 0)).toBe(350);
    expect(t.heightAt(650, 0)).toBeCloseTo(350 - 650 * Math.tan((15 * Math.PI) / 180), 6);
    expect(STUB_SHORE_X).toBeGreaterThan(1290);
    expect(STUB_SHORE_X).toBeLessThan(1320);
    expect(t.heightAt(STUB_SHORE_X + 1, 0)).toBe(0);
    expect(t.heightAt(3000, 0)).toBe(0);
    expect(STUB_BEACH.minX).toBe(2900);
    expect(STUB_BEACH.maxX).toBe(3100);
  });

  it('normals point up on the flats and down-slope on the face', () => {
    expect(t.normalAt(-10, 0)).toEqual({ x: 0, y: 1, z: 0 });
    expect(t.normalAt(3000, 0)).toEqual({ x: 0, y: 1, z: 0 });
    const n = t.normalAt(600, 0);
    expect(n.x).toBeGreaterThan(0);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 9);
    expect(n.y).toBeCloseTo(Math.cos((15 * Math.PI) / 180), 9);
  });

  it('returns sea level outside its bounds, per the TerrainSampler contract', () => {
    expect(t.heightAt(-5000, 0)).toBe(0);
    expect(t.heightAt(0, 5000)).toBe(0);
    expect(t.isReady()).toBe(true);
  });
});
