import { describe, expect, it } from 'vitest';
import { createFlightState, type WingsuitFlightState } from '../flight/state';
import { LandingZoneRegistry } from './LandingZoneRegistry';
import { SCORING } from './scoring-tuning';
import { ScoreTracker, type TouchdownInfo } from './Scoring';
import { parseTriggers, TriggerRegistry } from './TriggerRegistry';

const zones = LandingZoneRegistry.fromData();
const triggers = TriggerRegistry.fromData();
const beach = zones.get('camps-bay-beach')!;
const glen = zones.get('the-glen')!; // difficulty 2
const orange = zones.get('upper-orange')!; // difficulty 3
const START = { x: 0, y: 1000, z: 0 };
const DT = 1 / 120;

function tracker(t: TriggerRegistry = triggers): ScoreTracker {
  return new ScoreTracker(START, zones, t);
}

function state(over: Partial<WingsuitFlightState> = {}): WingsuitFlightState {
  return { ...createFlightState(), phase: 'wingsuit', aglM: 200, airspeedMps: 45, ...over };
}

function run(tr: ScoreTracker, seconds: number, over: Partial<WingsuitFlightState> = {}, pitch = 0): void {
  const st = state(over);
  for (let i = 0; i < seconds / DT; i++) tr.step(DT, st, pitch);
}

function end(over: Partial<TouchdownInfo> = {}): TouchdownInfo {
  return { x: 0, z: -500, groundHeightM: 100, landingClass: 'soft', crashed: false, deployAglM: null, ...over };
}

describe('distance', () => {
  it('is horizontal metres from the exit, 1 point each, capped at 6000', () => {
    expect(tracker().finish(end({ x: 3000, z: 4000 })).distanceScore).toBe(5000);
    expect(tracker().finish(end({ x: 30000, z: 0 })).distanceScore).toBe(SCORING.distance.cap);
  });

  it('halves on a crash', () => {
    const b = tracker().finish(end({ x: 1000, z: 0, crashed: true, landingClass: 'crash' }));
    expect(b.distanceM).toBe(500);
    expect(b.distanceScore).toBe(500);
  });
});

describe('air time', () => {
  it('counts freefall and wingsuit seconds at 40 points, not canopy', () => {
    const tr = tracker();
    run(tr, 10, { phase: 'wingsuit' });
    run(tr, 10, { phase: 'canopy', airspeedMps: 12 });
    const b = tr.finish(end());
    expect(b.airTimeS).toBeCloseTo(10, 0);
    expect(b.airTimeScore).toBe(400);
  });

  it('caps at 4000', () => {
    const tr = tracker();
    run(tr, 130, { aglM: 500 });
    expect(tr.finish(end()).airTimeScore).toBe(SCORING.airTime.cap);
  });
});

describe('proximity', () => {
  it('accrues dt * airspeed * (40 - agl) / 40 * 2.5 when under 40 m AGL and over 35 m/s', () => {
    const tr = tracker();
    run(tr, 2, { aglM: 20, airspeedMps: 50 });
    // 2 s * 50 m/s * 0.5 * 2.5 = 125
    expect(tr.finish(end()).proximityScore).toBe(125);
  });

  it('does nothing when high, slow, or exactly at the thresholds', () => {
    const tr = tracker();
    run(tr, 3, { aglM: 40, airspeedMps: 60 });
    run(tr, 3, { aglM: 10, airspeedMps: 35 });
    run(tr, 3, { aglM: 100, airspeedMps: 60 });
    expect(tr.finish(end()).proximityScore).toBe(0);
  });

  it('caps at 5000', () => {
    const tr = tracker();
    run(tr, 200, { aglM: 1, airspeedMps: 70 }, 0);
    expect(tr.finish(end()).proximityScore).toBe(SCORING.proximity.cap);
  });

  it('keeps proximity on a crash', () => {
    const tr = tracker();
    run(tr, 2, { aglM: 20, airspeedMps: 50 });
    expect(tr.finish(end({ crashed: true, landingClass: 'crash' })).proximityScore).toBe(125);
  });
});

