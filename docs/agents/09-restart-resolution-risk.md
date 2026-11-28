# Agent brief 09 — Restart, Resolution and Risk Engineer (Stage 9, v0.2)

**Recommended settings:** Sonnet 5.5, effort high, permission mode auto, fresh session in the main checkout.

**Depends on:** v0.2.0-alpha.5 on `main` (Stages 0 to 8 and 7b). **Runs alone**; nothing else writes to the repo during this stage.

**Owns:** `src/game/` (restart path, scoring), `src/world/` (dynamic resolution), `src/fx/` (`PostStack` target reuse), `src/ui/` (stamps, results tally, scoring hint only), `tools/`, `docs/`. `src/flight/` is not changed. Any other folder touched is noted in the report.

## Background

Table Mountain Wingsuit is a browser wingsuit game on real Table Mountain terrain (Vite, TypeScript strict, Three.js, Vitest), live at https://toastseagers.github.io/table-mountain-wingsuit/ as v0.2.0-alpha.5. It was built in staged agent sessions (0 to 8, plus 7b), each from a brief in `docs/agents/` and gated by the Orchestrator before merging; the conventions in `CLAUDE.md` are binding: `src/flight/` imports nothing from Three.js, shared types in `src/types/` are frozen, tuning constants carry reasons, Three.js objects are created only in `src/world/` and `src/fx/`, git identity is the repo's local ToastSeagers config. A research note on other wingsuit games (`docs/research/wingsuit-sims.md`) set three priority-one changes, which are this stage: instant restart (Superflight's quick retry), dynamic resolution from frame time (OpenSkyFlight's answer to weak GPUs and phone heat), and scoring that rewards risk rather than time near terrain (Superflight's best-documented flaw). Stage 7b added the countdown warm-up gate and device-scaled streaming budgets; Stage 8 replaced the pilot and canopy and made the glide ratio dynamic; v0.2.0-alpha.5 added a scoring hint and a first-flight controls-card hold after the first tester response. A feedback round with friends and Reddit is running, so the owner wants retries to feel instant and phones to stay smooth. The owner has delegated plan approvals to the Orchestrator: decide open questions yourself from the specs and record each decision in the report rather than asking.

## Mission

Make a retry cost almost nothing, keep phones at frame rate by adapting resolution instead of fixing it, and make the proximity score reward danger rather than dawdling.

## Deliverables

1. **Instant restart.** Stage 7b's countdown warm-up (`src/game/CountdownGate.ts`, `Game.updateCountdown`) holds GO for up to 4 s while chunks, tiles and shaders settle. That is right on a cold start and wrong on a retry: Superflight's most praised trait is that a crash is a brief interruption. When the player restarts (pause RESTART, the R key, or JUMP AGAIN on the results or scores screens) at the same exit and line and the terrain reports settled, skip the warm-up wait entirely and run a short countdown (your call, for example 1 s or a single GO, recorded with reasoning). A different exit, or unsettled terrain, keeps today's behaviour. The first-flight controls-card hold added in v0.2.0-alpha.5 must still work and must never trigger on a restart. Measure time from the restart press to GO before and after, desktop and the mobile preset, and put both in the report.

2. **Dynamic resolution on touch devices.** Replace the mobile preset's fixed render scale with a frame-time-driven controller in `src/world/` (a small pure class with unit tests, the way `StreamingBudgets` is): a smoothed frame-time measure, step down when over budget, step up slowly when well under, hysteresis so it does not oscillate, a floor and ceiling in `WorldSettings` per preset, and no change more often than about once a second. On by default only for the mobile preset; desktop presets keep a fixed scale unless you show it helps. It must cooperate with the results screen's own 0.75 scale and with the post stack. The Stage 6 code review noted `PostStack` reallocates its targets on every render-scale change, causing a hitch; fix that (reuse or resize targets) since this controller will change scale during play. Show the current scale in the `?dev=1` overlay.

3. **Risk-weighted proximity and near-miss stamps.** Today proximity is time-integrated under 50 m AGL, so the best strategy is skimming open slopes. Rework it in `src/game/Scoring.ts` and `src/game/scoring-tuning.ts`: weight proximity by closeness times speed times a narrowness term from a few terrain samples around the pilot (to the sides and ahead, through the existing `TerrainSampler`, not just the ground below), so a gorge or ridge-gap pass is worth clearly more than an open slope at the same height. Add discrete near-miss events: a lump sum and a HUD stamp when passing within a few metres of terrain at speed, with a cooldown so one pass is one stamp, and a NEAR MISSES line in the results tally. Update `docs/design/scoring.md` to describe the new rules and keep its balance targets: a good first-time run about 5,000, an expert run about 15,000. Use the existing probes (`tools/low-line.ts`, `tools/lazy-run.ts`, `tools/exit-check.ts`) and add one that flies a gorge line through Platteklip to show the gorge now out-scores open-slope skimming; report the numbers. The scoring hint text in `src/ui/controlsCard.ts` should still be true afterwards; adjust it if not.

## Constraints

`src/flight/` stays free of Three.js and is not changed in this stage. Do not move exits or landing zones. Do not regress the mobile preset: measure with `?dev=1` before and after, and note that a hidden browser pane throttles fps to about 15, so report GPU and CPU ms as the comparison and say whether the pane was visible. Keep `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` green; CI runs them on push. Every constant gets a reason in its tuning file, and every change goes in the report's tuning table (old, new, why). Commit small in imperative mood. Never change the repo's git identity. Do not merge to `main` and do not push `main`; you may push your own branch, and if the gh CLI is on the other GitHub login, switch with `gh auth switch --user ToastSeagers` first (and switch back afterwards).

## Gate 9 (checked by the Orchestrator)

- [ ] Branch `stage-9-restart-resolution-risk` pushed.
- [ ] Tests extended for the restart path, the resolution controller and the new scoring; `npm test`, lint, typecheck, build green.
- [ ] `docs/status/stage-9-report.md` from the template in `docs/03-handoff-protocol.md` with the restart timings (before and after, desktop and mobile preset), the resolution controller's behaviour (a trace of scale over a flight on the mobile preset), the scoring probe table (gorge versus open slope versus lazy run, before and after), the tuning table and the perf numbers.
- [ ] One line appended to `docs/status/STATUS.md`. Then stop.

## Kickoff prompt (paste into a new session, effort high, auto mode)

```
You are the Stage 9 engineer on Table Mountain Wingsuit. Read, in order: CLAUDE.md, PLAN.md, docs/status/STATUS.md, docs/03-handoff-protocol.md, docs/research/wingsuit-sims.md (sections 2.2, 2.3, 2.10 and 3), docs/design/scoring.md, docs/status/stage-7b-report.md, docs/status/stage-8-report.md and docs/status/playtest-notes.md. First save this prompt as the stage brief at docs/agents/09-restart-resolution-risk.md in the same shape as the other briefs in docs/agents/, then work on a new branch stage-9-restart-resolution-risk cut from main. Deliver the three items above (instant restart, dynamic resolution, risk-weighted proximity with near-miss stamps) under the constraints above. Done means: branch pushed, tests extended for the restart path, the resolution controller and the new scoring, docs/status/stage-9-report.md written from the template with the restart timings, the resolution controller's behaviour, the scoring probe table, the tuning table and the perf numbers, plus one line appended to docs/status/STATUS.md. Then stop.
```
