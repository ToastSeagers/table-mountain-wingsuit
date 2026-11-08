import exitsJson from '../../data/exits.json';
import type { ExitDefinition } from '../types/game';
import type { Vec3 } from '../types/math';
import { latLonToWorld } from '../world/geo';
import { DataError, Reader, root } from './validate';

export interface AltHeading {
  label: string;
  headingDeg: number;
}

/**
 * An ExitDefinition plus the optional sub-exits the frozen type has no room for (Lion's Head can
 * face Sea Point or Clifton). `altHeadings` is empty for exits with one heading.
 */
export interface ExitDef extends ExitDefinition {
  altHeadings: AltHeading[];
}

const FILE = 'data/exits.json';

/** A lat/lon/elevation triple at the data boundary, converted to world metres. */
function readPoint(r: Reader, elevationKey = 'elevationM'): Vec3 {
  const ll = r.child('latLon');
  ll.object();
  return latLonToWorld(ll.child('lat').number(-90, 90), ll.child('lon').number(-180, 180), r.child(elevationKey).number(-500, 9000));
}

function readUnlock(r: Reader): ExitDefinition['unlock'] {
  const type = r.child('type').oneOf(['always', 'completed', 'score'] as const);
  if (type === 'always') return { type };
  if (type === 'completed') return { type, exitId: r.child('exitId').string() };
  return { type, exitId: r.child('exitId').string(), min: r.child('min').number(0) };
}

/** Parses and validates the exits file. Throws DataError with the path of the first bad field. */
export function parseExits(json: unknown, file: string = FILE): ExitDef[] {
  const top = root(file, json);
  top.object();
  const list = top.child('exits').array();
  if (list.length === 0) throw new DataError(`${file}: $.exits: at least one exit is required`);
  const seen = new Set<string>();
  const exits = list.map((r): ExitDef => {
    const id = r.child('id').string();
    if (seen.has(id)) throw new DataError(`${file}: ${r.path}.id: duplicate exit id "${id}"`);
    seen.add(id);
    const intro = r.child('intro');
    const altRaw = r.optional('altHeadings');
    return {
      id,
      name: r.child('name').string(),
      subtitle: r.child('subtitle').string(),
      position: readPoint(r),
      headingDeg: r.child('headingDeg').number(0, 360),
      difficulty: r.child('difficulty').oneOf([1, 2, 3] as const),
      recommendedLandingZones: r.child('recommendedLandingZones').stringArray(),
      unlock: readUnlock(r.child('unlock')),
      intro: {
        cameraPath: intro
          .child('cameraPath')
          .array()
          .map((p) => readPoint(p)),
        durationS: intro.child('durationS').number(1, 30),
      },
      blurb: r.child('blurb').string(),
      altHeadings: altRaw
        ? altRaw.array().map((a) => ({ label: a.child('label').string(), headingDeg: a.child('headingDeg').number(0, 360) }))
        : [],
    };
  });
  for (const [i, e] of exits.entries()) {
    if (e.unlock.type !== 'always' && !seen.has(e.unlock.exitId)) {
      throw new DataError(`${file}: $.exits[${i}].unlock.exitId: unknown exit "${e.unlock.exitId}"`);
    }
  }
  return exits;
}

/** All exits, in file order. A fourth exit in the JSON shows up in the UI with no code change. */
export class ExitRegistry {
  constructor(readonly exits: readonly ExitDef[]) {}

  static fromData(): ExitRegistry {
    return new ExitRegistry(parseExits(exitsJson));
  }

  get(id: string): ExitDef {
    const e = this.exits.find((x) => x.id === id);
    if (!e) throw new DataError(`unknown exit "${id}"`);
    return e;
  }

  find(id: string): ExitDef | undefined {
    return this.exits.find((x) => x.id === id);
  }

  /** Checks that every recommended landing zone id exists; call once at boot with the zone ids. */
  checkZones(zoneIds: ReadonlySet<string>, file: string = FILE): void {
    for (const [i, e] of this.exits.entries()) {
      for (const z of e.recommendedLandingZones) {
        if (!zoneIds.has(z)) throw new DataError(`${file}: $.exits[${i}].recommendedLandingZones: unknown landing zone "${z}"`);
      }
    }
  }
}