describe('landing', () => {
  const at = (z: { centre: { x: number; z: number } }, dx = 0): Partial<TouchdownInfo> => ({ x: z.centre.x + dx, z: z.centre.z });

  it('zone centre, soft, difficulty 1: 1500 base + 500 accuracy', () => {
    expect(tracker().finish(end(at(beach))).landingScore).toBe(2000);
  });

  it('applies the softness multiplier and the difficulty multiplier', () => {
    // difficulty 2 (x1.25), centre: ok (0.7): 1500*0.7*1.25 + 500
    expect(tracker().finish(end({ ...at(glen), landingClass: 'ok' })).landingScore).toBe(Math.round(1500 * 0.7 * 1.25 + 500));
    // difficulty 3 (x1.5), hard (0.35)
    expect(tracker().finish(end({ ...at(orange), landingClass: 'hard' })).landingScore).toBe(Math.round(1500 * 0.35 * 1.5 + 500));
    expect(tracker().finish(end(at(orange))).landingScore).toBe(2750);
  });

  it('accuracy falls linearly to zero at the zone radius', () => {
    const half = tracker().finish(end(at(beach, beach.radiusM / 2))).landingScore;
    expect(half).toBe(1500 + 250);
    const edge = tracker().finish(end(at(beach, beach.radiusM * 0.999))).landingScore;
    expect(edge).toBe(1500);
  });

  it('gives 300 anywhere else on land, scaled by softness', () => {
    const soft = tracker().finish(end({ x: 100, z: 100 }));
    expect(soft.landingScore).toBe(300);
    expect(soft.surface).toBe('land');
    expect(tracker().finish(end({ x: 100, z: 100, landingClass: 'ok' })).landingScore).toBe(210);
  });

  it('gives nothing in the water, even inside a zone', () => {
    const b = tracker().finish(end({ ...at(beach), groundHeightM: 0 }));
    expect(b.landingScore).toBe(0);
    expect(b.surface).toBe('water');
    expect(b.landingZoneId).toBeNull();
  });

  it('gives nothing for a crash', () => {
    expect(tracker().finish(end({ ...at(beach), landingClass: 'crash', crashed: true })).landingScore).toBe(0);
  });
});

