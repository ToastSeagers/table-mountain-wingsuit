import {
  AdditiveBlending,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { LandingZone } from '../types/game';

const FYNBOS = 0x7fb069;
const SUN = 0xffb347;
const SEGMENTS = 64;
const WALL_HEIGHT_M = 90;

/**
 * Landing zone markers: a ring draped over the ground and a faint pillar wall so the fields can
 * be picked out from altitude (look spec: fynbos green for landing zone markers). The
 * recommended zones of the current exit are drawn in the accent colour.
 */
export class ZoneMarkers {
  readonly group = new Group();
  private readonly entries = new Map<string, { ring: Mesh; wall: Mesh; zone: LandingZone }>();

  constructor(
    zones: readonly LandingZone[],
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    for (const zone of zones) {
      const ring = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: FYNBOS, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false, fog: false }));
      const wall = new Mesh(
        new CylinderGeometry(zone.radiusM, zone.radiusM, WALL_HEIGHT_M, SEGMENTS, 1, true),
        new MeshBasicMaterial({ color: FYNBOS, transparent: true, opacity: 0.13, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, fog: false }),
      );
      ring.frustumCulled = false;
      this.group.add(ring, wall);
      this.entries.set(zone.id, { ring, wall, zone });
    }
    this.rebuild();
  }

  /** Re-drapes every ring over the current terrain (call once tiles are in and at each run start). */
  rebuild(): void {
    for (const { ring, wall, zone } of this.entries.values()) {
      const width = Math.max(3, zone.radiusM * 0.05);
      const pos: number[] = [];
      let low = Infinity;
      for (let i = 0; i < SEGMENTS; i++) {
        const a0 = (i / SEGMENTS) * Math.PI * 2;
        const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
        const pt = (a: number, r: number): number[] => {
          const x = zone.centre.x + Math.cos(a) * r;
          const z = zone.centre.z + Math.sin(a) * r;
          const y = this.groundAt(x, z) + 1.2;
          low = Math.min(low, y);
          return [x, y, z];
        };
        const o0 = pt(a0, zone.radiusM);
        const i0 = pt(a0, zone.radiusM - width);
        const o1 = pt(a1, zone.radiusM);
        const i1 = pt(a1, zone.radiusM - width);
        pos.push(...o0, ...i0, ...o1, ...i0, ...i1, ...o1);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      ring.geometry.dispose();
      ring.geometry = g;
      wall.position.set(zone.centre.x, low + WALL_HEIGHT_M / 2 - 1, zone.centre.z);
    }
  }

  /** Highlights the zones an exit recommends and dims the rest. */
  highlight(recommended: readonly string[]): void {
    for (const [id, { ring, wall }] of this.entries) {
      const hot = recommended.includes(id);
      (ring.material as MeshBasicMaterial).color.setHex(hot ? SUN : FYNBOS);
      (wall.material as MeshBasicMaterial).color.setHex(hot ? SUN : FYNBOS);
      (wall.material as MeshBasicMaterial).opacity = hot ? 0.18 : 0.1;
    }
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}
