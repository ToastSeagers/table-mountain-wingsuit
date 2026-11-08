import triggersJson from '../../data/triggers.json';
import type { Vec3 } from '../types/math';
import { DataError, Reader, root } from './validate';

const FILE = 'data/triggers.json';

/** Which style bonus a volume belongs to. */
export type TriggerBonus = 'gorge' | 'apostles';

/** An axis-aligned box in world metres. `order` is the sequence position for ordered bonuses. */
export interface TriggerVolume {
  id: string;
  bonus: TriggerBonus;
  order: number;
  min: Vec3;
  max: Vec3;
}

function readVec(r: Reader): Vec3 {
  return { x: r.child('x').number(), y: r.child('y').number(), z: r.child('z').number() };
}

export function parseTriggers(json: unknown, file: string = FILE): TriggerVolume[] {
  const top = root(file, json);
  top.object();
  const seen = new Set<string>();
  return top
    .child('volumes')
    .array()
    .map((r): TriggerVolume => {
      const id = r.child('id').string();
      if (seen.has(id)) throw new DataError(`${file}: ${r.path}.id: duplicate trigger id "${id}"`);
      seen.add(id);
      const min = readVec(r.child('min'));
      const max = readVec(r.child('max'));
      if (min.x >= max.x || min.y >= max.y || min.z >= max.z) {
        throw new DataError(`${file}: ${r.path}: min must be below max on every axis`);
      }
      return { id, bonus: r.child('bonus').oneOf(['gorge', 'apostles'] as const), order: r.child('order').number(1, 99), min, max };
    });
}

export function insideVolume(v: TriggerVolume, p: Vec3): boolean {
  return p.x >= v.min.x && p.x <= v.max.x && p.y >= v.min.y && p.y <= v.max.y && p.z >= v.min.z && p.z <= v.max.z;
}

export class TriggerRegistry {
  constructor(readonly volumes: readonly TriggerVolume[]) {}

  static fromData(): TriggerRegistry {
    return new TriggerRegistry(parseTriggers(triggersJson));
  }

  /** Volumes of one bonus, sorted by `order`. */
  forBonus(bonus: TriggerBonus): TriggerVolume[] {
    return this.volumes.filter((v) => v.bonus === bonus).sort((a, b) => a.order - b.order);
  }
}
