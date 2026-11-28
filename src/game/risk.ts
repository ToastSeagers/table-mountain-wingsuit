import type { Vec3 } from '../types/math';
import type { TerrainSampler } from '../types/terrain';
import { SCORING } from './scoring-tuning';

/** What the terrain around the pilot says about how dangerous this moment is. */
export interface Surroundings {
  /**
   * Approximate distance to the nearest terrain, metres: the minimum over the ground below and a few
   * close samples to the sides and ahead (a wall within `d` metres counts as `d`, ground below the
   * pilot at offset `d` as the slant distance to it). Not a true 3D distance, but it needs no ray cast.
   */
  clearanceM: number;
  /** 0 on open ground, 1 with rock above flight level on both sides and ahead (a gorge or a ridge gap). */
  narrowness: number;
}

export function createSurroundings(): Surroundings {
  return { clearanceM: Infinity, narrowness: 0 };
}

const smooth = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * How much the ground at an offset blocks the pilot's level. The reference level is the flight level
 * less `levelBelowM`, but never below the ground under the pilot, so a pilot skimming open ground sees
 * flat ground (the same height as the ground below) as no wall at all, however low they fly; ground
 * `riseFullM` above the reference level blocks completely.
 */
function wall(groundM: number, belowM: number, yM: number): number {
  const r = SCORING.risk;
  const ref = Math.max(belowM, yM - r.levelBelowM);
  return smooth((groundM - ref) / r.riseFullM);
}

/**
 * Samples the terrain around `position` along and across the direction of travel (the horizontal
 * velocity, or `fallbackHeadingDeg` when nearly stationary) and writes the result to `out`. Twelve
 * height lookups, called at 30 Hz by the tracker.
 */
export function senseSurroundings(
  terrain: TerrainSampler,
  position: Vec3,
  velocity: Vec3,
  fallbackHeadingDeg: number,
  out: Surroundings,
): void {
  const r = SCORING.risk;
  let fx = velocity.x;
  let fz = velocity.z;
  const hs = Math.hypot(fx, fz);
  if (hs < 1) {
    const h = (fallbackHeadingDeg * Math.PI) / 180;
    fx = Math.sin(h);
    fz = -Math.cos(h);
  } else {
    fx /= hs;
    fz /= hs;
  }
  // Right of travel in a frame with X east, Z south is (-fz, fx) rotated: for forward (fx, fz) the
  // lateral axis is (fz, -fx) or its negative; the sign does not matter because both sides are sampled.
  const lx = fz;
  const lz = -fx;
  const y = position.y;
  const ground = (ox: number, oz: number): number => terrain.heightAt(position.x + ox, position.z + oz);

  const below = ground(0, 0);
  let clear = Math.max(0, y - below);

  // Close samples for the near-miss test.
  for (const d of r.nearLateralM) {
    for (const s of [-1, 1]) {
      const g = ground(lx * d * s, lz * d * s);
      clear = Math.min(clear, g >= y ? d : Math.hypot(d, y - g));
    }
  }
  for (const d of r.nearAheadM) {
    const g = ground(fx * d, fz * d);
    clear = Math.min(clear, g >= y ? d : Math.hypot(d, y - g));
  }
  out.clearanceM = clear;

  // Wider samples for the narrowness term: both sides closed, and rock ahead.
  let left = 0;
  let right = 0;
  for (const d of r.sideSamplesM) {
    left += wall(ground(lx * d, lz * d), below, y);
    right += wall(ground(-lx * d, -lz * d), below, y);
  }
  left /= r.sideSamplesM.length;
  right /= r.sideSamplesM.length;
  const sides = Math.min(left, right);
  let ahead = 0;
  for (const d of r.aheadSamplesM) ahead = Math.max(ahead, wall(ground(fx * d, fz * d), below, y));
  out.narrowness = Math.min(1, r.sidesWeight * sides + (1 - r.sidesWeight) * ahead);
}
