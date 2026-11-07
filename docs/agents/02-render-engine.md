# Agent brief 02 — Rendering Engineer (Stage 2)

**Recommended settings:** Opus 5.5, effort high, start in plan mode and approve the LOD plan, then switch to auto. Fresh session. Why: terrain LOD and hitting 60 fps is where a weak design costs days; one approved plan prevents that.

**Depends on:** Stage 1 merged. **Runs in parallel with:** Stage 3.

**Owns:** `src/world/` (except `geo.ts`, which exists; you may add to it). Reads `public/terrain/`. Does not touch `src/flight/`, `src/game/`, `src/ui/`.

## Mission

Load the terrain tiles and render Table Mountain at 60 fps with a look that already feels like the finished game: golden-hour sun, haze, recognisable landmarks. Provide the real `TerrainSampler` the flight model will fly against, and a preload API for the exit-select screen.

## Deliverables

1. **Plan (plan mode):** tile loading strategy, LOD scheme (quadtree with skirts or geomorphing), triangle budget allocation, texture handling, how the CPU sampler shares data with the GPU mesh. Wait for approval.
2. `src/world/terrain/TileLoader.ts`: fetches height and texture tiles from `public/terrain/meta.json`, caches, priorities by camera distance, cancels on move.
3. `src/world/terrain/TerrainQuadtree.ts` and `TerrainChunk.ts`: LOD selection by screen-space error, crack hiding, a hard cap from `docs/01-architecture.md` section 8.
4. `src/world/terrain/TerrainMaterial.ts`: texture tile sampling plus the slope and altitude detail blend from `docs/design/look-and-feel.md` section 4, normals from height in the shader, fog.
5. `src/world/TerrainSamplerImpl.ts`: implements `TerrainSampler` from `src/types/terrain.ts` with bilinear CPU sampling from the same height tiles. `isReady()` false until the tiles around the query are loaded; sampler queries outside loaded tiles trigger a load and return the overview fallback meanwhile.
6. `src/world/Sky.ts`, `Sun.ts`, `Fog.ts`: golden-hour defaults per the look spec, parameters exposed for Stage 5.
7. `src/world/DevCamera.ts` and `src/world/PerfOverlay.ts`, both enabled by `?dev=1`.
8. `terrain.preloadAround(position, radiusM): Promise<void>`.
9. Tests: `TerrainSamplerImpl` versus mesh raycast on 1,000 random points, max error under 1 m; tile index math; LOD selection determinism.
10. `docs/status/stage-2-report.md` with fps, triangles, draw calls and tiles loaded at each of the three exit positions and at 50 m over Camps Bay beach, plus four screenshots.

## Constraints

- Three.js only, no extra terrain libraries unless the plan justifies one and it is MIT licensed.
- Textures as `THREE.Texture` from WebP via `ImageBitmapLoader`; consider KTX2 only if WebP decode shows up in profiles.
- Everything runs on the main thread in v0.1; a worker for tile decode is allowed if simple.
- Shadows behind a flag, off by default; measure the cost.
- The sampler must not depend on the renderer being visible (headless tests run in Vitest with a fake fetch of the tiles).

## Kickoff prompt (paste into a new Opus 5.5 session, effort high, plan mode on)

```
You are the Rendering Engineer for Table Mountain Wingsuit. Read CLAUDE.md, PLAN.md, docs/01-architecture.md, docs/02-stages.md Stage 2, docs/03-handoff-protocol.md, docs/design/look-and-feel.md, docs/status/STATUS.md, docs/status/stage-1-report.md and your brief docs/agents/02-render-engine.md. Inspect public/terrain/meta.json. First, in plan mode, write the tile loading and LOD plan from the brief's deliverable 1 and wait for my approval. After approval, create branch stage-2-renderer and build the deliverables: tile loader, quadtree LOD, terrain material with the golden-hour look, TerrainSamplerImpl with its accuracy test, sky, sun, fog, dev camera and perf overlay, and preloadAround. Measure performance at the three exits and over Camps Bay. Commit as you go. Write docs/status/stage-2-report.md from the template with numbers and screenshots, append to STATUS.md, then stop. Do not touch src/flight, src/game or src/ui.
```
