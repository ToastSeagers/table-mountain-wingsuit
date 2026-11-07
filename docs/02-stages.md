# 02 — Stage-by-stage process

Each stage below has: inputs, steps in order, outputs, and the gate checklist the Orchestrator runs. Agents follow the steps; the Orchestrator runs the checklist. The agent brief for each stage (`docs/agents/`) adds the detail and the kickoff prompt.

Legend: [A] agent does it, [O] Orchestrator does it.

---

## Stage 0 — Project bootstrap

**Inputs:** this repo as planned (docs only).
**Outputs:** a running Vite + TS + Three.js app, shared types, lint/test/typecheck config, git repo on `main`.

Steps
1. [A] `git init`, `.gitignore` (node_modules, dist, .env, tools/terrain/cache/).
2. [A] `npm create vite@latest . -- --template vanilla-ts`, then add `three`, `@types/three`, `vitest`, `eslint`, `typescript-eslint`, `prettier`. Pin exact versions.
3. [A] Create the folder layout from `docs/01-architecture.md` section 2 with an `index.ts` in each.
4. [A] Create `src/types/*.ts` exactly as in `docs/01-architecture.md` section 5.
5. [A] Create `src/world/geo.ts` with the frame constants and `latLonToWorld`, `worldToLatLon`. Vitest test against the checkpoints in `data/checkpoints.json`.
6. [A] Minimal scene: a plane and a cube, orbit camera, a DOM HUD element reading "TABLE MOUNTAIN WINGSUIT" in the pixel font (`public/fonts/`, see `docs/ASSETS.md`).
7. [A] `npm` scripts: dev, build, preview, test, lint, typecheck, format.
8. [A] Write `docs/status/stage-0-report.md` including the reference laptop spec (CPU, GPU, resolution) used for all later perf gates.
9. [O] Gate 0 checklist. Commit to `main`.

