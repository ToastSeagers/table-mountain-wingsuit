# Stage 7b report — Mobile start-up performance

**Agent:** Mobile Performance Engineer · **Model/effort:** Sonnet 5.5 · **Branch:** stage-7b-mobile-perf · **Date:** 2026-11-08

## What was built
- **Countdown warm-up.** `Terrain.beginWarmup(poses)` / `endWarmup()` / `isSettled()` ([Terrain.ts](../../src/world/terrain/Terrain.ts)). While the countdown holds, the terrain builds the chunk geometry and uploads the texture tiles for the live camera and for a second pose (400 m along the exit heading, 120 m lower, looking down the line), with the flight budgets lifted ([StreamingBudgets.ts](../../src/world/terrain/StreamingBudgets.ts): 48 builds and 6 uploads per frame, 8 ms of node measuring). `isSettled()` is true when no selected chunk is unbuilt, no node measurement or height upload is pending and no texture tile is downloading, decoding or awaiting upload.
- **Shader precompile.** `PostStack.precompile(scene, camera)` runs `renderer.compileAsync` for the whole scene (hidden canopy and lines included, since Three compiles materials of invisible objects) and for the bright, down and composite passes, each with the render target it will draw into, because Three picks the tone-mapping variant from the bound target. Game starts it at the start of the countdown.
- **Gate.** [CountdownGate.ts](../../src/game/CountdownGate.ts) replaces the inline wait: terrain gate (sampler ready and preload done, or 6 s, unchanged), then warm-up gate (shaders compiled and `isSettled()`, or 4 s more, clock starts only after the terrain gate opens, latches once passed). The "LOADING TERRAIN..." text covers both.
- **Runtime budgets.** `geometryBuildsPerFrame` and `textureUploadsPerFrame` are now `WorldSettings` (defaults 12 and 2); `GEOMETRY_BUILDS_PER_FRAME` is gone, `UPLOADS_PER_FRAME` remains only as the cache's default. Applied by `World.applySettings`.
- **Presets** moved to [qualityPresets.ts](../../src/game/qualityPresets.ts) (testable headless). Every preset sets every streaming knob so none leaks when switching.
- **Overlay.** `?dev=1` overlay shows `evicted N`, `builds N (total T)`, `settled|busy`, and `since GO: builds X, evicted Y` (zeroed at GO). On viewports under 500 px tall it uses 10 px type, sits below the HUD's top row, is capped to the screen width and shortens the GPU name.

## How to run and verify
`npm test` (224), `npm run lint`, `npm run typecheck`, `npm run build`. In the browser: `?dev=1&touch=1` on a phone (or the pane at 740x360): the countdown holds on "LOADING TERRAIN..." until `settled`, then 3-2-1; after GO the overlay line should read `since GO: builds 0-2, evicted 0`.

## Gate results
- [x] Warm-up runs in the countdown and the gate waits for it, capped at 4 s: unit tests in `CountdownGate.test.ts`, and `TerrainWarmup.test.ts` (headless Terrain over the real tiles: unwarmed frames respect 3 builds / 1 upload; warm-up settles in under 600 frames; after settling, further frames build and upload nothing; moving to the second pose after GO builds at most 3 chunks).
- [x] Budgets: mobile preset gives 3 and 1, desktop presets 12 and 2, switching back restores them (`qualityPresets.test.ts`); warm-up overrides (`StreamingBudgets.test.ts`).
- [x] Preset values (`qualityPresets.test.ts`).
- [x] Emulated phone (740x360, `?touch=1&dev=1`, mobile preset, dpr 2 rendered at 1): countdown held 4.8 s on LOADING TERRAIN until `settled` (cold start, hidden pane), then 3-2-1; shader programs stayed at 11 from countdown to flight; first 420 flight frames: 2 builds total (max 1 in a frame), 0 evictions, 0 loading. After 240 more frames: 32 resident, `since GO: builds 2, evicted 0`.
- [x] Desktop (`?dev=1`, medium): budgets 12 and 2, 900 autopilot flight frames, at most 1 build in a frame, 1 eviction in the whole session, no console errors.
- [x] Overlay readable at 360 px tall (screenshot checked; it no longer covers the speed, time and AGL readouts).
- Not measured: phone frame rates. The pane runs on the desktop RTX 4060 and was hidden, so I drove `tick()` from a timer; the numbers prove behaviour, not phone timings.

## Interface or shared-file changes
None outside `src/world`, `src/game`, `src/fx`. `src/flight`, scoring and `src/types` untouched. `WorldSettings` gains two fields. `TerrainStats` gains `geometryBuildsTotal` and `settled`.

## Tuning changes
| constant | old | new | why |
|---|---|---|---|
| mobile `maxResidentTextureTiles` | 24 | 32 | phone held 31 with no evictions |
| mobile `maxPixelRatio` / `renderScale` | 1.5 / 0.8 (1.2 px per CSS px) | 1 / 1 (1.0 px per CSS px) | thermal headroom |
| mobile `geometryBuildsPerFrame` | 12 (constant) | 3 | spread chunk builds over frames in flight |
| mobile `textureUploadsPerFrame` | 2 (constant) | 1 | same |
| desktop builds / uploads per frame | 12 / 2 (constants) | 12 / 2 (settings) | unchanged |
| mobile triangles, `lodErrorPx` | 300k, 3 | 300k, 3 | brief: leave |
| warm-up builds / uploads / measure ms | n/a | 48 / 6 / 8 | countdown is a loading screen |

## Known issues and deferred items
- Phone confirmation is the owner's: the overlay now shows `since GO` counters for a screenshot.
- Texture eviction during the countdown is normal (title orbit tiles make way for the exit's); only the since-GO number matters.
- Warm-up only covers LOD and tiles for two poses; later stretches of the line still stream in flight at 3 builds / 1 upload per frame.
- Compile uses `compileAsync`, so a browser without parallel compile blocks briefly at the start of the countdown; harmless behind the loading screen.

## Decisions made
- **Pins released at GO** (`Terrain.releasePreload`, `TerrainTextureCache.unpinAll`). The exit preload pinned up to `max - 8` tiles until the next preload, leaving only about 8 slots for the whole flight whatever the cap, so raising the cap to 32 alone would not have stopped churn. Waiting preload promises are resolved on release so a repeat jump cannot hang.
- **Room accounting fix** in `TerrainTextureCache.update`: only pinned tiles that are not also wanted take room off the cap (they used to count twice).
- Second warm pose: 400 m ahead and 120 m below the exit (floored 60 m above ground), looking 150 m down over 1,500 m. One pose, as briefed.
- Warm-up clock for the 4 s cap starts when the terrain gate opens ("on top of the current gate") and latches.
- Warm geometry is protected from the 160-entry geometry cache trim, or two large poses would rebuild every frame.
- Warm-up begins at the countdown, not the intro, as briefed; it stays on until GO, so the 3-2-1 seconds also help.

## Suggested next step
Owner flies the phone build and sends a `?dev=1` screenshot 20 s and 60 s into a flight; look at `since GO`. If builds or evictions still climb, raise the second warm pose's distance or add a third.
