import type { Quat, Vec3 } from './math';
import type { TerrainSampler } from './terrain';

export type FlightPhase = 'freefall' | 'wingsuit' | 'deploying' | 'canopy' | 'landed' | 'crashed'
export interface FlightInput { pitch: number; roll: number; yaw: number; deploy: boolean; flare: boolean; brake: boolean }
export interface FlightState {
  position: Vec3; velocity: Vec3; orientation: Quat
  phase: FlightPhase; airspeedMps: number; aglM: number; elapsedS: number
  glideRatio: number       // instantaneous horizontal / vertical speed
  gLoad: number
}
export interface FlightModel {
  reset(position: Vec3, headingDeg: number): void
  step(dtS: number, input: FlightInput, terrain: TerrainSampler): FlightState
  readonly state: FlightState
}