describe('style bonuses', () => {
  const ids = (tr: ScoreTracker, e = end()): string[] => tr.finish(e).bonuses.map((b) => b.id);

  it('ghost line: 5 continuous seconds under 15 m AGL above 40 m/s', () => {
    const tr = tracker();
    run(tr, 4.9, { aglM: 10, airspeedMps: 45 });
    expect(ids(tracker())).not.toContain('ghost');
    run(tr, 0.2, { aglM: 10, airspeedMps: 45 });
    expect(ids(tr)).toContain('ghost');
  });

  it('ghost line resets when the condition breaks', () => {
    const tr = tracker();
    run(tr, 3, { aglM: 10, airspeedMps: 45 });
    run(tr, 0.1, { aglM: 50, airspeedMps: 45 });
    run(tr, 3, { aglM: 10, airspeedMps: 45 });
    expect(ids(tr)).not.toContain('ghost');
  });

  it('gorge: inside the Platteklip volume', () => {
    const v = triggers.forBonus('gorge')[0];
    const tr = tracker();
    run(tr, 0.1, { position: { x: v.max.x + 50, y: v.min.y + 10, z: v.min.z + 10 } });
    expect(ids(tr)).not.toContain('gorge');
    run(tr, 0.1, { position: { x: (v.min.x + v.max.x) / 2, y: v.min.y + 10, z: v.min.z + 10 } });
    expect(ids(tr)).toContain('gorge');
  });

  it('apostles: three volumes, in order only', () => {
    const [a, b, c] = triggers.forBonus('apostles');
    const mid = (v: typeof a): { x: number; y: number; z: number } => ({
      x: (v.min.x + v.max.x) / 2,
      y: (v.min.y + v.max.y) / 2,
      z: (v.min.z + v.max.z) / 2,
    });
    const wrong = tracker();
    for (const v of [c, b, a]) run(wrong, 0.05, { position: mid(v) });
    expect(ids(wrong)).not.toContain('apostles');
    const skipped = tracker();
    for (const v of [a, c]) run(skipped, 0.05, { position: mid(v) });
    expect(ids(skipped)).not.toContain('apostles');
    const right = tracker();
    for (const v of [a, b, c]) run(right, 0.05, { position: mid(v) });
    expect(ids(right)).toContain('apostles');
  });

  it('beach: soft landing in the Camps Bay zone only', () => {
    const b = { x: beach.centre.x, z: beach.centre.z };
    expect(ids(tracker(), end(b))).toContain('beach');
    expect(ids(tracker(), end({ ...b, landingClass: 'ok' }))).not.toContain('beach');
    expect(ids(tracker(), end({ x: glen.centre.x, z: glen.centre.z }))).not.toContain('beach');
    expect(ids(tracker(), end({ ...b, groundHeightM: 0 }))).not.toContain('beach');
  });

  it('late pull: deploy between 120 and 160 m, landing soft or ok', () => {
    expect(ids(tracker(), end({ deployAglM: 140 }))).toContain('late');
    expect(ids(tracker(), end({ deployAglM: 140, landingClass: 'ok' }))).toContain('late');
    expect(ids(tracker(), end({ deployAglM: 140, landingClass: 'hard' }))).not.toContain('late');
    expect(ids(tracker(), end({ deployAglM: 110 }))).not.toContain('late');
    expect(ids(tracker(), end({ deployAglM: 170 }))).not.toContain('late');
    expect(ids(tracker(), end({ deployAglM: null }))).not.toContain('late');
  });

  it('clean exit: awarded after 5 s if pitch swung no more than 0.6 either way', () => {
    const calm = tracker();
    run(calm, 3, {}, 0.3);
    run(calm, 3, {}, -0.2);
    expect(ids(calm)).toContain('clean');
    const jerky = tracker();
    run(jerky, 1, {}, 1);
    run(jerky, 1, {}, -1);
    run(jerky, 4, {}, 0);
    expect(ids(jerky)).not.toContain('clean');
  });

  it('long haul: air time over 75 s', () => {
    const tr = tracker();
    run(tr, 74, { aglM: 500 });
    expect(ids(tr)).not.toContain('long');
    run(tr, 2, { aglM: 500 });
    expect(ids(tr)).toContain('long');
  });

  it('awards each bonus once and queues one stamp', () => {
    const v = triggers.forBonus('gorge')[0];
    const tr = tracker();
    run(tr, 1, { position: { x: v.min.x + 10, y: v.min.y + 10, z: v.min.z + 10 } });
    const stamps = tr.drainStamps().filter((s) => s.id === 'gorge');
    expect(stamps).toHaveLength(1);
    expect(tr.drainStamps()).toHaveLength(0);
  });

  it('caps the bonuses at 3000 in total', () => {
    const tr = new ScoreTracker(START, zones, triggers);
    const v = triggers.forBonus('gorge')[0];
    const apostles = triggers.forBonus('apostles');
    run(tr, 80, { aglM: 10, airspeedMps: 50, position: { x: v.min.x + 1, y: v.min.y + 1, z: v.min.z + 1 } });
    for (const a of apostles) run(tr, 0.05, { aglM: 10, airspeedMps: 50, position: { x: a.min.x + 1, y: a.min.y + 1, z: a.min.z + 1 } });
    const b = tr.finish(end({ x: beach.centre.x, z: beach.centre.z, deployAglM: 140 }));
    const raw = b.bonuses.reduce((s, x) => s + x.points, 0);
    expect(raw).toBeGreaterThan(3000);
    expect(b.bonusScore).toBe(3000);
  });

  it('a crash keeps bonuses earned before it and awards none after', () => {
    const tr = tracker();
    run(tr, 6, {}, 0);
    const b = tr.finish(end({ crashed: true, landingClass: 'crash', ...{ x: beach.centre.x, z: beach.centre.z }, deployAglM: 140 }));
    expect(b.bonuses.map((x) => x.id)).toEqual(['clean']);
  });

  it('works with no trigger file entries', () => {
    const empty = new TriggerRegistry(parseTriggers({ volumes: [] }));
    expect(() => run(new ScoreTracker(START, zones, empty), 1)).not.toThrow();
  });
});

describe('total', () => {
  it('sums the components', () => {
    const tr = tracker();
    run(tr, 10, { aglM: 20, airspeedMps: 50 });
    const b = tr.finish(end({ x: beach.centre.x, z: beach.centre.z }));
    expect(b.total).toBe(b.distanceScore + b.airTimeScore + b.proximityScore + b.landingScore + b.bonusScore);
    expect(Number.isInteger(b.total)).toBe(true);
  });
});
