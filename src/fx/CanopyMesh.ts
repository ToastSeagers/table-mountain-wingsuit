import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  Vector3,
} from 'three';
import { AvatarMaterial, type AvatarLighting } from './AvatarMaterial';
import type { CanopyState } from './avatarPose';

export const CELLS = 7;
/** Span segments per cell: enough for the top skin to bulge between the ribs. */
const SUB = 4;
const NS = CELLS * SUB;
/** Chord segments. */
const NC = 8;
/** Metres before the avatar scale (a 215 sq ft canopy at the pilot's larger-than-life scale). */
export const SPAN_M = 6.0;
export const CHORD_M = 2.6;
export const LINE_LENGTH_M = 4.3;
const THICK_M = 0.34;
/** The span is an arc of this half-angle (lines of equal length from the risers give the anhedral). */
const ARC_HALF_RAD = (34 * Math.PI) / 180;
/** Fraction of the chord ahead of the line attachment centre. */
const LE_OFFSET = 0.28;
/** The tail hinges here on a brake stroke. */
const HINGE_C = 0.7;
const TAIL_MAX_RAD = (42 * Math.PI) / 180;

const PAPER = [0.96, 0.91, 0.82];
const SUN = [1.0, 0.7, 0.28];
const CORAL = [1.0, 0.37, 0.36];
/** Cell colours left to right: the classic two-tone with a coral centre stripe. */
const CELL_COLOURS = [SUN, PAPER, SUN, CORAL, SUN, PAPER, SUN];
const RIB_COLOUR = [0.78, 0.72, 0.64];
const INLET_COLOUR = [0.3, 0.22, 0.26];

/** Where the lines attach: rib index, chord fraction, and which riser (-1 left, 1 right) or 0 for a brake line to the hand. */
interface LineAttach {
  rib: number;
  c: number;
  side: -1 | 1;
  brake: boolean;
}

function buildLineAttachments(): LineAttach[] {
  const out: LineAttach[] = [];
  for (let rib = 0; rib <= CELLS; rib++) {
    const side: -1 | 1 = rib <= CELLS / 2 ? -1 : 1;
    out.push({ rib, c: 0.12, side, brake: false });
    out.push({ rib, c: 0.55, side, brake: false });
  }
  for (const rib of [1, 2]) out.push({ rib, c: 1, side: -1, brake: true });
  for (const rib of [5, 6]) out.push({ rib, c: 1, side: 1, brake: true });
  return out;
}

/**
 * A seven-cell ram-air canopy: top and bottom skins on a span-wise arc, ribs at each cell
 * wall, dark inlets at the leading edge, and the suspension lines from the A and C positions
 * on every rib to the risers, plus brake lines from the tail to the hands. The skins are
 * rebuilt each frame from the CanopyState (inflation bulge, tail deflection); the opening
 * scales and raises the whole canopy. About 1,050 triangles.
 */
export class CanopyMesh {
  /** Pivot at the risers; swing rotations go here. */
  readonly pivot = new Group();
  /** The canopy itself, LINE_LENGTH_M above the pivot when the lines are out. */
  readonly canopy = new Group();
  readonly lines: LineSegments;
  private readonly skins: Mesh;
  private readonly ribs: Mesh;
  private readonly inlets: Mesh;
  private readonly skinMat: AvatarMaterial;
  private readonly ribMat: AvatarMaterial;
  private readonly inletMat: AvatarMaterial;
  private readonly lineMat: LineBasicMaterial;
  private readonly attach = buildLineAttachments();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly mat = new Matrix4();

