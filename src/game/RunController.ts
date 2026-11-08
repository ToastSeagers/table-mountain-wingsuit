import { FlightModelImpl } from '../flight/FlightModelImpl';
import type { LandingClass, WingsuitFlightState } from '../flight/state';
import type { FlightInput } from '../types/flight';
import type { RunResult } from '../types/game';
import type { Quat, Vec3 } from '../types/math';
import type { TerrainSampler } from '../types/terrain';
import type { RawFlightInput } from '../core/InputManager';
import type { ExitDef } from './ExitRegistry';
import type { LandingZoneRegistry } from './LandingZoneRegistry';
import { ReplayRecorder } from './Replay';
import { SCORING } from './scoring-tuning';
import { ScoreTracker, type ScoreBreakdown, type StyleBonus } from './Scoring';
import type { TriggerRegistry } from './TriggerRegistry';

/** Leaving the terrain area by this much ends the run (brief: 200 m). */
export const OUT_OF_BOUNDS_MARGIN_M = 200;
/** Metres above the exit ledge at the start, so the first step is not terrain contact. */
export const START_CLEARANCE_M = 1.5;

export type EndReason = 'landed' | 'water' | 'crashed' | 'out-of-bounds';

/** Everything the results screen needs: the RunResult to store plus the details it does not hold. */
export interface RunOutcome {
  result: RunResult;
  reason: EndReason;
  breakdown: ScoreBreakdown;
  landingClass: LandingClass | null;
  lowPull: boolean;
  /** Touchdown vertical and forward speed, m/s, if the model reported a landing. */
  touchdown: { verticalMps: number; forwardMps: number } | null;
  /** Splashed down: a crash into the sea gets the same soft card as a water landing. */
  inWater: boolean;
}

export interface RunPose {
  position: Vec3;
  orientation: Quat;
}

export interface RunControllerOptions {
  exit: ExitDef;
  /** Heading for this run: the exit's own, or one of its alternates. */
  headingDeg: number;
  terrain: TerrainSampler;
  zones: LandingZoneRegistry;
  triggers: TriggerRegistry;
  seed?: number;
  /** Injectable clock for tests; defaults to the current time. */
  nowIso?: () => string;
}

/**
 * Drives one run: the flight model, scoring, replay recording at 30 Hz, and end detection
 * (touchdown, crash, out of bounds). Fixed-step: call `step` with the same dt every time. Keeps the
 * previous and current pose so the renderer can interpolate between steps.
 */
export class RunController {
  readonly model = new FlightModelImpl();
  readonly tracker: ScoreTracker;
  readonly recorder = new ReplayRecorder();
  readonly exit: ExitDef;
  readonly headingDeg: number;
  outcome: RunOutcome | null = null;
  private readonly prev: RunPose = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  private readonly input: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
  private actionReleasedAfterDeploy = false;
  private lastPhase: string = 'freefall';
  private readonly phaseListeners: ((from: string, to: string) => void)[] = [];
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private started = false;

  constructor(private readonly opts: RunControllerOptions) {
    this.exit = opts.exit;
    this.headingDeg = opts.headingDeg;
    this.tracker = new ScoreTracker(opts.exit.position, opts.zones, opts.triggers);
    const b = opts.terrain.bounds;
    this.bounds = {
      minX: b.minX - OUT_OF_BOUNDS_MARGIN_M,
      maxX: b.maxX + OUT_OF_BOUNDS_MARGIN_M,
      minZ: b.minZ - OUT_OF_BOUNDS_MARGIN_M,
      maxZ: b.maxZ + OUT_OF_BOUNDS_MARGIN_M,
    };
  }

  get state(): WingsuitFlightState {
    return this.model.state;
  }

  get ended(): boolean {
    return this.outcome !== null;
  }

  onPhase(listener: (from: string, to: string) => void): void {
    this.phaseListeners.push(listener);
  }

  /** Places the pilot on the ledge and records the first frame. */
  start(): void {
    const e = this.exit.position;
    const ground = this.opts.terrain.heightAt(e.x, e.z);
    const pos = { x: e.x, y: Math.max(e.y, ground + START_CLEARANCE_M), z: e.z };
    this.model.reset(pos, this.headingDeg, this.opts.seed ?? 1);
    this.model.state.aglM = pos.y - ground;
    this.copyPose(this.prev);
    const st = this.model.state;
    this.recorder.sample(0, st.position, st.orientation, st.phase);
    this.lastPhase = st.phase;
    this.started = true;
  }

  /** Raw player intent to model input: deploy in the wingsuit, flare only on a fresh press under canopy. */
  stepRaw(dtS: number, raw: RawFlightInput): void {
    const phase = this.model.state.phase;
    const canopy = phase === 'deploying' || phase === 'canopy';
    if (canopy && !raw.action) this.actionReleasedAfterDeploy = true;
    const i = this.input;
    i.pitch = raw.pitch;
    i.roll = raw.roll;
    i.yaw = raw.yaw;
    i.brake = raw.brake;
    i.deploy = !canopy && raw.action;
    i.flare = canopy && this.actionReleasedAfterDeploy && raw.action;
    this.step(dtS, i);
  }

