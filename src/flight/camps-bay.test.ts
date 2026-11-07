import { describe, expect, it } from 'vitest';
import { campsBay, DEPLOY_AGL_M } from '../../tools/scenarios/camps-bay';
import { firstFrame, lastFrame } from './metrics';
import { runScenario } from './scripting';
import { STUB_BEACH } from './stub-terrain';

// Spec section 7 and Gate 3: exit 1 position, trim with a slight dive early, deploy at 200 m
// AGL, lands with x between 2,900 and 3,100.
describe('Camps Bay scenario', () => {
  const frames = runScenario(campsBay);
  const end = lastFrame(frames);

  it('lands on the beach', () => {
    expect(end.phase).toBe('landed');
    expect(end.x).toBeGreaterThanOrEqual(STUB_BEACH.minX);
    expect(end.x).toBeLessThanOrEqual(STUB_BEACH.maxX);
    expect(end.landing === 'soft' || end.landing === 'ok').toBe(true);
  });

  it('deploys at 200 m AGL over the sea and flies every phase', () => {
    const d = firstFrame(frames, (f) => f.phase === 'deploying')!;
    expect(d).toBeDefined();
    expect(d.agl).toBeLessThanOrEqual(DEPLOY_AGL_M);
    expect(d.agl).toBeGreaterThan(DEPLOY_AGL_M - 2);
    expect(d.y).toBeCloseTo(d.agl, 0);
    for (const phase of ['freefall', 'wingsuit', 'deploying', 'canopy', 'landed'] as const) {
      expect(firstFrame(frames, (f) => f.phase === phase)).toBeDefined();
    }
  });
});
