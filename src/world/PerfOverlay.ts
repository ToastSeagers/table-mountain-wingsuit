import type { WebGLRenderer } from 'three';
import type { TerrainStats } from './terrain/Terrain';

/** Frame-time window for the fps and p95 readouts. */
const WINDOW = 240;

export interface PerfSample {
  fps: number;
  frameMsMean: number;
  frameMsP95: number;
  cpuMsMean: number;
  /** GPU time per frame from EXT_disjoint_timer_query_webgl2 (NaN if unavailable). */
  gpuMsMean: number;
  gpuMsP95: number;
  triangles: number;
  drawCalls: number;
}

/**
 * `?dev=1` overlay: fps, frame-time mean and p95, CPU time per frame, triangles and draw calls
 * from renderer.info, and the terrain's chunk/LOD/tile counts. Toggle with P.
 */
export class PerfOverlay {
  readonly el: HTMLDivElement;
  readonly gpu: string;
  private readonly frameMs: number[] = [];
  private readonly cpuMs: number[] = [];
  private readonly gpuMs: number[] = [];
  private readonly gl: WebGL2RenderingContext;
  private readonly timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly inFlight: WebGLQuery[] = [];
  private readonly freeQueries: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private lastS = -1;
  private lastDrawS = 0;
  private tris = 0;
  private calls = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    parent: HTMLElement = document.body,
  ) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '8px',
      top: '8px',
      zIndex: '20',
      padding: '6px 8px',
      font: '12px/1.35 ui-monospace, Consolas, monospace',
      color: '#e8f0e8',
      background: 'rgba(10, 12, 20, 0.72)',
      whiteSpace: 'pre',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
    this.gpu = gpuName(renderer);
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.timer;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
    });
  }

  /** Starts timing this frame's GPU work (call before World.frame). */
  gpuBegin(): void {
    if (!this.timer || this.active) return;
    const q = this.freeQueries.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  /** Ends timing and collects any finished results from earlier frames. */
  gpuEnd(): void {
    const gl = this.gl;
    if (!this.timer) return;
    if (this.active) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.inFlight.push(this.active);
      this.active = null;
    }
    const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT) as boolean;
    while (this.inFlight.length > 0 && gl.getQueryParameter(this.inFlight[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.inFlight.shift() as WebGLQuery;
      if (!disjoint) push(this.gpuMs, (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
      this.freeQueries.push(q);
    }
  }

  /** Call after renderer.render with the frame's timestamp and CPU time spent in update+render. */
  record(nowS: number, cpuMs: number): void {
    if (this.lastS >= 0) push(this.frameMs, (nowS - this.lastS) * 1000);
    this.lastS = nowS;
    push(this.cpuMs, cpuMs);
    this.tris = this.renderer.info.render.triangles;
    this.calls = this.renderer.info.render.calls;
  }

  sample(): PerfSample {
    const mean = avg(this.frameMs);
    const sorted = [...this.frameMs].sort((a, b) => a - b);
    const gsorted = [...this.gpuMs].sort((a, b) => a - b);
    return {
      fps: mean > 0 ? 1000 / mean : 0,
      frameMsMean: mean,
      frameMsP95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      cpuMsMean: avg(this.cpuMs),
      gpuMsMean: gsorted.length ? avg(this.gpuMs) : Number.NaN,
      gpuMsP95: gsorted.length ? gsorted[Math.floor(gsorted.length * 0.95)] : Number.NaN,
      triangles: this.tris,
      drawCalls: this.calls,
    };
  }

  draw(nowS: number, t: TerrainStats, extra: string): void {
    if (nowS - this.lastDrawS < 0.25 || this.el.style.display === 'none') return;
    this.lastDrawS = nowS;
    const s = this.sample();
    const c = this.renderer.domElement;
    this.el.textContent = [
      `${s.fps.toFixed(1)} fps  ${s.frameMsMean.toFixed(2)} ms  p95 ${s.frameMsP95.toFixed(2)} ms  cpu ${s.cpuMsMean.toFixed(2)} ms  gpu ${s.gpuMsMean.toFixed(2)} ms (p95 ${s.gpuMsP95.toFixed(2)})`,
      `tris ${(s.triangles / 1000).toFixed(0)}k  calls ${s.drawCalls}  chunks ${t.chunks} [${t.chunksPerLod.join(' ')}]`,
      `height tiles ${t.heightTilesLoaded}/${t.heightTilesTotal}  textures ${t.texturesResident} resident, ${t.texturesLoading} loading, ${t.texturesEvicted} evicted`,
      `queued ${t.requestsQueued}  fetched ${t.mbFetched.toFixed(1)} MB  measuring ${t.pendingMeasurements}  builds ${t.geometryBuildsThisFrame}`,
      `${c.width}x${c.height}  AGL ${t.cameraAglM.toFixed(0)} m  ${this.gpu}`,
      extra,
    ].join('\n');
  }
}

export function gpuName(renderer: WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

function push(a: number[], v: number): void {
  a.push(v);
  if (a.length > WINDOW) a.shift();
}

function avg(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}
