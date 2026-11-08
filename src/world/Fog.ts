import type { FogParams } from './WorldSettings';
import type { WorldUniforms } from './WorldUniforms';

/**
 * Height fog plus distance haze (look spec section 4: warm grey-blue, denser below 200 m, hiding
 * the far edge of the terrain, haze over the Atlantic). The maths is in atmosphereGlsl.ts
 * (applyFog); this class only owns the parameters. Stage 5 may change them via `set()` or
 * WorldSettings.fog.
 */
export class Fog {
  private current: FogParams;

  constructor(
    private readonly uniforms: WorldUniforms,
    params: FogParams,
  ) {
    this.current = { ...params };
    this.apply();
  }

  get params(): Readonly<FogParams> {
    return this.current;
  }

  set(patch: Partial<FogParams>): void {
    this.current = { ...this.current, ...patch };
    this.apply();
  }

  /** CPU copy of the shader's fog opacity, for gameplay or tests (e.g. "is the beach visible"). */
  opacity(camY: number, dirY: number, distM: number): number {
    const p = this.current;
    const b = 1 / p.heightFalloffM;
    const a = p.densityPerM * Math.exp(-b * (camY - p.baseHeightM));
    const k = dirY * b;
    let od = Math.abs(k) > 1e-6 ? (a * (1 - Math.exp(-distM * k))) / k : a * distM;
    od += p.hazePerM * distM;
    return Math.min(1 - Math.exp(-od), p.maxOpacity);
  }

  private apply(): void {
    const u = this.uniforms;
    const p = this.current;
    u.uFogColor.value.setHex(p.colour);
    u.uFogSunColor.value.setHex(p.sunColour);
    u.uFogDensity.value = p.densityPerM;
    u.uFogFalloff.value = 1 / Math.max(p.heightFalloffM, 1);
    u.uFogBase.value = p.baseHeightM;
    u.uHaze.value = p.hazePerM;
    u.uFogSunExp.value = p.sunExponent;
    u.uFogMax.value = p.maxOpacity;
  }
}
