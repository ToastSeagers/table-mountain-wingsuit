import { type BufferGeometry, Mesh, type Texture } from 'three';
import type { ChunkPlacement } from './ChunkGeometry';
import type { TerrainMeta } from './TerrainMeta';
import { TerrainMaterial, type TerrainSharedUniforms } from './TerrainMaterial';
import type { QuadNode, TerrainQuadtree } from './TerrainQuadtree';

/** Chunks at this level and finer touch at most 2 x 2 texture tiles and sample them directly. */
export const MAX_TEXTURED_LOD = 2;

/** Where a node sits in the world and which texture tiles feed its four slots. */
export function chunkPlacement(tree: TerrainQuadtree, node: QuadNode): ChunkPlacement {
  const meta = tree.meta;
  const { gi, gj } = tree.nodeOrigin(node.lod, node.ix, node.iz);
  return {
    gi,
    gj,
    stride: 1 << node.lod,
    originX: meta.worldX(gi),
    originZ: meta.worldZ(gj),
    skirtDepthM: tree.skirtDepth(node.lod, node.ix, node.iz),
  };
}

/**
 * Texture tile indices for the four slots (-1 = none): the 2 x 2 block whose north-west tile holds
 * the chunk's north-west corner. Coarse chunks (L3, L4) use the overview only.
 */
export function chunkTextureSlots(meta: TerrainMeta, lod: number, originX: number, originZ: number): {
  slots: [number, number, number, number];
  tileCol: number;
  tileRow: number;
} {
  const slots: [number, number, number, number] = [-1, -1, -1, -1];
  const tileCol = Math.floor((originX - meta.bounds.minX) / meta.texSpanXM);
  const tileRow = Math.floor((originZ - meta.bounds.minZ) / meta.texSpanZM);
  if (lod <= MAX_TEXTURED_LOD) {
    for (let s = 0; s < 4; s++) {
      const c = tileCol + (s & 1);
      const r = tileRow + (s >> 1);
      if (c >= 0 && c < meta.texCols && r >= 0 && r < meta.texRows) slots[s] = meta.textureTileIndex(c, r);
    }
  }
  return { slots, tileCol, tileRow };
}

/** One drawn terrain chunk: a mesh with its own material (shared program, own texture slots). */
export class TerrainChunk {
  readonly mesh: Mesh;
  readonly material: TerrainMaterial;
  nodeId = -1;
  lod = 0;
  slots: [number, number, number, number] = [-1, -1, -1, -1];

  constructor(shared: TerrainSharedUniforms, private readonly placeholder: Texture) {
    this.material = new TerrainMaterial(shared, placeholder);
    this.mesh = new Mesh(undefined, this.material);
    this.mesh.frustumCulled = false; // the quadtree already culled
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'terrain-chunk';
  }

  assign(meta: TerrainMeta, node: QuadNode, placement: ChunkPlacement, geometry: BufferGeometry): void {
    this.nodeId = node.id;
    this.lod = node.lod;
    this.mesh.geometry = geometry;
    this.mesh.position.set(placement.originX, 0, placement.originZ);
    this.mesh.updateMatrix();
    const t = chunkTextureSlots(meta, node.lod, placement.originX, placement.originZ);
    this.slots = t.slots;
    this.material.tileOrigin.set(
      meta.bounds.minX + t.tileCol * meta.texSpanXM,
      meta.bounds.minZ + t.tileRow * meta.texSpanZM,
    );
  }

  /** Points the slots at resident textures (placeholder and blend 0 otherwise). */
  updateTextures(get: (index: number) => Texture | null, blend: (index: number) => number): void {
    for (let s = 0; s < 4; s++) {
      const idx = this.slots[s];
      const tex = idx >= 0 ? get(idx) : null;
      this.material.setSlot(s, tex ?? this.placeholder, tex ? blend(idx) : 0);
    }
  }

  dispose(): void {
    this.material.dispose();
  }
}
