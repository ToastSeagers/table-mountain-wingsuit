import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Texture,
  type WebGLRenderer,
} from 'three';
import type { TerrainMeta, TileCoord } from './TerrainMeta';
import { PRIORITY_PRELOAD, TileAbortedError, type TileLoader } from './TileLoader';
import { DEFAULT_TEXTURE_UPLOADS_PER_FRAME } from '../WorldSettings';

/** Seconds a newly uploaded tile takes to cross-fade in over the overview. */
export const TILE_FADE_S = 0.3;
/** Default GPU uploads per frame: a 1024 px tile plus mips costs 1 to 3 ms on a desktop. Runtime setting: `uploadsPerFrame`. */
export const UPLOADS_PER_FRAME = DEFAULT_TEXTURE_UPLOADS_PER_FRAME;

interface Entry {
  col: number;
  row: number;
  index: number;
  state: 'loading' | 'decoded' | 'ready';
  bitmap: ImageBitmap | null;
  texture: Texture | null;
  readyAtS: number;
  lastWantedFrame: number;
  pins: number;
  waiters: (() => void)[];
}

export interface TextureCacheStats {
  resident: number;
  loading: number;
  awaitingUpload: number;
  evicted: number;
}

/**
 * GPU residency for the 80 texture tiles: LRU-capped, pinned tiles (preloads) never evicted,
 * at most `uploadsPerFrame` uploads per frame. The overview is loaded once and always resident.
 */
export class TerrainTextureCache {
  overview: Texture | null = null;
  maxResident: number;
  /** Uploads allowed per `update()`; the terrain raises it while the countdown holds (a loading screen). */
  uploadsPerFrame = UPLOADS_PER_FRAME;
  private readonly entries = new Map<number, Entry>();
  private evicted = 0;
  private anisotropy = 8;

  constructor(
    private readonly meta: TerrainMeta,
    private readonly loader: TileLoader,
    maxResident: number,
  ) {
    this.maxResident = maxResident;
  }

  setAnisotropy(a: number): void {
    this.anisotropy = a;
  }

  async loadOverview(renderer: WebGLRenderer): Promise<Texture> {
    const bitmap = await this.loader.loadOverview();
    const tex = this.makeTexture(bitmap);
    renderer.initTexture(tex);
    this.overview = tex;
    return tex;
  }

  get stats(): TextureCacheStats {
    let resident = 0;
    let loading = 0;
    let awaitingUpload = 0;
    for (const e of this.entries.values()) {
      if (e.state === 'ready') resident++;
      else if (e.state === 'loading') loading++;
      else awaitingUpload++;
    }
    return { resident, loading, awaitingUpload, evicted: this.evicted };
  }

  /** True when no tile is still downloading, decoding or waiting for its GPU upload. */
  isIdle(): boolean {
    for (const e of this.entries.values()) if (e.state !== 'ready') return false;
    return true;
  }

  /** Texture for a tile index if uploaded, else null. */
  get(index: number): Texture | null {
    const e = this.entries.get(index);
    return e && e.state === 'ready' ? e.texture : null;
  }

  /** Cross-fade weight 0..1 for a resident tile. */
  blend(index: number, nowS: number): number {
    const e = this.entries.get(index);
    if (!e || e.state !== 'ready') return 0;
    return Math.min(Math.max((nowS - e.readyAtS) / TILE_FADE_S, 0), 1);
  }

  /**
   * Per frame: request wanted tiles (priority = lower first), abort requests no longer wanted,
   * upload a few decoded tiles, evict least-recently-wanted tiles above the cap.
   */
  update(wanted: Map<number, number>, frame: number, nowS: number, renderer: WebGLRenderer): void {
    // Never want more than fits; keep the most urgent.
    let keep = wanted;
    // Pinned tiles that are also wanted already sit inside `keep`; only the others take room off the cap.
    const pinnedElsewhere = [...this.entries.values()].filter((e) => e.pins > 0 && !wanted.has(e.index)).length;
    const room = Math.max(this.maxResident - pinnedElsewhere, 0);
    if (wanted.size > room) {
      keep = new Map([...wanted.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, room));
    }
    for (const [index, priority] of keep) {
      let e = this.entries.get(index);
      if (!e) e = this.request(index, priority);
      e.lastWantedFrame = frame;
    }
    // Abort loads nobody wants any more (pinned ones stay).
    const retain = new Set<number>(keep.keys());
    for (const e of this.entries.values()) if (e.pins > 0) retain.add(e.index);
    this.loader.retainTextures(retain);
    for (const e of [...this.entries.values()]) {
      if (e.state === 'loading' && !retain.has(e.index)) this.entries.delete(e.index);
    }
    // Upload: wanted-and-pinned first, nearest first.
    const decoded = [...this.entries.values()]
      .filter((e) => e.state === 'decoded')
      .sort((a, b) => (keep.get(a.index) ?? (a.pins > 0 ? -1 : 1e12)) - (keep.get(b.index) ?? (b.pins > 0 ? -1 : 1e12)));
    for (const e of decoded.slice(0, this.uploadsPerFrame)) {
      const tex = this.makeTexture(e.bitmap as ImageBitmap);
      renderer.initTexture(tex);
      // The GPU copy is all we need; free the decoded 4 MB bitmap.
      e.bitmap?.close?.();
      e.bitmap = null;
      e.texture = tex;
      e.state = 'ready';
      e.readyAtS = nowS;
      for (const w of e.waiters.splice(0)) w();
    }
    this.evict(frame);
  }

