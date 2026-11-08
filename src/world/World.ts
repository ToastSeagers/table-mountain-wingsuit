import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Vec3 } from '../types/math';
import { Fog } from './Fog';
import { Sea } from './Sea';
import { Sky } from './Sky';
import { Sun } from './Sun';
import { Terrain } from './terrain/Terrain';
import type { FetchLike } from './terrain/TileLoader';
import {
  cloneSettings,
  DEFAULT_WORLD_SETTINGS,
  mergeSettings,
  type WorldSettings,
  type WorldSettingsPatch,
} from './WorldSettings';
import { createWorldUniforms, type WorldUniforms } from './WorldUniforms';

export const CAMERA_NEAR_M = 1;
export const CAMERA_FAR_M = 80_000;
export const CAMERA_FOV_DEG = 70;

export interface WorldOptions {
  container: HTMLElement;
  /** Where loading starts: tiles nearest this point arrive first. */
  focus: Vec3;
  settings?: WorldSettingsPatch;
  terrainBaseUrl?: string;
  fetch?: FetchLike;
}

/**
 * Renderer, scene, camera and everything in src/world: terrain, sky, sun, fog and sea. Stage 4
 * drives `camera` and calls `frame()` each animation frame; Stage 5 changes looks through
 * `applySettings()`.
 */
export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly uniforms: WorldUniforms;
  readonly sun: Sun;
  readonly fog: Fog;
  readonly sky: Sky;
  readonly sea: Sea;
  readonly terrain: Terrain;
  /** Which depth trick is active, for the report and the perf overlay. */
  readonly depthMode: 'reversed' | 'logarithmic';
  /** Stage 5 hook: when set, replaces the plain render (the post stack renders through this). */
  renderHook: ((scene: Scene, camera: PerspectiveCamera) => void) | null = null;
  private current: WorldSettings;
  private readonly tmp = new Vector3();

  private constructor(
    renderer: WebGLRenderer,
    depthMode: 'reversed' | 'logarithmic',
    uniforms: WorldUniforms,
    terrain: Terrain,
    settings: WorldSettings,
  ) {
    this.renderer = renderer;
    this.depthMode = depthMode;
    this.uniforms = uniforms;
    this.terrain = terrain;
    this.current = settings;
    this.camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR_M, CAMERA_FAR_M);
    this.camera.rotation.order = 'YXZ';
    this.sun = new Sun(uniforms, settings.sun);
    this.fog = new Fog(uniforms, settings.fog);
    this.sky = new Sky(uniforms, settings.sky);
    this.sea = new Sea(uniforms, terrain.meta.bounds);
    this.scene.add(terrain.group, this.sky.mesh, this.sea.mesh, this.sun.light, this.sun.light.target);
    this.applySettings({});
  }

  static async create(opts: WorldOptions): Promise<World> {
    const settings = mergeSettings(DEFAULT_WORLD_SETTINGS, opts.settings ?? {});
    // Reverse-Z keeps depth precise from 1 m to 80 km; fall back to a log depth buffer without it.
    const probe = document.createElement('canvas').getContext('webgl2');
    const clipControl = !!probe?.getExtension('EXT_clip_control');
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    const renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      reversedDepthBuffer: clipControl,
      logarithmicDepthBuffer: !clipControl,
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    opts.container.appendChild(renderer.domElement);
    const uniforms = createWorldUniforms();
    const terrain = await Terrain.create(
      {
        baseUrl: opts.terrainBaseUrl ?? `${import.meta.env.BASE_URL}terrain/`,
        renderer,
        uniforms,
        maxResidentTextureTiles: settings.maxResidentTextureTiles,
        lodErrorPx: settings.lodErrorPx,
        maxTerrainTriangles: settings.maxTerrainTriangles,
        fetch: opts.fetch,
      },
      opts.focus,
    );
    const world = new World(
      renderer,
      renderer.capabilities.reversedDepthBuffer ? 'reversed' : 'logarithmic',
      uniforms,
      terrain,
      settings,
    );
    world.resize(opts.container.clientWidth || window.innerWidth, opts.container.clientHeight || window.innerHeight);
    return world;
  }

  get settings(): Readonly<WorldSettings> {
    return this.current;
  }

  /** Applies any subset of WorldSettings (quality presets, time of day, fog look). */
  applySettings(patch: WorldSettingsPatch): void {
    this.current = mergeSettings(this.current, patch);
    const s = this.current;
    this.sun.set(s.sun);
    this.fog.set(s.fog);
    this.sky.set(s.sky);
    this.terrain.setMaxResidentTextures(s.maxResidentTextureTiles);
    this.terrain.lodErrorPx = s.lodErrorPx;
    this.terrain.maxTerrainTriangles = s.maxTerrainTriangles;
    this.renderer.toneMappingExposure = s.exposure;
    this.applyPixelRatio();
    const shadow = this.sun.light.shadow;
    if (shadow.mapSize.x !== s.shadowMapSize) {
      shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
    const half = s.shadowExtentM / 2;
    Object.assign(shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 20_000 });
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.0004;
    this.renderer.shadowMap.enabled = s.shadows;
    this.sun.light.castShadow = s.shadows;
    this.terrain.setShadows(s.shadows);
  }

  /** A copy of the current settings, for a settings panel to edit and apply back. */
  snapshotSettings(): WorldSettings {
    return cloneSettings(this.current);
  }

  /** Fraction of the preset's pixel ratio actually rendered; the results screen covers most of the frame. */
  private renderScale = 1;

  setRenderScale(scale: number): void {
    if (scale === this.renderScale) return;
    this.renderScale = scale;
    this.applyPixelRatio();
    this.resize(this.renderer.domElement.clientWidth || window.innerWidth, this.renderer.domElement.clientHeight || window.innerHeight);
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.current.maxPixelRatio) * this.renderScale);
  }

  resize(widthPx: number, heightPx: number): void {
    this.renderer.setSize(widthPx, heightPx);
    this.camera.aspect = widthPx / heightPx;
    this.camera.updateProjectionMatrix();
  }

  /** Per-frame update (terrain LOD and streaming, sky and sea follow the camera), then render. */
  frame(nowS: number): void {
    this.uniforms.uTime.value = nowS;
    this.terrain.update(this.camera, nowS);
    this.sky.update(this.camera.position);
    this.sea.update(this.camera.position);
    if (this.current.shadows) this.placeShadowCamera();
    if (this.renderHook) this.renderHook(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  /** The shadow box covers the ground ahead of the camera; light sits up-sun of it. */
  private placeShadowCamera(): void {
    const cam = this.camera;
    const fwd = cam.getWorldDirection(this.tmp);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize().multiplyScalar(this.current.shadowExtentM * 0.3);
    const cx = cam.position.x + fwd.x;
    const cz = cam.position.z + fwd.z;
    const cy = this.terrain.sampler.peekHeight(cx, cz);
    const light = this.sun.light;
    light.target.position.set(cx, cy, cz);
    light.position.copy(this.sun.direction).multiplyScalar(8000).add(light.target.position);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  }
}
