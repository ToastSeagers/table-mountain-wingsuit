import {
  type BufferGeometry,
  DataTexture,
  Frustum,
  Group,
  Matrix4,
  PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { Vec3 } from '../../types/math';
import { makeDataTexture, detailTextureData } from '../NoiseTexture';
import { TerrainSamplerImpl } from '../TerrainSamplerImpl';
import type { WorldUniforms } from '../WorldUniforms';
import { buildChunkGeometry } from './ChunkGeometry';
import { HeightTexture } from './HeightTexture';
import { HeightTileStore } from './HeightTileStore';
import { chunkPlacement, chunkTextureSlots, MAX_TEXTURED_LOD, TerrainChunk } from './TerrainChunk';
import { DEFAULT_GEOMETRY_BUILDS_PER_FRAME, DEFAULT_TEXTURE_UPLOADS_PER_FRAME } from '../WorldSettings';
import { createTerrainSharedUniforms, type TerrainSharedUniforms } from './TerrainMaterial';
import { rectDistance, type TerrainMeta } from './TerrainMeta';
import { MAX_LOD, type QuadNode, TerrainQuadtree, TRIANGLES_PER_CHUNK } from './TerrainQuadtree';
import { streamingBudgets } from './StreamingBudgets';
import { TerrainTextureCache } from './TerrainTextureCache';
import {
  type FetchLike,
  loadTerrainMeta,
  PRIORITY_OFFSCREEN_M,
  PRIORITY_PRELOAD,
  PRIORITY_URGENT,
  TileLoader,
} from './TileLoader';

/** Built geometries kept for reuse when the LOD flips back. */
export const GEOMETRY_CACHE_SIZE = 160;
/** Texture tiles within this distance of the camera stay wanted even when off screen. */
export const TEXTURE_RING_M = 1200;
/** Camera AGL range over which the detail blend fades out (look spec: strong on the deck, gone at the exit). */
export const DETAIL_FULL_AGL_M = 150;
export const DETAIL_NONE_AGL_M = 600;

export interface TerrainOptions {
  baseUrl: string;
  renderer: WebGLRenderer;
  uniforms: WorldUniforms;
  maxResidentTextureTiles: number;
  lodErrorPx: number;
  maxTerrainTriangles: number;
  /** Flight budgets (WorldSettings); desktop defaults when omitted. */
  geometryBuildsPerFrame?: number;
  textureUploadsPerFrame?: number;
  fetch?: FetchLike;
}

/** A camera placement the countdown warms up beyond the live camera: where the flight will be in a few seconds. */
export interface WarmPose {
  position: Vec3;
  target: Vec3;
}

export interface TerrainStats {
  chunks: number;
  triangles: number;
  chunksPerLod: number[];
  heightTilesLoaded: number;
  heightTilesTotal: number;
  texturesResident: number;
  texturesLoading: number;
  texturesTotal: number;
  texturesEvicted: number;
  geometryBuildsThisFrame: number;
  /** Chunk geometries built since the terrain was created (a flight with no churn adds none after the warm-up). */
  geometryBuildsTotal: number;
  /** The warm-up queues (builds, measurements, uploads) are empty. */
  settled: boolean;
  pendingMeasurements: number;
  requestsQueued: number;
  mbFetched: number;
  cameraAglM: number;
}

interface GeomEntry {
  geometry: BufferGeometry;
  complete: boolean;
  lastUsedFrame: number;
}

/**
 * The terrain: loads tiles, selects LOD chunks each frame, keeps textures resident and exposes
 * the CPU sampler. `update()` once per frame before rendering; `group` goes in the scene.
 */
export class Terrain {
  readonly group = new Group();
  readonly sampler: TerrainSamplerImpl;
  readonly quadtree: TerrainQuadtree;
  readonly textures: TerrainTextureCache;
  readonly heightTexture: HeightTexture;
  lodErrorPx: number;
  maxTerrainTriangles: number;
  /** Flight budgets; the countdown warm-up overrides them (see StreamingBudgets). */
  geometryBuildsPerFrame: number;
  textureUploadsPerFrame: number;
  private readonly shared: TerrainSharedUniforms;
  private readonly placeholder: DataTexture;
  private readonly detail: DataTexture;
  private readonly geoms = new Map<number, GeomEntry>();
  /**
   * Geometries are recycled, never disposed while the terrain lives: they all share one index
   * buffer, and disposing any geometry would delete that buffer under the others.
   */
  private readonly freeGeoms: BufferGeometry[] = [];
  private readonly chunkPool: TerrainChunk[] = [];
  private readonly active = new Map<number, TerrainChunk>();
  private drawn: QuadNode[] = [];
  private frame = 0;
  private builds = 0;
  private buildsTotal = 0;
  private buildBacklog = 0;
  private settled = false;
  private warming = false;
  private warmPoses: WarmPose[] = [];
  private readonly warmCams: PerspectiveCamera[] = [];
  private readonly warmWanted = new Map<number, number>();
  private shadows = false;
  private readonly frustum = new Frustum();
  private readonly m4 = new Matrix4();
  private preloadPins: { col: number; row: number }[] = [];
  private agl = 0;

  private constructor(
    readonly meta: TerrainMeta,
    readonly store: HeightTileStore,
    readonly loader: TileLoader,
    private readonly renderer: WebGLRenderer,
    uniforms: WorldUniforms,
    opts: TerrainOptions,
  ) {
    this.lodErrorPx = opts.lodErrorPx;
    this.maxTerrainTriangles = opts.maxTerrainTriangles;
    this.geometryBuildsPerFrame = opts.geometryBuildsPerFrame ?? DEFAULT_GEOMETRY_BUILDS_PER_FRAME;
    this.textureUploadsPerFrame = opts.textureUploadsPerFrame ?? DEFAULT_TEXTURE_UPLOADS_PER_FRAME;
    this.sampler = new TerrainSamplerImpl(store, (col, row) => void loader.requestHeight(col, row, PRIORITY_URGENT));
    this.quadtree = new TerrainQuadtree(store);
    this.heightTexture = new HeightTexture(store);
    this.textures = new TerrainTextureCache(meta, loader, opts.maxResidentTextureTiles);
    this.textures.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    this.placeholder = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    this.placeholder.needsUpdate = true;
    this.detail = makeDataTexture(detailTextureData(), 256);
    uniforms.uDetail.value = this.detail;
    this.shared = createTerrainSharedUniforms(uniforms, meta);
    this.shared.uHeight.value = this.heightTexture.texture;
    this.shared.uOverview.value = this.placeholder;
    this.group.name = 'terrain';
  }

  /** Loads meta.json and the overview, then starts streaming every height tile (nearest first). */
  static async create(opts: TerrainOptions, focus: Vec3): Promise<Terrain> {
    const fetchFn: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
    const meta = await loadTerrainMeta(opts.baseUrl, fetchFn);
    const store = new HeightTileStore(meta);
    const loader = new TileLoader(meta, store, {
      fetch: fetchFn,
      decodeImage: (blob) => createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }),
    });
    const terrain = new Terrain(meta, store, loader, opts.renderer, opts.uniforms, opts);
    loader.setFocus(focus.x, focus.z);
    void loader.requestAllHeights();
    const overview = await terrain.textures.loadOverview(opts.renderer);
    terrain.shared.uOverview.value = overview;
    return terrain;
  }

  get stats(): TerrainStats {
    const perLod = new Array<number>(MAX_LOD + 1).fill(0);
    for (const n of this.drawn) perLod[n.lod]++;
    const ts = this.textures.stats;
    const ls = this.loader.stats;
    return {
      chunks: this.drawn.length,
      triangles: this.drawn.length * TRIANGLES_PER_CHUNK,
      chunksPerLod: perLod,
      heightTilesLoaded: this.store.loadedCount,
      heightTilesTotal: this.meta.heightTileCount,
      texturesResident: ts.resident,
      texturesLoading: ts.loading + ts.awaitingUpload,
      texturesTotal: this.meta.textureTileCount,
      texturesEvicted: ts.evicted,
      geometryBuildsThisFrame: this.builds,
      geometryBuildsTotal: this.buildsTotal,
      settled: this.settled,
      pendingMeasurements: this.quadtree.pendingMeasurements,
      requestsQueued: ls.queued + ls.running,
      mbFetched: ls.bytesFetched / 1e6,
      cameraAglM: this.agl,
    };
  }

  /** Nodes drawn last frame (for tests and the perf overlay). */
  get drawnNodes(): readonly QuadNode[] {
    return this.drawn;
  }

  setMaxResidentTextures(n: number): void {
    this.textures.maxResident = n;
  }

  /**
   * Countdown warm-up: from now until `endWarmup()` the streaming budgets are lifted, and the chunks
   * and texture tiles the flight will want from each of `poses` (as well as from the live camera)
   * are built and uploaded. `isSettled()` turns true once all of it has drained.
   */
  beginWarmup(poses: readonly WarmPose[]): void {
    this.warming = true;
    this.warmPoses = [...poses];
    this.settled = false;
  }

  endWarmup(): void {
    this.warming = false;
    this.warmPoses = [];
    this.warmWanted.clear();
  }

  /** Nothing is left queued: the selected chunks are built, node errors measured, height and texture uploads done. */
  isSettled(): boolean {
    return this.settled;
  }

  /** Lets the preload's pinned texture tiles age out like any other (called when the flight starts). */
  releasePreload(): void {
    this.textures.unpin(this.preloadPins);
    this.textures.unpinAll();
    this.preloadPins = [];
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    for (const c of [...this.chunkPool, ...this.active.values()]) {
      c.mesh.castShadow = on;
      c.mesh.receiveShadow = on;
    }
  }

  /**
   * Resolves once the height tiles and texture tiles within `radiusM` of `position` are loaded and
   * uploaded, and the sampler reports ready there. Texture tiles beyond the residency cap are
   * skipped (they stream in flight). Pins those textures until the next preload. Needs the render
   * loop (update) running, since uploads happen there.
   */
  async preloadAround(position: Vec3, radiusM: number): Promise<void> {
    this.sampler.setReadyFocus(position.x, position.z);
    this.loader.setFocus(position.x, position.z);
    const heights = this.meta
      .heightTilesInRadius(position.x, position.z, radiusM)
      .map((t, i) => this.loader.requestHeight(t.col, t.row, PRIORITY_PRELOAD + i));
    const tiles = this.meta
      .textureTilesInRadius(position.x, position.z, radiusM)
      .map((t) => ({ ...t, d: rectDistance(this.meta.textureTileRect(t.col, t.row), position.x, position.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.max(this.textures.maxResident - 8, 4));
    this.textures.unpin(this.preloadPins);
    this.preloadPins = tiles;
    await Promise.all([...heights, this.textures.preload(tiles)]);
    // Height texture uploads and node measurements happen in update(); wait for the frame.
    while (this.heightTexture.pendingUploads > 0) await nextFrame();
  }

  update(camera: PerspectiveCamera, nowS: number): void {
    this.frame++;
    this.builds = 0;
    const renderer = this.renderer;
    const budgets = streamingBudgets(this.warming, this.geometryBuildsPerFrame, this.textureUploadsPerFrame);
    this.textures.uploadsPerFrame = budgets.uploadsPerFrame;
    this.heightTexture.upload(renderer);
    this.quadtree.processDirty(budgets.measureMs);
    const cam = camera.position;
    this.loader.setFocus(cam.x, cam.z);
    this.agl = cam.y - this.sampler.peekHeight(cam.x, cam.z);
    this.shared.uDetailK.value = 1 - smoothstep(DETAIL_FULL_AGL_M, DETAIL_NONE_AGL_M, this.agl);

    camera.updateMatrixWorld();
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4, camera.coordinateSystem, camera.reversedDepth);
    const heightPx = renderer.domElement.height || 1080;
    const pxPerUnitAtDistance = heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const maxChunks = Math.floor(this.maxTerrainTriangles / TRIANGLES_PER_CHUNK);
    const nodes = this.quadtree.select({
      camX: cam.x,
      camY: cam.y,
      camZ: cam.z,
      pxPerUnitAtDistance,
      errorPx: this.lodErrorPx,
      maxChunks,
      frustum: this.frustum,
    });
    const warm = this.warming ? this.selectWarm(camera, nodes, pxPerUnitAtDistance, maxChunks) : [];
    this.drawn = this.ensureGeometry(nodes, warm, budgets.buildsPerFrame);
    this.syncChunks();
    this.updateTextures(cam.x, cam.z, nowS);
    this.trimGeometryCache(warm);
    this.settled =
      this.buildBacklog === 0 &&
      this.quadtree.pendingMeasurements === 0 &&
      this.heightTexture.pendingUploads === 0 &&
      this.textures.isIdle();
  }

  dispose(): void {
    for (const c of [...this.chunkPool, ...this.active.values()]) c.dispose();
    for (const g of this.geoms.values()) g.geometry.dispose();
    for (const g of this.freeGeoms) g.dispose();
    this.heightTexture.dispose();
    this.textures.dispose();
    this.detail.dispose();
    this.placeholder.dispose();
  }

  /**
   * Selects what each warm-up pose would draw (same LOD rules as the live camera) and returns the
   * nodes the live selection does not already hold. Their texture tiles go into `warmWanted`.
   */
  private selectWarm(camera: PerspectiveCamera, live: QuadNode[], pxPerUnitAtDistance: number, maxChunks: number): QuadNode[] {
    const have = new Set(live.map((n) => n.id));
    const out: QuadNode[] = [];
    this.warmWanted.clear();
    const meta = this.meta;
    this.warmPoses.forEach((pose, i) => {
      const cam = (this.warmCams[i] ??= new PerspectiveCamera());
      cam.projectionMatrix.copy(camera.projectionMatrix);
      cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      cam.position.set(pose.position.x, pose.position.y, pose.position.z);
      cam.up.set(0, 1, 0);
      cam.lookAt(pose.target.x, pose.target.y, pose.target.z);
      cam.updateMatrixWorld();
      this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.m4, camera.coordinateSystem, camera.reversedDepth);
      const nodes = this.quadtree.select({
        camX: pose.position.x,
        camY: pose.position.y,
        camZ: pose.position.z,
        pxPerUnitAtDistance,
        errorPx: this.lodErrorPx,
        maxChunks,
        frustum: this.frustum,
      });
      for (const n of nodes) {
        if (n.lod <= MAX_TEXTURED_LOD) {
          const p = chunkPlacement(this.quadtree, n);
          for (const idx of chunkTextureSlots(meta, n.lod, p.originX, p.originZ).slots) {
            if (idx < 0) continue;
            const rect = meta.textureTileRect(idx % meta.texCols, Math.floor(idx / meta.texCols));
            const d = rectDistance(rect, pose.position.x, pose.position.z);
            const prev = this.warmWanted.get(idx);
            if (prev === undefined || d < prev) this.warmWanted.set(idx, d);
          }
        }
        if (!have.has(n.id)) {
          have.add(n.id);
          out.push(n);
        }
      }
    });
    return out;
  }

  /**
   * Builds missing geometry for the live selection first, then (budget permitting) for the warm-up
   * poses. If too much of the live selection is missing, keeps the previous selection one more frame.
   */
  private ensureGeometry(nodes: QuadNode[], warm: QuadNode[], budget: number): QuadNode[] {
    const isMissing = (n: QuadNode): boolean => {
      const g = this.geoms.get(n.id);
      return !g || (!g.complete && this.quadtree.nodeDataLoaded(n.lod, n.ix, n.iz));
    };
    const missing = nodes.filter(isMissing);
    const buildAll = missing.length <= budget || this.drawn.length === 0;
    const toBuild = buildAll ? missing : missing.slice(0, budget);
    for (const n of toBuild) this.build(n);
    const left = buildAll ? budget - missing.length : 0;
    if (left > 0) for (const n of warm.filter(isMissing).slice(0, left)) this.build(n);
    const result = buildAll ? nodes : this.drawn.filter((n) => this.geoms.has(n.id));
    for (const n of [...result, ...warm]) {
      const g = this.geoms.get(n.id);
      if (g) g.lastUsedFrame = this.frame;
    }
    // Anything selected (live or warm) that is not built and complete is still queued.
    let backlog = 0;
    for (const n of nodes) if (!this.geoms.get(n.id)?.complete) backlog++;
    for (const n of warm) if (!this.geoms.get(n.id)?.complete) backlog++;
    this.buildBacklog = backlog;
    return result;
  }

  private build(n: QuadNode): void {
    const p = chunkPlacement(this.quadtree, n);
    const existing = this.geoms.get(n.id);
    const geometry = buildChunkGeometry(this.store, p, existing?.geometry ?? this.freeGeoms.pop());
    this.geoms.set(n.id, {
      geometry,
      complete: this.quadtree.nodeDataLoaded(n.lod, n.ix, n.iz),
      lastUsedFrame: this.frame,
    });
    this.builds++;
    this.buildsTotal++;
  }

  private syncChunks(): void {
    const want = new Set(this.drawn.map((n) => n.id));
    for (const [id, chunk] of this.active) {
      if (!want.has(id)) {
        this.group.remove(chunk.mesh);
        this.active.delete(id);
        this.chunkPool.push(chunk);
      }
    }
    for (const n of this.drawn) {
      let chunk = this.active.get(n.id);
      const g = this.geoms.get(n.id) as GeomEntry;
      if (!chunk) {
        chunk = this.chunkPool.pop() ?? new TerrainChunk(this.shared, this.placeholder);
        chunk.mesh.castShadow = this.shadows;
        chunk.mesh.receiveShadow = this.shadows;
        this.active.set(n.id, chunk);
        this.group.add(chunk.mesh);
      }
      if (chunk.nodeId !== n.id || chunk.mesh.geometry !== g.geometry) {
        chunk.assign(this.meta, n, chunkPlacement(this.quadtree, n), g.geometry);
      }
    }
  }

  private updateTextures(camX: number, camZ: number, nowS: number): void {
    const wanted = new Map<number, number>();
    const meta = this.meta;
    for (const chunk of this.active.values()) {
      if (chunk.lod > MAX_TEXTURED_LOD) continue;
      for (const idx of chunk.slots) {
        if (idx < 0 || wanted.has(idx)) continue;
        const col = idx % meta.texCols;
        const row = Math.floor(idx / meta.texCols);
        wanted.set(idx, rectDistance(meta.textureTileRect(col, row), camX, camZ));
      }
    }
    for (const t of meta.textureTilesInRadius(camX, camZ, TEXTURE_RING_M)) {
      const idx = meta.textureTileIndex(t.col, t.row);
      if (!wanted.has(idx)) {
        wanted.set(idx, PRIORITY_OFFSCREEN_M + rectDistance(meta.textureTileRect(t.col, t.row), camX, camZ));
      }
    }
    for (const [idx, d] of this.warmWanted) {
      const cur = wanted.get(idx);
      if (cur === undefined || d < cur) wanted.set(idx, d);
    }
    this.textures.update(wanted, this.frame, nowS, this.renderer);
    const get = (i: number): Texture | null => this.textures.get(i);
    const blend = (i: number): number => this.textures.blend(i, nowS);
    for (const chunk of this.active.values()) chunk.updateTextures(get, blend);
  }

  private trimGeometryCache(warm: QuadNode[]): void {
    if (this.geoms.size <= GEOMETRY_CACHE_SIZE) return;
    // Warm-up geometry counts as in use, or two poses larger than the cache would rebuild it every frame.
    const inUse = new Set([...this.drawn, ...warm].map((n) => n.id));
    const old = [...this.geoms.entries()]
      .filter(([id]) => !inUse.has(id))
      .sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);
    for (const [id, g] of old.slice(0, this.geoms.size - GEOMETRY_CACHE_SIZE)) {
      this.freeGeoms.push(g.geometry);
      this.geoms.delete(id);
    }
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function nextFrame(): Promise<void> {
  return new Promise((res) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(() => res()) : setTimeout(res, 16)));
}
