/**
 * Every scoring constant, from docs/design/scoring.md. Stage 6 balances these so a good first
 * run scores around 5,000 and an expert run around 15,000; record each change in its report.
 */
export const SCORING = {
  distance: {
    /** Points per horizontal metre from exit to touchdown (spec section 1). */
    pointsPerM: 1.0,
    cap: 6000,
    /** A crash counts half the distance. */
    crashFactor: 0.5,
  },
  airTime: {
    /** Points per second in freefall + wingsuit phases. */
    pointsPerS: 40,
    cap: 4000,
  },
  proximity: {
    /** Under this clearance and over this airspeed, proximity accrues (spec section 1). */
    aglBelowM: 50,
    airspeedAboveMps: 35,
    /**
     * Points per second = gain * airspeed * closeness * risk multiplier, closeness being
     * (aglBelowM - clearance) / aglBelowM. Stage 9: 4 -> 2, because the multiplier now averages about 0.27 on
     * open ground and 1.6 along the real Platteklip gully: a 12 m, 50 m/s skim of open slope is about 20 points
     * a second (a minute of skimming is 1,200) and the gully about 120, up to 270 in a properly closed gorge.
     * The old formula paid 152 a second for the same skim.
     */
    gain: 2,
    /** Risk multiplier = riskFloor + riskSpan * narrowness: open ground (narrowness under 0.05) is worth 0.27x, a half-closed gully 2.5x, a fully closed gorge or gap 4.75x. */
    riskFloor: 0.25,
    riskSpan: 4.5,
    cap: 5000,
  },
  /**
   * Terrain sampling around the pilot (src/game/risk.ts), all in metres. The Platteklip gully is 60 to 100 m
   * wide with 20 to 60 m walls in the 5 m DEM, so the side samples reach 30 and 70 m.
   */
  risk: {
    /** Walls count only once they reach within this far below flight level (a pilot far above a gorge floor is not in it)... */
    levelBelowM: 15,
    /** ...and ground this far above that reference level, or above the ground under the pilot if that is higher, blocks completely. */
    riseFullM: 20,
    /** Lateral offsets, each side, for the narrowness term. */
    sideSamplesM: [30, 70],
    /** Offsets along the direction of travel for the narrowness term. */
    aheadSamplesM: [50, 110],
    /** Share of narrowness that comes from both sides being closed; the rest from rock ahead. A gorge floor has closed sides and a falling floor ahead, so 0.7. */
    sidesWeight: 0.7,
    /** Close samples for the near-miss clearance. */
    nearLateralM: [8],
    nearAheadM: [12, 25],
    /** Steps between samples: the tracker senses at 30 Hz from the 120 Hz step. */
    senseEverySteps: 4,
  },
  /** A discrete near-miss: within a few metres of terrain at speed. One pass, one stamp. */
  nearMiss: {
    label: 'NEAR MISS',
    /** A pass begins when the clearance drops to this (metres) at this airspeed. */
    withinM: 6,
    airspeedAboveMps: 40,
    /** The pass ends, and a new one may begin, only once clearance has opened back up to this. Skimming at 5 m for a minute is one pass. */
    rearmM: 20,
    /** And at least this long after the last stamp, so a wobble near a wall cannot stamp twice. */
    cooldownS: 4,
    /** No near misses in the first seconds: the pilot leaves the ledge 1.5 m up. */
    graceS: 3,
    /** Lump sum = basePoints * (floor + (1 - floor) * narrowness): 90 for a pass over open ground, up to 300 in a gorge or ridge gap. */
    basePoints: 300,
    floor: 0.3,
    /** The tally's near-miss line saturates here, like every other component. */
    cap: 3000,
  },
  landing: {
    zoneBase: 1500,
    landBase: 300,
    waterBase: 0,
    /** Softness multipliers by landing classification. */
    softness: { soft: 1.0, ok: 0.7, hard: 0.35, crash: 0 },
    /** Zone difficulty 1, 2, 3. */
    difficultyMultiplier: { 1: 1.0, 2: 1.25, 3: 1.5 },
    /** Bonus at the zone centre, falling linearly to zero at the radius. */
    accuracyMax: 500,
    cap: 3500,
    /** Ground at or below this height is the sea (the DEM sea is exactly 0). */
    waterHeightM: 0.25,
  },
  styleCap: 3000,
  bonuses: {
    ghost: { points: 800, label: 'GHOST LINE', aglUnderM: 15, airspeedAboveMps: 40, holdS: 5 },
    gorge: { points: 700, label: 'THROUGH THE GORGE' },
    apostles: { points: 700, label: 'APOSTLES TRAVERSE', volumeCount: 3 },
    beach: { points: 500, label: 'TOES IN THE SAND', zoneId: 'camps-bay-beach' },
    late: { points: 400, label: 'LATE PULL', minAglM: 120, maxAglM: 160 },
    clean: { points: 200, label: 'CLEAN EXIT', windowS: 5, maxAmplitude: 0.6 },
    long: { points: 300, label: 'LONG HAUL', airTimeOverS: 75 },
  },
} as const;

export type ScoringTuning = typeof SCORING;
