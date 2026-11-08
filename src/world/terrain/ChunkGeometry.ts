import { BufferAttribute, BufferGeometry, Box3, Sphere, Vector3 } from 'three';
import type { HeightTileStore } from './HeightTileStore';
import { CHUNK_CELLS } from './TerrainQuadtree';

const V = CHUNK_CELLS + 1;
/** Grid vertices first, then four skirt rows (north, south, west, east) of V vertices each. */
export const CHUNK_VERTEX_COUNT = V * V + 4 * V;

let sharedIndex: BufferAttribute | null = null;

/**
 * One index buffer for every chunk (they all share the topology). Each cell is split along its
 * north-west (i, j) to south-east (i+1, j+1) diagonal, wound counter-clockwise seen from above:
 * (00, 11, 10) and (00, 01, 11). TerrainSamplerImpl interpolates on the same triangles.
 * Skirt quads face outward.
 */
export function chunkIndex(): BufferAttribute {
  if (sharedIndex) return sharedIndex;
  const tris = CHUNK_CELLS * CHUNK_CELLS * 2 + 4 * CHUNK_CELLS * 2;
  const idx = new Uint16Array(tris * 3);
  let o = 0;
  const g = (i: number, j: number): number => j * V + i;
  for (let j = 0; j < CHUNK_CELLS; j++) {
    for (let i = 0; i < CHUNK_CELLS; i++) {
      const a = g(i, j);
      const b = g(i + 1, j);
      const c = g(i, j + 1);
      const d = g(i + 1, j + 1);
      idx[o++] = a;
      idx[o++] = d;
      idx[o++] = b;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const base = V * V;
  const north = base;
  const south = base + V;
  const west = base + 2 * V;
  const east = base + 3 * V;
  for (let k = 0; k < CHUNK_CELLS; k++) {
    // North edge (j = 0), outward -Z: (T_k, T_k+1, B_k), (T_k+1, B_k+1, B_k).
    quad(g(k, 0), g(k + 1, 0), north + k, north + k + 1, false);
    // South edge (j = 64), outward +Z: reversed.
    quad(g(k, CHUNK_CELLS), g(k + 1, CHUNK_CELLS), south + k, south + k + 1, true);
    // East edge (i = 64) along +Z, outward +X: same order as north.
    quad(g(CHUNK_CELLS, k), g(CHUNK_CELLS, k + 1), east + k, east + k + 1, false);
    // West edge (i = 0), outward -X: reversed.
    quad(g(0, k), g(0, k + 1), west + k, west + k + 1, true);
  }
  function quad(t0: number, t1: number, b0: number, b1: number, flip: boolean): void {
    if (!flip) {
      idx[o++] = t0;
      idx[o++] = t1;
      idx[o++] = b0;
      idx[o++] = t1;
      idx[o++] = b1;
      idx[o++] = b0;
    } else {
      idx[o++] = t0;
      idx[o++] = b0;
      idx[o++] = t1;
      idx[o++] = t1;
      idx[o++] = b0;
      idx[o++] = b1;
    }
  }
  sharedIndex = new BufferAttribute(idx, 1);
  return sharedIndex;
}

export interface ChunkPlacement {
  /** Global sample index of the north-west corner. */
  gi: number;
  gj: number;
  /** Sample stride (2^lod). */
  stride: number;
  /** World position of the north-west corner (the mesh's position). */
  originX: number;
  originZ: number;
  skirtDepthM: number;
}

/**
 * Fills (or allocates) a chunk geometry: positions in chunk-local metres with absolute heights,
 * read through HeightTileStore.sampleWithApron at integer samples, so vertices sit exactly on
 * data samples. No normals or UVs: the material derives both from world position.
 */
export function buildChunkGeometry(
  store: HeightTileStore,
  p: ChunkPlacement,
  target?: BufferGeometry,
): BufferGeometry {
  const geom = target ?? new BufferGeometry();
  let attr = geom.getAttribute('position') as BufferAttribute | undefined;
  if (!attr) {
    attr = new BufferAttribute(new Float32Array(CHUNK_VERTEX_COUNT * 3), 3);
    geom.setAttribute('position', attr);
    geom.setIndex(chunkIndex());
  }
  const pos = attr.array as Float32Array;
  const cell = store.meta.cellSizeM * p.stride;
  let minY = Infinity;
  let maxY = -Infinity;
  let o = 0;
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const h = store.sampleWithApron(p.gi + i * p.stride, p.gj + j * p.stride);
      pos[o++] = i * cell;
      pos[o++] = h;
      pos[o++] = j * cell;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }
  const skirt = (gridIdx: (k: number) => number): void => {
    for (let k = 0; k < V; k++) {
      const s = gridIdx(k) * 3;
      pos[o++] = pos[s];
      pos[o++] = pos[s + 1] - p.skirtDepthM;
      pos[o++] = pos[s + 2];
    }
  };
  skirt((k) => k); // north
  skirt((k) => CHUNK_CELLS * V + k); // south
  skirt((k) => k * V); // west
  skirt((k) => k * V + CHUNK_CELLS); // east
  attr.needsUpdate = true;
  const size = CHUNK_CELLS * cell;
  const box = geom.boundingBox ?? new Box3();
  box.min.set(0, minY - p.skirtDepthM, 0);
  box.max.set(size, maxY, size);
  geom.boundingBox = box;
  const sphere = geom.boundingSphere ?? new Sphere();
  box.getBoundingSphere(sphere);
  geom.boundingSphere = sphere;
  return geom;
}

/** Scratch vector for callers that need a world-space vertex (tests). */
export function chunkVertexWorld(geom: BufferGeometry, p: ChunkPlacement, index: number, out: Vector3): Vector3 {
  const pos = geom.getAttribute('position');
  return out.set(pos.getX(index) + p.originX, pos.getY(index), pos.getZ(index) + p.originZ);
}
