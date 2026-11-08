import { Box3, type Frustum } from 'three';
import type { HeightTileStore } from './HeightTileStore';
import type { TerrainMeta } from './TerrainMeta';

/** Cells per chunk side at every level; a chunk is 64 x 64 cells at stride 2^lod samples. */
export const CHUNK_CELLS = 64;
/** Coarsest level: 2^4 = 16 sample stride, 1024 samples (5120 m) per root. */
export const MAX_LOD = 4;
export const ROOT_SAMPLES = CHUNK_CELLS << MAX_LOD;
/** The domain reaches this many samples past the data on every side (the apron). */
export const APRON_SAMPLES = 512;
/** Triangles in one chunk: the 64 x 64 grid plus 4 skirts of 64 quads. */
export const TRIANGLES_PER_CHUNK = CHUNK_CELLS * CHUNK_CELLS * 2 + 4 * CHUNK_CELLS * 2;
/**
 * Error assumed for a node before its height data has arrived and been measured (metres).
 * Generous so unmeasured areas refine rather than look blocky.
 */
const DEFAULT_LEVEL_ERROR_M = [0, 10, 25, 60, 140];
const DEFAULT_MIN_Y = -10;
const DEFAULT_MAX_Y = 1100;

export interface QuadNode {
  id: number;
  lod: number;
  ix: number;
  iz: number;
}

export interface SelectParams {
  camX: number;
  camY: number;
  camZ: number;
  /** viewportHeightPx / (2 tan(fovY / 2)): converts metres at distance d into pixels. */
  pxPerUnitAtDistance: number;
  /** Split while the projected error exceeds this many pixels. */
  errorPx: number;
  /** Hard cap on drawn chunks (triangle budget / TRIANGLES_PER_CHUNK). */
  maxChunks: number;
  /** Nodes outside it are neither split nor drawn; null disables culling (tests). */
  frustum: Frustum | null;
}

export interface NodeBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface Level {
  nx: number;
  nz: number;
  idOffset: number;
  err: Float32Array; // NaN = not measured yet
  minY: Float32Array;
  maxY: Float32Array;
}

/**
 * Quadtree LOD over the height grid plus apron: a forest of 5120 m roots, five levels, selection by
 * screen-space error with a hard chunk cap. Node errors are measured from the data as height
 * tiles arrive (time-sliced via processDirty) and bounded hierarchically, so a node's error is a
 * true upper bound on |its mesh - the full-resolution mesh|.
 */
export class TerrainQuadtree {
  /** Global sample index of the domain's north-west corner. */
  readonly originGi = -APRON_SAMPLES;
  readonly originGj = -APRON_SAMPLES;
  readonly levels: Level[] = [];
  private readonly dirtyL1 = new Set<number>();
  private readonly dirtyUp: Set<number>[] = [];
  private readonly box = new Box3();
  private readonly limitMaxGi: number;
  private readonly limitMaxGj: number;

  constructor(private readonly store: HeightTileStore) {
    const meta = store.meta;
    this.limitMaxGi = meta.samplesX - 1 + APRON_SAMPLES;
    this.limitMaxGj = meta.samplesZ - 1 + APRON_SAMPLES;
    const rootsX = Math.ceil((this.limitMaxGi - this.originGi) / ROOT_SAMPLES);
    const rootsZ = Math.ceil((this.limitMaxGj - this.originGj) / ROOT_SAMPLES);
    let idOffset = 0;
    for (let lod = 0; lod <= MAX_LOD; lod++) {
      const f = 1 << (MAX_LOD - lod);
      const nx = rootsX * f;
      const nz = rootsZ * f;
      const n = nx * nz;
      this.levels.push({
        nx,
        nz,
        idOffset,
        err: new Float32Array(n).fill(Number.NaN),
        minY: new Float32Array(n).fill(Number.NaN),
        maxY: new Float32Array(n).fill(Number.NaN),
      });
      this.dirtyUp.push(new Set());
      idOffset += n;
    }
    this.levels[0].err.fill(0); // L0 is the full-resolution mesh by definition
    for (let row = 0; row < meta.heightRows; row++) {
      for (let col = 0; col < meta.heightCols; col++) if (store.has(col, row)) this.markTileDirty(col, row);
    }
    store.onTile((col, row) => this.markTileDirty(col, row));
  }

