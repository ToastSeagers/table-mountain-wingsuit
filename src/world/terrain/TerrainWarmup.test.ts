import { PerspectiveCamera, type WebGLRenderer } from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExitRegistry } from '../../game/ExitRegistry';
import { createWorldUniforms } from '../WorldUniforms';
import { Terrain, type WarmPose } from './Terrain';
import { BASE_URL, diskFetch } from './testFixtures';

// Headless Terrain over the committed tiles: only the GPU calls are stubbed.
const fakeBitmap = { width: 1024, height: 1024, close: () => undefined };
let uploadsPerUpdate: number[] = [];
let uploadCounter = 0;
const renderer = {
  capabilities: { getMaxAnisotropy: () => 8 },
  extensions: { has: () => true },
  initTexture: () => void uploadCounter++,
  copyTextureToTexture: () => undefined,
  domElement: { height: 720 },
} as unknown as WebGLRenderer;

const tick = (ms = 4): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function makeTerrain(builds: number, uploads: number): Promise<Terrain> {
  const exit = ExitRegistry.fromData().exits[0];
  return Terrain.create(
    {
      baseUrl: BASE_URL,
      renderer,
      uniforms: createWorldUniforms(),
      maxResidentTextureTiles: 32,
      lodErrorPx: 3,
      maxTerrainTriangles: 300_000,
      geometryBuildsPerFrame: builds,
      textureUploadsPerFrame: uploads,
      fetch: diskFetch(),
    },
    exit.position,
  );
}

function cameraAt(x: number, y: number, z: number, lookX: number, lookZ: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(70, 838 / 328, 1, 80_000);
  cam.position.set(x, y, z);
  cam.lookAt(lookX, y - 100, lookZ);
  cam.updateMatrixWorld();
  return cam;
}

beforeAll(() => {
  vi.stubGlobal('createImageBitmap', async () => fakeBitmap);
});
afterEach(() => {
  uploadsPerUpdate = [];
});

/** The browser's render loop, for the awaits that only finish when update() runs (uploads). */
async function preload(terrain: Terrain, cam: PerspectiveCamera, p: { x: number; y: number; z: number }): Promise<void> {
  let t = 0;
  const pump = setInterval(() => terrain.update(cam, (t += 1 / 60)), 8);
  try {
    await terrain.preloadAround(p, 3000);
  } finally {
    clearInterval(pump);
  }
}

/** Runs update() until `done` or the frame cap; the loader needs real time between frames. */
async function run(terrain: Terrain, cam: PerspectiveCamera, frames: number, done?: () => boolean): Promise<number> {
  let n = 0;
  for (; n < frames; n++) {
    const before = uploadCounter;
    terrain.update(cam, n / 60);
    uploadsPerUpdate.push(uploadCounter - before);
    if (done?.()) return n + 1;
    await tick();
  }
  return n;
}

describe('Terrain countdown warm-up', () => {
  it('settles once the live and warm-up chunks are built and uploaded, with a phone-sized flight budget', async () => {
    const exit = ExitRegistry.fromData().exits[0];
    const terrain = await makeTerrain(3, 1);
    const p = exit.position;
    const h = (exit.headingDeg * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const cam = cameraAt(p.x - fx * 20, p.y + 10, p.z - fz * 20, p.x + fx * 500, p.z + fz * 500);
    // Let the exit's height tiles arrive first (the real countdown waits for the sampler too).
    await preload(terrain, cam, p);
    const pose: WarmPose = {
      position: { x: p.x + fx * 400, y: p.y - 120, z: p.z + fz * 400 },
      target: { x: p.x + fx * 1900, y: p.y - 270, z: p.z + fz * 1900 },
    };

    // Without a warm-up the flight budget rules: never more than 3 builds or 1 upload in a frame.
    expect(terrain.isSettled()).toBe(false);
    await run(terrain, cam, 5);
    expect(terrain.stats.geometryBuildsThisFrame).toBeLessThanOrEqual(3);
    expect(Math.max(...uploadsPerUpdate)).toBeLessThanOrEqual(1);

    // With it, budgets lift and the queues drain, then isSettled() turns true and stays quiet.
    const liveChunks = terrain.stats.chunks;
    terrain.beginWarmup([pose]);
    expect(terrain.isSettled()).toBe(false);
    uploadsPerUpdate = [];
    const frames = await run(terrain, cam, 600, () => terrain.isSettled());
    expect(terrain.isSettled()).toBe(true);
    expect(frames).toBeLessThan(600);
    expect(terrain.stats.chunks).toBeGreaterThanOrEqual(liveChunks);
    expect(terrain.stats.geometryBuildsTotal).toBeGreaterThan(terrain.stats.chunks); // the second pose built extra geometry

    // Settled means quiet: more frames from the same pose build nothing and upload nothing.
    const builds = terrain.stats.geometryBuildsTotal;
    uploadsPerUpdate = [];
    await run(terrain, cam, 10);
    expect(terrain.stats.geometryBuildsTotal).toBe(builds);
    expect(uploadsPerUpdate.every((u) => u === 0)).toBe(true);

    // Moving to the second pose after GO needs no new geometry: that is the point of the warm-up.
    terrain.endWarmup();
    terrain.releasePreload();
    const ahead = cameraAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.z);
    await run(terrain, ahead, 8);
    expect(terrain.stats.geometryBuildsTotal - builds).toBeLessThanOrEqual(3);
    terrain.dispose();
  }, 30_000);
});
