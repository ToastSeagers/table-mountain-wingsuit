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
    /** Under this AGL and over this airspeed, proximity accrues. */
    aglBelowM: 50,
    airspeedAboveMps: 35,
    /** Scale on dt * airspeed * (aglBelowM - agl) / aglBelowM. */
    gain: 4,
    cap: 5000,
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
