import { describe, expect, it } from 'vitest';
import { flare, noFlare } from '../../tools/scenarios/canopy';
import { classifyLanding } from './CanopyModel';
import { lastFrame } from './metrics';
import { runScenario, stubScenario } from './scripting';

// Spec section 7 "flare": flare at 3.5 m AGL from full flight lands under 1.5 m/s vertical.
// Spec section 3: soft under 1.5 m/s vertical; ok under 3; hard under 5; crash above 5 or
// forward over 9.
describe('flare and landing', () => {
  it('a flare at 3.5 m lands soft: under 1.5 m/s down', () => {
    const frames = runScenario(flare);
    const end = lastFrame(frames);
    const before = frames[frames.length - 2];
    expect(end.phase).toBe('landed');
    expect(end.landing).toBe('soft');
    expect(before.sink).toBeLessThan(1.5);
    expect(before.groundSpeed).toBeLessThan(7);
    expect(end.y).toBe(0);
  });

  it('no flare at full flight is a crash by the classification table (forward over 9)', () => {
    const frames = runScenario(noFlare);
    const end = lastFrame(frames);
    const before = frames[frames.length - 2];
    expect(end.phase).toBe('crashed');
    expect(end.landing).toBe('crash');
    expect(before.groundSpeed).toBeGreaterThan(9);
  });

  it('a flare held far too early is spent before the ground', () => {
    const early = stubScenario('early-flare', 240, (t, st, input) => {
      input.deploy = t >= 10;
      if (st.phase === 'canopy' && st.aglM <= 12) input.flare = true;
    });
    const frames = runScenario(early);
    const end = lastFrame(frames);
    const before = frames[frames.length - 2];
    expect(end.phase === 'landed' || end.phase === 'crashed').toBe(true);
    expect(before.sink).toBeGreaterThan(1.5);
    expect(before.flareEnergy).toBeLessThan(0.05);
  });

  it('classifies touchdowns per the spec table', () => {
    expect(classifyLanding(1, 4)).toBe('soft');
    expect(classifyLanding(1.5, 4)).toBe('soft');
    expect(classifyLanding(2, 6)).toBe('ok');
    expect(classifyLanding(4, 6)).toBe('hard');
    expect(classifyLanding(6, 2)).toBe('crash');
    expect(classifyLanding(1, 9.5)).toBe('crash');
  });
});