  /** One fixed step with an already-formed FlightInput. */
  step(dtS: number, input: FlightInput): void {
    if (!this.started || this.outcome) return;
    this.copyPose(this.prev);
    const st = this.model.step(dtS, input, this.opts.terrain);
    this.tracker.step(dtS, st, input.pitch);
    this.recorder.sample(st.elapsedS, st.position, st.orientation, st.phase);
    if (st.phase !== this.lastPhase) {
      for (const l of this.phaseListeners) l(this.lastPhase, st.phase);
      this.lastPhase = st.phase;
    }

    const p = st.position;
    const finite = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    if (!finite) {
      this.finish('crashed', true);
    } else if (st.phase === 'landed' || st.phase === 'crashed') {
      this.finish(st.phase === 'landed' ? 'landed' : 'crashed', st.phase === 'crashed');
    } else if (p.x < this.bounds.minX || p.x > this.bounds.maxX || p.z < this.bounds.minZ || p.z > this.bounds.maxZ) {
      this.finish('out-of-bounds', true);
    }
  }

  /** Style stamps earned since the last call. */
  drainStamps(): StyleBonus[] {
    return this.tracker.drainStamps();
  }

  /** The pose between the previous and current step, for rendering at any frame rate. */
  interpolate(alpha: number, out: RunPose): void {
    const a = this.prev;
    const b = this.model.state;
    const u = this.outcome ? 1 : alpha;
    out.position.x = a.position.x + (b.position.x - a.position.x) * u;
    out.position.y = a.position.y + (b.position.y - a.position.y) * u;
    out.position.z = a.position.z + (b.position.z - a.position.z) * u;
    const dot = a.orientation.x * b.orientation.x + a.orientation.y * b.orientation.y + a.orientation.z * b.orientation.z + a.orientation.w * b.orientation.w;
    const s = dot < 0 ? -1 : 1;
    const x = a.orientation.x + (s * b.orientation.x - a.orientation.x) * u;
    const y = a.orientation.y + (s * b.orientation.y - a.orientation.y) * u;
    const z = a.orientation.z + (s * b.orientation.z - a.orientation.z) * u;
    const w = a.orientation.w + (s * b.orientation.w - a.orientation.w) * u;
    const n = Math.hypot(x, y, z, w) || 1;
    out.orientation.x = x / n;
    out.orientation.y = y / n;
    out.orientation.z = z / n;
    out.orientation.w = w / n;
  }

  /** Ends the run at the current state (quit). Scores it as a crash at the current position. */
  abort(): void {
    if (!this.outcome && this.started) this.finish('crashed', true);
  }

  private copyPose(out: RunPose): void {
    const st = this.model.state;
    out.position.x = st.position.x;
    out.position.y = st.position.y;
    out.position.z = st.position.z;
    out.orientation.x = st.orientation.x;
    out.orientation.y = st.orientation.y;
    out.orientation.z = st.orientation.z;
    out.orientation.w = st.orientation.w;
  }

  private finish(reason: EndReason, crashed: boolean): void {
    const st = this.model.state;
    const ground = Number.isFinite(st.position.x) ? this.opts.terrain.heightAt(st.position.x, st.position.z) : 0;
    const water = ground <= SCORING.landing.waterHeightM;
    const landing = st.landing;
    const landingClass: LandingClass = crashed ? 'crash' : (landing?.classification ?? 'soft');
    const breakdown = this.tracker.finish({
      x: st.position.x,
      z: st.position.z,
      groundHeightM: ground,
      landingClass,
      crashed,
      deployAglM: st.deployAglM,
    });
    this.recorder.force(st.elapsedS, st.position, st.orientation, st.phase);
    const finalReason: EndReason = reason === 'landed' && water ? 'water' : reason;
    const result: RunResult = {
      exitId: this.exit.id,
      landingZoneId: breakdown.landingZoneId,
      distanceM: breakdown.distanceM,
      airTimeS: breakdown.airTimeS,
      proximityScore: breakdown.proximityScore,
      landingScore: breakdown.landingScore,
      styleBonuses: breakdown.bonuses,
      total: breakdown.total,
      crashed,
      replay: this.recorder.frames,
      recordedAt: (this.opts.nowIso ?? ((): string => new Date().toISOString()))(),
    };
    this.outcome = {
      result,
      reason: finalReason,
      breakdown,
      landingClass: landing ? landingClass : null,
      lowPull: st.lowPull,
      touchdown: landing ? { verticalMps: landing.verticalMps, forwardMps: landing.forwardMps } : null,
      inWater: water,
    };
  }
}
