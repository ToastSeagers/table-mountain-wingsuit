# Table Mountain Wingsuit — Master Plan

A browser game. The player exits from one of three launch points on Table Mountain, flies a wingsuit down the real terrain, deploys a parachute and lands at a real landing zone around Camps Bay and the City Bowl. Scoring exists but the point is the feeling of the flight.

Look and feel: a modern, cinematic 3D world built from real elevation data, wrapped in an old-school "California Games" style interface (pixel fonts, chunky event-select screen, three-letter initials on the high score table, VHS-style replay).

This file is the single source of truth for scope, architecture and the staged process. Every agent reads it first. Detailed specs live in `docs/`.

---

## 1. Goals and non-goals

**Goals (v0.1, the first shippable build)**
- Three launch points on real Table Mountain terrain, data-driven so more can be added later.
- A wingsuit flight model that feels right: a start arc after exit, dive to gain speed, pull up to stretch the glide, proximity to terrain is the thrill.
- Parachute deploy, canopy flight, flare and landing at a real landing zone.
- Scoring: distance, air time, proximity, landing. Local high-score table.
- Cinematic rendering: real terrain, satellite-derived texture, sun, sky, fog, post-processing, chase-cam replay.
- Retro UI chrome over the 3D world.
- Runs at 60 fps at 1080p on a mid-range laptop, loads in under 10 seconds on a normal connection.
- Static site, no backend. Deployable to any static host.

**Non-goals (v0.1)**
- Multiplayer, online leaderboards, accounts.
- Mobile touch controls (keep the layout responsive, but desktop keyboard/mouse/gamepad only).
- Real BASE exit coordinates or real jump footage. Launch points are game designs placed on real geography. See `docs/design/exits.md`.
- Photorealistic 3D city buildings. Terrain plus imagery is the look. Buildings are a later stretch goal.

---

## 2. Architecture in one page

Stack: **Vite + TypeScript + Three.js**. Node 24, npm. Vitest for headless tests. No UI framework; the HUD and menus are plain DOM with a pixel font, layered over the WebGL canvas.

Data pipeline (offline, run once, output committed): **Python 3 + rasterio/GDAL** scripts in `tools/terrain/` that turn the Cape Town 5 m DEM and satellite imagery into heightmap tiles and texture tiles under `public/terrain/`.

```
src/
  core/        app bootstrap, game loop, time, input, settings, event bus
  world/       coordinate frame, terrain loader, TerrainSampler, sky, sun, fog
  flight/      wingsuit + canopy physics (pure TS, no Three.js imports), tuning constants
  game/        state machine, run controller, scoring, exits, landing zones, replay recorder
  ui/          menus, HUD, results screen, high score table, retro chrome, settings
  audio/       wind, altimeter, canopy, UI sounds, mixing
  fx/          post-processing stack, camera rigs, cinematics
  types/       shared interfaces (see section 4)
tools/
  terrain/     Python data pipeline + validation
public/
  terrain/     generated heightmap + texture tiles + meta.json (committed)
  fonts/ audio/ img/
data/
  exits.json           launch point definitions
  landing-zones.json   landing zone definitions
docs/                  everything agents need (this plan, specs, briefs, status)
```

Coordinate frame (fixed; changing it means updating `docs/01-architecture.md` and telling everyone):
- World units are metres. X = east, Y = up (metres above sea level), Z = south. Right-handed, matches Three.js defaults.
- Origin: latitude -33.9500, longitude 18.4100 at sea level. Conversion constants in `docs/01-architecture.md` section 3.

---

## 3. Stages, agents, gates and recommended agent settings

Each stage is owned by one agent role, run as its own Claude Code session with the brief in `docs/agents/`. A stage is done when its gate passes and its report exists in `docs/status/`. The Orchestrator (you, plus a main session) reviews gates, merges branches and updates the progress tracker.

