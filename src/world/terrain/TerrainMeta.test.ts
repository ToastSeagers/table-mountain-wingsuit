import { describe, expect, it } from 'vitest';
import { apronHeight, APRON_FADE_M, HeightTileStore } from './HeightTileStore';
import { loadFullStore, loadMeta } from './testFixtures';

describe('TerrainMeta index math (public/terrain/meta.json)', () => {
  it('derives the grid from meta.json, not the architecture doc', async () => {
    const m = await loadMeta();
    expect(m.bounds).toEqual({ minX: -5925, maxX: 6850, minZ: -5665, maxZ: 4555 });
    expect(m.cellsPerHeightTile).toBe(511);
    expect(m.samplesX).toBe(5 * 511 + 1);
    expect(m.samplesZ).toBe(4 * 511 + 1);
    expect(m.heightTileSpanM).toBe(2555);
    expect(m.texSpanXM).toBeCloseTo(1277.5, 9);
    expect(m.texSpanZM).toBeCloseTo(1277.5, 9);
    expect(m.heightTileUrl(3, 1)).toBe('/terrain/h/3_1.bin');
    expect(m.textureTileUrl(9, 7)).toBe('/terrain/t/9_7.webp');
    expect(m.overviewUrl).toBe('/terrain/overview.webp');
  });

  it('maps world positions to height tiles, including seams and the far edges', async () => {
    const m = await loadMeta();
    const b = m.bounds;
    expect(m.heightTileAt(b.minX, b.minZ)).toEqual({ col: 0, row: 0 });
    expect(m.heightTileAt(b.maxX, b.maxZ)).toEqual({ col: 4, row: 3 });
    // A seam belongs to the tile on its east / south side; the far edge to the last tile.
    expect(m.heightTileAt(b.minX + 2555, b.minZ)).toEqual({ col: 1, row: 0 });
    expect(m.heightTileAt(b.minX + 2555 - 0.01, b.minZ + 2555 - 0.01)).toEqual({ col: 0, row: 0 });
    // Out of bounds clamps (the sampler checks bounds first).
    expect(m.heightTileAt(b.minX - 100, b.maxZ + 100)).toEqual({ col: 0, row: 3 });
  });

  it('maps world positions to texture tiles: 2 x 2 per height tile', async () => {
    const m = await loadMeta();
    const b = m.bounds;
    expect(m.textureTileAt(b.minX + 1, b.minZ + 1)).toEqual({ col: 0, row: 0 });
    expect(m.textureTileAt(b.minX + 1277.5 + 1, b.minZ + 2555 + 1)).toEqual({ col: 1, row: 2 });
    expect(m.textureTileAt(b.maxX, b.maxZ)).toEqual({ col: 9, row: 7 });
    const r = m.textureTileRect(1, 2);
    expect(r.minX).toBeCloseTo(b.minX + 1277.5, 6);
    expect(r.maxZ).toBeCloseTo(b.minZ + 3 * 1277.5, 6);
  });

  it('round-trips world and sample coordinates', async () => {
    const m = await loadMeta();
    for (const x of [-5925, -1234.5, 0, 6850]) expect(m.worldX(m.sampleX(x))).toBeCloseTo(x, 9);
    for (const z of [-5665, 17.25, 4555]) expect(m.worldZ(m.sampleZ(z))).toBeCloseTo(z, 9);
  });

  it('lists tiles in a radius', async () => {
    const m = await loadMeta();
    expect(m.heightTilesInRadius(0, 0, 1)).toHaveLength(1);
    expect(m.heightTilesInRadius(0, 0, 100_000)).toHaveLength(20);
    expect(m.textureTilesInRadius(0, 0, 100_000)).toHaveLength(80);
  });
});

describe('HeightTileStore', () => {
  it('reads shared seam samples identically from either tile', async () => {
    const store = await loadFullStore();
    const m = store.meta;
    for (let row = 0; row < m.heightRows; row++) {
      for (let col = 0; col < m.heightCols - 1; col++) {
        const a = store.tile(col, row) as Uint16Array;
        const b = store.tile(col + 1, row) as Uint16Array;
        for (let j = 0; j < 512; j += 7) expect(a[j * 512 + 511]).toBe(b[j * 512]);
      }
    }
  });

  it('returns 0 for unloaded tiles and fades the apron to below sea level', async () => {
    const m = await loadMeta();
    const store = new HeightTileStore(m);
    expect(store.sample(1000, 1000)).toBe(0);
    expect(store.sampleLoaded(1000, 1000)).toBe(false);
    expect(apronHeight(500, 0)).toBe(500);
    expect(apronHeight(500, APRON_FADE_M)).toBeLessThan(0);
    expect(apronHeight(500, APRON_FADE_M / 2)).toBeLessThan(500);
  });

  it('rejects tiles of the wrong size', async () => {
    const m = await loadMeta();
    const store = new HeightTileStore(m);
    expect(() => store.setTileBytes(0, 0, new ArrayBuffer(10))).toThrow();
  });
});
