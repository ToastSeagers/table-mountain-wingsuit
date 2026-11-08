import type { LandingClass, WingsuitFlightState } from '../flight/state';
import type { LandingZone } from '../types/game';
import type { Vec3 } from '../types/math';
import type { LandingZoneRegistry } from './LandingZoneRegistry';
import { SCORING, type ScoringTuning } from './scoring-tuning';
import { insideVolume, type TriggerRegistry, type TriggerVolume } from './TriggerRegistry';

export interface StyleBonus {
  id: string;
  label: string;
  points: number;
}

/** How and where the run ended; everything the landing score and the end-of-run bonuses need. */
export interface TouchdownInfo {
  x: number;
  z: number;
  /** Terrain height under the touchdown point, metres ASL. */
  groundHeightM: number;
  /** The flight model's landing classification, or 'crash' for crashes and out-of-bounds. */
  landingClass: LandingClass;
  /** True for a crash or leaving the area; the run still scores, with distance halved. */
  crashed: boolean;
  /** AGL at deploy, null if the canopy was never opened. */
  deployAglM: number | null;
}

export type LandingSurface = 'water' | 'zone' | 'land' | 'none';

export interface ScoreBreakdown {
  distanceM: number;
  airTimeS: number;
  distanceScore: number;
  airTimeScore: number;
  proximityScore: number;
  landingScore: number;
  bonuses: StyleBonus[];
  /** Sum of bonus points after the style cap. */
  bonusScore: number;
  total: number;
  landingZoneId: string | null;
  surface: LandingSurface;
}

const cap = (v: number, max: number): number => Math.min(max, Math.max(0, v));

/**
 * Accumulates the score during a run (one `step` per simulation step) and settles it at the end
 * (`finish`). Pure TypeScript, no clocks: replaying the same states gives the same score.
 * Formulas and bonuses are docs/design/scoring.md sections 1 and 2; numbers are in
 * scoring-tuning.ts.
 */
export class ScoreTracker {
  airTimeS = 0;
  proximityRaw = 0;
  private readonly bonuses = new Map<string, StyleBonus>();
  private readonly stamps: StyleBonus[] = [];
  private ghostS = 0;
  private apostlesNext = 0;
  private pitchMin = Infinity;
  private pitchMax = -Infinity;
  private cleanDecided = false;
  private elapsedS = 0;
  private readonly apostles: TriggerVolume[];
  private readonly gorge: TriggerVolume[];

  constructor(
    private readonly start: Vec3,
    private readonly zones: LandingZoneRegistry,
    triggers: TriggerRegistry,
    private readonly tuning: ScoringTuning = SCORING,
  ) {
    this.apostles = triggers.forBonus('apostles');
    this.gorge = triggers.forBonus('gorge');
  }

  /** Call once per simulation step with the state after the step. `pitchInput` is the pilot's pitch. */
  step(dtS: number, st: Readonly<WingsuitFlightState>, pitchInput: number): void {
    this.elapsedS += dtS;
    const t = this.tuning;
    const flying = st.phase === 'freefall' || st.phase === 'wingsuit';
    if (flying) this.airTimeS += dtS;

    const p = t.proximity;
    if (st.aglM < p.aglBelowM && st.airspeedMps > p.airspeedAboveMps) {
      this.proximityRaw += (dtS * st.airspeedMps * (p.aglBelowM - st.aglM) * p.gain) / p.aglBelowM;
    }

    // Ghost line: continuous seconds low and fast.
    const g = t.bonuses.ghost;
    if (flying && st.aglM < g.aglUnderM && st.airspeedMps > g.airspeedAboveMps) {
      this.ghostS += dtS;
      if (this.ghostS >= g.holdS) this.award('ghost', g.label, g.points);
    } else {
      this.ghostS = 0;
    }

    // Trigger volumes.
    if (this.gorge.some((v) => insideVolume(v, st.position))) {
      this.award('gorge', t.bonuses.gorge.label, t.bonuses.gorge.points);
    }
    const next = this.apostles[this.apostlesNext];
    if (next && insideVolume(next, st.position)) {
      this.apostlesNext++;
      if (this.apostlesNext >= Math.min(t.bonuses.apostles.volumeCount, this.apostles.length)) {
        this.award('apostles', t.bonuses.apostles.label, t.bonuses.apostles.points);
      }
    }

    // Clean exit: the peak-to-peak swing of the pitch input over the opening seconds.
    const c = t.bonuses.clean;
    if (!this.cleanDecided) {
      this.pitchMin = Math.min(this.pitchMin, pitchInput);
      this.pitchMax = Math.max(this.pitchMax, pitchInput);
      if (this.elapsedS >= c.windowS) {
        this.cleanDecided = true;
        if ((this.pitchMax - this.pitchMin) / 2 <= c.maxAmplitude) this.award('clean', c.label, c.points);
      }
    }

    if (flying && this.airTimeS > t.bonuses.long.airTimeOverS) {
      this.award('long', t.bonuses.long.label, t.bonuses.long.points);
    }
  }