Model and effort recommendations are chosen to spend credits where judgement matters (physics feel, rendering performance, data wrangling) and save them where the work is well specified (UI, audio wiring, cleanup). Full reasoning in `docs/05-agent-settings.md`.

| Stage | Name | Brief | Depends on | Parallel with | Model | Effort | Mode |
|---|---|---|---|---|---|---|---|
| 0 | Project bootstrap | `00-orchestrator.md` | - | - | Sonnet 5.5 | medium | auto |
| 1 | Terrain data pipeline | `01-terrain-data.md` | 0 | 3 | Opus 5.5 | high | auto + browser |
| 2 | Terrain renderer + free camera | `02-render-engine.md` | 1 | 3 | Opus 5.5 | high | plan first, then auto |
| 3 | Flight model (headless) | `03-flight-physics.md` | 0 | 1, 2 | Opus 5.5 | xhigh | plan first, then auto |
| 4 | Game loop, UI, scoring | `04-game-loop-ui.md` | 2, 3 | 5 (audio half) | Sonnet 5.5 | high | auto |
| 5 | Audio, post-FX, replay | `05-audio-postfx.md` | 3 (audio), 4 (FX) | 4 | Sonnet 5.5 | medium | auto |
| 6 | QA, balance, perf, release | `06-qa-release.md` | 4, 5 | - | Sonnet 5.5 (+ Haiku for sweeps) | medium | auto |
| - | Orchestrator / gate reviews | `00-orchestrator.md` | - | - | Fable 5.1 or Opus 5.5 | medium | default |

Stages 1 and 3 can start the same day once Stage 0 is merged. Stage 3 never touches Three.js, so it cannot collide with Stage 1 or 2.

### Gates (pass/fail, checked by the Orchestrator)

- **Gate 0:** `npm run dev` opens a page showing a Three.js scene and a HUD element in the pixel font. `npm test`, `npm run lint`, `npm run typecheck` pass. Git repo initialised with a first commit on `main`.
- **Gate 1:** `public/terrain/meta.json` plus heightmap and texture tiles exist and total under 60 MB. `python tools/terrain/validate.py` reports Maclear's Beacon within 15 m of 1,085 m, Lion's Head within 15 m of 669 m, and sea at Camps Bay beach within 3 m of 0.
- **Gate 2:** Free-fly camera over the full area at 60 fps or better at 1080p on the reference laptop. Camps Bay, the Twelve Apostles, Platteklip Gorge and Lion's Head are recognisable. `TerrainSampler.heightAt()` agrees with the rendered mesh within 1 m.
- **Gate 3:** Vitest suite passes. At trim from the western exit, glide ratio measures 2.8 to 3.2. A scripted flight reaches Camps Bay beach. Canopy deploy, flare and landing produce a `RunResult`. The headless tuning harness writes a flight log as CSV.
- **Gate 4:** The complete loop is playable for all three exits: title, exit select, countdown, exit, wingsuit, deploy, canopy, landing, results, high score entry, back to title. Crash and out-of-bounds handled. Exits come from `data/exits.json` only.
- **Gate 5:** Wind audio tracks airspeed, altimeter beeps work, canopy sounds, UI sounds. Post stack (grading, grain, vignette, bloom, sun shafts) toggleable in settings. Replay chase-cam plays after every run. Still 60 fps with the post stack on medium.
- **Gate 6:** Zero known crash bugs. Perf budget met on reference laptop and one integrated-GPU machine. Lighthouse performance 80 or better. Deployed to a static URL. `docs/status/release-v0.1.md` written.

---

## 4. Shared interfaces (agree once, build in parallel)

These live in `src/types/` and are created in Stage 0. Changing them requires a note in `docs/status/STATUS.md` and a message to any agent currently working. Full definitions in `docs/01-architecture.md` section 5.