  /** Releases every pin (the countdown's preload) so those tiles age out like any other once the flight starts. */
  unpinAll(): void {
    for (const e of this.entries.values()) {
      e.pins = 0;
      // A preload still waiting on this tile must not hang for ever now that nothing keeps the tile alive.
      for (const w of e.waiters.splice(0)) w();
    }
  }

  /** Loads and pins tiles until `unpin`; resolves when all are uploaded. */
  preload(tiles: TileCoord[]): Promise<void> {
    const waits: Promise<void>[] = [];
    tiles.forEach((t, i) => {
      const index = this.meta.textureTileIndex(t.col, t.row);
      let e = this.entries.get(index);
      if (!e) e = this.request(index, PRIORITY_PRELOAD + i);
      e.pins++;
      const entry = e;
      if (entry.state !== 'ready') waits.push(new Promise<void>((res) => entry.waiters.push(res)));
    });
    return Promise.all(waits).then(() => undefined);
  }

  unpin(tiles: TileCoord[]): void {
    for (const t of tiles) {
      const e = this.entries.get(this.meta.textureTileIndex(t.col, t.row));
      if (e && e.pins > 0) e.pins--;
    }
  }

  dispose(): void {
    for (const e of this.entries.values()) this.drop(e);
    this.entries.clear();
    this.overview?.dispose();
  }

  private request(index: number, priority: number): Entry {
    const col = index % this.meta.texCols;
    const row = Math.floor(index / this.meta.texCols);
    const e: Entry = {
      col,
      row,
      index,
      state: 'loading',
      bitmap: null,
      texture: null,
      readyAtS: 0,
      lastWantedFrame: -1,
      pins: 0,
      waiters: [],
    };
    this.entries.set(index, e);
    this.loader.requestTexture(col, row, priority).then(
      (bitmap) => {
        if (this.entries.get(index) !== e) {
          bitmap.close?.();
          return;
        }
        e.bitmap = bitmap;
        e.state = 'decoded';
      },
      (err: unknown) => {
        if (this.entries.get(index) === e && e.pins === 0) this.entries.delete(index);
        if (!(err instanceof TileAbortedError)) {
          console.warn(err);
          // Pinned loads retry so preloads cannot hang on one network hiccup.
          if (e.pins > 0) setTimeout(() => this.retry(e, priority), 500);
        }
      },
    );
    return e;
  }

  private retry(e: Entry, priority: number): void {
    if (this.entries.get(e.index) !== e) return;
    this.entries.delete(e.index);
    const fresh = this.request(e.index, priority);
    fresh.pins = e.pins;
    fresh.waiters = e.waiters;
  }

  private evict(frame: number): void {
    const ready = [...this.entries.values()].filter((e) => e.state === 'ready');
    let excess = ready.length - this.maxResident;
    if (excess <= 0) return;
    const candidates = ready
      .filter((e) => e.pins === 0 && e.lastWantedFrame < frame)
      .sort((a, b) => a.lastWantedFrame - b.lastWantedFrame || a.index - b.index);
    for (const e of candidates) {
      if (excess-- <= 0) break;
      this.drop(e);
      this.entries.delete(e.index);
      this.evicted++;
    }
  }

  private drop(e: Entry): void {
    e.texture?.dispose();
    e.bitmap?.close?.();
    e.texture = null;
    e.bitmap = null;
  }

  private makeTexture(bitmap: ImageBitmap): Texture {
    const tex = new Texture(bitmap);
    tex.colorSpace = SRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.anisotropy;
    tex.needsUpdate = true;
    return tex;
  }
}
