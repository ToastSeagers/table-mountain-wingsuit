import type { FlightInput, FlightPhase } from '../types/flight';
import type { Vec3 } from '../types/math';
import type { TerrainSampler } from '../types/terrain';
import { FlightModelImpl } from './FlightModelImpl';
import type { LandingClass, WingsuitFlightState } from './state';
import { StubTerrain } from './stub-terrain';
import { SIM } from './tuning';

// Scripted runs shared by the Vitest suite and the tuning harness.

/** One recorded sample. Plain numbers so runs can be compared bit for bit. */
export interface ScriptFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  airspeed: number;
  glide: number;
  agl: number;
  alpha: number;
  phase: FlightPhase;
  gLoad: number;
  mush: number;
  sink: number;
  groundSpeed: number;
  heading: number;
  pitch: number;
  bank: number;
  areaFactor: number;
  flareEnergy: number;
  landing: LandingClass | null;
}

/** Writes the input for time `t` into `input` (mutated in place, so the loop allocates nothing). */
export type InputScript = (
  t: number,
  state: Readonly<WingsuitFlightState>,
  input: FlightInput,
) => void;

export interface Scenario {
  name: string;
  description: string;
  exit: Readonly<Vec3>;
  headingDeg: number;
  durationS: number;
  script: InputScript;
}

export function makeInput(): FlightInput {
  return { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
}

export function clearInput(input: FlightInput): void {
  input.pitch = 0;
  input.roll = 0;
  input.yaw = 0;
  input.deploy = false;
  input.flare = false;
  input.brake = false;
}

function snapshot(st: WingsuitFlightState): ScriptFrame {
  return {
    t: st.elapsedS,
    x: st.position.x,
    y: st.position.y,
    z: st.position.z,
    vx: st.velocity.x,
    vy: st.velocity.y,
    vz: st.velocity.z,
    airspeed: st.airspeedMps,
    glide: st.glideRatio,
    agl: st.aglM,
    alpha: st.alphaDeg,
    phase: st.phase,
    gLoad: st.gLoad,
    mush: st.mushFactor,
    sink: st.sinkMps,
    groundSpeed: st.groundSpeedMps,
    heading: st.headingDeg,
    pitch: st.pitchDeg,
    bank: st.bankDeg,
    areaFactor: st.wingAreaFactor,
    flareEnergy: st.flareEnergy,
    landing: st.landing ? st.landing.classification : null,
  };
}

export interface RunOptions {
  terrain?: TerrainSampler;
  dtS?: number;
  model?: FlightModelImpl;
  seed?: number;
}

/**
 * Resets `model` at the scenario exit and steps it with the script until the duration ends or
 * the flight is over. Records a frame before the first step and after every step.
 */
export function runScenario(scenario: Scenario, opts: RunOptions = {}): ScriptFrame[] {
  const model = opts.model ?? new FlightModelImpl();
  const terrain = opts.terrain ?? new StubTerrain();
  const dt = opts.dtS ?? SIM.dtS;
  model.reset(scenario.exit, scenario.headingDeg, opts.seed ?? 0);
  // Prime the AGL read-out so scripts that look at it on the first step see the real value.
  model.state.aglM = scenario.exit.y - terrain.heightAt(scenario.exit.x, scenario.exit.z);
  const input = makeInput();
  const frames: ScriptFrame[] = [snapshot(model.state)];
  const steps = Math.round(scenario.durationS / dt);
  for (let i = 0; i < steps; i++) {
    clearInput(input);
    scenario.script(model.state.elapsedS, model.state, input);
    const st = model.step(dt, input, terrain);
    frames.push(snapshot(st));
    if (st.phase === 'landed' || st.phase === 'crashed') break;
  }
  return frames;
}

/** A scenario from the stub exit with the given script. */
export function stubScenario(
  name: string,
  durationS: number,
  script: InputScript,
  description = '',
): Scenario {
  return {
    name,
    description,
    exit: { x: 0, y: 1050, z: 0 },
    headingDeg: 90,
    durationS,
    script,
  };
}
