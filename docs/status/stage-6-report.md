# Stage 6 report — QA, balance and release

**Agent:** QA, Balance and Release Engineer · **Model/effort:** Sonnet 5.5 / medium · **Branch:** stage-6-release · **Date:** 2026-11-08

## What was built
- Bug bash against all 19 playtest items, logged in [stage-6-bugs.md](stage-6-bugs.md).
- Lion's Head: the Autopilot no longer opens on a falling-away slope (`src/game/Autopilot.ts`); Sea Point zone moved into glide range (`data/landing-zones.json`).
- Balance: proximity window 50 m, gain 4 (`src/game/scoring-tuning.ts`); spec rows in `docs/design/flight-model.md` follow the model.
- Perf and config: `base` for build and preview, Three.js chunk, results replay at 0.75 render scale, narrower sea glint, brighter canopy, shader mask for the Clifton patch.
- Deploy: `.github/workflows/pages.yml`, `npm run deploy`, version 0.1.0.
- Probes in `tools/`: `lions-head-dives.ts`, `zone-reach.ts`, `ground-at.ts`, `low-line.ts`, `lazy-run.ts`.
- [release-v0.1.md](release-v0.1.md).

## How to run and verify
```
npm test && npm run lint && npm run typecheck && npm run build
npx tsx tools/exit-check.ts            # all four Lion's Head lines now land in the Clifton zone
npx tsx tools/lions-head-dives.ts      # hand-style dives survive
npx tsx tools/lazy-run.ts              # a no-steering run misses the beach
npm run build && npx vite preview      # http://localhost:4173/table-mountain-wingsuit/
```

## Gate results
- [x] Tests 183 green, lint, typecheck, build green.
- [x] Bundle split: game 187 kB (64 kB gzip), Three.js 528 kB (131 kB gzip).
- [x] Base path works: production build served at `/table-mountain-wingsuit/`, fonts, terrain and keyboard flow loaded.
- [x] Lighthouse performance **97** (local production build, desktop preset, real GPU; mobile preset with software GL scores 71, not representative).
- [~] **Live URL not verified.** The push of `stage-6-release` to origin (to run the workflow from the branch) was refused by the auto-mode permission classifier as a production deploy, so no workflow run exists, and Lighthouse on the live site was not run. See Known issues.
- [~] Results-screen GPU under 4 ms: change made, not measured (pane hidden, timer queries unusable).
- [~] 60 fps on a second GPU: not measured. First load from sizes: 11.5 MB, about 5 s at 20 Mbps.
- [~] Firefox and Edge: not checked.

## Interface or shared-file changes
- `src/world/World.ts` (render scale), `src/world/atmosphereGlsl.ts`, `src/world/terrain/TerrainMaterial.ts`: Stage 2 files, fixes only.
- `src/fx/PlayerAvatar.ts`: canopy emissive. `src/game/Game.ts`, `Autopilot.ts`: Stage 4 files.
- `data/landing-zones.json`, `docs/design/exits.md`, `docs/design/flight-model.md`, `docs/design/scoring.md`, `vite.config.ts`, `package.json` (script and version 0.1.0).
- No change to `src/types/`.

## Tuning changes
| constant | old | new | why |
|---|---|---|---|
| `SCORING.proximity.aglBelowM` | 40 | 50 | Under 40 m a human who skims at 25 to 30 m earned about 250 points in 12 s; a wider window makes the line earnable without making it free (weight is still linear to the ground). |
| `SCORING.proximity.gain` | 2.5 | 4 | Expert estimate: 25 s at 10 to 15 m and about 55 m/s is about 4,000 points, giving about 14,000 in total with 3,300 distance, 2,200 air time, 1,800 landing and 2,900 style. The terrain-following probe (17 s at 25 to 30 m) scored 1,277 proximity. The 5,000 cap is unchanged. |
| `docs/design` min sink | 12 (11 to 14) | 10 (9.5 to 14) | Model row follows the max-glide row. Not a code change. |
| `docs/design` opening height | 55 to 90 | 45 to 90, 3.7 g | Model kept; end speed row wins over height and 2.5 g. |
| `docs/design` start arc height lost | about 90 m | about 60 m | Model measured 60 m, spec required under 120. |
| Sea glint | `900, 40, 80, 0.25` | `2400, 9, 120, 0.12` | Pillar too strong under bloom. Not a flight or scoring constant. |
No change in `src/flight/tuning.ts`.

Balance evidence: autopilot clean Table run to Camps Bay lands 7 m from centre for 6,767 points with zero proximity (a first-time target of about 5,000 sits between this and a lazy run). A lazy no-steering run from every exit misses every zone and scores 2,000 to 3,800. The probe pilot is crude, so the 15,000 expert figure is an estimate, not a measured run.

## Known issues and deferred items
1. **Live deploy unverified.** To finish: Orchestrator merges to main and pushes (the workflow runs on push), then checks `https://toastseagers.github.io/table-mountain-wingsuit/` and runs Lighthouse on it. If the `github-pages` environment restricts branches, that is expected for main only. Alternatively allow me to push `stage-6-release` and re-dispatch.
2. Results GPU cost, second-GPU 60 fps, throttled load timing, Firefox/Edge: need a visible pane or hardware I did not have.
3. Open playtest items 7 to 10 (ears, pad, pointer lock, trigger volumes) need a person.
4. Code review (medium): six findings reported, one fixed (probe typecheck). Open: PostStack reallocates at each render-scale switch (a hitch entering results); the grey-blank shader mask could repaint pale offshore rock; Autopilot `lastAglM` has no reset; Sea Point zone reachability unproven by a human; the deploy workflow runs no tests. The review diff scope was the Stage 6 branch in depth; Stages 0 to 5 were not re-audited line by line.
5. Roadmap candidates added: PostStack target reuse across render scale, a CI test step, a terrain-aware autopilot for balance.

## Decisions made
- Lion's Head exit and headings kept; the failure was the autopilot, not the terrain.
- Sea Point zone moved rather than the exit, because no heading from the summit reaches 2.6 km.
- Render scale on results rather than removing the replay.
- `base` applies to build and preview, not dev.
- Version set to 0.1.0 so the settings screen shows it.

## Suggested next step
Orchestrator runs Gate 6 with the pane visible (results GPU, a flight at each exit, the sea glint, the canopy), merges, pushes main, confirms the live URL and Lighthouse, then tags v0.1.0.
