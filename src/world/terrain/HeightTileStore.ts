import type { TerrainMeta } from './TerrainMeta';

/** Apron outside the data: edge height fades to sea over this distance. */
export const APRON_FADE_M = 2000;
/** The apron also sinks below the sea plane so the two never z-fight. */
export const APRON_SINK_M = 6;

export type TileListener = (col: number, row: number) => void;

/**
 * The 20 height tiles as raw uint16 arrays (10.5 MB, never evicted). This is the single source
 * the CPU sampler, the chunk meshes and the GPU height texture are all built from.
 * No Three.js, no DOM: usable headless.
 */
export class HeightTileStore {
  private readonly tiles: (Uint16Array | null)[];
  private readonly listeners: TileListener[] = [];
  private loaded = 0;

  constructor(readonly meta: TerrainMeta) {
    this.tiles = new Array<Uint16Array | null>(meta.heightTileCount).fill(null);
  }

  get loadedCount(): number {
    return this.loaded;
  }

  get allLoaded(): boolean {
    return this.loaded === this.meta.heightTileCount;
  }

  has(col: number, row: number): boolean {
    return this.tiles[this.meta.heightTileIndex(col, row)] !== null;
  }

  tile(col: number, row: number): Uint16Array | null {
    return this.tiles[this.meta.heightTileIndex(col, row)];
  }

  /** Accepts the raw little-endian uint16 bytes of one tile. */
  setTileBytes(col: number, row: number, buffer: ArrayBuffer): void {
    const n = this.meta.heightTileSize;
    if (buffer.byteLength !== n * n * 2) {
      throw new Error(`height tile ${col}_${row}: expected ${n * n * 2} bytes, got ${buffer.byteLength}`);
    }
    // Typed arrays use platform byte order; every platform a browser runs on is little-endian,
    // but convert explicitly if not so the data contract holds.
    let data = new Uint16Array(buffer);
    if (!isLittleEndian()) {
      const dv = new DataView(buffer);
      data = new Uint16Array(n * n);
      for (let i = 0; i < data.length; i++) data[i] = dv.getUint16(i * 2, true);
    }
    const idx = this.meta.heightTileIndex(col, row);
    if (this.tiles[idx] === null) this.loaded++;
    this.tiles[idx] = data;
    for (const l of this.listeners) l(col, row);
  }

  onTile(listener: TileListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Height in metres at an integer global sample inside the grid; 0 if its tile is not loaded. */
  sample(gi: number, gj: number): number {
    const m = this.meta;
    const cpt = m.cellsPerHeightTile;
    const col = gi >= m.samplesX - 1 ? m.heightCols - 1 : (gi / cpt) | 0;
    const row = gj >= m.samplesZ - 1 ? m.heightRows - 1 : (gj / cpt) | 0;
    const t = this.tiles[row * m.heightCols + col];
    if (t === null) return 0;
    const li = gi - col * cpt;
    const lj = gj - row * cpt;
    return t[lj * m.heightTileSize + li] * m.heightScale + m.heightOffset;
  }

  /**
   * Height at any integer global sample, including the apron outside the data: the nearest edge
   * height fades to below sea level over APRON_FADE_M. Used only for rendering.
   */
  sampleWithApron(gi: number, gj: number): number {
    const m = this.meta;
    const ci = gi < 0 ? 0 : gi > m.samplesX - 1 ? m.samplesX - 1 : gi;
    const cj = gj < 0 ? 0 : gj > m.samplesZ - 1 ? m.samplesZ - 1 : gj;
    const h = this.sample(ci, cj);
    if (ci === gi && cj === gj) return h;
    const outsideM = Math.hypot(gi - ci, gj - cj) * m.cellSizeM;
    return apronHeight(h, outsideM);
  }

  /** Whether the tile holding a global sample is loaded (outside samples use the clamped edge). */
  sampleLoaded(gi: number, gj: number): boolean {
    const m = this.meta;
    const ci = Math.min(Math.max(gi, 0), m.samplesX - 1);
    const cj = Math.min(Math.max(gj, 0), m.samplesZ - 1);
    return this.has(m.heightColForSample(ci), m.heightRowForSample(cj));
  }
}

export function apronHeight(edgeHeightM: number, outsideM: number): number {
  const t = Math.min(outsideM / APRON_FADE_M, 1);
  const fade = 1 - t * t * (3 - 2 * t);
  const sink = Math.min(outsideM / 300, 1) * APRON_SINK_M;
  return edgeHeightM * fade - sink;
}

function isLittleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}
