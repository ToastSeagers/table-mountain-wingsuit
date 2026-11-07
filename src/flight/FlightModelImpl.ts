import type { FlightInput, FlightModel } from '../types/flight';
import type { Quat, Vec3 } from '../types/math';
import type { TerrainSampler } from '../types/terrain';
import { CanopyModel, classifyLanding } from './CanopyModel';
import { DEG_TO_RAD, headingDegOf, qbasis, qFromHeadingPitchBank, RAD_TO_DEG } from './math3';
import { createFlightState, type LandingClass, type WingsuitFlightState } from './state';
import { LANDING, WINGSUIT } from './tuning';
import { WingsuitModel } from './WingsuitModel';

/**
 * The FlightModel: owns the state, runs the phase machine and terrain contact, and delegates
 * forces to WingsuitModel and CanopyModel. Designed for a fixed 1/120 s step from the caller.
 *
 * Phases: freefall -> wingsuit (wing area ramp at 90 %) -> deploying (deploy edge) -> canopy
 * (after 2.5 s) -> landed | crashed (ground contact, classified). Wingsuit contact is a crash.
 */
export class FlightModelImpl implements FlightModel {
  readonly state: WingsuitFlightState = createFlightState();

  private readonly wing = new WingsuitModel();
  private readonly canopy = new CanopyModel();
  private prevDeploy = false;
  private rngState = 1;
  private readonly f: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly u: Vec3 = { x: 0, y: 1, z: 0 };
  private readonly r: Vec3 = { x: 1, y: 0, z: 0 };
  private readonly qtmp: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private readonly landingReport = {
    verticalMps: 0,
    forwardMps: 0,
    classification: 'soft' as LandingClass,
  };

  /** Seed is for future stochastic effects (buffet, turbulence); nothing in v0.1 draws from it. */
  reset(position: Vec3, headingDeg: number, seed = 0): void {
    const st = this.state;
    st.position.x = position.x;
    st.position.y = position.y;
    st.position.z = position.z;
    const h = headingDeg * DEG_TO_RAD;
    st.velocity.x = Math.sin(h) * WINGSUIT.exitSpeedMps;
    st.velocity.y = 0;
    st.velocity.z = -Math.cos(h) * WINGSUIT.exitSpeedMps;
    qFromHeadingPitchBank(st.orientation, this.qtmp, headingDeg, 0, 0);
    st.phase = 'freefall';
    st.airspeedMps = WINGSUIT.exitSpeedMps;
    st.aglM = 0;
    st.elapsedS = 0;
    st.glideRatio = 99;
    st.gLoad = 0;
    st.alphaDeg = 0;
    st.betaDeg = 0;
    st.mushFactor = 0;
    st.wingAreaFactor = WINGSUIT.areaRampStart;
    st.headingDeg = ((headingDeg % 360) + 360) % 360;
    st.pitchDeg = 0;
    st.bankDeg = 0;
    st.sinkMps = 0;
    st.groundSpeedMps = WINGSUIT.exitSpeedMps;
    st.deployAglM = null;
    st.lowPull = false;
    st.landing = null;
    st.flareEnergy = 1;
    this.wing.reset();
    this.canopy.reset();
    this.prevDeploy = false;
    this.rngState = seed | 0 || 0x9e3779b9;
  }

  /** Deterministic xorshift32 in [0, 1). */
  random(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x;
    return (x >>> 0) / 4294967296;
  }

  step(dtS: number, input: FlightInput, terrain: TerrainSampler): WingsuitFlightState {
    const st = this.state;
    if (st.phase === 'landed' || st.phase === 'crashed') return st;
    st.elapsedS += dtS;

    const deploy = input.deploy;
    switch (st.phase) {
      case 'freefall':
      case 'wingsuit':
        this.wing.step(dtS, input, st);
        if (st.phase === 'freefall' && this.wing.flyingSinceS >= 0) st.phase = 'wingsuit';
        if (st.phase === 'wingsuit' && deploy && !this.prevDeploy) {
          st.phase = 'deploying';
          st.deployAglM = st.aglM;
          st.lowPull = st.aglM < LANDING.minSafeDeployAglM;
          this.canopy.beginOpening(st);
        }
        break;
      case 'deploying':
        if (this.canopy.stepOpening(dtS, input, st)) st.phase = 'canopy';
        break;
      case 'canopy':
        this.canopy.stepCanopy(dtS, input, st);
        break;
    }
    this.prevDeploy = deploy;

    const p = st.position;
    const v = st.velocity;
    p.x += v.x * dtS;
    p.y += v.y * dtS;
    p.z += v.z * dtS;

    const ground = terrain.heightAt(p.x, p.z);
    st.aglM = p.y - ground;
    this.updateReadouts();

    // --- Ground contact.
    const vertical = -v.y;
    const forward = st.groundSpeedMps;
    if (st.phase === 'freefall' || st.phase === 'wingsuit') {
      if (
        st.aglM <= 0 ||
        (st.aglM < LANDING.wingsuitCrashAglM && st.airspeedMps > LANDING.wingsuitCrashSpeedMps)
      ) {
        this.touchdown(ground, vertical, forward, 'crash');
      }
    } else if (st.phase === 'deploying') {
      if (st.aglM <= 0) {
        const cls: LandingClass =
          vertical <= LANDING.deployingLandMaxVerticalMps && forward <= LANDING.crashForwardMps
            ? 'hard'
            : 'crash';
        this.touchdown(ground, vertical, forward, cls);
      }
    } else if (st.phase === 'canopy') {
      if (st.aglM <= 0)
        this.touchdown(ground, vertical, forward, classifyLanding(vertical, forward));
    }
    return st;
  }

  private updateReadouts(): void {
    const st = this.state;
    const v = st.velocity;
    const horizontal = Math.hypot(v.x, v.z);
    const sink = -v.y;
    st.airspeedMps = Math.sqrt(horizontal * horizontal + v.y * v.y);
    st.sinkMps = sink;
    st.groundSpeedMps = horizontal;
    st.glideRatio = sink > 0.01 ? Math.min(horizontal / sink, 99) : 99;
    qbasis(st.orientation, this.f, this.u, this.r);
    st.headingDeg = headingDegOf(this.f.x, this.f.z);
    st.pitchDeg = Math.asin(Math.max(-1, Math.min(1, this.f.y))) * RAD_TO_DEG;
    st.bankDeg = Math.atan2(-this.r.y, this.u.y) * RAD_TO_DEG;
  }

  private touchdown(ground: number, vertical: number, forward: number, cls: LandingClass): void {
    const st = this.state;
    const report = this.landingReport;
    report.verticalMps = vertical;
    report.forwardMps = forward;
    report.classification = cls;
    st.landing = report;
    st.phase = cls === 'crash' ? 'crashed' : 'landed';
    st.position.y = ground;
    st.velocity.x = 0;
    st.velocity.y = 0;
    st.velocity.z = 0;
    st.aglM = 0;
    st.airspeedMps = 0;
    st.sinkMps = 0;
    st.groundSpeedMps = 0;
    st.glideRatio = 0;
    st.gLoad = 0;
  }
}
