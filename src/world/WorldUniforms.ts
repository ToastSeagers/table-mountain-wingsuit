import { Color, type IUniform, type Texture, Vector3 } from 'three';

/**
 * The uniforms named in atmosphereGlsl.ts, shared by reference between every world material so
 * Sun, Fog and Sky update one place.
 */
export interface WorldUniforms {
  [name: string]: IUniform;
  uSunDir: IUniform<Vector3>;
  uSunColor: IUniform<Color>;
  uSkyAmbient: IUniform<Color>;
  uGroundAmbient: IUniform<Color>;
  uFogColor: IUniform<Color>;
  uFogSunColor: IUniform<Color>;
  uFogDensity: IUniform<number>;
  uFogFalloff: IUniform<number>;
  uFogBase: IUniform<number>;
  uHaze: IUniform<number>;
  uFogSunExp: IUniform<number>;
  uFogMax: IUniform<number>;
  uSkyZenith: IUniform<Color>;
  uSkyHorizon: IUniform<Color>;
  uTime: IUniform<number>;
  uDetail: IUniform<Texture | null>;
  uOpenSea: IUniform<Color>;
}

export function createWorldUniforms(): WorldUniforms {
  return {
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color(1, 1, 1) },
    uSkyAmbient: { value: new Color(0.3, 0.4, 0.55) },
    uGroundAmbient: { value: new Color(0.2, 0.17, 0.13) },
    uFogColor: { value: new Color() },
    uFogSunColor: { value: new Color() },
    uFogDensity: { value: 0 },
    uFogFalloff: { value: 1 },
    uFogBase: { value: 0 },
    uHaze: { value: 0 },
    uFogSunExp: { value: 1 },
    uFogMax: { value: 1 },
    uSkyZenith: { value: new Color() },
    uSkyHorizon: { value: new Color() },
    uTime: { value: 0 },
    uDetail: { value: null },
    uOpenSea: { value: new Color() },
  };
}
