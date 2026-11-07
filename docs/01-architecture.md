# 01 — Architecture

Reference for every engineer. `PLAN.md` says what; this says how things fit together.

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Build | Vite 6, TypeScript strict | Fast dev loop, static output, no server |
| 3D | Three.js (latest stable at Stage 0, pinned in package.json) | Mature, huge ecosystem, postprocessing included |
| Tests | Vitest | Headless flight-model tests, runs in CI later |
| Lint/format | ESLint (typescript-eslint) + Prettier | Keeps six agents' code looking the same |
| UI | Plain DOM + CSS, pixel font | Retro chrome is easier in CSS than in WebGL text |
| Audio | Web Audio API, no library | Wind synthesis and pitch tracking need low-level control |
| Data pipeline | Python 3.11+, rasterio, numpy, Pillow | Standard geo tooling; run once offline |
| State persistence | `localStorage` | High scores, settings, unlocks; no backend |

## 2. Folder ownership

| Folder | Owner (stage) | Others may read | Others may write |
|---|---|---|---|
| `src/core/` | 0, then 4 | all | no |
| `src/types/` | 0 (frozen) | all | only with STATUS note |
| `src/world/` | 2 | all | 5 (fog/sky params only) |
| `src/flight/` | 3 | all | 6 (tuning only) |
| `src/game/` | 4 | all | 6 (scoring tuning only) |
| `src/ui/` | 4 | all | 5 (settings panel entries) |
| `src/audio/` | 5 | all | no |
| `src/fx/` | 5 | all | no |
| `tools/terrain/` | 1 | all | no |
| `public/terrain/` | 1 (generated) | all | no |
| `data/` | 0 creates, 4 owns | all | 6 (balance) |
| `docs/status/` | everyone appends | all | all |

## 3. Coordinate frame

World space is a local tangent plane in metres.

- **X** = east, **Y** = up (metres above mean sea level), **Z** = south.
- Origin: lat `-33.9500`, lon `18.4100`, elevation 0.
- Conversion (good to well under 1 m across the 12 km area):

```
METRES_PER_DEG_LAT = 110_940      // at 34 degrees south
METRES_PER_DEG_LON = 92_380       // 111_320 * cos(33.95 deg)
x =  (lon - 18.4100) * METRES_PER_DEG_LON
z = -(lat - (-33.9500)) * METRES_PER_DEG_LAT     // north is negative Z
y =  elevation_m
```

- Heading: degrees clockwise from north. Heading 270 = flying west toward Camps Bay. Convert to a direction vector with `dir = (sin(h), 0, -cos(h))`.
- These constants live in `src/world/geo.ts` and `tools/terrain/geo.py`. They must match. `validate.py` checks the Python side against known points; a Vitest test checks the TS side against the same points.

Area of interest (AOI), the terrain we ship:

```
lon 18.350 to 18.480   (about 12.0 km east-west)
lat -33.990 to -33.900 (about 10.0 km north-south)
```

In world space that is roughly X from -5,540 to +6,470 and Z from -5,550 to +4,440. Covers Sea Point to Rondebosch and Signal Hill to just south of the Twelve Apostles.

## 4. Terrain data format (Stage 1 output, Stage 2 input)

`public/terrain/meta.json`:

```json
{
  "version": 1,
  "originLat": -33.95, "originLon": 18.41,
  "boundsWorld": { "minX": -5540, "maxX": 6470, "minZ": -5550, "maxZ": 4440 },
  "cellSizeM": 5,
  "heightTiles": { "size": 512, "cols": 5, "rows": 4, "format": "r16", "path": "h/{col}_{row}.bin", "heightScale": 0.05, "heightOffset": 0 },
  "textureTiles": { "size": 1024, "cols": 10, "rows": 8, "format": "webp", "path": "t/{col}_{row}.webp" },
  "source": { "dem": "City of Cape Town 5m DEM 2019B", "imagery": "...", "licence": "..." },
  "checkpoints": [ { "name": "Maclear's Beacon", "x": 0, "z": 0, "expectedY": 1085 } ]
}
```

- Height tiles: little-endian uint16, row-major, north row first. `height_m = value * heightScale + heightOffset`. 512 x 512 samples per tile with a 1-sample overlap on the east and south edges so tiles stitch without seams.
- Texture tiles: WebP, sRGB, pre-graded (see `docs/design/look-and-feel.md` section 4). Also ship a single 2048 x 2048 `overview.webp` for the far LOD and the exit-select map.
- Budget: heights about 20 MB, textures about 30 MB, total under 60 MB.

## 5. Shared types (created in Stage 0, frozen)

`src/types/math.ts`

```ts
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
```

`src/types/terrain.ts`

```ts
export interface TerrainBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface TerrainSampler {
  readonly bounds: TerrainBounds
  heightAt(x: number, z: number): number          // metres ASL; returns 0 (sea) outside bounds
  normalAt(x: number, z: number): Vec3            // unit, Y up
  isReady(): boolean
}
```

`src/types/flight.ts`

```ts
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
```

`src/types/game.ts`

```ts
export interface ExitDefinition {
  id: string; name: string; subtitle: string
  position: Vec3                 // world metres, exit ledge
  headingDeg: number             // initial facing
  difficulty: 1 | 2 | 3
  recommendedLandingZones: string[]
  unlock: { type: 'always' } | { type: 'completed'; exitId: string } | { type: 'score'; exitId: string; min: number }
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
```

## 6. Runtime data flow

```
input (keyboard/mouse/gamepad)  ->  FlightInput
FlightInput + TerrainSampler    ->  FlightModel.step(dt)  ->  FlightState
FlightState                     ->  RunController (phase changes, scoring, replay recording)
FlightState                     ->  CameraRig -> Three.js camera
FlightState                     ->  HUD (DOM), Audio (Web Audio params)
RunController end               ->  RunResult -> ResultsScreen, HighScores (localStorage)
```

Fixed-step simulation: the flight model steps at 120 Hz with an accumulator; rendering interpolates. This keeps the physics deterministic for replays and tests.

## 7. Game states (Stage 4)

`title -> exitSelect -> intro -> countdown -> flying -> results -> highScoreEntry -> title`

`flying` contains the flight phases from `FlightPhase`. `paused` can overlay `flying`. `settings` can overlay `title` and `paused`.

## 8. Performance budget

| Item | Budget |
|---|---|
| Frame time | 16 ms at 1920 x 1080, reference laptop (define in Stage 0 report) |
| Terrain triangles on screen | 600k max, 300k typical |
| Draw calls | under 150 |
| Terrain assets | under 60 MB |
| Audio assets | under 8 MB |
| First load to title | under 10 s on 20 Mbps |
| Time from exit select to flying | under 2 s (tiles for that exit preloaded on the exit-select screen) |
