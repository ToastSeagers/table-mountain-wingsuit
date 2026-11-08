import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  Vector2,
  type WebGLRenderer,
} from 'three';
import type { HeightTileStore } from './HeightTileStore';

/**
 * The whole height grid as one R32F texture (2556 x 2045, 21 MB) for per-pixel normals and the
 * water mask. Filled from the same uint16 tiles as the sampler and meshes; each arriving tile is
 * copied into its rectangle with copyTextureToTexture, so there is no full re-upload.
 */
export class HeightTexture {
  readonly texture: DataTexture;
  private readonly data: Float32Array;
  private readonly scratch: DataTexture;
  private readonly pending: { col: number; row: number }[] = [];
  private initialised = false;
  private readonly dst = new Vector2();
  /** False if the GPU cannot linearly filter float textures (normals then come out faceted). */
  linearFiltering = true;

  constructor(private readonly store: HeightTileStore) {
    const m = store.meta;
    this.data = new Float32Array(m.samplesX * m.samplesZ);
    this.texture = new DataTexture(this.data, m.samplesX, m.samplesZ, RedFormat, FloatType);
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.unpackAlignment = 4;
    // Without a version bump initTexture binds an unallocated texture and every copy fails.
    this.texture.needsUpdate = true;
    const n = m.heightTileSize;
    this.scratch = new DataTexture(new Float32Array(n * n), n, n, RedFormat, FloatType);
    for (let row = 0; row < m.heightRows; row++) {
      for (let col = 0; col < m.heightCols; col++) if (store.has(col, row)) this.fill(col, row);
    }
    store.onTile((col, row) => {
      this.fill(col, row);
      this.pending.push({ col, row });
    });
  }

  /** Uploads pending tiles; call once per frame before rendering. */
  upload(renderer: WebGLRenderer): void {
    if (!this.initialised) {
      if (!renderer.extensions.has('OES_texture_float_linear')) {
        this.linearFiltering = false;
        this.texture.magFilter = NearestFilter;
        this.texture.minFilter = NearestFilter;
        console.warn('OES_texture_float_linear missing: terrain normals will be faceted');
      }
      renderer.initTexture(this.texture);
      this.initialised = true;
      this.pending.length = 0; // the initial upload already holds every tile filled so far
      return;
    }
    const m = this.store.meta;
    while (this.pending.length > 0) {
      const { col, row } = this.pending.shift() as { col: number; row: number };
      const tile = this.store.tile(col, row);
      if (!tile) continue;
      const out = this.scratch.image.data as Float32Array;
      for (let i = 0; i < tile.length; i++) out[i] = tile[i] * m.heightScale + m.heightOffset;
      this.dst.set(col * m.cellsPerHeightTile, row * m.cellsPerHeightTile);
      renderer.copyTextureToTexture(this.scratch, this.texture, null, this.dst);
    }
  }

  get pendingUploads(): number {
    return this.pending.length;
  }

  dispose(): void {
    this.texture.dispose();
    this.scratch.dispose();
  }

  private fill(col: number, row: number): void {
    const m = this.store.meta;
    const tile = this.store.tile(col, row);
    if (!tile) return;
    const n = m.heightTileSize;
    const x0 = col * m.cellsPerHeightTile;
    const z0 = row * m.cellsPerHeightTile;
    for (let j = 0; j < n; j++) {
      const dst = (z0 + j) * m.samplesX + x0;
      const src = j * n;
      for (let i = 0; i < n; i++) this.data[dst + i] = tile[src + i] * m.heightScale + m.heightOffset;
    }
  }
}
