import { describe, expect, it } from 'vitest';
import { flatten, FLATTEN_START_S } from '../../tools/scenarios/flatten';
import { controlAuthority } from './aero';
import { firstDownCrossing, frameAt, mean, trough } from './metrics';
import { runScenario, stubScenario } from './scripting';

// Spec section 7 "flatten": full nose up from trim reaches max glide 3.2 to 3.6 then mushes;
// sink rises after airspeed drops below 35. Spec table: max glide 3.4 (3.2 to 3.6) at about
// 38 m/s, min sink 12 m/s (11 to 14), mush onset 32 m/s (30 to 35).

function heldPitch(p: number) {
  const sc = stubScenario(`held-${p}`, 34, (t, _st, input) => {
    if (t >= 10) input.pitch = p;
  });
  sc.exit = { x: 0, y: 2000, z: 0 };
  const frames = runScenario(sc);
  return {
    glide: mean(frames, 'glide', 29, 34),
    airspeed: mean(frames, 'airspeed', 29, 34),
    sink: mean(frames, 'sink', 29, 34),
  };
}

describe('flatten and mush', () => {
  it('the flattest sustainable glide is 3.2 to 3.6, slower than trim', () => {
    let best = { p: 0, glide: 0, airspeed: 0, sink: 0 };
    let minSink = { p: 0, glide: 0, airspeed: 0, sink: Infinity };
    for (let p = 0; p <= 0.85; p += 0.1) {
      const s = heldPitch(Number(p.toFixed(1)));
      if (s.glide > best.glide) best = { p, ...s };
      if (s.sink < minSink.sink) minSink = { p, ...s };
    }
    expect(best.glide).toBeGreaterThanOrEqual(3.2);
    expect(best.glide).toBeLessThanOrEqual(3.6);
    expect(best.airspeed).toBeGreaterThan(32);
    expect(best.airspeed).toBeLessThan(40);
    // Spec says 11 to 14, but its own max-glide row (3.4 at 38 m/s) is a sink of 10.7 m/s,
    // so the floor here is 9.5; see the stage report.
    expect(minSink.sink).toBeGreaterThanOrEqual(9.5);
    expect(minSink.sink).toBeLessThanOrEqual(14);
  });

  it('full nose up slows through 35 m/s into mush, and sink rises', () => {
    const frames = runScenario(flatten);
    const cross35 = firstDownCrossing(frames, 'airspeed', 35, FLATTEN_START_S);
    expect(cross35).toBeDefined();
    expect(cross35!.t - FLATTEN_START_S).toBeLessThan(8);
    const slowest = trough(frames, 'airspeed', FLATTEN_START_S);
    expect(slowest.value).toBeLessThan(32);
    const atSlowest = frameAt(frames, slowest.t);
    expect(atSlowest.mush).toBeGreaterThan(0);
    const laterSink = mean(frames, 'sink', slowest.t, slowest.t + 2);
    expect(laterSink).toBeGreaterThan(cross35!.sink);
    expect(mean(frames, 'sink', FLATTEN_START_S + 8, FLATTEN_START_S + 12)).toBeGreaterThan(
      cross35!.sink,
    );
  });

  it('mush onset is between 30 and 35 m/s', () => {
    const frames = runScenario(flatten);
    const onset = frames.find((f) => f.t > FLATTEN_START_S && f.mush > 0.05);
    expect(onset).toBeDefined();
    expect(onset!.airspeed).toBeGreaterThanOrEqual(30);
    expect(onset!.airspeed).toBeLessThanOrEqual(35);
  });

  it('roll authority at 30 m/s is less than half of trim', () => {
    expect(controlAuthority(30)).toBeLessThan(0.5 * controlAuthority(45));
  });
});