  get meta(): TerrainMeta {
    return this.store.meta;
  }

  get rootsX(): number {
    return this.levels[MAX_LOD].nx;
  }

  get rootsZ(): number {
    return this.levels[MAX_LOD].nz;
  }

  /** Samples per node side at a level. */
  nodeSamples(lod: number): number {
    return CHUNK_CELLS << lod;
  }

  nodeId(lod: number, ix: number, iz: number): number {
    const l = this.levels[lod];
    return l.idOffset + iz * l.nx + ix;
  }

  /** Global sample index of a node's north-west corner. */
  nodeOrigin(lod: number, ix: number, iz: number): { gi: number; gj: number } {
    const s = this.nodeSamples(lod);
    return { gi: this.originGi + ix * s, gj: this.originGj + iz * s };
  }

  /** Whether any part of the node lies inside data + apron. */
  inDomain(lod: number, ix: number, iz: number): boolean {
    const { gi, gj } = this.nodeOrigin(lod, ix, iz);
    return gi < this.limitMaxGi && gj < this.limitMaxGj;
  }

  /** Measured error (metres), or the level default while unmeasured. */
  nodeError(lod: number, ix: number, iz: number): number {
    const l = this.levels[lod];
    const e = l.err[iz * l.nx + ix];
    return Number.isNaN(e) ? DEFAULT_LEVEL_ERROR_M[lod] : e;
  }

  nodeMeasured(lod: number, ix: number, iz: number): boolean {
    const l = this.levels[lod];
    return !Number.isNaN(l.err[iz * l.nx + ix]) && !Number.isNaN(l.minY[iz * l.nx + ix]);
  }

  nodeBox(lod: number, ix: number, iz: number, out: NodeBox): NodeBox {
    const meta = this.store.meta;
    const s = this.nodeSamples(lod);
    const { gi, gj } = this.nodeOrigin(lod, ix, iz);
    const l = this.levels[lod];
    const k = iz * l.nx + ix;
    const minY = l.minY[k];
    const maxY = l.maxY[k];
    out.minX = meta.worldX(gi);
    out.maxX = meta.worldX(gi + s);
    out.minZ = meta.worldZ(gj);
    out.maxZ = meta.worldZ(gj + s);
    out.minY = (Number.isNaN(minY) ? DEFAULT_MIN_Y : minY) - this.skirtDepth(lod, ix, iz);
    out.maxY = Number.isNaN(maxY) ? DEFAULT_MAX_Y : maxY;
    return out;
  }

  /**
   * Skirt length for a chunk: deep enough to cover the gap to a neighbour up to two levels
   * coarser, which is bounded by that coarser level's error here.
   */
  skirtDepth(lod: number, ix: number, iz: number): number {
    const up = Math.min(lod + 2, MAX_LOD);
    const shift = up - lod;
    const e = this.nodeError(up, ix >> shift, iz >> shift);
    return Math.min(3 + e, 300);
  }

  /** Number of nodes still waiting for an error measurement. */
  get pendingMeasurements(): number {
    let n = this.dirtyL1.size;
    for (const s of this.dirtyUp) n += s.size;
    return n;
  }

  /**
   * Measures node errors for areas whose height tiles have arrived, for at most `budgetMs`.
   * Returns true when nothing is left to do.
   */
  processDirty(budgetMs: number, now: () => number = defaultNow): boolean {
    const t0 = now();
    for (const k of this.dirtyL1) {
      if (now() - t0 > budgetMs) return false;
      this.dirtyL1.delete(k);
      const l1 = this.levels[1];
      this.measureL1(k % l1.nx, Math.floor(k / l1.nx));
    }
    for (let lod = 2; lod <= MAX_LOD; lod++) {
      for (const k of this.dirtyUp[lod]) {
        if (now() - t0 > budgetMs) return false;
        this.dirtyUp[lod].delete(k);
        const l = this.levels[lod];
        this.measureUpper(lod, k % l.nx, Math.floor(k / l.nx));
      }
    }
    return true;
  }

