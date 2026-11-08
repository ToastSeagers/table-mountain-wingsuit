import { Frustum, Matrix4, PerspectiveCamera } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { mulberry32 } from '../NoiseTexture';
import { measurementViewpoints } from '../viewpoints';
import type { HeightTileStore } from './HeightTileStore';
import { loadFullStore } from './testFixtures';
import { MAX_LOD, type SelectParams, TerrainQuadtree, TRIANGLES_PER_CHUNK } from './TerrainQuadtree';

const PX = 1080 / (2 * Math.tan((70 * Math.PI) / 360));
const MAX_CHUNKS = Math.floor(560_000 / TRIANGLES_PER_CHUNK);

function cameraParams(x: number, y: number, z: number, headingDeg: number, pitchDeg: number): SelectParams {
  const cam = new PerspectiveCamera(70, 16 / 9, 1, 80_000);
  cam.position.set(x, y, z);
  cam.rotation.order = 'YXZ';
  cam.rotation.set((pitchDeg * Math.PI) / 180, (-headingDeg * Math.PI) / 180, 0);
  cam.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
  );
  return { camX: x, camY: y, camZ: z, pxPerUnitAtDistance: PX, errorPx: 2, maxChunks: MAX_CHUNKS, frustum };
}

describe('TerrainQuadtree', () => {
  let store: HeightTileStore;

  beforeAll(async () => {
    store = await loadFullStore();
  });

  it('measures errors as a bound that grows with level', () => {
    const tree = new TerrainQuadtree(store);
    expect(tree.pendingMeasurements).toBeGreaterThan(0);
    expect(tree.processDirty(Infinity)).toBe(true);
    expect(tree.pendingMeasurements).toBe(0);
    expect(tree.rootsX).toBe(4);
    expect(tree.rootsZ).toBe(3);
    // The Table area (root containing the cable station) is rough; deep sea is flat.
    let maxPerLevel = 0;
    for (let lod = 1; lod <= MAX_LOD; lod++) {
      const l = tree.levels[lod];
      let m = 0;
      for (let k = 0; k < l.err.length; k++) {
        const ix = k % l.nx;
        const iz = Math.floor(k / l.nx);
        if (tree.inDomain(lod, ix, iz)) {
          expect(Number.isNaN(l.err[k]), `L${lod} ${ix},${iz}`).toBe(false);
          m = Math.max(m, l.err[k]);
        }
      }
      expect(m).toBeGreaterThanOrEqual(maxPerLevel);
      maxPerLevel = m;
    }
    expect(maxPerLevel).toBeGreaterThan(20);
  });

  it('selects the same chunks for the same camera regardless of history', () => {
    const a = new TerrainQuadtree(store);
    a.processDirty(Infinity);
    const b = new TerrainQuadtree(store);
    b.processDirty(Infinity);
    for (const vp of measurementViewpoints()) {
      const p = cameraParams(vp.position.x, vp.position.y, vp.position.z, vp.headingDeg, vp.pitchDeg);
      const first = a.select(p).map((n) => n.id);
      a.select(cameraParams(4000, 3000, 3000, 10, -40)); // look somewhere else in between
      expect(a.select(p).map((n) => n.id)).toEqual(first);
      expect(b.select(p).map((n) => n.id)).toEqual(first);
    }
  });

  it('never exceeds the chunk cap, low, high or grazing', () => {
    const tree = new TerrainQuadtree(store);
    tree.processDirty(Infinity);
    const rand = mulberry32(99);
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      const x = -5000 + rand() * 11000;
      const z = -5000 + rand() * 9000;
      const y = [5, 60, 400, 1100, 3000][i % 5] + store.sample(1000, 1000);
      const nodes = tree.select(cameraParams(x, y, z, rand() * 360, -rand() * 30));
      worst = Math.max(worst, nodes.length);
      expect(nodes.length).toBeLessThanOrEqual(MAX_CHUNKS);
    }
    expect(worst * TRIANGLES_PER_CHUNK).toBeLessThanOrEqual(560_000);
  });

  it('partitions the domain when culling is off', () => {
    const tree = new TerrainQuadtree(store);
    tree.processDirty(Infinity);
    const nodes = tree.select({ ...cameraParams(-600, 1100, 900, 265, -10), frustum: null, maxChunks: 100_000 });
    // Area of the leaves equals the area of the in-domain L4 roots minus the out-of-domain parts:
    // check with a sample grid that every point is covered exactly once.
    const covered = new Map<string, number>();
    for (const n of nodes) {
      const s = tree.nodeSamples(n.lod);
      const { gi, gj } = tree.nodeOrigin(n.lod, n.ix, n.iz);
      for (let j = gj + 32; j < gj + s; j += 64) {
        for (let i = gi + 32; i < gi + s; i += 64) covered.set(`${i},${j}`, (covered.get(`${i},${j}`) ?? 0) + 1);
      }
    }
    for (const c of covered.values()) expect(c).toBe(1);
    const m = store.meta;
    for (let j = -480; j < m.samplesZ + 480; j += 64) {
      for (let i = -480; i < m.samplesX + 480; i += 64) {
        expect(covered.has(`${i},${j}`), `${i},${j}`).toBe(true);
      }
    }
  });

  it('refines near the camera and stays coarse over flat sea', () => {
    const tree = new TerrainQuadtree(store);
    tree.processDirty(Infinity);
    const vp = measurementViewpoints()[0];
    const nodes = tree.select({ ...cameraParams(vp.position.x, vp.position.y, vp.position.z, 0, 0), frustum: null, maxChunks: 1000 });
    const m = store.meta;
    const under = nodes.find((n) => {
      const s = tree.nodeSamples(n.lod);
      const { gi, gj } = tree.nodeOrigin(n.lod, n.ix, n.iz);
      const sx = m.sampleX(vp.position.x);
      const sz = m.sampleZ(vp.position.z);
      return sx >= gi && sx < gi + s && sz >= gj && sz < gj + s;
    });
    expect(under?.lod).toBe(0);
    // Deep sea off the north-west corner is perfectly flat: error 0, never split below the root.
    expect(tree.nodeError(MAX_LOD, 0, 0)).toBeLessThan(1);
  });
});
