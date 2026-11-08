/// <reference types="node" />
// Test-only helpers: serve the committed public/terrain files through a fake fetch, so the loader,
// store and sampler run headless exactly as in the browser. Never imported by app code.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { HeightTileStore } from './HeightTileStore';
import type { TerrainMeta } from './TerrainMeta';
import { loadTerrainMeta, type FetchLike, type FetchResponseLike } from './TileLoader';

export const TERRAIN_DIR = resolve(__dirname, '../../../public/terrain');
export const BASE_URL = '/terrain/';

export interface FakeFetch extends FetchLike {
  urls: string[];
}

/** fetch() over public/terrain; optionally delayed so tests can observe queues and aborts. */
export function diskFetch(opts: { delayMs?: number } = {}): FakeFetch {
  const urls: string[] = [];
  const fn = (async (url: string, init?: { signal?: AbortSignal }): Promise<FetchResponseLike> => {
    urls.push(url);
    if (opts.delayMs) {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, opts.delayMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          rej(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    const path = resolve(TERRAIN_DIR, url.slice(BASE_URL.length));
    let ok = true;
    try {
      statSync(path);
    } catch {
      ok = false;
    }
    const bytes = ok ? readFileSync(path) : Buffer.alloc(0);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return {
      ok,
      status: ok ? 200 : 404,
      arrayBuffer: async () => ab,
      blob: async () => new Blob([ab]),
      json: async () => JSON.parse(bytes.toString('utf8')) as unknown,
    };
  }) as FakeFetch;
  fn.urls = urls;
  return fn;
}

export async function loadMeta(): Promise<TerrainMeta> {
  return loadTerrainMeta(BASE_URL, diskFetch());
}

/** A store with every height tile loaded straight from disk. */
export async function loadFullStore(): Promise<HeightTileStore> {
  const meta = await loadMeta();
  const store = new HeightTileStore(meta);
  for (let row = 0; row < meta.heightRows; row++) {
    for (let col = 0; col < meta.heightCols; col++) {
      const b = readFileSync(resolve(TERRAIN_DIR, `h/${col}_${row}.bin`));
      store.setTileBytes(col, row, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    }
  }
  return store;
}
