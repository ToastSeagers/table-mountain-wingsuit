import { BufferGeometry, Frustum, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { TerrainSamplerImpl } from '../TerrainSamplerImpl';
import { measurementViewpoints } from '../viewpoints';
import { buildChunkGeometry } from './ChunkGeometry';
import type { HeightTileStore } from './HeightTileStore';
import { mulberry32 } from '../NoiseTexture';
import { loadFullStore } from './testFixtures';
import { chunkPlacement } from './TerrainChunk';
import { CHUNK_CELLS, type QuadNode, TerrainQuadtree, TRIANGLES_PER_CHUNK } from './TerrainQuadtree';

const RAY_TOP_M = 3000;

/** Builds (and caches) chunk meshes and raycasts straight down onto them. */
class MeshProbe {
  private readonly meshes = new Map<number, Mesh>();
  private readonly ray = new Raycaster();
  private readonly mat = new MeshBasicMaterial();

  constructor(
    private readonly store: HeightTileStore,
    private readonly tree: TerrainQuadtree,
  ) {}

  mesh(node: QuadNode): Mesh {
    let m = this.meshes.get(node.id);
    if (!m) {
      const p = chunkPlacement(this.tree, node);
      m = new Mesh(buildChunkGeometry(this.store, p, new BufferGeometry()), this.mat);
      m.position.set(p.originX, 0, p.originZ);
      m.updateMatrixWorld(true);
      this.meshes.set(node.id, m);
    }
    return m;
  }

  heightOn(meshes: Mesh[], x: number, z: number): number | null {
    this.ray.set(new Vector3(x, RAY_TOP_M, z), new Vector3(0, -1, 0));
    const hits = this.ray.intersectObjects(meshes, false);
    return hits.length ? hits[0].point.y : null;
  }
}

/** The finest-level node containing a world point. */
function leafAt(tree: TerrainQuadtree, x: number, z: number): QuadNode {
  const m = tree.meta;
  const ix = Math.floor((m.sampleX(x) - tree.originGi) / CHUNK_CELLS);
  const iz = Math.floor((m.sampleZ(z) - tree.originGj) / CHUNK_CELLS);
  return { id: tree.nodeId(0, ix, iz), lod: 0, ix, iz };
}

describe('TerrainSampler versus the rendered mesh', () => {
  let store: HeightTileStore;
  let tree: TerrainQuadtree;
  let sampler: TerrainSamplerImpl;
  let probe: MeshProbe;

  beforeAll(async () => {
    store = await loadFullStore();
    tree = new TerrainQuadtree(store);
    tree.processDirty(Infinity);
    sampler = new TerrainSamplerImpl(store);
    probe = new MeshProbe(store, tree);
  });

  it('agrees with the full-resolution mesh on 1,000 random points within 1 m', () => {
    const rand = mulberry32(20261108);
    const b = sampler.bounds;
    let maxErr = 0;
    let land = 0;
    for (let i = 0; i < 1000; i++) {
      // Keep off the very edge so the ray cannot slip between chunks at the AOI boundary.
      const x = b.minX + 1 + rand() * (b.maxX - b.minX - 2);
      const z = b.minZ + 1 + rand() * (b.maxZ - b.minZ - 2);
      const node = leafAt(tree, x, z);
      const y = probe.heightOn([probe.mesh(node)], x, z);
      expect(y, `no hit at ${x}, ${z}`).not.toBeNull();
      const h = sampler.heightAt(x, z);
      if (h > 1) land++;
      maxErr = Math.max(maxErr, Math.abs((y as number) - h));
    }
    console.info(`full-res mesh: max |sampler - raycast| over 1000 points = ${maxErr.toExponential(2)} m (${land} on land)`);
    expect(land).toBeGreaterThan(500); // the sample really covers the mountain, not just sea
    expect(maxErr).toBeLessThan(1);
    expect(maxErr).toBeLessThan(0.01); // same triangles: only float rounding is left
  });

  it('agrees with the LOD-selected mesh within 700 m of a camera at each viewpoint', () => {
    const rand = mulberry32(7);
    for (const vp of measurementViewpoints()) {
      const cam = { position: vp.position };
      // No frustum culling for the accuracy check: points all around the camera need cover.
      const nodes = tree.select({
        camX: cam.position.x,
        camY: cam.position.y,
        camZ: cam.position.z,
        pxPerUnitAtDistance: 1080 / (2 * Math.tan((70 * Math.PI) / 360)),
        errorPx: 2,
        maxChunks: 10_000,
        frustum: null,
      });
      const meshes = nodes.map((n) => probe.mesh(n));
      let maxErr = 0;
      for (let i = 0; i < 250; i++) {
        const r = 700 * Math.sqrt(rand());
        const a = rand() * Math.PI * 2;
        const x = cam.position.x + r * Math.cos(a);
        const z = cam.position.z + r * Math.sin(a);
        const y = probe.heightOn(meshes, x, z);
        expect(y, `${vp.id}: no hit`).not.toBeNull();
        maxErr = Math.max(maxErr, Math.abs((y as number) - sampler.heightAt(x, z)));
      }
      console.info(`${vp.id}: ${nodes.length} chunks, max |sampler - raycast| within 700 m = ${maxErr.toFixed(3)} m`);
      expect(maxErr, vp.id).toBeLessThan(1);
    }
  });

  it('agrees with the mesh actually drawn (64-chunk cap, frustum) within 1 m in the 700 m ahead', () => {
    const rand = mulberry32(11);
    const maxChunks = Math.floor(560_000 / TRIANGLES_PER_CHUNK);
    for (const vp of measurementViewpoints()) {
      const cam = new PerspectiveCamera(70, 16 / 9, 1, 80_000);
      cam.position.set(vp.position.x, vp.position.y, vp.position.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.set((vp.pitchDeg * Math.PI) / 180, (-vp.headingDeg * Math.PI) / 180, 0);
      cam.updateMatrixWorld();
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
      );
      const nodes = tree.select({
        camX: cam.position.x,
        camY: cam.position.y,
        camZ: cam.position.z,
        pxPerUnitAtDistance: 1080 / (2 * Math.tan((70 * Math.PI) / 360)),
        errorPx: 2,
        maxChunks,
        frustum,
      });
      expect(nodes.length).toBeLessThanOrEqual(maxChunks);
      const meshes = nodes.map((n) => probe.mesh(n));
      const bands = [150, 300, 700, 1500];
      const worst = bands.map(() => 0);
      const h = (vp.headingDeg * Math.PI) / 180;
      for (let i = 0; i < 2000; i++) {
        // Points ahead of the camera within +-30 degrees of the heading.
        const r = 1500 * Math.sqrt(rand());
        const a = h + (rand() - 0.5) * (Math.PI / 3);
        const x = cam.position.x + r * Math.sin(a);
        const z = cam.position.z - r * Math.cos(a);
        const y = probe.heightOn(meshes, x, z);
        if (y === null) continue; // culled (below the view) or outside the data
        const err = Math.abs(y - sampler.heightAt(x, z));
        const b = bands.findIndex((d) => r <= d);
        worst[b] = Math.max(worst[b], err);
      }
      console.info(`${vp.id}: ${nodes.length} chunks drawn; worst |sampler - drawn mesh| by distance ${bands.map((d, k) => `<=${d} m: ${worst[k].toFixed(2)}`).join(', ')}`);
      expect(Math.max(worst[0], worst[1], worst[2]), vp.id).toBeLessThan(1);
    }
  });

  it('keeps the triangle count of a chunk at the budgeted figure', () => {
    const g = probe.mesh(leafAt(tree, 0, 0)).geometry;
    expect((g.index?.count ?? 0) / 3).toBe(TRIANGLES_PER_CHUNK);
  });
});
