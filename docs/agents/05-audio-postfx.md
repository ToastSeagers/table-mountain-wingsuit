# Agent brief 05 — Audio and Post-FX Engineer (Stage 5)

**Recommended settings:** Sonnet 5.5, effort medium, permission mode auto, fresh session. Raise to high only for the replay camera if the first attempt is flat. Why: wiring Web Audio nodes and Three.js post passes to existing state is well-trodden work.

**Depends on:** audio half needs Stage 3 merged; FX and replay half needs Stage 4 merged. Run as one session started after Stage 3, which does audio first and then waits (stops and reports an interim) until Stage 4 is on `main`, or as two short sessions. The Orchestrator decides; two short sessions are cheaper if the gap is more than a day.

**Owns:** `src/audio/`, `src/fx/`, `public/audio/`. May add entries to the settings screen in `src/ui/settings/` and read `Sky`, `Sun`, `Fog` parameters from `src/world/`.

## Mission

Make the flight sound and look like the trailer in the player's head: wind that tells you your speed, an altimeter that raises your pulse, a post stack that turns the renderer into golden-hour film, and a replay that makes every run look heroic.

## Deliverables — audio half

1. `src/audio/AudioEngine.ts`: context unlock on first input, buses (master, world, UI), settings persistence.
2. `src/audio/Wind.ts`: noise through band-pass and low-pass whose cutoff, gain and stereo width follow airspeed, with a roll-dependent pan and a sub rumble under 20 m AGL. Freefall flutter in the start arc.
3. `src/audio/Altimeter.ts`: beeps at configurable AGL thresholds (default warning 250 m, deploy 160 m, low 120 m), pulse rate increasing under 150 m, silent under canopy.
4. `src/audio/Canopy.ts`: opening snap, line flutter proportional to speed, flare swoosh, landing thump by surface.
5. `src/audio/UiSounds.ts`: move, select, back, countdown drums, tally tick, high score fanfare, "WIPEOUT" sting. Chiptune style; synthesise with oscillators where possible, CC0 samples otherwise (log in `docs/ASSETS.md`).
6. A four-bar title loop (synthesised or CC0).
7. Interim report if waiting for Stage 4.

## Deliverables — FX and replay half

8. `src/fx/PostStack.ts`: filmic tonemap, warm grade (LUT or curves), grain, vignette, bloom restricted to sun and specular, sun shafts, speed-scaled chromatic aberration. Presets low, medium, high; medium must hold 60 fps on the reference laptop.
9. `src/fx/CameraEffects.ts`: speed shake above 60 m/s, opening shock kick, FOV stretch (coordinate with `CameraRig` through parameters, do not rewrite it).
10. `src/fx/ReplayDirector.ts`: plays `RunResult.replay` with a shot list (ground cams placed at the three closest-approach points of the track, a chase cam, a canopy wide, the landing), cut on a rhythm, skippable, VHS overlay toggle.
11. Intro flyover polish for each exit (timing, easing of the 3D camera only).
12. Title attract mode: after 30 s idle, play the best stored replay.
13. Settings entries: audio sliders, quality preset, VHS toggle, camera shake toggle, attribution text from `docs/ASSETS.md`.
14. `docs/status/stage-5-report.md` with before/after screenshots and the measured frame cost of each post effect.

## Constraints

- Web Audio only, no audio libraries. Three.js `EffectComposer` or the `postprocessing` npm package (MIT) for the stack; say which and why.
- Respect `prefers-reduced-motion` for shake and grain.
- Total audio assets under 8 MB.
- Do not change physics, scoring or game states.

## Kickoff prompt (paste into a new Sonnet 5.5 session, effort medium, auto mode)

```
You are the Audio and Post-FX Engineer for Table Mountain Wingsuit. Read CLAUDE.md, PLAN.md, docs/01-architecture.md, docs/02-stages.md Stage 5, docs/03-handoff-protocol.md, docs/design/look-and-feel.md sections 4, 6 and 7, docs/status/STATUS.md, the latest stage reports and your brief docs/agents/05-audio-postfx.md. Create branch stage-5-audio-fx. If Stage 4 is not yet on main, build only the audio half against FlightState from src/flight, write an interim report and stop. If Stage 4 is on main, build everything: audio engine, wind, altimeter, canopy and UI sounds, title loop, post stack with presets, camera effects, replay director, attract mode and settings entries. Measure the frame cost of each effect. Commit as you go. Write docs/status/stage-5-report.md from the template, append to STATUS.md, then stop. Do not change physics, scoring or game states.
```
