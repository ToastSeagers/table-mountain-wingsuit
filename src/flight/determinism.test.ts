import { describe, expect, it } from 'vitest';
import { campsBay } from '../../tools/scenarios/camps-bay';
import { FlightModelImpl } from './FlightModelImpl';
import { runScenario, type ScriptFrame } from './scripting';

// Spec section 7 "determinism": two runs with identical input scripts produce bit-identical
// state arrays.
function pack(frames: ScriptFrame[]): Float64Array {
  const out = new Float64Array(frames.length * 7);
  frames.forEach((f, i) => {
    out[i * 7] = f.x;
    out[i * 7 + 1] = f.y;
    out[i * 7 + 2] = f.z;
    out[i * 7 + 3] = f.vx;
    out[i * 7 + 4] = f.vy;
    out[i * 7 + 5] = f.vz;
    out[i * 7 + 6] = f.heading;
  });
  return out;
}

describe('determinism', () => {
  it('two fresh models give bit-identical trajectories for the same script', () => {
    const a = pack(runScenario(campsBay));
    const b = pack(runScenario(campsBay));
    expect(a.length).toBeGreaterThan(1000);
    expect(a).toEqual(b);
  });

  it('a reused model after reset() gives the same trajectory as a fresh one', () => {
    const model = new FlightModelImpl();
    const first = pack(runScenario(campsBay, { model }));
    const again = pack(runScenario(campsBay, { model }));
    expect(again).toEqual(first);
    expect(pack(runScenario(campsBay, { seed: 42 }))).toEqual(first);
  });

  it('the seeded generator repeats after reset', () => {
    const model = new FlightModelImpl();
    model.reset({ x: 0, y: 1050, z: 0 }, 90, 7);
    const seq = [model.random(), model.random(), model.random()];
    model.reset({ x: 0, y: 1050, z: 0 }, 90, 7);
    expect([model.random(), model.random(), model.random()]).toEqual(seq);
    model.reset({ x: 0, y: 1050, z: 0 }, 90, 8);
    expect(model.random()).not.toBe(seq[0]);
    for (const r of seq) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
});
