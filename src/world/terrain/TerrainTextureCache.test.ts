import type { WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightTileStore } from './HeightTileStore';
import { TerrainTextureCache, UPLOADS_PER_FRAME } from './TerrainTextureCache';
import { diskFetch, loadMeta } from './testFixtures';
import { TileLoader } from './TileLoader';

const fakeDecode = async (): Promise<ImageBitmap> =>
  ({ width: 1024, height: 1024, close: () => undefined }) as unknown as ImageBitmap;

function fakeRenderer(): WebGLRenderer & { uploads: number } {
  const r = { uploads: 0, initTexture: () => void r.uploads++ };
  return r as unknown as WebGLRenderer & { uploads: number };
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function setup(maxResident: number) {
  const meta = await loadMeta();
  const loader = new TileLoader(meta, new HeightTileStore(meta), { fetch: diskFetch(), decodeImage: fakeDecode });
  return { meta, cache: new TerrainTextureCache(meta, loader, maxResident), renderer: fakeRenderer() };
}

describe('TerrainTextureCache', () => {
  it('uploads at most two tiles per frame and evicts the least recently wanted above the cap', async () => {
    const { cache, renderer } = await setup(4);
    let frame = 0;
    const want = (ids: number[]): Map<number, number> => new Map(ids.map((id, i) => [id, i]));
    cache.update(want([0, 1, 2, 3]), ++frame, frame, renderer);
    await tick(30);
    cache.update(want([0, 1, 2, 3]), ++frame, frame, renderer);
    expect(renderer.uploads).toBe(UPLOADS_PER_FRAME);
    cache.update(want([0, 1, 2, 3]), ++frame, frame, renderer);
    expect(cache.stats.resident).toBe(4);
    // Move on: tiles 10..13 replace the old ones without ever exceeding the cap.
    for (let i = 0; i < 6; i++) {
      cache.update(want([10, 11, 12, 13]), ++frame, frame, renderer);
      await tick(10);
      expect(cache.stats.resident).toBeLessThanOrEqual(4);
    }
    cache.update(want([10, 11, 12, 13]), ++frame, frame, renderer);
    expect([10, 11, 12, 13].every((i) => cache.get(i) !== null)).toBe(true);
    expect(cache.get(0)).toBeNull();
    expect(cache.stats.evicted).toBe(4);
  });

  it('preload resolves only after the tiles are uploaded, and pinned tiles are never evicted', async () => {
    const { meta, cache, renderer } = await setup(3);
    const tiles = [
      { col: 2, row: 3 },
      { col: 3, row: 3 },
    ];
    let done = false;
    const p = cache.preload(tiles).then(() => (done = true));
    await tick(30);
    expect(done).toBe(false); // decoded but not uploaded: update() has not run
    let frame = 0;
    cache.update(new Map(), ++frame, frame, renderer);
    await p;
    expect(done).toBe(true);
    // Flood with other wanted tiles: the pinned pair survives.
    for (let i = 0; i < 8; i++) {
      cache.update(new Map([[40 + (i % 4), 0]]), ++frame, frame, renderer);
      await tick(10);
    }
    expect(cache.get(meta.textureTileIndex(2, 3))).not.toBeNull();
    expect(cache.get(meta.textureTileIndex(3, 3))).not.toBeNull();
    cache.unpin(tiles);
    for (let i = 0; i < 8; i++) {
      cache.update(new Map([[50 + (i % 4), i], [60 + (i % 4), i]]), ++frame, frame, renderer);
      await tick(10);
    }
    expect(cache.get(meta.textureTileIndex(2, 3))).toBeNull();
  });

  it('honours a runtime uploadsPerFrame and reports idle only once every tile is uploaded', async () => {
    const { cache, renderer } = await setup(8);
    let frame = 0;
    const want = new Map([0, 1, 2, 3, 4].map((id, i) => [id, i] as [number, number]));
    expect(cache.isIdle()).toBe(true);
    cache.uploadsPerFrame = 1;
    cache.update(want, ++frame, frame, renderer);
    expect(cache.isIdle()).toBe(false); // requested, still downloading
    await tick(60);
    cache.update(want, ++frame, frame, renderer);
    expect(renderer.uploads).toBe(1);
    expect(cache.isIdle()).toBe(false); // decoded tiles still waiting for their turn
    cache.uploadsPerFrame = 6;
    cache.update(want, ++frame, frame, renderer);
    expect(renderer.uploads).toBe(5);
    expect(cache.isIdle()).toBe(true);
  });

  it('pinned tiles that are also wanted do not use up room twice', async () => {
    const { meta, cache, renderer } = await setup(4);
    const tiles = [
      { col: 2, row: 3 },
      { col: 3, row: 3 },
      { col: 4, row: 3 },
    ];
    const p = cache.preload(tiles);
    await tick(40);
    let frame = 0;
    cache.update(new Map(), ++frame, frame, renderer);
    cache.update(new Map(), ++frame, frame, renderer);
    await p;
    // Three pinned tiles, all wanted again, plus a fourth wanted tile: all four fit under the cap of 4.
    const pinnedIdx = tiles.map((t) => meta.textureTileIndex(t.col, t.row));
    const wanted = new Map<number, number>([...pinnedIdx.map((i, k) => [i, k] as [number, number]), [50, 10]]);
    cache.update(wanted, ++frame, frame, renderer);
    await tick(40);
    cache.update(wanted, ++frame, frame, renderer);
    expect(cache.get(50)).not.toBeNull();
    expect(pinnedIdx.every((i) => cache.get(i) !== null)).toBe(true);
    expect(cache.stats.resident).toBe(4);
    expect(cache.stats.evicted).toBe(0);
  });

  it('unpinAll lets pinned tiles age out and releases a preload that was still waiting', async () => {
    const { meta, cache, renderer } = await setup(2);
    const tiles = [{ col: 2, row: 3 }];
    let done = false;
    void cache.preload(tiles).then(() => (done = true));
    cache.unpinAll(); // before the tile ever uploaded
    await tick(5);
    expect(done).toBe(true);
    let frame = 0;
    for (let i = 0; i < 8; i++) {
      cache.update(new Map([[40 + (i % 3), i], [50 + (i % 3), i], [60 + (i % 3), i]]), ++frame, frame, renderer);
      await tick(10);
    }
    expect(cache.get(meta.textureTileIndex(2, 3))).toBeNull();
    expect(cache.stats.resident).toBeLessThanOrEqual(2);
  });
});
