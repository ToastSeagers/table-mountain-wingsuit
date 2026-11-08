import type { HeightTileStore } from './HeightTileStore';
import { rectDistance, TerrainMeta, type TerrainMetaJson } from './TerrainMeta';

/** The subset of `Response` the loader uses, so tests can serve tiles from disk. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;
/** Image decode; the browser default is createImageBitmap, which decodes off the main thread. */
export type DecodeImage = (blob: Blob) => Promise<ImageBitmap>;

export interface TileLoaderDeps {
  fetch: FetchLike;
  decodeImage?: DecodeImage;
}

export interface TileLoaderOptions {
  /** Parallel requests. Four keeps HTTP/1.1 dev servers responsive and saturates 20 Mbps. */
  maxConcurrent?: number;
}

/** Thrown into a texture request's promise when it is cancelled because the camera moved away. */
export class TileAbortedError extends Error {
  constructor(key: string) {
    super(`tile request ${key} cancelled`);
    this.name = 'TileAbortedError';
  }
}

/** Priority bands: lower runs first. Distances in metres are added on top. */
export const PRIORITY_URGENT = -2e9;
export const PRIORITY_PRELOAD = -1e9;
/** Added to texture tiles that are wanted but outside the view frustum. */
export const PRIORITY_OFFSCREEN_M = 20_000;

type Kind = 'height' | 'texture' | 'overview';

interface Job<T> {
  key: string;
  kind: Kind;
  col: number;
  row: number;
  priority: number;
  seq: number;
  running: boolean;
  controller: AbortController;
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export interface TileLoaderStats {
  queued: number;
  running: number;
  heightTilesLoaded: number;
  texturesFetched: number;
  texturesAborted: number;
  bytesFetched: number;
}

export async function loadTerrainMeta(baseUrl: string, fetchFn: FetchLike): Promise<TerrainMeta> {
  const res = await fetchFn(baseUrl + 'meta.json');
  if (!res.ok) throw new Error(`meta.json: HTTP ${res.status}`);
  return new TerrainMeta((await res.json()) as TerrainMetaJson, baseUrl);
}

/**
 * Fetches height and texture tiles listed by meta.json with a priority queue ordered by distance
 * to the camera (or preload target). Height tiles go into the HeightTileStore (the cache; all 20
 * are always fetched because together they are only 10.5 MB). Texture requests resolve with a
 * decoded ImageBitmap; the GPU-side TerrainTextureCache owns them after that. Texture requests
 * that leave the wanted set are aborted ("cancels on move"); height requests are only re-ordered.
 */
export class TileLoader {
  private readonly jobs = new Map<string, Job<unknown>>();
  private readonly maxConcurrent: number;
  private running = 0;
  private seq = 0;
  private focusX = 0;
  private focusZ = 0;
  private texturesFetched = 0;
  private texturesAborted = 0;
  private bytesFetched = 0;
  private pumpScheduled = false;

  constructor(
    readonly meta: TerrainMeta,
    readonly store: HeightTileStore,
    private readonly deps: TileLoaderDeps,
    opts: TileLoaderOptions = {},
  ) {
    this.maxConcurrent = opts.maxConcurrent ?? 4;
  }

  get stats(): TileLoaderStats {
    let queued = 0;
    for (const j of this.jobs.values()) if (!j.running) queued++;
    return {
      queued,
      running: this.running,
      heightTilesLoaded: this.store.loadedCount,
      texturesFetched: this.texturesFetched,
      texturesAborted: this.texturesAborted,
      bytesFetched: this.bytesFetched,
    };
  }

  /** Keys of jobs in the order they would start (for tests and the perf overlay). */
  queuedKeys(): string[] {
    return [...this.jobs.values()]
      .filter((j) => !j.running)
      .sort(compareJobs)
      .map((j) => j.key);
  }

  /** Re-orders queued height tiles by distance to a new focus point. */
  setFocus(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
    for (const j of this.jobs.values()) {
      if (j.kind === 'height' && !j.running && j.priority >= 0) {
        j.priority = rectDistance(this.meta.heightTileRect(j.col, j.row), x, z);
      }
    }
  }

  /** Queues every height tile, nearest the focus first. */
  requestAllHeights(): Promise<void> {
    const all: Promise<void>[] = [];
    for (let row = 0; row < this.meta.heightRows; row++) {
      for (let col = 0; col < this.meta.heightCols; col++) all.push(this.requestHeight(col, row));
    }
    return Promise.all(all).then(() => undefined);
  }