Gate 0 checklist
- [ ] `npm install && npm run dev` shows scene and pixel-font HUD
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` all pass
- [ ] `src/types/` matches the architecture doc
- [ ] Geo test passes for all checkpoints
- [ ] Report written, reference machine recorded

---

## Stage 1 — Terrain data pipeline

**Inputs:** Stage 0 on `main`. Internet access. Python 3.11+.
**Outputs:** `tools/terrain/` scripts, `public/terrain/` tiles and `meta.json`, `docs/ASSETS.md` entries for DEM and imagery with licences.

Steps
1. [A] Branch `stage-1-terrain-data`.
2. [A] Acquire the DEM. Preferred: City of Cape Town 5 m DEM (2019B LiDAR). Try, in order: the City's Open Data Portal (odp-cctegis.opendata.arcgis.com) as a downloadable raster; the ArcGIS ImageServer/MapServer export endpoint for the AOI; the 2 m contours as a fallback to interpolate from. Last resort: Copernicus GLO-30 for the AOI. Record exactly what was used and its licence.
3. [A] Acquire imagery. Preferred: Sentinel-2 L2A cloud-free scene, 10 m, true colour, from Copernicus Data Space or AWS open data. Alternative: a licensed tile provider's free tier only if its terms allow caching into a game asset (most do not; document the check). Record source and licence.
4. [A] `tools/terrain/fetch.py` (downloads and caches raw inputs), `build.py` (reproject to a local metric grid, resample to 5 m, crop to the AOI, write height tiles and texture tiles per `docs/01-architecture.md` section 4), `grade.py` (colour grading of imagery per `docs/design/look-and-feel.md` section 4), `validate.py` (checks checkpoints, tile seams, byte budget, prints a summary).
5. [A] `requirements.txt`, and `tools/terrain/README.md` with the exact commands to rebuild from scratch.
6. [A] Commit the generated `public/terrain/` output (it is an asset, rebuilds are rare).
7. [A] Report.
8. [O] Gate 1 checklist. Merge.

Gate 1 checklist
- [ ] `python tools/terrain/validate.py` passes checkpoints within tolerance
- [ ] `public/terrain/` under 60 MB
- [ ] No visible seams in a quick stitched preview PNG (validate.py writes `preview.png`)
- [ ] `docs/ASSETS.md` has DEM and imagery rows with licence
- [ ] `tools/terrain/README.md` lets a stranger rebuild

---

## Stage 2 — Terrain renderer and free camera

**Inputs:** Stage 1 on `main`.
**Outputs:** `src/world/` terrain loader, quadtree LOD, real `TerrainSampler`, sky, sun, fog, a dev free-fly camera, a perf overlay.

Steps
1. [A] Branch `stage-2-renderer`. Plan mode: write the LOD and loading plan, wait for approval.
2. [A] Tile loader with cache and priority by distance to camera.
3. [A] Quadtree LOD with geomorphing or skirts to hide cracks. Hard triangle budget from `docs/01-architecture.md` section 8.
4. [A] `TerrainSamplerImpl` reading the same height tiles on the CPU (bilinear). Test: sample 1,000 random points, compare with raycast against the mesh, max error under 1 m.
5. [A] Sky (physically based or gradient plus sun disc), directional sun with time-of-day parameter, height fog with the Camps Bay haze look, shadows optional behind a flag.
6. [A] Terrain material: texture tiles plus a slope and altitude based detail blend (rock on steep, fynbos on gentle high ground, sand near the beaches). Normal from height on the GPU.
7. [A] Dev free-fly camera (WASD, mouse look, speed on scroll) and a perf overlay (fps, triangles, draw calls, tiles loaded). Both behind `?dev=1`.
8. [A] Preload API: `terrain.preloadAround(position, radiusM)` returning a promise, for exit select to call.
9. [A] Report with perf numbers at the three exit positions and over Camps Bay.
10. [O] Gate 2 checklist. Merge.

Gate 2 checklist
- [ ] 60 fps or better at 1080p on the reference laptop at all three exits and over Camps Bay
- [ ] Triangle and draw call budgets met (perf overlay)
- [ ] Sampler versus mesh test passes
- [ ] Landmarks recognisable in screenshots attached to the report
- [ ] No visible cracks or popping worse than noted in the report

---

## Stage 3 — Flight model (headless)

**Inputs:** Stage 0 on `main` (does not need Stages 1 or 2).
**Outputs:** `src/flight/` wingsuit and canopy models, tuning constants, a stub terrain, Vitest suite, headless tuning harness.

Steps
1. [A] Branch `stage-3-flight`. Plan mode: write the model plan (forces, state, integration, phases), wait for approval.
2. [A] Implement `WingsuitModel` per `docs/design/flight-model.md`: start arc, lift/drag from angle of attack, roll and yaw coupling, airspeed-dependent control authority, g-load.
3. [A] Implement `CanopyModel`: deployment sequence with opening shock and heading preservation, canopy glide, brakes, flare, landing speed classification.
4. [A] `FlightModelImpl` that switches phases and exposes `FlightState`.
5. [A] `StubTerrain`: analytic cliff (vertical drop of 700 m then a 15 degree slope to a flat at 0 m), good enough to test proximity and landing.
6. [A] Tests: glide ratio at trim, min sink, max dive speed, start arc duration and height lost, canopy opening height loss, flare reduces vertical speed to under 2 m/s, determinism (same inputs give identical state).
7. [A] `tools/flight-harness.ts` (run with `npx tsx`): scripted inputs, writes CSV (t, x, y, z, airspeed, glide, agl, phase). Includes a "reach Camps Bay" scenario using the exit 1 position and a flat sea at y = 0 roughly 3 km out.
8. [A] Report with the measured numbers versus the spec table and every tuning change.
9. [O] Gate 3 checklist. Merge. Fable or Opus review of the feel is worth doing here by reading the CSV plots.

Gate 3 checklist
- [ ] Vitest suite passes
- [ ] Trim glide 2.8 to 3.2, dive speed and start arc within spec table tolerances
- [ ] Camps Bay scenario lands on the beach with a deploy at 200 m AGL
- [ ] Deterministic replay test passes
- [ ] No Three.js imports in `src/flight/`

---

## Stage 4 — Game loop, UI, scoring

**Inputs:** Stages 2 and 3 on `main`.
**Outputs:** full playable loop, all screens, HUD, scoring, exits and landing zones from data, local high scores, settings, input mapping (keyboard, mouse, gamepad).

Steps
1. [A] Branch `stage-4-game`.
2. [A] State machine in `src/game/` per `docs/01-architecture.md` section 7.
3. [A] Exit and landing zone loaders validating `data/*.json` against the types.
4. [A] Run controller: fixed-step loop, phase transitions, crash detection (terrain penetration, speed over threshold at touchdown), out-of-bounds, replay recording at 30 Hz.
5. [A] Scoring per `docs/design/scoring.md`.
6. [A] Camera rig for play: chase cam with speed-dependent FOV and lag, canopy cam, landing cam.
7. [A] Screens per `docs/design/look-and-feel.md`: title, exit select (overview map plus three cards), intro flyover using `ExitDefinition.intro`, countdown, HUD, pause, results, high score entry, settings.
8. [A] Input: keyboard and mouse, gamepad via Gamepad API, rebinding not required.
9. [A] Persistence: high scores per exit, settings, unlocks.
10. [A] Report with a short gameplay video or GIF and the list of anything deferred to Stage 6.
11. [O] Gate 4 checklist. Merge. First real playtest; write `docs/status/playtest-notes.md`.

Gate 4 checklist
- [ ] Full loop for all three exits without a console error
- [ ] Crash, out-of-bounds and water landing handled with a result screen
- [ ] Exits and zones only from `data/`; adding a fourth exit to the JSON shows it in the UI
- [ ] High scores persist across reload
- [ ] Gamepad works

---

## Stage 5 — Audio, post-FX, replay cinematics

**Inputs:** audio half needs Stage 3; FX half needs Stage 4.
**Outputs:** `src/audio/`, `src/fx/`, settings entries, replay chase-cam.

Steps (audio half, can start right after Stage 3)
1. [A] Branch `stage-5-audio-fx`.
2. [A] Wind: filtered noise whose cutoff, gain and stereo width follow airspeed and roll. Freefall flutter in the start arc.
3. [A] Altimeter: three configurable beeps (deploy warning, deploy now, too low) mapped to AGL; faster pulse under 150 m.
4. [A] Canopy: opening snap, line flutter, flare swoosh. Landing thump by surface type.
5. [A] UI: menu move, select, back, countdown, score tally ticks, high score fanfare. Retro chiptune style, short.
6. [A] Mixer with master, world and UI buses; settings sliders.

Steps (FX half, after Stage 4 merges)
7. [A] Post stack: colour grading (LUT or curves), film grain, vignette, bloom, sun shafts, slight chromatic aberration at high speed. Quality presets low, medium, high.
8. [A] Camera effects: speed shake, FOV stretch in dives, motion blur optional.
9. [A] Replay: play back `RunResult.replay` with a cinematic camera (ground cams at the line's closest points, a chase cam, a canopy wide shot), VHS overlay toggle, skip button.
10. [A] Intro flyover polish for each exit.
11. [A] Report with before/after screenshots and perf cost per effect.
12. [O] Gate 5 checklist. Merge.

Gate 5 checklist
- [ ] All sounds present and respond to state
- [ ] Post stack presets work and medium keeps 60 fps
- [ ] Replay plays after every run and can be skipped
- [ ] Settings expose audio and quality

---

## Stage 6 — QA, balance, performance, release

**Inputs:** everything merged.
**Outputs:** bug fixes, tuning pass, perf pass, deploy, release notes.

Steps
1. [A] Branch `stage-6-release`.
2. [A] Bug bash from `docs/status/playtest-notes.md` and a fresh walkthrough of every screen and phase.
3. [A] Balance pass: run the harness and real play, adjust `tuning.ts` and `scoring-tuning.ts`, record each change.
4. [A] Perf pass on the reference laptop and an integrated-GPU machine. Lighthouse.
5. [A] `/code-review` at medium on the full diff since Stage 0; fix what matters.
6. [A] Static deploy (GitHub Pages or Netlify, Orchestrator's choice), `vite.config` base path, cache headers for `public/terrain/`.
7. [A] `docs/status/release-v0.1.md`: what shipped, known issues, how to deploy again.
8. [O] Gate 6 checklist. Tag `v0.1.0`.

Gate 6 checklist
- [ ] No known crash bugs
- [ ] Perf budget met on both machines
- [ ] Lighthouse performance 80 or better
- [ ] Live URL works in Chrome, Edge and Firefox
- [ ] Release notes written, tag pushed
