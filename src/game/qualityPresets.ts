import type { QualityPreset } from '../core/Settings';
import type { WorldSettingsPatch } from '../world/WorldSettings';

/**
 * World settings for each quality preset. Every preset sets every streaming budget, so switching
 * from `mobile` back to a desktop preset restores 12 builds and 2 uploads per frame.
 */
export const QUALITY: Record<QualityPreset, WorldSettingsPatch> = {
  low: {
    maxTerrainTriangles: 300_000,
    lodErrorPx: 4,
    maxResidentTextureTiles: 24,
    geometryBuildsPerFrame: 12,
    textureUploadsPerFrame: 2,
    shadows: false,
    maxPixelRatio: 1,
    renderScale: 1,
    dynamicResolution: false,
    minRenderScale: 1,
    maxRenderScale: 1,
  },
  medium: {
    maxTerrainTriangles: 560_000,
    lodErrorPx: 2,
    maxResidentTextureTiles: 40,
    geometryBuildsPerFrame: 12,
    textureUploadsPerFrame: 2,
    shadows: false,
    maxPixelRatio: 1,
    renderScale: 1,
    dynamicResolution: false,
    minRenderScale: 1,
    maxRenderScale: 1,
  },
  high: {
    maxTerrainTriangles: 560_000,
    lodErrorPx: 2,
    maxResidentTextureTiles: 40,
    geometryBuildsPerFrame: 12,
    textureUploadsPerFrame: 2,
    shadows: true,
    maxPixelRatio: 1,
    renderScale: 1,
    dynamicResolution: false,
    minRenderScale: 1,
    maxRenderScale: 1,
  },
  // Stage 7, retuned in Stage 7b from the owner's Mali-G78 (landscape 838x328 CSS px):
  // - 300k triangles and lodErrorPx 3 held 57.9 fps at 1.2 rendered px per CSS px, so pixels drop to
  //   1.0 per CSS px (cap 1, scale 1) for thermal headroom rather than touching geometry.
  // - 32 resident tiles: the phone held 31 with no evictions on the v0.1 build, 24 churned.
  // - Streaming is spread thin in flight (3 builds, 1 upload per frame); the countdown warm-up does the bulk.
  // Stage 9: the scene scale is dynamic between 0.6 and 1.0 of the canvas (canvas still 1.0 px per CSS px,
  // so the title, menus and HUD stay sharp). 1.0 is the ceiling because 1.2 px per CSS px held only 57.9 fps
  // on the Mali-G78 in Stage 7; 0.6 is the floor because below it the terrain texture reads as mud and the
  // horizon steps are visible, and a phone that cannot hold 60 fps at 0.6 (360 px of a 600 px scene) is
  // CPU-bound, where more pixels off will not help.
  mobile: {
    maxTerrainTriangles: 300_000,
    lodErrorPx: 3,
    maxResidentTextureTiles: 32,
    geometryBuildsPerFrame: 3,
    textureUploadsPerFrame: 1,
    shadows: false,
    maxPixelRatio: 1,
    renderScale: 1,
    dynamicResolution: true,
    minRenderScale: 0.6,
    maxRenderScale: 1,
  },
};
