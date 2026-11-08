import { describe, expect, it } from 'vitest';
import { HeightTileStore } from './HeightTileStore';
import { diskFetch, loadMeta } from './testFixtures';
import { PRIORITY_URGENT, TileAbortedError, TileLoader } from './TileLoader';

const fakeDecode = async (blob: Blob): Promise<ImageBitmap> =>
  ({ width: 1024, height: 1024, close: () => undefined, size: blob.size }) as unknown as ImageBitmap;

describe('TileLoader', () => {
  it('fetches height tiles nearest the focus first, four at a time', async () => {
    const meta = await loadMeta();
    const store = new HeightTileStore(meta);
    const fetch = diskFetch({ delayMs: 5 });
    const loader = new TileLoader(meta, store, { fetch });
    loader.setFocus(1431.9, 1863.8); // Maclear's Beacon, in tile 2_2
    const all = loader.requestAllHeights();
    await Promise.resolve(); // work starts on the next microtask, after the batch is ordered
    expect(loader.stats.running).toBe(4);
    expect(fetch.urls[0]).toBe('/terrain/h/2_2.bin');
    // The rest are queued in distance order.
    const order = loader.queuedKeys();
    const dist = order.map((k) => {
      const [col, row] = k.slice(2).split('_').map(Number);
      const r = meta.heightTileRect(col, row);
      return Math.hypot(Math.max(r.minX - 1431.9, 0, 1431.9 - r.maxX), Math.max(r.minZ - 1863.8, 0, 1863.8 - r.maxZ));
    });
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeGreaterThanOrEqual(dist[i - 1]);
    await all;
    expect(store.allLoaded).toBe(true);
    expect(fetch.urls.filter((u) => u.includes('/h/'))).toHaveLength(20);
    expect(loader.stats.bytesFetched).toBe(20 * 512 * 512 * 2);
  });

  it('de-duplicates requests and lets urgent ones jump the queue', async () => {
    const meta = await loadMeta();
    const store = new HeightTileStore(meta);
    const fetch = diskFetch({ delayMs: 5 });
    const loader = new TileLoader(meta, store, { fetch }, { maxConcurrent: 1 });
    loader.setFocus(-5000, -5000);
    void loader.requestAllHeights();
    const p1 = loader.requestHeight(4, 3, PRIORITY_URGENT);
    const p2 = loader.requestHeight(4, 3);
    expect(loader.queuedKeys()[0]).toBe('h/4_3');
    await Promise.all([p1, p2]);
    expect(fetch.urls.filter((u) => u.endsWith('4_3.bin'))).toHaveLength(1);
    // Already loaded: resolves without fetching.
    await loader.requestHeight(4, 3);
    expect(fetch.urls.filter((u) => u.endsWith('4_3.bin'))).toHaveLength(1);
  });

  it('cancels texture requests that leave the wanted set (queued and in flight)', async () => {
    const meta = await loadMeta();
    const store = new HeightTileStore(meta);
    const fetch = diskFetch({ delayMs: 30 });
    const loader = new TileLoader(meta, store, { fetch, decodeImage: fakeDecode }, { maxConcurrent: 2 });
    const results = new Map<number, string>();
    const ids = [0, 1, 2, 3, 4, 5];
    for (const i of ids) {
      loader.requestTexture(i, 0, i).then(
        () => results.set(i, 'ok'),
        (e: unknown) => results.set(i, e instanceof TileAbortedError ? 'aborted' : 'error'),
      );
    }
    await Promise.resolve();
    expect(loader.stats.running).toBe(2); // tiles 0 and 1 in flight, 2..5 queued
    loader.retainTextures(new Set([meta.textureTileIndex(0, 0), meta.textureTileIndex(4, 0)]));
    await new Promise((r) => setTimeout(r, 120));
    expect(results.get(0)).toBe('ok');
    expect(results.get(4)).toBe('ok');
    for (const i of [1, 2, 3, 5]) expect(results.get(i), `tile ${i}`).toBe('aborted');
    expect(loader.stats.texturesAborted).toBe(4);
    // Aborted in-flight fetches never reach the decoder or count as fetched.
    expect(loader.stats.texturesFetched).toBe(2);
  });

  it('reports HTTP failures without wedging the queue', async () => {
    const meta = await loadMeta();
    const store = new HeightTileStore(meta);
    const loader = new TileLoader(meta, store, { fetch: diskFetch(), decodeImage: fakeDecode });
    await expect(loader.requestTexture(99, 99, 0)).rejects.toThrow(/404/);
    await expect(loader.requestTexture(0, 0, 0)).resolves.toBeDefined();
    expect(loader.stats.running).toBe(0);
  });
});
