# Agent brief 03 — Flight Physics Engineer (Stage 3)

**Recommended settings:** Opus 5.5, effort xhigh, start in plan mode and approve the model plan, then switch to auto. Fresh session. This is the highest-effort stage in the project because the flight model is the game. If credits allow, have the Orchestrator session (Fable) read the plan before approving it.

**Depends on:** Stage 0 merged only. **Runs in parallel with:** Stages 1 and 2.

**Owns:** `src/flight/`, `tools/flight-harness.ts`, `tools/scenarios/`. Imports only from `src/types/`. **Never imports Three.js.**

## Mission

Build a wingsuit and canopy flight model that matches the numbers and, more importantly, the five feelings in `docs/design/flight-model.md` section 1, with a headless test suite and tuning harness so feel can be tuned with numbers.

## Deliverables

1. **Plan (plan mode):** state representation, force model, control mapping, integration scheme, phase machine, how start arc and mush are modelled, test list. Wait for approval.
2. `src/flight/tuning.ts`: every constant with a comment and its source in the spec.
3. `src/flight/aero.ts`: CL(alpha), CD(alpha), authority curves. Pure functions.
4. `src/flight/WingsuitModel.ts`, `src/flight/CanopyModel.ts`, `src/flight/FlightModelImpl.ts` implementing `FlightModel` from `src/types/flight.ts`.
5. `src/flight/stub-terrain.ts`: the analytic cliff from the spec section 6.
6. `src/flight/*.test.ts`: every test in the spec section 7, deterministic.
7. `tools/flight-harness.ts` and `tools/scenarios/{trim,dive,flatten,canopy,camps-bay}.ts`, CSV output as specified. `npm run harness -- camps-bay > out.csv` wired in package.json.
8. A plot (PNG) of y versus x for trim and Camps Bay scenarios in `docs/status/stage-3/`.
9. `docs/status/stage-3-report.md` with a measured-versus-target table for every row in spec sections 2 and 3.

## Design notes

- Fixed 120 Hz step, semi-implicit Euler, quaternion orientation, inputs already smoothed by the caller (document that assumption).
- Phase transitions: `freefall` to `wingsuit` when effective wing area reaches 90 percent; `wingsuit` to `deploying` on deploy input; `deploying` to `canopy` after 2.5 s; `canopy` to `landed` or `crashed` on ground contact with the classification table; `wingsuit` to `crashed` on terrain contact.
- Expose `glideRatio`, `gLoad`, `alphaDeg`, `mushFactor` on the state for the HUD and tuning.
- `step()` must be allocation-free in the hot path (reuse vectors), since it runs 120 times a second.
- Make `reset()` seedable so replays and ghosts are exact.

## Kickoff prompt (paste into a new Opus 5.5 session, effort xhigh, plan mode on)

```
You are the Flight Physics Engineer for Table Mountain Wingsuit. Read CLAUDE.md, PLAN.md, docs/01-architecture.md sections 3, 5 and 6, docs/02-stages.md Stage 3, docs/03-handoff-protocol.md, docs/design/flight-model.md in full, docs/status/STATUS.md and your brief docs/agents/03-flight-physics.md. First, in plan mode, write the flight model plan from deliverable 1 and wait for approval. After approval, create branch stage-3-flight and build the wingsuit and canopy models, tuning constants, stub terrain, the full Vitest suite from the spec, and the headless harness with its scenarios. Tune until every row in the spec tables is within tolerance and the Camps Bay scenario lands on the beach. Never import Three.js in src/flight. Commit as you go. Write docs/status/stage-3-report.md from the template with the measured-versus-target table and plots, append to STATUS.md, then stop. Do not touch src/world, src/game or src/ui.
```
