import { describe, expect, it } from 'vitest';
import { HeightTileStore } from './terrain/HeightTileStore';
import { diskFetch, loadFullStore, loadMeta } from './terrain/testFixtures';
import { TileLoader } from './terrain/TileLoader';
import { TerrainSamplerImpl } from './TerrainSamplerImpl';

/** Heights validate.py printed for the same checkpoints (docs/status/stage-1-report.md). */
const VALIDATE_SAMPLED: Record<string, number> = {
  "Maclear's Beacon": 1084.0,
  'Upper cable station': 1064.1,
  "Lion's Head summit": 664.8,
  'Signal Hill summit': 349.6,
  'Camps Bay beach (sea)': 0.0,
  'Sea Point promenade': 6.4,
};

describe('TerrainSamplerImpl on the real tiles', () => {
  it('matches the Stage 1 checkpoints', async () => {
    const store = await loadFullStore();
    const s = new TerrainSamplerImpl(store);
    const cps = (store.meta.json as unknown as { checkpoints: { name: string; x: number; z: number; expectedY: number }[] })
      .checkpoints;
    expect(cps.length).toBe(6);
    for (const cp of cps) {
      const h = s.heightAt(cp.x, cp.z);
      expect(Math.abs(h - VALIDATE_SAMPLED[cp.name]), cp.name).toBeLessThan(1.0);
      expect(Math.abs(h - cp.expectedY), cp.name).toBeLessThan(cp.name.includes('beach') ? 3 : 15);
    }
    expect(s.isReady()).toBe(true);
  });

  it('returns 0 outside the bounds', async () => {
    const store = await loadFullStore();
    const s = new TerrainSamplerImpl(store);
    const b = s.bounds;
    expect(s.heightAt(b.minX - 1, 0)).toBe(0);
    expect(s.heightAt(b.maxX + 1, 0)).toBe(0);
    expect(s.heightAt(0, b.minZ - 1)).toBe(0);
    expect(s.heightAt(0, b.maxZ + 1)).toBe(0);
    // Exactly on the far corner is inside and must not read past the tile.
    expect(Number.isFinite(s.heightAt(b.maxX, b.maxZ))).toBe(true);
  });

  it('is continuous across tile seams', async () => {
    const store = await loadFullStore();
    const s = new TerrainSamplerImpl(store);
    const m = store.meta;
    for (let col = 1; col < m.heightCols; col++) {
      const x = m.bounds.minX + col * m.heightTileSpanM;
      for (let k = 0; k < 50; k++) {
        const z = m.bounds.minZ + 37.3 + k * 197.1;
        expect(Math.abs(s.heightAt(x - 1e-6, z) - s.heightAt(x + 1e-6, z))).toBeLessThan(1e-3);
      }
    }
  });

  it('gives unit, Y-up normals and straight up on the sea', async () => {
    const store = await loadFullStore();
    const s = new TerrainSamplerImpl(store);
    const sea = (store.meta.json as unknown as { checkpoints: { x: number; z: number }[] }).checkpoints[4];
    const n0 = { ...s.normalAt(sea.x, sea.z) };
    expect(n0.y).toBeCloseTo(1, 6);
    for (const [x, z] of [
      [1431.9, 1863.8],
      [-628.2, 865.3],
      [-1930.7, -1664.1],
      [-900, 900],
    ]) {
      const n = s.normalAt(x, z);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
      expect(n.y).toBeGreaterThan(0);
    }
    // A cliff below the cable station faces north (towards -Z).
    let steepest = { y: 1, z: 0 };
    for (let dz = -400; dz <= 0; dz += 10) {
      const n = s.normalAt(-628.2, 865.3 + dz);
      if (n.y < steepest.y) steepest = { y: n.y, z: n.z };
    }
    expect(steepest.y).toBeLessThan(0.6);
    expect(steepest.z).toBeLessThan(0);
  });

  it('falls back to 0 m, requests the tile and reports not ready until it arrives', async () => {
    const meta = await loadMeta();
    const store = new HeightTileStore(meta);
    const loader = new TileLoader(meta, store, { fetch: diskFetch() });
    const requested: string[] = [];
    const s = new TerrainSamplerImpl(store, (col, row) => {
      requested.push(`${col}_${row}`);
      void loader.requestHeight(col, row);
    });
    expect(s.isReady()).toBe(false);
    const x = 1431.9;
    const z = 1863.8;
    expect(s.heightAt(x, z)).toBe(0);
    expect(s.isReady()).toBe(false);
    expect(requested).toContain('2_2');
    // Load everything within the ready radius of the query.
    await Promise.all(meta.heightTilesInRadius(x, z, 1500).map((t) => loader.requestHeight(t.col, t.row)));
    expect(s.isReady()).toBe(true);
    expect(s.heightAt(x, z)).toBeGreaterThan(1000);
    // peekHeight does not move the readiness focus.
    s.peekHeight(-5000, 4000);
    expect(s.isReady()).toBe(true);
    s.heightAt(-5000, 4000);
    expect(s.isReady()).toBe(false);
  });
});
