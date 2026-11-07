import type { Vec3 } from '../types/math';
import type { TerrainBounds, TerrainSampler } from '../types/terrain';

// Analytic cliff for headless work (spec section 6): table top at 1,050 m for x < 0, a vertical
// drop to 350 m at x = 0, a 15 degree slope down to sea level at x ~ 1,306, then flat sea.
// The profile runs along +X, so scenarios fly heading 90 in this frame.

const SLOPE_DEG = 15;
const TAN_SLOPE = Math.tan((SLOPE_DEG * Math.PI) / 180);
const SIN_SLOPE = Math.sin((SLOPE_DEG * Math.PI) / 180);
const COS_SLOPE = Math.cos((SLOPE_DEG * Math.PI) / 180);

export const STUB_TOP_M = 1050;
export const STUB_CLIFF_BASE_M = 350;
/** Where the slope meets the sea. */
export const STUB_SHORE_X = STUB_CLIFF_BASE_M / TAN_SLOPE;
/** Camps Bay beach stand-in (spec section 6). */
export const STUB_BEACH = { minX: 2900, maxX: 3100 } as const;
/** Exit 1 stand-in in the stub frame: the cliff edge, facing down the profile. */
export const STUB_EXIT: Readonly<Vec3> = { x: 0, y: STUB_TOP_M, z: 0 };
export const STUB_EXIT_HEADING_DEG = 90;

export class StubTerrain implements TerrainSampler {
  readonly bounds: TerrainBounds = { minX: -3000, maxX: 8000, minZ: -3000, maxZ: 3000 };

  /** Ground profile without the bounds check, exported for plots. */
  static profile(x: number): number {
    if (x < 0) return STUB_TOP_M;
    if (x < STUB_SHORE_X) return STUB_CLIFF_BASE_M - x * TAN_SLOPE;
    return 0;
  }

  heightAt(x: number, z: number): number {
    if (!this.inBounds(x, z)) return 0;
    return StubTerrain.profile(x);
  }

  normalAt(x: number, z: number): Vec3 {
    if (this.inBounds(x, z) && x >= 0 && x < STUB_SHORE_X) {
      return { x: SIN_SLOPE, y: COS_SLOPE, z: 0 };
    }
    return { x: 0, y: 1, z: 0 };
  }

  isReady(): boolean {
    return true;
  }

  private inBounds(x: number, z: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }
}