  /**
   * Deterministic greedy refinement: start from the visible roots, repeatedly split the node with
   * the largest projected error (ties by id) while it exceeds `errorPx` and the chunk cap allows.
   * Returns the leaves sorted by id.
   */
  select(p: SelectParams): QuadNode[] {
    const leaves = new Map<number, QuadNode>();
    const heap = new NodeHeap();
    const box: NodeBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    const consider = (lod: number, ix: number, iz: number): boolean => {
      if (!this.inDomain(lod, ix, iz)) return false;
      this.nodeBox(lod, ix, iz, box);
      if (p.frustum && !this.boxInFrustum(box, p.frustum)) return false;
      const node: QuadNode = { id: this.nodeId(lod, ix, iz), lod, ix, iz };
      leaves.set(node.id, node);
      if (lod > 0) {
        const d = boxDistance(box, p.camX, p.camY, p.camZ);
        const rho = (this.nodeError(lod, ix, iz) * p.pxPerUnitAtDistance) / Math.max(d, 1e-3);
        heap.push(rho, node);
      }
      return true;
    };
    for (let iz = 0; iz < this.rootsZ; iz++) for (let ix = 0; ix < this.rootsX; ix++) consider(MAX_LOD, ix, iz);
    // A split costs (visible children - 1) chunks; skip splits that would break the cap.
    const childBox: NodeBox = { ...box };
    while (heap.size > 0) {
      const { rho, node } = heap.pop();
      if (rho <= p.errorPx) break;
      const cl = node.lod - 1;
      let visible = 0;
      for (let c = 0; c < 4; c++) {
        const cx = node.ix * 2 + (c & 1);
        const cz = node.iz * 2 + (c >> 1);
        if (!this.inDomain(cl, cx, cz)) continue;
        if (p.frustum && !this.boxInFrustum(this.nodeBox(cl, cx, cz, childBox), p.frustum)) continue;
        visible++;
      }
      if (leaves.size - 1 + visible > p.maxChunks) continue;
      leaves.delete(node.id);
      for (let c = 0; c < 4; c++) consider(cl, node.ix * 2 + (c & 1), node.iz * 2 + (c >> 1));
    }
    return [...leaves.values()].sort((a, b) => a.id - b.id);
  }

  private boxInFrustum(b: NodeBox, f: Frustum): boolean {
    this.box.min.set(b.minX, b.minY, b.minZ);
    this.box.max.set(b.maxX, b.maxY, b.maxZ);
    return f.intersectsBox(this.box);
  }