  /**
   * Resolves when the tile is in the store. `priority` defaults to the distance from the focus;
   * pass PRIORITY_URGENT / PRIORITY_PRELOAD to jump the queue.
   */
  requestHeight(col: number, row: number, priority?: number): Promise<void> {
    if (this.store.has(col, row)) return Promise.resolve();
    const key = `h/${col}_${row}`;
    const p = priority ?? rectDistance(this.meta.heightTileRect(col, row), this.focusX, this.focusZ);
    return this.enqueue<void>(key, 'height', col, row, p);
  }

  requestTexture(col: number, row: number, priority: number): Promise<ImageBitmap> {
    return this.enqueue<ImageBitmap>(`t/${col}_${row}`, 'texture', col, row, priority);
  }

  hasTextureJob(col: number, row: number): boolean {
    return this.jobs.has(`t/${col}_${row}`);
  }

  loadOverview(): Promise<ImageBitmap> {
    return this.enqueue<ImageBitmap>('overview', 'overview', 0, 0, PRIORITY_URGENT);
  }

  /** Aborts queued or in-flight texture requests whose tile index is not in `wanted`. */
  retainTextures(wanted: ReadonlySet<number>): void {
    for (const j of [...this.jobs.values()]) {
      if (j.kind !== 'texture') continue;
      if (!wanted.has(this.meta.textureTileIndex(j.col, j.row))) this.abort(j);
    }
  }

  cancelTexture(col: number, row: number): void {
    const j = this.jobs.get(`t/${col}_${row}`);
    if (j) this.abort(j);
  }

  private abort(j: Job<unknown>): void {
    this.jobs.delete(j.key);
    j.controller.abort();
    if (j.running) this.running--;
    this.texturesAborted++;
    j.reject(new TileAbortedError(j.key));
    this.pump();
  }

  private enqueue<T>(key: string, kind: Kind, col: number, row: number, priority: number): Promise<T> {
    const existing = this.jobs.get(key) as Job<T> | undefined;
    if (existing) {
      if (!existing.running && priority < existing.priority) existing.priority = priority;
      return existing.promise;
    }
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Aborted texture promises are expected; keep them from surfacing as unhandled rejections
    // when a caller only cared about the side effect.
    promise.catch(() => undefined);
    const job: Job<T> = {
      key,
      kind,
      col,
      row,
      priority,
      seq: this.seq++,
      running: false,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
    };
    this.jobs.set(key, job as Job<unknown>);
    this.schedulePump();
    return promise;
  }

  /**
   * Starts work on the next microtask, so a batch of requests made in one go (all heights, a
   * frame's texture set) is ordered by priority before any of it starts.
   */
  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < this.maxConcurrent) {
      let next: Job<unknown> | null = null;
      for (const j of this.jobs.values()) {
        if (!j.running && (next === null || compareJobs(j, next) < 0)) next = j;
      }
      if (next === null) return;
      next.running = true;
      this.running++;
      void this.run(next);
    }
  }

  private async run(job: Job<unknown>): Promise<void> {
    const { signal } = job.controller;
    try {
      const url =
        job.kind === 'height'
          ? this.meta.heightTileUrl(job.col, job.row)
          : job.kind === 'texture'
            ? this.meta.textureTileUrl(job.col, job.row)
            : this.meta.overviewUrl;
      const res = await this.deps.fetch(url, { signal });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      let value: unknown;
      if (job.kind === 'height') {
        const buf = await res.arrayBuffer();
        if (signal.aborted) return;
        this.bytesFetched += buf.byteLength;
        this.store.setTileBytes(job.col, job.row, buf);
      } else {
        const blob = await res.blob();
        if (signal.aborted) return;
        this.bytesFetched += blob.size;
        const decode = this.deps.decodeImage;
        if (!decode) throw new Error('no image decoder configured');
        value = await decode(blob);
        if (signal.aborted) {
          (value as ImageBitmap).close?.();
          return;
        }
        if (job.kind === 'texture') this.texturesFetched++;
      }
      this.finish(job);
      job.resolve(value);
    } catch (e) {
      if (signal.aborted) return; // abort() already settled the job
      this.finish(job);
      job.reject(e);
    }
  }

  private finish(job: Job<unknown>): void {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    this.running--;
    this.pump();
  }
}

function compareJobs(a: Job<unknown>, b: Job<unknown>): number {
  return a.priority - b.priority || a.seq - b.seq;
}
