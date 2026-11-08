/**
 * Every world rendering knob Stage 5's quality presets and time-of-day may set, as one plain
 * object. Pass a partial to `World.applySettings()`; nothing needs to reach into classes.
 * Colours are sRGB hex. Defaults follow docs/design/look-and-feel.md section 4 (golden hour,
 * sun at 15 degrees in the west-north-west, warm grey-blue haze denser below 200 m).
 */

export interface SunParams {
  /** Degrees clockwise from north (290 = west-north-west, look spec section 4). */
  azimuthDeg: number;
  /** Degrees above the horizon (15 = golden hour). */
  elevationDeg: number;
  /** Multiplier on the elevation-derived sun colour. */
  intensity: number;
}

export interface FogParams {
  /** Grey-blue haze colour away from the sun. */
  colour: number;
  /** Warm in-scatter colour toward the sun. */
  sunColour: number;
  /** Extinction per metre at `baseHeightM`. */
  densityPerM: number;
  /** Height over which the fog density falls by e (exponential height fog). */
  heightFalloffM: number;
  /** Height where `densityPerM` applies; denser below it. */
  baseHeightM: number;
  /** Height-independent extinction per metre: hides the far edge of the terrain. */
  hazePerM: number;
  /** Sharpness of the warm lobe toward the sun. */
  sunExponent: number;
  /** Upper limit on fog opacity. */
  maxOpacity: number;
}

export interface SkyParams {
  zenithColour: number;
  horizonColour: number;
  /** Fraction of the upper sky covered by the stationary high clouds, 0..1. */
  cloudCover: number;
  /** Sun disc angular radius in degrees. */
  sunDiscDeg: number;
}

export interface WorldSettings {
  /** GPU-resident 1024 px texture tiles (about 5.6 MB each with mips). Lower on integrated GPUs. */
  maxResidentTextureTiles: number;
  /** LOD split threshold in pixels of projected geometric error. */
  lodErrorPx: number;
  /** Hard terrain triangle cap (600k budget minus a 40k reserve for Stages 4 and 5). */
  maxTerrainTriangles: number;
  /** Sun shadow map (off by default; cost measured in the Stage 2 report). */
  shadows: boolean;
  shadowMapSize: number;
  /** Side of the square shadow box that follows the camera, metres. */
  shadowExtentM: number;
  /** Renderer tone-mapping exposure. */
  exposure: number;
  /** Cap on devicePixelRatio. */
  maxPixelRatio: number;
  /** Fraction of the capped pixel ratio actually rendered (the mobile preset renders at 0.65). */
  renderScale: number;
  sun: SunParams;
  fog: FogParams;
  sky: SkyParams;
}

export type WorldSettingsPatch = Partial<Omit<WorldSettings, 'sun' | 'fog' | 'sky'>> & {
  sun?: Partial<SunParams>;
  fog?: Partial<FogParams>;
  sky?: Partial<SkyParams>;
};

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  maxResidentTextureTiles: 40,
  lodErrorPx: 2,
  maxTerrainTriangles: 560_000,
  shadows: false,
  shadowMapSize: 4096,
  shadowExtentM: 4000,
  exposure: 1.0,
  maxPixelRatio: 1,
  renderScale: 1,
  sun: { azimuthDeg: 290, elevationDeg: 15, intensity: 1 },
  fog: {
    colour: 0xaeb8c2,
    sunColour: 0xf6bf86,
    densityPerM: 0.00012,
    heightFalloffM: 260,
    baseHeightM: 200,
    hazePerM: 0.000045,
    sunExponent: 6,
    maxOpacity: 0.97,
  },
  sky: {
    zenithColour: 0x3f6fa8,
    horizonColour: 0xe8d6bf,
    cloudCover: 0.35,
    sunDiscDeg: 0.6,
  },
};

export function mergeSettings(base: WorldSettings, patch: WorldSettingsPatch): WorldSettings {
  return {
    ...base,
    ...patch,
    sun: { ...base.sun, ...patch.sun },
    fog: { ...base.fog, ...patch.fog },
    sky: { ...base.sky, ...patch.sky },
  };
}

export function cloneSettings(s: WorldSettings): WorldSettings {
  return mergeSettings(s, {});
}