  private markTileDirty(col: number, row: number): void {
    const meta = this.store.meta;
    // Samples whose value or apron value depends on this tile; edge tiles feed the apron too.
    const cpt = meta.cellsPerHeightTile;
    let gi0 = col * cpt;
    let gi1 = (col + 1) * cpt;
    let gj0 = row * cpt;
    let gj1 = (row + 1) * cpt;
    if (col === 0) gi0 = this.originGi;
    if (row === 0) gj0 = this.originGj;
    if (col === meta.heightCols - 1) gi1 = this.limitMaxGi;
    if (row === meta.heightRows - 1) gj1 = this.limitMaxGj;
    const s = this.nodeSamples(1);
    const l1 = this.levels[1];
    // A sample on a node boundary belongs to both nodes, hence the -1.
    const ix0 = Math.max(0, Math.floor((gi0 - this.originGi - 1) / s));
    const iz0 = Math.max(0, Math.floor((gj0 - this.originGj - 1) / s));
    const ix1 = Math.min(l1.nx - 1, Math.floor((gi1 - this.originGi) / s));
    const iz1 = Math.min(l1.nz - 1, Math.floor((gj1 - this.originGj) / s));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) this.dirtyL1.add(iz * l1.nx + ix);
  }

  /** All height tiles a node's samples (including clamped apron samples) read from are loaded. */
  nodeDataLoaded(lod: number, ix: number, iz: number): boolean {
    const s = this.nodeSamples(lod);
    const { gi, gj } = this.nodeOrigin(lod, ix, iz);
    const meta = this.store.meta;
    const cpt = meta.cellsPerHeightTile;
    const ci0 = clamp(gi, 0, meta.samplesX - 1);
    const ci1 = clamp(gi + s, 0, meta.samplesX - 1);
    const cj0 = clamp(gj, 0, meta.samplesZ - 1);
    const cj1 = clamp(gj + s, 0, meta.samplesZ - 1);
    for (let row = meta.heightRowForSample(cj0); row <= Math.floor(Math.min(cj1, meta.samplesZ - 2) / cpt); row++) {
      for (let col = meta.heightColForSample(ci0); col <= Math.floor(Math.min(ci1, meta.samplesX - 2) / cpt); col++) {
        if (!this.store.has(col, row)) return false;
      }
    }
    return true;
  }

  /** L1 error against every full-resolution sample, plus L1 and L0 height ranges. */
  private measureL1(ix: number, iz: number): void {
    if (!this.nodeDataLoaded(1, ix, iz)) return; // re-queued when the missing tile arrives
    const store = this.store;
    const { gi, gj } = this.nodeOrigin(1, ix, iz);
    const l0 = this.levels[0];
    const l1 = this.levels[1];
    let err = 0;
    const q = [Infinity, Infinity, Infinity, Infinity];
    const Q = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (let cj = 0; cj < CHUNK_CELLS; cj++) {
      for (let ci = 0; ci < CHUNK_CELLS; ci++) {
        const a = gi + ci * 2;
        const b = gj + cj * 2;
        const h00 = store.sampleWithApron(a, b);
        const h10 = store.sampleWithApron(a + 2, b);
        const h01 = store.sampleWithApron(a, b + 2);
        const h11 = store.sampleWithApron(a + 2, b + 2);
        for (let dj = 0; dj <= 2; dj++) {
          for (let di = 0; di <= 2; di++) {
            const h = store.sampleWithApron(a + di, b + dj);
            const fx = di / 2;
            const fz = dj / 2;
            const m = fx >= fz ? h00 + fx * (h10 - h00) + fz * (h11 - h10) : h00 + fz * (h01 - h00) + fx * (h11 - h01);
            const e = visibleDiff(h, m);
            if (e > err) err = e;
            // Children: quadrant of this sample (edge samples count for both sides).
            const sx = ci * 2 + di;
            const sz = cj * 2 + dj;
            for (let c = 0; c < 4; c++) {
              const ox = (c & 1) * CHUNK_CELLS;
              const oz = (c >> 1) * CHUNK_CELLS;
              if (sx >= ox && sx <= ox + CHUNK_CELLS && sz >= oz && sz <= oz + CHUNK_CELLS) {
                if (h < q[c]) q[c] = h;
                if (h > Q[c]) Q[c] = h;
              }
            }
          }
        }
      }
    }
    const k1 = iz * l1.nx + ix;
    l1.err[k1] = err;
    l1.minY[k1] = Math.min(q[0], q[1], q[2], q[3]);
    l1.maxY[k1] = Math.max(Q[0], Q[1], Q[2], Q[3]);
    for (let c = 0; c < 4; c++) {
      const k0 = (iz * 2 + (c >> 1)) * l0.nx + ix * 2 + (c & 1);
      l0.minY[k0] = q[c];
      l0.maxY[k0] = Q[c];
    }
    if (MAX_LOD >= 2) this.dirtyUp[2].add((iz >> 1) * this.levels[2].nx + (ix >> 1));
  }

  /** Parent error = max child error + max deviation of child vertices from the parent mesh. */
  private measureUpper(lod: number, ix: number, iz: number): void {
    const l = this.levels[lod];
    const lc = this.levels[lod - 1];
    let childErr = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let c = 0; c < 4; c++) {
      const cx = ix * 2 + (c & 1);
      const cz = iz * 2 + (c >> 1);
      if (!this.inDomain(lod - 1, cx, cz)) continue; // never drawn, never measured
      const k = cz * lc.nx + cx;
      const e = lc.err[k];
      if (Number.isNaN(e) || Number.isNaN(lc.minY[k])) return; // wait for every child
      childErr = Math.max(childErr, e);
      minY = Math.min(minY, lc.minY[k]);
      maxY = Math.max(maxY, lc.maxY[k]);
    }
    const store = this.store;
    const { gi, gj } = this.nodeOrigin(lod, ix, iz);
    const S = 1 << lod;
    const h = S >> 1;
    let dev = 0;
    for (let cj = 0; cj < CHUNK_CELLS; cj++) {
      for (let ci = 0; ci < CHUNK_CELLS; ci++) {
        const a = gi + ci * S;
        const b = gj + cj * S;
        const h00 = store.sampleWithApron(a, b);
        const h10 = store.sampleWithApron(a + S, b);
        const h01 = store.sampleWithApron(a, b + S);
        const h11 = store.sampleWithApron(a + S, b + S);
        // The five child vertices inside this parent cell that are not parent vertices.
        const mid = store.sampleWithApron(a + h, b + h);
        const n = store.sampleWithApron(a + h, b);
        const w = store.sampleWithApron(a, b + h);
        const e = store.sampleWithApron(a + S, b + h);
        const s = store.sampleWithApron(a + h, b + S);
        dev = Math.max(
          dev,
          visibleDiff(mid, (h00 + h11) / 2),
          visibleDiff(n, (h00 + h10) / 2),
          visibleDiff(w, (h00 + h01) / 2),
          visibleDiff(e, (h10 + h11) / 2),
          visibleDiff(s, (h01 + h11) / 2),
        );
      }
    }
    const k = iz * l.nx + ix;
    l.err[k] = childErr + dev;
    l.minY[k] = minY;
    l.maxY[k] = maxY;
    if (lod < MAX_LOD) this.dirtyUp[lod + 1].add((iz >> 1) * this.levels[lod + 1].nx + (ix >> 1));
  }
}

