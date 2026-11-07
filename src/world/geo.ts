import type { Vec3 } from '../types/math';

// Frame constants from docs/01-architecture.md section 3. Must match tools/terrain/geo.py.
export const ORIGIN_LAT = -33.95;
export const ORIGIN_LON = 18.41;
/** Metres per degree of latitude at 34 degrees south. */
export const METRES_PER_DEG_LAT = 110_940;
/** 111_320 * cos(33.95 deg): metres per degree of longitude at the origin latitude. */
export const METRES_PER_DEG_LON = 92_380;

/** Convert at the data boundary only; gameplay code never sees lat/lon. North is negative Z. */
export function latLonToWorld(latDeg: number, lonDeg: number, elevationM = 0): Vec3 {
  return {
    x: (lonDeg - ORIGIN_LON) * METRES_PER_DEG_LON,
    y: elevationM,
    z: -(latDeg - ORIGIN_LAT) * METRES_PER_DEG_LAT,
  };
}

export function worldToLatLon(p: Vec3): { lat: number; lon: number; elevationM: number } {
  return {
    lat: ORIGIN_LAT - p.z / METRES_PER_DEG_LAT,
    lon: ORIGIN_LON + p.x / METRES_PER_DEG_LON,
    elevationM: p.y,
  };
}