  /** Style stamps earned since the last call, for the HUD. */
  drainStamps(): StyleBonus[] {
    return this.stamps.splice(0, this.stamps.length);
  }

  /** Distance, air time, proximity and bonuses so far, for the quiet running score. */
  runningScore(position: Vec3): number {
    const d = this.tuning;
    const dist = cap(Math.hypot(position.x - this.start.x, position.z - this.start.z) * d.distance.pointsPerM, d.distance.cap);
    const air = cap(this.airTimeS * d.airTime.pointsPerS, d.airTime.cap);
    const prox = cap(this.proximityRaw, d.proximity.cap);
    let b = 0;
    for (const v of this.bonuses.values()) b += v.points;
    return Math.round(dist + air + prox + cap(b, d.styleCap));
  }

  /** Settles the run: landing score, end-of-run bonuses, caps and the total. */
  finish(end: TouchdownInfo): ScoreBreakdown {
    const t = this.tuning;
    const distRaw = Math.hypot(end.x - this.start.x, end.z - this.start.z);
    const distanceM = end.crashed ? distRaw * t.distance.crashFactor : distRaw;
    const distanceScore = Math.round(cap(distanceM * t.distance.pointsPerM, t.distance.cap));
    const airTimeScore = Math.round(cap(this.airTimeS * t.airTime.pointsPerS, t.airTime.cap));
    const proximityScore = Math.round(cap(this.proximityRaw, t.proximity.cap));

    let landingScore = 0;
    let surface: LandingSurface = 'none';
    let zone: LandingZone | null = null;
    if (!end.crashed) {
      const l = t.landing;
      const water = end.groundHeightM <= l.waterHeightM;
      zone = water ? null : this.zones.zoneAt(end.x, end.z);
      surface = water ? 'water' : zone ? 'zone' : 'land';
      const soft = l.softness[end.landingClass];
      if (water) {
        landingScore = l.waterBase;
      } else if (zone) {
        const accuracy = l.accuracyMax * Math.max(0, 1 - this.zones.distanceTo(zone, end.x, end.z) / zone.radiusM);
        landingScore = l.zoneBase * soft * l.difficultyMultiplier[zone.difficulty] + accuracy;
      } else {
        landingScore = l.landBase * soft;
      }
      landingScore = Math.round(cap(landingScore, l.cap));

      const b = t.bonuses;
      if (zone && zone.id === b.beach.zoneId && end.landingClass === 'soft') {
        this.award('beach', b.beach.label, b.beach.points);
      }
      if (
        end.deployAglM !== null &&
        end.deployAglM >= b.late.minAglM &&
        end.deployAglM <= b.late.maxAglM &&
        (end.landingClass === 'soft' || end.landingClass === 'ok')
      ) {
        this.award('late', b.late.label, b.late.points);
      }
    }

    const bonuses = [...this.bonuses.values()];
    const bonusScore = Math.round(cap(
      bonuses.reduce((s, x) => s + x.points, 0),
      t.styleCap,
    ));
    return {
      distanceM: Math.round(distanceM),
      airTimeS: Math.round(this.airTimeS * 10) / 10,
      distanceScore,
      airTimeScore,
      proximityScore,
      landingScore,
      bonuses,
      bonusScore,
      total: distanceScore + airTimeScore + proximityScore + landingScore + bonusScore,
      landingZoneId: zone?.id ?? null,
      surface,
    };
  }

  private award(id: string, label: string, points: number): void {
    if (this.bonuses.has(id)) return;
    const b = { id, label, points };
    this.bonuses.set(id, b);
    this.stamps.push(b);
  }
}