/**
 * Height difference as seen: anything below sea level is hidden under the opaque sea plane, so
 * only the apron (the one place heights go negative) is affected; inside the data heights are
 * never below 0 and this is a plain absolute difference.
 */
function visibleDiff(a: number, b: number): number {
  return Math.abs(Math.max(a, 0) - Math.max(b, 0));
}

function boxDistance(b: NodeBox, x: number, y: number, z: number): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dy = Math.max(b.minY - y, 0, y - b.maxY);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Max-heap on rho, ties broken by smaller id first, so selection is order-independent. */
class NodeHeap {
  private readonly rho: number[] = [];
  private readonly nodes: QuadNode[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(rho: number, node: QuadNode): void {
    this.rho.push(rho);
    this.nodes.push(node);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): { rho: number; node: QuadNode } {
    const top = { rho: this.rho[0], node: this.nodes[0] };
    const lastR = this.rho.pop() as number;
    const lastN = this.nodes.pop() as QuadNode;
    if (this.nodes.length > 0) {
      this.rho[0] = lastR;
      this.nodes[0] = lastN;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.nodes.length && this.before(l, m)) m = l;
        if (r < this.nodes.length && this.before(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private before(a: number, b: number): boolean {
    return this.rho[a] > this.rho[b] || (this.rho[a] === this.rho[b] && this.nodes[a].id < this.nodes[b].id);
  }

  private swap(a: number, b: number): void {
    [this.rho[a], this.rho[b]] = [this.rho[b], this.rho[a]];
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
  }
}
