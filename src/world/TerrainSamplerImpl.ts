import type { Vec3 } from '../types/math';
import type { TerrainBounds, TerrainSampler } from '../types/terrain';
import type { HeightTileStore } from './terrain/HeightTileStore';

/** Radius around the last query (or preload target) whose height tiles must be loaded for isReady(). */
export const READY_RADIUS_M = 1500;

/**
 * The real TerrainSampler, reading the same uint16 height tiles the terrain mesh and the GPU
 * height texture are built from. No Three.js and no DOM, so it runs headless.
 *
 * Interpolation: on the mesh's own triangles (every cell split along its north-west to
 * south-east diagonal, exactly as ChunkGeometry builds it), not bilinear. On 5 m cliff cells a
 * bilinear patch and a triangle mesh can differ by more than 1 m, so this is what makes the
 * sampler agree with the rendered ground to float precision near the player.
 *
 * Fallback and readiness (Stage 4 gates the countdown on this):
 * - Outside `bounds`, heightAt returns 0 (sea), as the TerrainSampler contract says.
 * - Inside bounds over a height tile that has not arrived yet, heightAt returns 0 m (meta.json
 *   ships no coarse height grid to fall back on), asks the loader for that tile at top priority,
 *   and isReady() reports false until it arrives.
 * - isReady() is true when every height tile within READY_RADIUS_M of the most recent heightAt /
 *   normalAt query (or of the last preload target, if that is more recent) is loaded. Before any
 *   query or preload it is true only once all tiles are loaded. Call
 *   `terrain.preloadAround(exit, r)` and wait for it before flying; after that isReady() stays
 *   true because height tiles are never evicted.
 */
export class TerrainSamplerImpl implements TerrainSampler {
  readonly bounds: TerrainBounds;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private readonly normal: Vec3 = { x: 0, y: 1, z: 0 };

  constructor(
    private readonly store: HeightTileStore,
    private readonly requestTile: (col: number, row: number) => void = () => undefined,
  ) {
    this.bounds = { ...store.meta.bounds };
  }

  heightAt(x: number, z: number): number {
    this.lastX = x;
    this.lastZ = z;
    return this.height(x, z, true);
  }

  /** heightAt without moving the readiness focus or requesting tiles (camera AGL, tooling). */
  peekHeight(x: number, z: number): number {
    return this.height(x, z, false);
  }

  /**
   * Unit surface normal from central differences one cell either side. The returned object is
   * reused between calls (the flight model reads it immediately), so copy it to keep it.
   */
  normalAt(x: number, z: number): Vec3 {
    this.lastX = x;
    this.lastZ = z;
    const d = this.store.meta.cellSizeM;
    const dhdx = (this.height(x + d, z, true) - this.height(x - d, z, true)) / (2 * d);
    const dhdz = (this.height(x, z + d, true) - this.height(x, z - d, true)) / (2 * d);
    const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
    this.normal.x = -dhdx * inv;
    this.normal.y = inv;
    this.normal.z = -dhdz * inv;
    return this.normal;
  }

  isReady(): boolean {
    if (Number.isNaN(this.lastX)) return this.store.allLoaded;
    return this.tilesLoadedAround(this.lastX, this.lastZ, READY_RADIUS_M);
  }

  /** Points isReady() at a preload target (Terrain.preloadAround calls this). */
  setReadyFocus(x: number, z: number): void {
    this.lastX = x;
    this.lastZ = z;
  }

  tilesLoadedAround(x: number, z: number, radiusM: number): boolean {
    const meta = this.store.meta;
    for (const t of meta.heightTilesInRadius(x, z, radiusM)) if (!this.store.has(t.col, t.row)) return false;
    return true;
  }

  private height(x: number, z: number, request: boolean): number {
    const meta = this.store.meta;
    const b = meta.bounds;
    if (!(x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ)) return 0;
    const gx = (x - b.minX) / meta.cellSizeM;
    const gz = (z - b.minZ) / meta.cellSizeM;
    const cpt = meta.cellsPerHeightTile;
    const col = meta.heightColForSample(gx);
    const row = meta.heightRowForSample(gz);
    const tile = this.store.tile(col, row);
    if (tile === null) {
      if (request) this.requestTile(col, row);
      return 0;
    }
    const lx = gx - col * cpt;
    const lz = gz - row * cpt;
    const i = Math.min(Math.floor(lx), cpt - 1);
    const j = Math.min(Math.floor(lz), cpt - 1);
    const fx = lx - i;
    const fz = lz - j;
    const n = meta.heightTileSize;
    const o = j * n + i;
    const s = meta.heightScale;
    const h00 = tile[o] * s;
    const h10 = tile[o + 1] * s;
    const h01 = tile[o + n] * s;
    const h11 = tile[o + n + 1] * s;
    // Same diagonal as ChunkGeometry: triangles (00, 11, 10) and (00, 01, 11).
    const h = fx >= fz ? h00 + fx * (h10 - h00) + fz * (h11 - h10) : h00 + fz * (h01 - h00) + fx * (h11 - h01);
    return h + meta.heightOffset;
  }
}
