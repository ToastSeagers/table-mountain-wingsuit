# Stage 0 report — Project bootstrap

**Agent:** Stage 0 bootstrap engineer · **Model/effort:** Sonnet 5.5 / medium · **Branch:** main · **Date:** 2026-11-07

## What was built
- Git repo on `main`, `.gitignore` (node_modules, dist, .env, tools/terrain/cache/).
- Vite + strict TypeScript + Three.js project at the repo root; all dependencies exact-pinned in `package.json`.
- Folder layout from architecture section 2: `src/{core,types,world,flight,game,ui,audio,fx}/index.ts` placeholders, plus `tools/terrain/` and `public/terrain/` (`.gitkeep`).
- Frozen shared types, verbatim: `src/types/{math,terrain,flight,game}.ts` (plus an empty `index.ts` placeholder).
- `src/world/geo.ts` (frame constants, `latLonToWorld`, `worldToLatLon`) and `src/world/geo.test.ts` (8 tests: origin, axis directions, all 6 checkpoints formula + round trip within 2 m).
- Placeholder scene `src/world/demo-scene.ts` (plane, cube, drag/scroll orbit camera), HUD div in `index.html` styled in `src/style.css`, reading "TABLE MOUNTAIN WINGSUIT" in Press Start 2P.
- Font self-hosted: `public/fonts/PressStart2P-Regular.woff2` + OFL text; row added to `docs/ASSETS.md`.
- Tooling: ESLint 9 flat config (`eslint.config.js`), Prettier (`.prettierrc.json`; `src/types` and docs are ignored so the types stay verbatim).

## How to run and verify
```
npm install
npm run dev        # http://localhost:5173 : cube on green plane, pixel-font title top-left
npm test && npm run lint && npm run typecheck && npm run build
```

## Gate results
- [x] `npm install && npm run dev` shows scene and pixel-font HUD (checked in the in-app browser)
- [x] `npm test` (8/8 pass), `npm run lint`, `npm run typecheck`, `npm run build` all pass
- [x] `src/types/` matches the architecture doc (copied verbatim)
- [x] Geo test passes for all checkpoints (6/6, all within 2 m)
- [x] Report written, reference machine recorded

Reference machine (all later perf gates): Intel Core Ultra 9 185H, 23.4 GB RAM, NVIDIA GeForce RTX 4060 Laptop GPU (Intel Arc iGPU also present; the discrete GPU is the reference), 1920x1080 primary display, Windows 11 Pro. The browser must be set to use the discrete GPU for perf runs.

## Interface or shared-file changes
- `docs/ASSETS.md`: pixel font row filled in. `docs/status/STATUS.md`: log line appended. No other docs touched.

## Tuning changes
None (no tuning files yet).

## Known issues and deferred items
- `npm audit` reports moderate advisories in `vitest@3` (`@vitest/mocker`, dev-only mock features). The fix is vitest 5, which needs a newer Vite than the architecture's Vite 6. Revisit in Stage 6 together with a Vite upgrade.
- Build warns the bundle is over 500 kB (all of Three.js); Stage 6 can add manual chunks.
- Only the Latin subset of the font is shipped.
- `src/world/demo-scene.ts` is throwaway; Stage 2 replaces it.

## Decisions made
- Versions: Vite 6.4.5 (architecture says Vite 6), TypeScript 5.9.3 (typescript-eslint does not yet support TS 7), Vitest 3.2.7, ESLint 9.39.5, Three 0.187.0, Prettier 3.9.10.
- `npm create vite` was not used; config files were written by hand to avoid touching existing docs/data.
- Font: Press Start 2P, woff2 taken from the `@fontsource/press-start-2p` 5.3.0 npm package (OFL).
- Vitest picks up only `src/**/*.test.ts`; `build` runs `tsc --noEmit` before `vite build`.
- Git identity: repo-local user.name `ToastSeagers` (set by the Orchestrator); commits use the repo-local noreply email (set by the Orchestrator) `61140937+ToastSeagers@users.noreply.github.com`. No global identity changed, no remote created, nothing pushed.

## Suggested next step
Orchestrator runs Gate 0, then starts Stage 1 (terrain data) on `stage-1-terrain-data`.
