import type { FlightPhase } from './flight';
import type { Quat, Vec3 } from './math';

export interface ExitDefinition {
  id: string; name: string; subtitle: string
  position: Vec3                 // world metres, exit ledge
  headingDeg: number             // initial facing
  difficulty: 1 | 2 | 3
  recommendedLandingZones: string[]
  unlock: { type: 'always' } | { type: 'score'; exitId: string; min: number }
  intro: { cameraPath: Vec3[]; durationS: number }
  blurb: string
}
export interface LandingZone {
  id: string; name: string; centre: Vec3; radiusM: number
  surface: 'grass' | 'sand' | 'tarmac' | 'water'
  difficulty: 1 | 2 | 3
}
export interface ReplayFrame { t: number; p: Vec3; q: Quat; phase: FlightPhase }
export interface RunResult {
  exitId: string; landingZoneId: string | null
  distanceM: number; airTimeS: number
  proximityScore: number; landingScore: number
  styleBonuses: { id: string; label: string; points: number }[]
  total: number; crashed: boolean
  replay: ReplayFrame[]
  recordedAt: string
}
