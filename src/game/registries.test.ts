import { describe, expect, it } from 'vitest';
import exitsJson from '../../data/exits.json';
import { DataError } from './validate';
import { ExitRegistry, parseExits } from './ExitRegistry';
import { LandingZoneRegistry, parseZones } from './LandingZoneRegistry';
import { insideVolume, parseTriggers, TriggerRegistry } from './TriggerRegistry';

const exit = {
  id: 'x',
  name: 'X',
  subtitle: 'sub',
  latLon: { lat: -33.95, lon: 18.41 },
  elevationM: 100,
  headingDeg: 90,
  difficulty: 1,
  recommendedLandingZones: [],
  unlock: { type: 'always' },
  intro: { cameraPath: [{ latLon: { lat: -33.95, lon: 18.411 }, elevationM: 200 }], durationS: 6 },
  blurb: 'b',
};

describe('ExitRegistry', () => {
  it('loads the three real exits in world metres', () => {
    const reg = ExitRegistry.fromData();
    expect(reg.exits.map((e) => e.id)).toEqual(['the-table', 'platteklip', 'lions-head']);
    const table = reg.get('the-table');
    // West of the origin and south of it (X east, Z south): the Table sits at x about -670, z about +800.
    expect(table.position.x).toBeLessThan(-500);
    expect(table.position.z).toBeGreaterThan(500);
    expect(table.position.y).toBeGreaterThan(1000);
    expect(reg.get('lions-head').altHeadings.map((a) => a.label)).toEqual(['Sea Point', 'Clifton']);
    expect(reg.get('platteklip').unlock).toEqual({ type: 'completed', exitId: 'the-table' });
  });

  it('converts lat/lon at the data boundary', () => {
    const [e] = parseExits({ exits: [exit] });
    expect(e.position.x).toBeCloseTo(0, 6);
    expect(e.position.z).toBeCloseTo(0, 6);
    expect(e.position.y).toBe(100);
    expect(e.intro.cameraPath[0].x).toBeCloseTo(92.38, 1);
  });

  it('accepts a fourth exit with no code change', () => {
    const four = parseExits({ exits: [...(exitsJson.exits as unknown[]), { ...exit, id: 'fourth' }] });
    expect(four).toHaveLength(4);
    expect(new ExitRegistry(four).get('fourth').name).toBe('X');
  });

  it('throws readable errors that name the file and the field', () => {
    expect(() => parseExits({ exits: [{ ...exit, headingDeg: 'north' }] })).toThrow(/data\/exits\.json: \$\.exits\[0\]\.headingDeg: expected a finite number, got string "north"/);
    expect(() => parseExits({ exits: [{ ...exit, difficulty: 4 }] })).toThrow(/difficulty: expected one of 1, 2, 3/);
    expect(() => parseExits({ exits: [exit, exit] })).toThrow(/duplicate exit id "x"/);
    expect(() => parseExits({ exits: [] })).toThrow(/at least one exit/);
    expect(() => parseExits({})).toThrow(DataError);
    expect(() => parseExits({ exits: [{ ...exit, unlock: { type: 'completed', exitId: 'nope' } }] })).toThrow(/unknown exit "nope"/);
    expect(() => parseExits('nope', 'custom.json')).toThrow(/custom\.json: \$: expected an object/);
  });

  it('checks recommended zones exist', () => {
    const reg = ExitRegistry.fromData();
    const zones = LandingZoneRegistry.fromData();
    expect(() => reg.checkZones(zones.ids())).not.toThrow();
    expect(() => reg.checkZones(new Set(['camps-bay-beach']))).toThrow(/unknown landing zone/);
  });
});

describe('LandingZoneRegistry', () => {
  it('loads the seven zones and finds the zone under a point', () => {
    const reg = LandingZoneRegistry.fromData();
    expect(reg.zones).toHaveLength(7);
    const beach = reg.get('camps-bay-beach');
    expect(beach?.radiusM).toBe(120);
    expect(reg.zoneAt(beach!.centre.x + 30, beach!.centre.z)?.id).toBe('camps-bay-beach');
    expect(reg.zoneAt(beach!.centre.x + 500, beach!.centre.z)).toBeNull();
  });

  it('rejects bad zones', () => {
    const z = { id: 'a', name: 'A', latLon: { lat: -33.9, lon: 18.4 }, radiusM: 50, surface: 'grass', difficulty: 2 };
    expect(parseZones({ zones: [z] })).toHaveLength(1);
    expect(() => parseZones({ zones: [{ ...z, surface: 'lava' }] })).toThrow(/surface: expected one of/);
    expect(() => parseZones({ zones: [{ ...z, radiusM: 0 }] })).toThrow(/radiusM/);
    expect(() => parseZones({ zones: [z, z] })).toThrow(/duplicate zone id/);
  });
});

describe('TriggerRegistry', () => {
  const vol = { id: 'g', bonus: 'gorge', order: 1, min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } };

  it('validates volumes and tests containment', () => {
    const [v] = parseTriggers({ volumes: [vol] });
    expect(insideVolume(v, { x: 5, y: 5, z: 5 })).toBe(true);
    expect(insideVolume(v, { x: 11, y: 5, z: 5 })).toBe(false);
    expect(() => parseTriggers({ volumes: [{ ...vol, max: { x: -1, y: 10, z: 10 } }] })).toThrow(/min must be below max/);
    expect(() => parseTriggers({ volumes: [{ ...vol, bonus: 'wow' }] })).toThrow(/bonus: expected one of/);
  });

  it('ships the gorge and three Apostles volumes in order', () => {
    const reg = TriggerRegistry.fromData();
    expect(reg.forBonus('gorge')).toHaveLength(1);
    expect(reg.forBonus('apostles').map((v) => v.order)).toEqual([1, 2, 3]);
  });
});
