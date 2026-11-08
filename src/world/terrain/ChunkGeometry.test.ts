import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildChunkGeometry, CHUNK_VERTEX_COUNT } from './ChunkGeometry';
import { loadFullStore } from './testFixtures';
import { chunkTextureSlots } from './TerrainChunk';
import { CHUNK_CELLS, TRIANGLES_PER_CHUNK } from './TerrainQuadtree';

describe('ChunkGeometry', () => {
  it('winds every grid triangle up and every skirt triangle outward', async () => {
    const store = await loadFullStore();
    const g = buildChunkGeometry(store, { gi: 1000, gj: 1200, stride: 2, originX: 0, originZ: 0, skirtDepthM: 10 });
    const pos = g.getAttribute('position');
    const idx = g.index?.array as Uint16Array;
    expect(pos.count).toBe(CHUNK_VERTEX_COUNT);
    expect(idx.length / 3).toBe(TRIANGLES_PER_CHUNK);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const n = new Vector3();
    const centre = new Vector3(CHUNK_CELLS * 5, 0, CHUNK_CELLS * 5); // stride 2, 5 m cells
    const gridTris = CHUNK_CELLS * CHUNK_CELLS * 2;
    for (let t = 0; t < idx.length / 3; t++) {
      a.fromBufferAttribute(pos, idx[t * 3]);
      b.fromBufferAttribute(pos, idx[t * 3 + 1]);
      c.fromBufferAttribute(pos, idx[t * 3 + 2]);
      n.subVectors(b, a).cross(c.clone().sub(a));
      if (t < gridTris) {
        expect(n.y, `grid triangle ${t}`).toBeGreaterThan(0);
      } else {
        const mid = a.clone().add(b).add(c).divideScalar(3).sub(centre);
        mid.y = 0;
        expect(n.x * mid.x + n.z * mid.z, `skirt triangle ${t}`).toBeGreaterThan(0);
      }
    }
  });

  it('puts vertices exactly on data samples', async () => {
    const store = await loadFullStore();
    const g = buildChunkGeometry(store, { gi: 512, gj: 768, stride: 4, originX: 0, originZ: 0, skirtDepthM: 5 });
    const pos = g.getAttribute('position');
    const v = CHUNK_CELLS + 1;
    for (const [i, j] of [
      [0, 0],
      [17, 3],
      [64, 64],
    ]) {
      expect(pos.getY(j * v + i)).toBeCloseTo(store.sample(512 + i * 4, 768 + j * 4), 4);
      expect(pos.getX(j * v + i)).toBeCloseTo(i * 20, 6);
    }
  });

  it('assigns at most a 2 x 2 block of texture tiles to every textured chunk', async () => {
    const store = await loadFullStore();
    const m = store.meta;
    for (let lod = 0; lod <= 2; lod++) {
      const size = CHUNK_CELLS * (1 << lod) * m.cellSizeM;
      for (let k = 0; k < 40; k++) {
        const x0 = m.bounds.minX - 2560 + k * size;
        if (x0 > m.bounds.maxX) break;
        const { tileCol } = chunkTextureSlots(m, lod, x0, m.bounds.minZ);
        const lastCol = Math.floor((x0 + size - 1e-6 - m.bounds.minX) / m.texSpanXM);
        expect(lastCol - tileCol, `lod ${lod} chunk ${k}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
