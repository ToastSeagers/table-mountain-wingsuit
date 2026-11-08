import { DevCamera } from './DevCamera';
import { PerfOverlay, type PerfSample } from './PerfOverlay';
import type { TerrainStats } from './terrain/Terrain';
import { checkpointPosition, measurementViewpoints, type Viewpoint } from './viewpoints';
import { World } from './World';
import type { WorldSettingsPatch } from './WorldSettings';

/** Attract orbit (no `?dev=1`): around the upper cable station, the western edge of the Table. */
const ORBIT_RADIUS_M = 3800;
const ORBIT_HEIGHT_M = 1500;
const ORBIT_PERIOD_S = 240;

export interface StartOptions {
  dev: boolean;
  /** Viewpoint id to open at (`?view=`). */
  view?: string | null;
  settings?: WorldSettingsPatch;
}

/** Dev hook on `window.__tmw` (only with `?dev=1`) used for the Stage 2 measurements. */
export interface DevHook {
  world: World;
  views: Viewpoint[];
  goto(id: string): void;
  stats(): TerrainStats & PerfSample;
  /** Waits for streaming to settle, then averages over `seconds`. */
  measure(seconds: number): Promise<Record<string, unknown>>;
  /** Renders one frame and returns the canvas as a PNG. */
  capture(): Promise<Blob>;
}

/**
 * Boots the world into `container`: the Stage 2 replacement for the Stage 0 demo scene. With
 * `dev`, adds the free-fly camera, the perf overlay and `window.__tmw`; otherwise the camera
 * slowly orbits the Table.
 */
export async function startWorld(container: HTMLElement, opts: StartOptions): Promise<World> {
  const views = measurementViewpoints();
  const startView = views.find((v) => v.id === opts.view) ?? views[0];
  const centre = checkpointPosition('Upper cable station') ?? startView.position;
  const world = await World.create({
    container,
    focus: opts.dev ? startView.position : centre,
    settings: opts.settings,
  });
  window.addEventListener('resize', () => world.resize(container.clientWidth, container.clientHeight));

  let devCam: DevCamera | null = null;
  let overlay: PerfOverlay | null = null;
  let currentView = startView.id;
  if (opts.dev) {
    devCam = new DevCamera(world.camera, world.renderer.domElement, views, (vp) => {
      currentView = vp.id;
      void world.terrain.preloadAround(vp.position, 1500);
    });
    devCam.goto(startView);
    overlay = new PerfOverlay(world.renderer);
    installDevHook(world, views, devCam, overlay, () => currentView);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG') world.applySettings({ shadows: !world.settings.shadows });
    });
  }

  let lastS = performance.now() / 1000;
  world.renderer.setAnimationLoop((timeMs: number) => {
    const nowS = timeMs / 1000;
    const dtS = Math.min(nowS - lastS, 0.1);
    lastS = nowS;
    const t0 = performance.now();
    if (devCam) devCam.update(dtS);
    else orbit(world, centre, nowS);
    overlay?.gpuBegin();
    world.frame(nowS);
    overlay?.gpuEnd();
    if (overlay) {
      overlay.record(nowS, performance.now() - t0);
      overlay.draw(
        nowS,
        world.terrain.stats,
        `view ${currentView}  speed ${devCam?.speedMps.toFixed(0)} m/s  shadows ${world.settings.shadows ? 'on' : 'off'} (G)  depth ${world.depthMode}`,
      );
    }
  });
  return world;
}

function orbit(world: World, centre: { x: number; y: number; z: number }, nowS: number): void {
  const a = (nowS / ORBIT_PERIOD_S) * Math.PI * 2;
  const cam = world.camera;
  cam.position.set(centre.x - Math.cos(a) * ORBIT_RADIUS_M, ORBIT_HEIGHT_M, centre.z + Math.sin(a) * ORBIT_RADIUS_M);
  cam.lookAt(centre.x, centre.y * 0.6, centre.z);
}

function installDevHook(
  world: World,
  views: Viewpoint[],
  devCam: DevCamera,
  overlay: PerfOverlay,
  viewId: () => string,
): void {
  const hook: DevHook = {
    world,
    views,
    goto(id) {
      const vp = views.find((v) => v.id === id);
      if (!vp) throw new Error(`no viewpoint ${id}`);
      devCam.goto(vp);
    },
    stats() {
      return { ...world.terrain.stats, ...overlay.sample() };
    },
    async measure(seconds) {
      const t0 = performance.now();
      for (;;) {
        const s = world.terrain.stats;
        const settled = s.requestsQueued === 0 && s.pendingMeasurements === 0 && s.texturesLoading === 0;
        if (settled || performance.now() - t0 > 30_000) break;
        await sleep(250);
      }
      await sleep(1000); // let cross-fades finish and the frame window fill with settled frames
      const tris: number[] = [];
      const calls: number[] = [];
      const fps: number[] = [];
      const p95: number[] = [];
      const cpu: number[] = [];
      const gpu: number[] = [];
      const gpu95: number[] = [];
      const end = performance.now() + seconds * 1000;
      while (performance.now() < end) {
        await sleep(500);
        const s = overlay.sample();
        tris.push(s.triangles);
        calls.push(s.drawCalls);
        fps.push(s.fps);
        p95.push(s.frameMsP95);
        cpu.push(s.cpuMsMean);
        gpu.push(s.gpuMsMean);
        gpu95.push(s.gpuMsP95);
      }
      const t = world.terrain.stats;
      const c = world.renderer.domElement;
      return {
        view: viewId(),
        gpu: overlay.gpu,
        canvas: `${c.width}x${c.height}`,
        shadows: world.settings.shadows,
        fps: round(mean(fps), 1),
        fpsMin: round(Math.min(...fps), 1),
        frameMsP95: round(Math.max(...p95), 2),
        cpuMs: round(mean(cpu), 2),
        gpuMs: round(mean(gpu), 2),
        gpuMsP95: round(Math.max(...gpu95), 2),
        triangles: Math.round(mean(tris)),
        trianglesMax: Math.max(...tris),
        drawCalls: Math.round(mean(calls)),
        drawCallsMax: Math.max(...calls),
        chunks: t.chunks,
        chunksPerLod: t.chunksPerLod,
        heightTilesLoaded: t.heightTilesLoaded,
        texturesResident: t.texturesResident,
        settleS: round((performance.now() - t0) / 1000 - seconds, 1),
      };
    },
    capture() {
      world.frame(performance.now() / 1000);
      return new Promise<Blob>((res, rej) =>
        world.renderer.domElement.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
      );
    },
  };
  (window as unknown as { __tmw: DevHook }).__tmw = hook;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