- `TerrainSampler` - `heightAt(x, z)`, `normalAt(x, z)`, `bounds`. The flight model depends on this, never on Three.js. Stage 3 uses a stub (analytic slope) until Stage 2 provides the real one.
- `ExitDefinition` - id, name, world position, heading, blurb, recommended landing zone ids, unlock rule, intro camera path.
- `LandingZone` - id, name, centre, radius, surface type, difficulty.
- `FlightState` - position, velocity, orientation, phase (`freefall | wingsuit | deploying | canopy | landed | crashed`), airspeed, AGL, elapsed.
- `FlightInput` - pitch, roll, yaw in -1..1, deploy, flare, brake.
- `RunResult` - exit id, distance, airTime, proximityScore, landingScore, styleBonuses, total, crashed, landingZoneId, replay track.

---

## 5. Working agreements for every agent

1. Read `CLAUDE.md`, this file, your brief in `docs/agents/`, then `docs/status/STATUS.md` before writing code.
2. Work on a branch named `stage-N-short-name`. Commit often with clear messages. Do not merge your own branch; the Orchestrator merges after the gate passes.
3. Stay inside your stage's folders (listed in your brief). If you must touch a shared file, say so in your report.
4. Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green.
5. When done: write `docs/status/stage-N-report.md` using the template in `docs/03-handoff-protocol.md`, append a one-line entry to `docs/status/STATUS.md`, and stop. Do not start the next stage.
6. If blocked for more than 30 minutes on something outside your stage, write the blocker in `STATUS.md` and stop rather than working around it in someone else's folder.
7. Numbers in `docs/design/` are starting points. If you change a tuning constant, record old value, new value and why in your report.

---

## 6. Order of play (what the Orchestrator does, step by step)

1. Run Stage 0 in a Sonnet session (bootstrap). Check Gate 0. Commit to `main`.
2. Open two new Claude Code sessions in this folder with the models from the table. Give one the kickoff prompt from `docs/agents/01-terrain-data.md`, the other from `docs/agents/03-flight-physics.md`. They work in parallel on separate branches.
3. When Stage 1 reports, check Gate 1, merge, then start Stage 2 (`02-render-engine.md`). Stage 3 may still be running; that is fine.
4. When Stages 2 and 3 both pass, merge both, then start Stage 4 (`04-game-loop-ui.md`). In parallel, start the audio half of Stage 5 (`05-audio-postfx.md`, audio section only).
5. When Stage 4 passes, merge, let Stage 5 finish the post-FX and replay half.
6. When Stage 5 passes, merge, start Stage 6 (`06-qa-release.md`). Playtest yourself at this point and write notes into `docs/status/playtest-notes.md`.
7. Ship v0.1. Open `docs/04-roadmap.md` and pick the next batch.

After each gate, update the progress tracker artifact (link in `docs/status/STATUS.md`).

---

## 7. Risks and how we handle them

| Risk | Mitigation |
|---|---|
| City DEM endpoints are awkward to export | Fallback is Copernicus GLO-30 (30 m). Pipeline accepts any GeoTIFF. Gate 1 tolerances allow for 30 m data. |
| Satellite imagery looks flat or green-grey | Colour grading in the pipeline plus a slope and altitude based detail texture blend in the renderer. Golden-hour lighting hides a lot. |
| Terrain too heavy for 60 fps | Tiled LOD (quadtree) with a hard triangle budget. Compressed texture tiles. Measured at Gate 2, not Gate 6. |
| Flight feels floaty or twitchy | Stage 3 ships a headless tuning harness and CSV logs so tuning is numeric, not guesswork. Stage 6 has a dedicated balance pass. |
| Scope creep | Anything not in section 1 goes to `docs/04-roadmap.md`. Agents do not add features outside their brief. |
| Agents stepping on each other | Folder ownership per brief, shared types frozen in Stage 0, one writer per file set at a time. |
| Credits burned on boilerplate | Model and effort per stage are set in the table above; cheaper models on well-specified work, fresh sessions per stage so context stays small. |
