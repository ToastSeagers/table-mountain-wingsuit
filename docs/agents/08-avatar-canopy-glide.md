# Agent brief 08 — Avatar, Canopy and Glide Engineer (Stage 8, v0.2)

**Recommended settings:** Fable 5.1 or Opus 5.5, effort high, permission mode auto, fresh session in the main checkout.

**Depends on:** v0.2.0-alpha.3 on `main` (Stages 0 to 7b). **Runs alone**; nothing else writes to the repo during this stage.

**Owns:** `src/fx/` (pilot and canopy), `src/flight/` (polar, pure TypeScript, no Three.js), `src/game/` (HUD and replay touch points only), `tools/`, `docs/`. Any other folder touched is noted in the report.

## Background

Table Mountain Wingsuit is a browser wingsuit game on real Table Mountain terrain (Vite, TypeScript strict, Three.js, Vitest), live at https://toastseagers.github.io/table-mountain-wingsuit/ as v0.2.0-alpha.3 with desktop and touch controls. It was built in seven staged agent sessions, each from a brief in `docs/agents/`, each gated by the Orchestrator before merging; the conventions in `CLAUDE.md` are binding, in particular: `src/flight/` imports nothing from Three.js, shared types in `src/types/` are frozen, tuning constants live in `src/flight/tuning.ts` with reasons, Three.js objects are created only in `src/world/` and `src/fx/`, and git identity is the repo's local ToastSeagers config (never change it, never push main). A feedback round with friends and Reddit is running now, so the owner wants the pilot and canopy to look good in replays and the flight to feel like real wingsuit flying: the research note in `docs/research/wingsuit-sims.md` records what the genre's best games do and the real glide numbers. Known issue being fixed here: playtest note 5, the canopy reads as a dark slab in replay shots. Stage 7b made mobile performance acceptable; do not regress it. The owner has delegated plan approvals to the Orchestrator, so decide open questions yourself from the specs and record the decision in the report rather than asking.

## Mission

Make the pilot and canopy read well in every camera, and make the glide ratio a live outcome of the flight state rather than a held constant, without breaking any exit line or the mobile frame rate.

## Deliverables

1. **A better wingsuit pilot.** Today `src/fx/PlayerAvatar.ts` draws a placeholder. Replace it with a readable procedural pilot built from Three.js primitives or hand-built BufferGeometry in `src/fx/`: torso, helmet, arm wings and a leg wing as one silhouette, two-tone suit colours from the look spec palette, a visible head. The pose must respond to flight: bank rolls the body and dips the inside wing, pitch-forward sweeps the arms back slightly, flare and deploy change posture, and a small speed-scaled flutter on the wing trailing edges. Keep it under about 3,000 triangles. It must read well in the chase camera, the head camera (hands and wing edges in view), and every replay shot.

2. **A better parachute.** Replace the current canopy with a lit, slightly translucent seven-cell ram-air canopy: cells with visible ribs, suspension lines to risers at the pilot's shoulders, an inflation animation over the model's opening time (snivel then snap), brake deflection of the tail on flare, and a gentle oscillation under load. Under 2,000 triangles. This fixes playtest note 5. No external assets unless CC0 and recorded in `docs/ASSETS.md`; procedural is preferred.

3. **A realistic, dynamic glide ratio.** The flight model in `src/flight/` (pure TypeScript, no Three.js imports, keep it that way) currently holds close to a fixed 3:1 trim glide. Make the glide ratio an outcome of state rather than a constant: a lift and drag polar over angle of attack with a stall region and drag rise past it; induced plus parasitic drag so there is a best-L/D airspeed and faster dives give lower L/D; bank raises load factor and sink; pitch-forward trades glide for speed, pull-back floats then mushes with decay. Targets, from the research note and spec: typical 2.5 to 3.0:1, about 3.3 to 3.5:1 at best-glide speed for a clean pilot, down to 1.5:1 or less in a full dive; horizontal speeds roughly 100 to 180 km/h. Optionally add the capped ground-effect term from research section 2.6 (1.0 to 1.3 lift over 20 m AGL) behind a tuning constant defaulting to off, for a human to judge. Every constant goes in `src/flight/tuning.ts` with a reason; record old, new and why in the report. Update `docs/design/flight-model.md` to describe the new model, extend the headless harness measured-versus-target table, and keep the Camps Bay scenario landing on the beach. The HUD glide readout must show the live ratio.

## Constraints

All three exits must still be landable by the autopilot (`tools/exit-check.ts` and `?dev=1&auto=1&exit=<id>`); if a line becomes unflyable, retune the model before moving any exit, and say so. No performance regression: the mobile preset must hold its frame rate and triangle budget; measure with `?dev=1` before and after. Stay in `src/fx/`, `src/flight/`, `src/game/` (HUD and replay touch points only), `tools/`, `docs/`; note any other folder you touch in the report. Keep `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` green; CI now runs them on push. Commit small in imperative mood. Do not merge to `main` and do not push `main`; the Orchestrator does both after the gate.

## Gate 8 (checked by the Orchestrator)

- [ ] Branch pushed as `stage-8-avatar-canopy-glide`.
- [ ] Tests extended for the new polar and for pose and canopy state logic; `npm test`, lint, typecheck, build green.
- [ ] `docs/status/stage-8-report.md` from the template in `docs/03-handoff-protocol.md` with before and after screenshots of the pilot and canopy in chase, head and replay cameras, the tuning table, the autopilot landing results for all three exits, and the mobile perf numbers.
- [ ] One line appended to `docs/status/STATUS.md`. Then stop.

## Kickoff prompt (paste into a new session, effort high, auto mode)

```
You are the Stage 8 engineer on Table Mountain Wingsuit. Read, in order: CLAUDE.md, PLAN.md, docs/status/STATUS.md, docs/03-handoff-protocol.md, docs/design/flight-model.md, docs/design/look-and-feel.md, docs/research/wingsuit-sims.md (sections 2.6 and 3), and docs/status/playtest-notes.md item 5 (canopy reads as a dark slab). First save this prompt as the stage brief at docs/agents/08-avatar-canopy-glide.md in the same shape as the other briefs in docs/agents/, then work on branch stage-8-avatar-canopy-glide. Deliver the three items above (pilot, canopy, dynamic glide) under the constraints above. Done means: branch pushed as stage-8-avatar-canopy-glide, tests extended for the new polar and for pose and canopy state logic, docs/status/stage-8-report.md written from the template in docs/03-handoff-protocol.md with before and after screenshots of the pilot and canopy in chase, head and replay cameras, the tuning table, the autopilot landing results for all three exits, and the mobile perf numbers, plus one line appended to docs/status/STATUS.md. Then stop.
```
