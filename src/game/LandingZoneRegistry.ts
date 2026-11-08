import zonesJson from '../../data/landing-zones.json';
import type { LandingZone } from '../types/game';
import { latLonToWorld } from '../world/geo';
import { DataError, root } from './validate';

const FILE = 'data/landing-zones.json';

export function parseZones(json: unknown, file: string = FILE): LandingZone[] {
  const top = root(file, json);
  top.object();
  const list = top.child('zones').array();
  const seen = new Set<string>();
  return list.map((r): LandingZone => {
    const id = r.child('id').string();
    if (seen.has(id)) throw new DataError(`${file}: ${r.path}.id: duplicate zone id "${id}"`);
    seen.add(id);
    const ll = r.child('latLon');
    ll.object();
    return {
      id,
      name: r.child('name').string(),
      // Zones are circles on the ground; only x and z matter, so y stays 0 (sea level).
      centre: latLonToWorld(ll.child('lat').number(-90, 90), ll.child('lon').number(-180, 180), 0),
      radiusM: r.child('radiusM').number(1, 2000),
      surface: r.child('surface').oneOf(['grass', 'sand', 'tarmac', 'water'] as const),
      difficulty: r.child('difficulty').oneOf([1, 2, 3] as const),
    };
  });
}

export class LandingZoneRegistry {
  constructor(readonly zones: readonly LandingZone[]) {}

  static fromData(): LandingZoneRegistry {
    return new LandingZoneRegistry(parseZones(zonesJson));
  }

  get(id: string): LandingZone | undefined {
    return this.zones.find((z) => z.id === id);
  }

  ids(): Set<string> {
    return new Set(this.zones.map((z) => z.id));
  }

  /** The zone containing (x, z), preferring the one the point is deepest inside; null if none. */
  zoneAt(x: number, z: number): LandingZone | null {
    let best: LandingZone | null = null;
    let bestFrac = Infinity;
    for (const zone of this.zones) {
      const frac = Math.hypot(x - zone.centre.x, z - zone.centre.z) / zone.radiusM;
      if (frac <= 1 && frac < bestFrac) {
        best = zone;
        bestFrac = frac;
      }
    }
    return best;
  }

  /** Horizontal distance from (x, z) to the zone centre. */
  distanceTo(zone: LandingZone, x: number, z: number): number {
    return Math.hypot(x - zone.centre.x, z - zone.centre.z);
  }
}
