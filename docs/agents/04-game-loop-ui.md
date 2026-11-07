# Agent brief 04 — Gameplay and UI Engineer (Stage 4)

**Recommended settings:** Sonnet 5.5, effort high, permission mode auto, fresh session. Why Sonnet: this is the largest volume of code in the project but every screen, state and formula is specified. High effort keeps quality up at a fraction of Opus cost. If the camera rig or state machine proves awkward, a short Opus session for that piece alone is cheaper than running the whole stage on Opus.

**Depends on:** Stages 2 and 3 merged. **Runs in parallel with:** the audio half of Stage 5 (different folders).

**Owns:** `src/game/`, `src/ui/`, `src/core/` (input, loop, persistence), `data/exits.json`, `data/landing-zones.json`, `data/triggers.json`, `public/img/`. Reads `src/world/` and `src/flight/` through their public APIs only.

## Mission

Make it a game: the full loop from title to high score, every screen in the retro chrome, scoring, exits and landing zones from data, keyboard, mouse and gamepad.

## Deliverables

1. `src/core/`: fixed-step game loop with accumulator and render interpolation, input manager (keyboard, pointer lock mouse, Gamepad API) producing a smoothed `FlightInput`, persistence helper over `localStorage` with versioned keys.
2. `src/game/GameStateMachine.ts` per `docs/01-architecture.md` section 7.
3. `src/game/ExitRegistry.ts`, `LandingZoneRegistry.ts`, `TriggerRegistry.ts`: load and validate JSON against the types; throw on a bad file with a readable message.
4. `src/game/RunController.ts`: drives `FlightModel`, detects crash, out-of-bounds (leave the AOI by 200 m) and landing, records replay at 30 Hz, produces `RunResult`.
5. `src/game/Scoring.ts` and `scoring-tuning.ts` per `docs/design/scoring.md`, with unit tests for each component and bonus.
6. `src/game/CameraRig.ts`: chase cam with the lag and FOV rules from the look spec, canopy cam, landing cam, intro flyover along `ExitDefinition.intro.cameraPath`.
7. `src/ui/`: all screens in `docs/design/look-and-feel.md` section 5, as DOM with CSS using the palette tokens. Title (with attract mode hook for Stage 5), exit select with overview map and cards, intro, countdown, HUD, pause, results tally, high score entry, settings skeleton (Stage 5 adds audio and quality entries).
8. `data/triggers.json` authored with the dev camera: Platteklip Gorge volume and three Apostles volumes.
9. Refine `data/exits.json` by flying each exit: adjust position a few metres so the start arc clears the ledge, set `intro.cameraPath`, write blurbs. List changes in the report.
10. Disclaimer line on the title screen per `docs/design/exits.md` section 4.
11. Tests: scoring, state transitions, registries, replay round-trip.
12. `docs/status/stage-4-report.md` with a GIF or short video of a complete run, and a list of anything deferred to Stage 6.

## Constraints

- No UI framework. Plain DOM, one module per screen, a tiny `Screen` base with `show()`, `hide()`, `update(dt)`.
- Chrome motion rules: steps and snaps only, no eased tweens on 2D (look spec section 6).
- Pixel font only, palette tokens only.
- `?dev=1` keeps the free camera and perf overlay and adds a "teleport to exit N" key.
- Keep `src/flight/` and `src/world/` untouched; if you need an API they lack, write it in the report and stub around it.

## Kickoff prompt (paste into a new Sonnet 5.5 session, effort high, auto mode)

```
You are the Gameplay and UI Engineer for Table Mountain Wingsuit. Read CLAUDE.md, PLAN.md, docs/01-architecture.md, docs/02-stages.md Stage 4, docs/03-handoff-protocol.md, docs/design/look-and-feel.md, docs/design/scoring.md, docs/design/exits.md, docs/status/STATUS.md, docs/status/stage-2-report.md, docs/status/stage-3-report.md and your brief docs/agents/04-game-loop-ui.md. Create branch stage-4-game. Build the complete game loop and every screen as specified: core loop and input, state machine, registries, run controller, scoring with tests, camera rig, all UI screens in the retro chrome, triggers, refined exits, persistence. Make the full loop playable for all three exits with keyboard, mouse and gamepad. Commit as you go. Write docs/status/stage-4-report.md from the template with a GIF of a complete run, append to STATUS.md, then stop. Do not modify src/world or src/flight; report any API you needed.
```
