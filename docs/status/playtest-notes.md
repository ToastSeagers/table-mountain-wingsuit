# Playtest notes for Stage 6

Collected by the Orchestrator across Gates 2 to 5 (2026-11-08), from autopilot runs and hands-on checks in the in-app browser on the reference laptop. Owner play notes, when they arrive, are appended at the bottom. Priority: P1 must fix before v0.1, P2 should fix, P3 nice to have.

## P1

1. **Lion's Head Sea Point line is not survivable hands-off.** With the autopilot, the 275 degree line strikes the slope 170 m from the exit at 14.6 s; the headless `tools/exit-check.ts` crashes all four Lion's Head lines (Sea Point lines at 17 to 21 s, Clifton lines at 133 s near the zone). The Table and Platteklip land fine. Hand-fly Lion's Head: if an immediate dive makes it, keep it and say so in the exit blurb; if not, move the exit or heading (Stage 1 noted the summit cell has a 156 m drop in 120 m along 300, but 300 hits a slope further out). Decide and record.
2. **Results screen GPU cost.** With the replay director behind the results panel the perf overlay reads about 7 ms GPU mean, p95 33 ms, 58 fps on the reference laptop inside the app pane (Gate 4 saw 7.6 ms; Gate 5 saw 7.1 ms; the Stage 5 report measured under 2 ms in the title-orbit view, so the cost is shot-dependent). Reproduce with `?dev=1&auto=1&exit=the-table`, let it land, press P for the overlay. Suspects: the CSS backdrop or scanline layers over the canvas, the post stack running at full resolution behind a mostly covered frame, the replay ground-cam shots pulling in many L0 chunks. Target under 4 ms.
3. **Verify 60 fps and first load on a second machine.** All measurements so far are on the RTX 4060 laptop. Gate 6 needs an integrated-GPU run (the same laptop's Intel Arc will do if the browser is forced to it) and a throttled 20 Mbps first-load timing (about 15 to 21 MB fetched per exit; budget is under 10 s to title).

## P2

4. **Sun glitter column.** The sun's reflection on the sea is a tall, hard white pillar (visible from The Table and Lion's Head exits). Bloom and shafts in Stage 5 make it dominate seaward frames. Narrow and dim the glint in `src/world` sea shading (`Sea.ts`, `TerrainMaterial.ts` sea branch) and recheck shaft strength.
5. **Resolved in Stage 8 (v0.2.0-alpha.4): lit, translucent seven-cell canopy.** Original note: Canopy reads as a dark slab in replay and landing-cam shots (Stage 4 raised the emissive but did not recheck). Give it a lit, slightly translucent material or a simple two-tone cell texture.
6. **Blank-coverage patch off Clifton** in the City aerial reads as a pale island near x -3,300, z -1,400 (Stage 2 known issue 2). Fix in the Stage 1 sea mask (`tools/terrain/build.py`: flood that patch to 0 m and re-fill colour) and regenerate only the affected tiles, or mask it in the shader if the rebuild is too slow.
7. **Ear test.** Nobody has listened to the mix on headphones. Check wind level against the altimeter beeps, the opening snap, the title loop level, and that the wipeout sting is not painful. Adjust gains in `src/audio/`.
8. **Physical gamepad.** Only a mocked pad has been tested. Try menus, a full flight, deploy and flare, and pause with a real controller.
9. **Mouse pointer lock** was never exercised in a visible pane. Click to capture, fly a run, confirm the virtual-stick centring feels right and that Esc releases cleanly.
10. **Trigger volumes were authored from data, not flown.** Fly through the Platteklip gorge and along the Apostles and confirm the gorge box and the three Apostles boxes award at sensible lines; adjust `data/triggers.json`.
11. **Scores of the same autopilot run differ between frame drivers** (6,767 with `advance()` in one run, 6,244 in another). Confirm the fixed-step loop and the 30 Hz replay recorder are independent of render frame timing; if the autopilot itself reads render time, that is fine, but a human run must be deterministic given the same input stream.

## P3

12. **Camera.** Chase camera pulls in under ledges below a wall; the intro ends on the plain start pose so the cut to the countdown can jump a few metres at The Table and Platteklip.
13. **Close-range texture** is soft within about 30 m (1.25 m per pixel aerial). Consider a stronger AGL-scaled detail normal near the ground, or accept.
14. **HUD glide readout** shows "--" above 15 and at low sink by design; make sure it never shows 99.
15. **Dev overlay covers the speed readout** in `?dev=1`. Dev only.
16. **Bundle size** is 713 kB (195 kB gzipped). Split Three.js into its own chunk; fix the absolute `/fonts/` URL in `style.css` for a non-root base path before deploying to GitHub Pages.
17. **Known spec inconsistencies from Stage 3** (min sink 9.6 vs 11 to 14, opening height loss 50 vs 55 to 90): decide which rows to keep and update `docs/design/flight-model.md` to match the model, rather than forcing the model.
18. **Balance targets** from `docs/design/scoring.md` section 5: a good first-time run about 5,000, an expert run about 15,000. The autopilot's clean Table run scores about 6,700 with zero proximity; check that a low, fast human line can reach 12,000 to 15,000 and that proximity is actually earnable.
19. **Audit advisories** in vitest 3 (dev only) and the 500 kB chunk warning, carried since Stage 0.

## Owner play notes

(append here)

## Tester feedback (round 1, from the form)

Triaged by the Orchestrator from the responses sheet. Each item gives the count of testers who raised it and their devices. First triage 2026-11-21: 1 response (2026-11-09, v0.2.0-alpha.2, keyboard, Safari 27 on macOS, Apple GPU, 1376x948 at 0.8, medium preset, The Table, crashed at 5,188, 60 fps). Felt 4 of 5, controls "easy straight away", ran smooth. Would play again: 1 of 5.

20. **"How to score points" was the first confusion** (1 tester, desktop). The HUD shows a score and a proximity meter but nothing says what earns points. P2: one line on the exit-select or intro card ("fly low and fast past rock for proximity, land in a green ring for the big bonus"), and the research backlog's near-miss stamps would make it self-explanatory. (1 of 1)
21. **Could not get from the score screen back to choosing an exit** (1 tester, desktop). After a qualifying run the tally offers only NEW HIGH SCORE! (and FEEDBACK), so the player must enter initials before JUMP AGAIN / CHANGE EXIT / TITLE appear on the high-score table; the first run always qualifies. P2: show CHANGE EXIT and TITLE beside NEW HIGH SCORE! on the tally, or let the initials screen be skipped with Esc / a SKIP item. (1 of 1)
22. **The controls card goes by too fast** (1 tester, desktop): "wait a minute to see the full list of controls". The card shows only during the intro. P2: add CONTROLS to the pause menu and to the title's settings, and hold the intro card until a key or tap if the player has not flown before. (1 of 1)
23. **First Safari on macOS data point**: Apple GPU, 60 fps at the 0.8 render scale, no complaint about visuals. iOS Safari is still untested. (info)
24. **"Would you play again" scored 1 while "how did flying feel" scored 4** (1 tester). Either a real verdict (the crash plus items 20 to 22) or a misread of the 1 to 5 scale. Watch for the pattern in later responses before reading into it. (1 of 1)

