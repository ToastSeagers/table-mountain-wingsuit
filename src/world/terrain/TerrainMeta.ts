import type { TerrainBounds } from '../../types/terrain';

/** Shape of `public/terrain/meta.json` (Stage 1 contract, docs/01-architecture.md section 4). */
export interface TerrainMetaJson {
  version: number;
  originLat: number;
  originLon: number;
  boundsWorld: TerrainBounds;
  cellSizeM: number;
  heightTiles: {
    size: number;
    cols: number;
    rows: number;
    format: string;
    path: string;
    heightScale: number;
    heightOffset: number;
  };
  textureTiles: { size: number; cols: number; rows: number; format: string; path: string };
  overview: { path: string; size: number };
}

export interface TileCoord {
  col: number;
  row: number;
}

/**
 * All index math between world metres, global height samples, height tiles and texture tiles.
 * Row 0 is north (min Z) for both tile grids and inside every tile, so no flips anywhere.
 * Height tiles hold `size` samples per side and share their east and south edge sample with the
 * neighbour, so each tile spans `size - 1` cells and the global sample grid is
 * `cols * (size - 1) + 1` wide.
 */
export class TerrainMeta {
  readonly bounds: TerrainBounds;
  readonly cellSizeM: number;
  readonly heightTileSize: number;
  readonly cellsPerHeightTile: number;
  readonly heightCols: number;
  readonly heightRows: number;
  readonly heightScale: number;
  readonly heightOffset: number;
  readonly heightTileSpanM: number;
  /** Global sample grid dimensions. */
  readonly samplesX: number;
  readonly samplesZ: number;
  readonly texCols: number;
  readonly texRows: number;
  readonly texSizePx: number;
  readonly texSpanXM: number;
  readonly texSpanZM: number;
  readonly widthM: number;
  readonly depthM: number;

  constructor(
    readonly json: TerrainMetaJson,
    readonly baseUrl: string,
  ) {
    if (json.heightTiles.format !== 'r16') throw new Error(`unsupported height format ${json.heightTiles.format}`);
    this.bounds = { ...json.boundsWorld };
    this.cellSizeM = json.cellSizeM;
    this.heightTileSize = json.heightTiles.size;
    this.cellsPerHeightTile = json.heightTiles.size - 1;
    this.heightCols = json.heightTiles.cols;
    this.heightRows = json.heightTiles.rows;
    this.heightScale = json.heightTiles.heightScale;
    this.heightOffset = json.heightTiles.heightOffset;
    this.heightTileSpanM = this.cellsPerHeightTile * this.cellSizeM;
    this.samplesX = this.heightCols * this.cellsPerHeightTile + 1;
    this.samplesZ = this.heightRows * this.cellsPerHeightTile + 1;
    this.texCols = json.textureTiles.cols;
    this.texRows = json.textureTiles.rows;
    this.texSizePx = json.textureTiles.size;
    this.widthM = this.bounds.maxX - this.bounds.minX;
    this.depthM = this.bounds.maxZ - this.bounds.minZ;
    this.texSpanXM = this.widthM / this.texCols;
    this.texSpanZM = this.depthM / this.texRows;
    const expectW = (this.samplesX - 1) * this.cellSizeM;
    const expectD = (this.samplesZ - 1) * this.cellSizeM;
    if (Math.abs(expectW - this.widthM) > 1e-6 || Math.abs(expectD - this.depthM) > 1e-6) {
      throw new Error('meta.json bounds do not match the height tile grid');
    }
  }

  get heightTileCount(): number {
    return this.heightCols * this.heightRows;
  }

  get textureTileCount(): number {
    return this.texCols * this.texRows;
  }

  heightTileIndex(col: number, row: number): number {
    return row * this.heightCols + col;
  }

  textureTileIndex(col: number, row: number): number {
    return row * this.texCols + col;
  }

  heightTileUrl(col: number, row: number): string {
    return this.baseUrl + fill(this.json.heightTiles.path, col, row);
  }

  textureTileUrl(col: number, row: number): string {
    return this.baseUrl + fill(this.json.textureTiles.path, col, row);
  }

  get overviewUrl(): string {
    return this.baseUrl + this.json.overview.path;
  }

  inBounds(x: number, z: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  /** Continuous global sample coordinate (0 at minX / minZ, one unit per cell). */
  sampleX(x: number): number {
    return (x - this.bounds.minX) / this.cellSizeM;
  }

  sampleZ(z: number): number {
    return (z - this.bounds.minZ) / this.cellSizeM;
  }

  worldX(sampleX: number): number {
    return this.bounds.minX + sampleX * this.cellSizeM;
  }

  worldZ(sampleZ: number): number {
    return this.bounds.minZ + sampleZ * this.cellSizeM;
  }

  /** Height tile column holding a continuous global sample coordinate, clamped to the grid. */
  heightColForSample(gx: number): number {
    return clampInt(Math.floor(gx / this.cellsPerHeightTile), 0, this.heightCols - 1);
  }

  heightRowForSample(gz: number): number {
    return clampInt(Math.floor(gz / this.cellsPerHeightTile), 0, this.heightRows - 1);
  }

  heightTileAt(x: number, z: number): TileCoord {
    return { col: this.heightColForSample(this.sampleX(x)), row: this.heightRowForSample(this.sampleZ(z)) };
  }

  textureTileAt(x: number, z: number): TileCoord {
    return {
      col: clampInt(Math.floor((x - this.bounds.minX) / this.texSpanXM), 0, this.texCols - 1),
      row: clampInt(Math.floor((z - this.bounds.minZ) / this.texSpanZM), 0, this.texRows - 1),
    };
  }

  /** World rectangle of a height tile. */
  heightTileRect(col: number, row: number): TerrainBounds {
    const minX = this.bounds.minX + col * this.heightTileSpanM;
    const minZ = this.bounds.minZ + row * this.heightTileSpanM;
    return { minX, maxX: minX + this.heightTileSpanM, minZ, maxZ: minZ + this.heightTileSpanM };
  }

  textureTileRect(col: number, row: number): TerrainBounds {
    const minX = this.bounds.minX + col * this.texSpanXM;
    const minZ = this.bounds.minZ + row * this.texSpanZM;
    return { minX, maxX: minX + this.texSpanXM, minZ, maxZ: minZ + this.texSpanZM };
  }

  /** Height tiles whose rectangle intersects a circle. */
  heightTilesInRadius(x: number, z: number, radiusM: number): TileCoord[] {
    const out: TileCoord[] = [];
    for (let row = 0; row < this.heightRows; row++) {
      for (let col = 0; col < this.heightCols; col++) {
        if (rectDistance(this.heightTileRect(col, row), x, z) <= radiusM) out.push({ col, row });
      }
    }
    return out;
  }

  textureTilesInRadius(x: number, z: number, radiusM: number): TileCoord[] {
    const out: TileCoord[] = [];
    for (let row = 0; row < this.texRows; row++) {
      for (let col = 0; col < this.texCols; col++) {
        if (rectDistance(this.textureTileRect(col, row), x, z) <= radiusM) out.push({ col, row });
      }
    }
    return out;
  }
}

/** Horizontal distance from a point to a rectangle (0 inside). */
export function rectDistance(r: TerrainBounds, x: number, z: number): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function fill(template: string, col: number, row: number): string {
  return template.replace('{col}', String(col)).replace('{row}', String(row));
}
