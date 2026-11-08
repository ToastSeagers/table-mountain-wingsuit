import checkpoints from '../../data/checkpoints.json';
import exits from '../../data/exits.json';
import zones from '../../data/landing-zones.json';
import type { Vec3 } from '../types/math';
import { latLonToWorld } from './geo';

/** A named camera pose for dev teleports and the Stage 2 measurements. */
export interface Viewpoint {
  id: string;
  label: string;
  position: Vec3;
  headingDeg: number;
  pitchDeg: number;
}

/** Eye height above an exit ledge. */
const EXIT_EYE_M = 2;
/** Look slightly down off the ledge, the way a jumper would. */
const EXIT_PITCH_DEG = -10;
/** Stage 2 brief: measure at 50 m over Camps Bay beach. */
const CAMPS_BAY_HEIGHT_M = 50;

/**
 * The four Stage 2 measurement views, from data only: each exit in data/exits.json looking along
 * its heading, and 50 m over the camps-bay-beach landing zone looking east at the Twelve Apostles
 * and the Table.
 */
export function measurementViewpoints(): Viewpoint[] {
  const out: Viewpoint[] = exits.exits.map((e) => ({
    id: e.id,
    label: e.name,
    position: latLonToWorld(e.latLon.lat, e.latLon.lon, e.elevationM + EXIT_EYE_M),
    headingDeg: e.headingDeg,
    pitchDeg: EXIT_PITCH_DEG,
  }));
  const beach = zones.zones.find((z) => z.id === 'camps-bay-beach');
  if (beach) {
    out.push({
      id: 'camps-bay',
      label: 'Camps Bay beach, 50 m',
      position: latLonToWorld(beach.latLon.lat, beach.latLon.lon, CAMPS_BAY_HEIGHT_M),
      headingDeg: 95,
      pitchDeg: 6,
    });
  }
  return out;
}

/** World position of a named checkpoint (for the attract orbit). */
export function checkpointPosition(name: string): Vec3 | null {
  const p = checkpoints.points.find((c) => c.name === name);
  return p ? latLonToWorld(p.lat, p.lon, p.expectedY) : null;
}
