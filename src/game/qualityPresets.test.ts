import { describe, expect, it } from 'vitest';
import { cloneSettings, DEFAULT_WORLD_SETTINGS, mergeSettings } from '../world/WorldSettings';
import { QUALITY } from './qualityPresets';

const apply = (name: keyof typeof QUALITY, from = cloneSettings(DEFAULT_WORLD_SETTINGS)) => mergeSettings(from, QUALITY[name]);

describe('quality presets', () => {
  it('mobile spreads streaming over frames: 3 builds and 1 upload per frame', () => {
    const s = apply('mobile');
    expect(s.geometryBuildsPerFrame).toBe(3);
    expect(s.textureUploadsPerFrame).toBe(1);
  });

  it('desktop presets keep 12 builds and 2 uploads per frame, and so do the defaults', () => {
    for (const name of ['low', 'medium', 'high'] as const) {
      const s = apply(name);
      expect(s.geometryBuildsPerFrame).toBe(12);
      expect(s.textureUploadsPerFrame).toBe(2);
    }
    expect(DEFAULT_WORLD_SETTINGS.geometryBuildsPerFrame).toBe(12);
    expect(DEFAULT_WORLD_SETTINGS.textureUploadsPerFrame).toBe(2);
  });

  it('switching from mobile back to a desktop preset restores the desktop budgets', () => {
    const s = apply('medium', apply('mobile'));
    expect(s.geometryBuildsPerFrame).toBe(12);
    expect(s.textureUploadsPerFrame).toBe(2);
  });

  it('mobile holds one flight line of textures and renders one pixel per CSS pixel', () => {
    const s = apply('mobile');
    expect(s.maxResidentTextureTiles).toBe(32);
    // maxPixelRatio caps devicePixelRatio, renderScale scales what is left: at most 1.0 rendered px per CSS px.
    expect(s.maxPixelRatio * s.renderScale).toBeLessThanOrEqual(1);
    // Geometry is untouched by Stage 7b.
    expect(s.maxTerrainTriangles).toBe(300_000);
    expect(s.lodErrorPx).toBe(3);
  });

  it('sets every streaming knob in every preset, so none leaks into the next', () => {
    for (const p of Object.values(QUALITY)) {
      expect(p.geometryBuildsPerFrame).toBeGreaterThan(0);
      expect(p.textureUploadsPerFrame).toBeGreaterThan(0);
    }
  });
});