  constructor(lighting: AvatarLighting) {
    this.skinMat = new AvatarMaterial(lighting, 0xffffff, {
      translucency: 0.7,
      opacity: 0.93,
      vertexColors: true,
      ribs: true,
    });
    this.ribMat = new AvatarMaterial(lighting, 0xffffff, {
      translucency: 0.4,
      opacity: 0.93,
      vertexColors: true,
    });
    this.inletMat = new AvatarMaterial(lighting, 0xffffff, { vertexColors: true });
    this.lineMat = new LineBasicMaterial({ color: 0xf4e9d2, transparent: true, opacity: 0.85 });

    // Skins: two grids (top k = 0..NC, bottom) in one geometry so one draw call covers both.
    const skinVerts = 2 * (NS + 1) * (NC + 1);
    const pos = new Float32Array(skinVerts * 3);
    const col = new Float32Array(skinVerts * 3);
    const uv = new Float32Array(skinVerts * 2);
    const idx: number[] = [];
    for (let skin = 0; skin < 2; skin++) {
      const base = skin * (NS + 1) * (NC + 1);
      for (let j = 0; j <= NS; j++) {
        const cell = Math.min(CELLS - 1, Math.floor(j / SUB));
        const colour = CELL_COLOURS[cell];
        const cellFrac = (j % SUB) / SUB;
        for (let k = 0; k <= NC; k++) {
          const i = base + j * (NC + 1) + k;
          col[i * 3] = colour[0];
          col[i * 3 + 1] = colour[1];
          col[i * 3 + 2] = colour[2];
          uv[i * 2] = j === NS ? 0 : cellFrac;
          uv[i * 2 + 1] = k / NC;
          if (j < NS && k < NC) {
            const a = i;
            const b = i + 1;
            const c = i + NC + 1;
            const d = c + 1;
            if (skin === 0) idx.push(a, b, c, b, d, c);
            else idx.push(a, c, b, b, c, d);
          }
        }
      }
    }
    const skinGeo = new BufferGeometry();
    const posAttr = new Float32BufferAttribute(pos, 3);
    posAttr.setUsage(DynamicDrawUsage);
    skinGeo.setAttribute('position', posAttr);
    skinGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
    skinGeo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    skinGeo.setIndex(idx);
    this.skins = new Mesh(skinGeo, this.skinMat);

    // Ribs: a strip per cell wall between the bottom and top skins, rebuilt with the skins.
    const ribVerts = (CELLS + 1) * (NC + 1) * 2;
    const rpos = new Float32Array(ribVerts * 3);
    const rcol = new Float32Array(ribVerts * 3);
    const ruv = new Float32Array(ribVerts * 2);
    const ridx: number[] = [];
    for (let r = 0; r <= CELLS; r++) {
      for (let k = 0; k <= NC; k++) {
        for (let t = 0; t < 2; t++) {
          const i = (r * (NC + 1) + k) * 2 + t;
          rcol[i * 3] = RIB_COLOUR[0];
          rcol[i * 3 + 1] = RIB_COLOUR[1];
          rcol[i * 3 + 2] = RIB_COLOUR[2];
          ruv[i * 2] = 0.5;
          ruv[i * 2 + 1] = k / NC;
        }
        if (k < NC) {
          const a = (r * (NC + 1) + k) * 2;
          ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const ribGeo = new BufferGeometry();
    const rposAttr = new Float32BufferAttribute(rpos, 3);
    rposAttr.setUsage(DynamicDrawUsage);
    ribGeo.setAttribute('position', rposAttr);
    ribGeo.setAttribute('color', new Float32BufferAttribute(rcol, 3));
    ribGeo.setAttribute('uv', new Float32BufferAttribute(ruv, 2));
    ribGeo.setIndex(ridx);
    this.ribs = new Mesh(ribGeo, this.ribMat);

    // Inlets: one dark quad per cell mouth at the leading edge.
    const ipos = new Float32Array(CELLS * 4 * 3);
    const icol = new Float32Array(CELLS * 4 * 3);
    const iuv = new Float32Array(CELLS * 4 * 2);
    const iidx: number[] = [];
    for (let c = 0; c < CELLS; c++) {
      for (let t = 0; t < 4; t++) {
        const i = c * 4 + t;
        icol[i * 3] = INLET_COLOUR[0];
        icol[i * 3 + 1] = INLET_COLOUR[1];
        icol[i * 3 + 2] = INLET_COLOUR[2];
        iuv[i * 2] = 0.5;
        iuv[i * 2 + 1] = 0;
      }
      const a = c * 4;
      iidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const inletGeo = new BufferGeometry();
    const iposAttr = new Float32BufferAttribute(ipos, 3);
    iposAttr.setUsage(DynamicDrawUsage);
    inletGeo.setAttribute('position', iposAttr);
    inletGeo.setAttribute('color', new Float32BufferAttribute(icol, 3));
    inletGeo.setAttribute('uv', new Float32BufferAttribute(iuv, 2));
    inletGeo.setIndex(iidx);
    this.inlets = new Mesh(inletGeo, this.inletMat);

    const lineGeo = new BufferGeometry();
    const lpos = new Float32BufferAttribute(new Float32Array(this.attach.length * 2 * 3), 3);
    lpos.setUsage(DynamicDrawUsage);
    lineGeo.setAttribute('position', lpos);
    this.lines = new LineSegments(lineGeo, this.lineMat);

    for (const m of [this.skins, this.ribs, this.inlets, this.lines]) m.frustumCulled = false;
    this.canopy.add(this.skins, this.ribs, this.inlets);
    this.pivot.add(this.canopy);
    this.canopy.position.y = LINE_LENGTH_M;
  }

  triangleCount(): number {
    let n = 0;
    for (const m of [this.skins, this.ribs, this.inlets]) n += (m.geometry.index?.count ?? 0) / 3;
    return n;
  }

  setVisible(v: boolean): void {
    this.pivot.visible = v;
    this.lines.visible = v;
  }

  /** A point on the canopy's bottom skin (canopy local, unscaled) at a rib and chord fraction. */
  private ribPoint(out: Vector3, rib: number, c: number, s: CanopyState): Vector3 {
    const span = -0.5 + rib / CELLS;
    const a = span * 2 * ARC_HALF_RAD;
    const radius = SPAN_M / 2 / Math.sin(ARC_HALF_RAD);
    const nx = Math.sin(a);
    const ny = Math.cos(a);
    out.set(radius * nx, radius * ny - radius, (c - LE_OFFSET) * CHORD_M);
    this.applyTail(out, c, nx, ny, s.tailDeflection);
    return out;
  }

  /** Rotates the tail of a point down about the hinge chord line by the brake stroke. */
  private applyTail(p: Vector3, c: number, nx: number, ny: number, deflection: number): void {
    if (c <= HINGE_C || deflection <= 0) return;
    const ang = deflection * TAIL_MAX_RAD;
    const arm = (c - HINGE_C) * CHORD_M;
    const dz = arm * (Math.cos(ang) - 1);
    const down = arm * Math.sin(ang);
    p.z += dz;
    p.x -= nx * down;
    p.y -= ny * down;
  }

  /**
   * Rebuilds the skins, ribs and inlets for the state, poses the canopy group, and draws the
   * lines from the risers and hands (given in pivot-parent space) to the canopy.
   */
  update(s: CanopyState, riserL: Vector3, riserR: Vector3, handL: Vector3, handR: Vector3): void {
    this.setVisible(s.visible);
    if (!s.visible) return;
    const radius = SPAN_M / 2 / Math.sin(ARC_HALF_RAD);
    const pos = this.skins.geometry.getAttribute('position') as Float32BufferAttribute;
    const bulge = 0.09 * s.inflation;
    for (let skin = 0; skin < 2; skin++) {
      const base = skin * (NS + 1) * (NC + 1);
      for (let j = 0; j <= NS; j++) {
        const span = -0.5 + j / NS;
        const a = span * 2 * ARC_HALF_RAD;
        const nx = Math.sin(a);
        const ny = Math.cos(a);
        const bx = radius * nx;
        const by = radius * ny - radius;
        const cellFrac = j === NS ? 0 : (j % SUB) / SUB;
        const cellBulge = Math.sin(Math.PI * cellFrac);
        for (let k = 0; k <= NC; k++) {
          const c = k / NC;
          const section = 4 * c * (1 - c) * (1 - 0.35 * c);
          let t: number;
          if (skin === 0) {
            t =
              (THICK_M * section + bulge * cellBulge * Math.sqrt(section)) *
              (0.15 + 0.85 * s.inflation);
          } else {
            t = -0.025 * cellBulge * s.inflation * Math.sqrt(section);
            if (k === 0) t += 0.02;
          }
          this.tmp.set(bx + nx * t, by + ny * t, (c - LE_OFFSET) * CHORD_M);
          // Under-inflated the trailing half sags back and down.
          this.tmp.y -= (1 - s.inflation) * 0.5 * c;
          this.applyTail(this.tmp, c, nx, ny, s.tailDeflection);
          pos.setXYZ(base + j * (NC + 1) + k, this.tmp.x, this.tmp.y, this.tmp.z);
        }
      }
    }
    pos.needsUpdate = true;
    this.skins.geometry.computeVertexNormals();

    const rpos = this.ribs.geometry.getAttribute('position') as Float32BufferAttribute;
    for (let r = 0; r <= CELLS; r++) {
      const j = r * SUB;
      const top = j * (NC + 1);
      const bottom = (NS + 1) * (NC + 1) + j * (NC + 1);
      for (let k = 0; k <= NC; k++) {
        const i = (r * (NC + 1) + k) * 2;
        rpos.setXYZ(i, pos.getX(bottom + k), pos.getY(bottom + k), pos.getZ(bottom + k));
        rpos.setXYZ(i + 1, pos.getX(top + k), pos.getY(top + k), pos.getZ(top + k));
      }
    }
    rpos.needsUpdate = true;
    this.ribs.geometry.computeVertexNormals();

    const ipos = this.inlets.geometry.getAttribute('position') as Float32BufferAttribute;
    for (let c = 0; c < CELLS; c++) {
      const jl = c * SUB + 1;
      const jr = (c + 1) * SUB - 1;
      const k = 1;
      const tl = jl * (NC + 1) + k;
      const tr = jr * (NC + 1) + k;
      const bl = (NS + 1) * (NC + 1) + jl * (NC + 1);
      const br = (NS + 1) * (NC + 1) + jr * (NC + 1);
      const i = c * 4;
      ipos.setXYZ(i, pos.getX(bl), pos.getY(bl), pos.getZ(bl) + 0.03);
      ipos.setXYZ(i + 1, pos.getX(br), pos.getY(br), pos.getZ(br) + 0.03);
      ipos.setXYZ(i + 2, pos.getX(tl), pos.getY(tl) * 0.92, pos.getZ(tl) + 0.03);
      ipos.setXYZ(i + 3, pos.getX(tr), pos.getY(tr) * 0.92, pos.getZ(tr) + 0.03);
    }
    ipos.needsUpdate = true;
    this.inlets.geometry.computeVertexNormals();

    // Pose the canopy: opening scale and height, swing about the risers, collapse after landing.
    const collapse = s.collapse;
    this.canopy.scale.set(
      s.spanScale,
      (1 - 0.85 * collapse) * (0.3 + 0.7 * s.inflation),
      s.chordScale,
    );
    this.canopy.position.y = LINE_LENGTH_M * s.lineExtension * (1 - collapse) + 0.9 * collapse;
    this.canopy.position.z = 0.6 * collapse;
    this.canopy.rotation.x = -0.25 * collapse;
    this.pivot.rotation.set(s.swingPitch, 0, s.swingRoll);
    const opacity = 0.93 * (0.35 + 0.65 * Math.min(1, s.inflation * 2));
    this.skinMat.setOpacity(opacity);
    this.ribMat.setOpacity(opacity);
    this.lineMat.opacity = 0.85 * Math.min(1, 0.2 + s.lineExtension);

    // Lines: canopy attachment points through the canopy and pivot transforms into the
    // pivot's parent space, where the risers and hands are given.
    this.canopy.updateMatrix();
    this.pivot.updateMatrix();
    this.mat.multiplyMatrices(this.pivot.matrix, this.canopy.matrix);
    const lpos = this.lines.geometry.getAttribute('position') as Float32BufferAttribute;
    for (let i = 0; i < this.attach.length; i++) {
      const at = this.attach[i];
      const from = at.brake ? (at.side < 0 ? handL : handR) : at.side < 0 ? riserL : riserR;
      this.ribPoint(this.tmp2, at.rib, at.c, s).applyMatrix4(this.mat);
      lpos.setXYZ(i * 2, from.x, from.y, from.z);
      lpos.setXYZ(i * 2 + 1, this.tmp2.x, this.tmp2.y, this.tmp2.z);
    }
    lpos.needsUpdate = true;
  }
}
