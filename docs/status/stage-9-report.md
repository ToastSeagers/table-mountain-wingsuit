# Stage 9 report — Instant restart, dynamic resolution, risk-weighted proximity

**Agent:** Stage 9 engineer (restart, resolution, risk) · **Model/effort:** Sonnet 5.5 / high, auto mode · **Branch:** stage-9-restart-resolution-risk · **Date:** 2026-11-28

## What was built

- **Instant restart.** A retry (pause RESTART, the R key, JUMP AGAIN on the results or the scores screen) at the same exit and heading as the run just flown, with the terrain settled, the sampler ready, the exit preload done and the shaders already compiled, skips the countdown gates and shows a single `GO!` for 0.6 s before the jump. The decision is a pure function, [restartPolicy.ts](../../src/game/restartPolicy.ts) (`isQuickRestart`, `QUICK_COUNTDOWN_S`), wired in `Game.beginCountdown` ([Game.ts](../../src/game/Game.ts)); `CountdownGate.skip()` opens both gates. The warm-up still streams underneath the 0.6 s (budgets lifted), shaders are not recompiled, the controls card is hidden (`.countdown-screen.quick`), and the first-flight controls hold never applies to a retry. A different exit or heading, an unsettled terrain, or a first jump from the intro keeps today's full countdown.
- **Dynamic resolution.** [DynamicResolution.ts](../../src/world/DynamicResolution.ts) is a small pure class: smoothed frame time, step down 0.1 when over budget, step up 0.1 slowly (a probe, with a back-off that doubles after a failed probe), a floor and ceiling from `WorldSettings` (`dynamicResolution`, `minRenderScale`, `maxRenderScale`, `targetFrameMs`), no change within 1 s of another, hitch frames ignored, and a step down that does not improve the frame time by 5% is undone and blocked for 60 s (doubling), so a phone locked to 30 Hz or CPU-bound is not left at the floor for nothing. On for the mobile preset only (0.6 to 1.0 of the canvas). It scales the scene and the bloom chain; the composite pass upsamples to the canvas, so the canvas, HUD and menus stay sharp and no canvas resize happens in flight.
- **PostStack target cache.** [PostStack.ts](../../src/fx/PostStack.ts) no longer disposes and reallocates every target on a size change (the Stage 6 review's hitch). Each size keeps its set (8 sets, least recently used out), `setSceneScale` selects one, and `prepareScales` allocates and `initRenderTarget`s every level the controller can visit during the countdown, so a step in flight is a pointer swap. The results screen's 0.75 canvas scale uses the same cache. `allocations` counts sets built.
- **Risk-weighted proximity** ([risk.ts](../../src/game/risk.ts), [Scoring.ts](../../src/game/Scoring.ts), [scoring-tuning.ts](../../src/game/scoring-tuning.ts)). Every 30 Hz the tracker samples the terrain through the `TerrainSampler` (12 lookups: below, 8 m to each side, 12 m and 25 m ahead for clearance; 30 and 70 m to each side and 50 and 110 m ahead for narrowness). Proximity accrues at `airspeed * closeness * gain * (0.25 + 4.5 * narrowness)` per second, closeness from the nearest of those samples, so a wall off the wingtip counts and a gully is worth several times an open slope at the same height.
- **Near misses.** A pass within 6 m at 40 m/s or more in the wingsuit or freefall (not in the first 3 s) pays `300 * (0.3 + 0.7 * narrowness)` and queues a `NEAR MISS +n` HUD stamp; one pass is one stamp (it re-arms only after the clearance has opened to 20 m and 4 s have gone by). The results tally has a `NEAR MISSES n` line; the HUD proximity bar now follows `tracker.proximityMeter` (closeness weighted by narrowness).
- **Overlay.** The `?dev=1` overlay's last line starts `res 0.80 dyn 16.7 ms` (scene scale, `dyn` or `fixed`, smoothed frame time); `__tmw.game.resolutionTrace` holds `[flight seconds, scale]` per change.
- **Docs and tools.** [scoring.md](../design/scoring.md) sections 1a and 1b; the scoring hint in [controlsCard.ts](../../src/ui/controlsCard.ts) now reads `POINTS: FLY FAST AND CLOSE TO ROCK, NARROW GAPS PAY MOST. LAND IN A GREEN RING.`; probes [risk-probe.ts](../../tools/risk-probe.ts) and [gorge-xs.ts](../../tools/gorge-xs.ts); the brief is [09-restart-resolution-risk.md](../agents/09-restart-resolution-risk.md).

## How to run and verify

```
npm test                                   # 38 files, 302 tests
npm run lint && npm run typecheck && npm run build
npx tsx tools/risk-probe.ts all            # scoring probe (table below); modes lazy | skim | gorge | ghost
npx tsx tools/gorge-xs.ts 960 640 -40 -160 60 10   # ground across the Platteklip gully
npx tsx tools/exit-check.ts                # every exit line still lands soft, scores identical to before
npm run dev                                # then ?dev=1&auto=1&exit=the-table, press R mid-flight
```

What the Orchestrator should see: R, pause RESTART or JUMP AGAIN after a first flight shows only a green `GO!` and jumps after about 0.6 s with no controls card; a first-ever flight (clear site data) still holds at `READY? PRESS ENTER` and the next R does not; with `?dev=1` on a phone or `?touch=1` and the mobile preset the overlay shows `res 1.00 dyn` and the scale steps in tenths when frames run long.

## Gate results

- [x] Branch `stage-9-restart-resolution-risk` pushed (see Decisions for the account switch).
- [x] Tests extended: `restartPolicy.test.ts` (8), `DynamicResolution.test.ts` (13), `postScale.test.ts` (5), `scoring.test.ts` (proximity rewritten, 7 new near-miss tests), `qualityPresets.test.ts` (3). `npm test` 302 passing, lint, typecheck and build green.
- [x] This report.
- [x] One line appended to `docs/status/STATUS.md`.

### Restart timings (press to GO, one retry at the same line, The Table autopilot, 6 s into the flight)

Measured with `?dev=1&auto=1&exit=the-table`, in the in-app browser pane, which was **hidden** (the page ran at 10 to 30 fps and sometimes 1 fps when idle). "Game s" is the sum of the frame dts between the press and `flying`, which is what a player at 60 fps would wait; wall ms is in the throttled pane. Terrain was settled at the press in every run.

| Preset | Before (main) | After (this branch) |
|---|---|---|
| Desktop (medium) | 2,767 ms wall, 2.77 game s, 82 frames | 611 ms wall, 0.63 game s, 18 frames |
| Mobile preset (`?touch=1`) | 2,760 ms wall, 2.77 game s, 83 frames | 590 ms wall, 0.60 game s, 18 frames |

Before, a settled retry still cost the whole 3-2-1 (3 x 0.9 s = 2.7 s) plus a frame or two of gate; the 4 s warm-up allowance only mattered when the terrain was unsettled, which the new path leaves alone. A cold start is unchanged (9.5 to 9.9 s wall in the throttled pane on both builds). Checked by real key events with the animation loop driven by hand: a cleared profile holds at `READY? PRESS ENTER` for 5 game s, Enter gives the 2.7 s countdown, R then shows only `GO!` with the `quick` class and flies at 0.60 game s with `controls-seen` already stored; a restart never shows the hold.

### Resolution controller on the mobile preset (a flight, scale over time)

The pane cannot show a phone's real frame times (it is throttled, and the 4060 is not pixel-bound at 1024x768), so the controller was driven through the real `Game` with a synthetic phone: the animation loop stopped, `game.tick(dt)` called with `dt = max(1/60, cost(t) * scale^2)`, cost 26 ms at full scale, rising to 36 ms between 40 and 70 s of flight (a phone heating up), 20 ms after. The game, post stack, target cache and overlay all ran for real (110 s of flight, mobile preset).

| Flight s | Scale | Why |
|---|---|---|
| 0 to 0.5 | 1.0 | 26 ms at full scale: over budget (target 16.7 ms) |
| 0.5 | 0.9 | first step down; 1 s minimum interval |
| 1.5 | 0.8 | 26 x 0.64 = 16.6 ms: on target |
| 5.5 | 0.9 | probe up after 4 s on target: 21 ms, over |
| 6.5 | 0.8 | failed probe undone; next probe wait doubles to 8 s |
| 14.6 / 15.6 | 0.9 / 0.8 | second probe fails; wait 16 s |
| 31.6 / 32.6 | 0.9 / 0.8 | third probe fails; wait 32 s |
| 40.7 | 0.7 | load rises to 36 ms: 36 x 0.64 = 23 ms, steps down once more |
| 40.7 to 110 | 0.7 | holds at 17.6 ms; the load drops at 70 s but the next probe is not due yet |

Nine changes in 110 s, none closer than 1 s, and `PostStack.allocations` stayed at 5 from GO to the end (the five levels 1.0 to 0.6 were prepared in the countdown): no reallocation in flight. On the 30 Hz-capped pane (every frame 33.3 ms whatever the scale) the controller tried 0.9 at 0.5 s, saw no gain and returned to 1.0 instead of sinking to the floor (before the futile-step rule it fell to 0.6 in 3.6 s with the GPU at 3 ms; this is the iOS Low Power Mode and CPU-bound case). Unit tests cover on-target holding, step down, the 1 s spacing, the floor, slow step up, the back-off, hitch frames, the 30 Hz cap, the desktop no-op and clamping on a preset change.

### Scoring probes (`tools/risk-probe.ts`; before is main at 4eb073a, after is this branch; saved in [stage-9/](stage-9/))

**Same height, same speed, different terrain** (`ghost`: a kinematic pass, 50 m/s, fixed AGL, over the real DEM; the tracker is fed the position and velocity, no flight model). Points per second under 50 m clearance, proximity only; near misses in brackets.

| Line (about 8 to 14 s) | AGL | Before | After |
|---|---|---|---|
| Platteklip gully floor | 10 m | 163/s (1,338) | **87/s** (716) |
| Platteklip east face (one wall) | 10 m | 163/s | 23/s |
| Camps Bay lower slope (open) | 10 m | 163/s (2,098) | 24/s (303) |
| Table top plateau (open, flat) | 10 m | 163/s (2,268) | 21/s (286) |
| Platteklip gully floor | 20 m | 122/s | **43/s** |
| Camps Bay lower slope / Table top | 20 m | 122/s | 15/s |
| Platteklip gully floor | 5 m | 184/s | 98/s + near miss 190 |
| Camps Bay lower slope / Table top | 5 m | 184/s | 27/s and 23/s + near miss 92 and 90 |
| Platteklip gully floor | 35 m | 61/s | 12/s |
| Camps Bay lower slope / Table top | 35 m | 61/s | 8/s |

Before, every line paid the same (narrowness 0). After, the gully is worth 3.6 times open ground at 10 m, 2.9 at 20 m, 3.6 at 5 m (and 2.1 times the near-miss lump sum), 1.5 at 35 m where the pilot is mostly above the walls. The gully in the 5 m DEM is a mild 100 to 120 m wide cut with 30 to 100 m walls (peak narrowness 0.73, mean about 0.3), not a slot, so these ratios are what this terrain gives; a closed slot would reach the 4.75x multiplier.

**Flown lines** (the real flight model; scripted pilots). Total score, with proximity and near misses:

| Line | Before | After |
|---|---|---|
| Table lazy (hands off, deploy at 160 m) | 3,817, prox 0 | 3,817, prox 0 |
| Platteklip lazy | 2,833, prox 0 | 2,833, prox 0 |
| Table open-slope skim (terrain follower, AGL target 15) | 4,546, prox 1,164, 15.1 s under 50 m, crashed at 52 s | 3,533, prox 151 (10 pts/s), crashed at 52 s |
| Lion's Head open-slope skim | 3,001, prox 557, 9.0 s under 50 m | 2,517, prox 73 |
| Platteklip gully line (scripted pilot) | 616, crashed at 7 s | 747, prox 56 and one near miss 145, crashed at 7 s |

Skimming open slope for the same 15 s used to be worth 1,164 of proximity and is now worth 151. The scripted pilot cannot fly the Platteklip gully (see Known issues), so the dynamically flown gully row is a crash at the rim, kept for the day it can. `tools/exit-check.ts` output is byte-identical before and after (every recommended line lands soft in its zone, scores unchanged, because the autopilot never gets under 50 m of clearance); `tools/lazy-run.ts` is identical. `tools/low-line.ts` was already stale after Stage 8 (it deploys at 130 m AGL on the cliff face and never skims; before: 6,499 / 6,478 / 6,465 with prox 0 at targets 12 / 25 / 40) and was replaced by the `skim` mode of the new probe.

**Balance targets.** The autopilot's clean Table run scores 7,634 with no proximity, so the "good first-time run about 5,000" target is met by landing in a zone with a little proximity; a crash early scores a few hundred to two thousand. An expert line, built from the measured pieces: 130 s of Table line (distance about 3,000 and air time 4,000 at the cap, or 3,000 at 75 s), 700 to 1,200 of proximity over the gully and the Apostles face, two or three gully or ridge near misses at about 200 (a few hundred), bonuses at the 3,000 cap (gorge 700, Apostles 700, ghost 800, beach 500, late 400, clean 200), landing about 2,500: roughly 12,000 to 14,000. An expert who strings several gully passes and keeps the ghost line reaches 15,000. This is an estimate from the probe pieces, not a flown run; the expert target stays unverified by a human (playtest note 18).

### Performance (mobile preset, `?dev=1&auto=1&exit=the-table&touch=1`, 25 s into the flight)

Browser pane **hidden** throughout (its frame rate was 1 to 30 fps and not steady), so the loop was stopped and `game.tick(1/60)` driven by hand for a repeatable load; the overlay's GPU timer and CPU time are the comparison. RTX 4060 laptop, canvas 1024x768 at pixel ratio 1.

| Build, scene scale | CPU ms | GPU ms (p95) |
|---|---|---|
| main, fixed 1.0 | 0.54 | 0.74 (2.68) |
| this branch, dynamic on, holding 1.00 at a steady 60 fps | 0.54 | 0.74 (2.62) |
| this branch, fixed 0.6 | 0.53 | 0.72 (2.58) |

No regression: the controller and the target cache cost nothing measurable when the scale does not move. The 4060 is not pixel-bound at this size, so 0.6 saves nothing here; the saving is for a phone's GPU, and the owner's phone is still the real check (Stage 7b's open item).

## Interface or shared-file changes

- `src/ui/ResultsScreen.ts` (NEAR MISSES row, bonus list anchored under row 6), `src/ui/CountdownScreen.ts` (`setQuick`), `src/ui/ui.css` (`.countdown-screen.quick .controls-card` hidden), `src/ui/controlsCard.ts` (hint text): outside the brief's "stamps, results tally, scoring hint only", but each is the minimum for the quick GO or the tally line.
- `src/game/RunController.ts`: passes the terrain sampler to the `ScoreTracker`; `RunResult.proximityScore` now holds proximity plus near misses, because `RunResult` is a frozen shared type with no near-miss field. The tally reads the split from `ScoreBreakdown` (`nearMissScore`, `nearMissCount`). `src/types/` is untouched.
- `src/game/Game.ts`: restart decision, resolution controller, overlay text, HUD proximity bar from the tracker.
- `src/world/WorldSettings.ts`: four new fields (`dynamicResolution`, `minRenderScale`, `maxRenderScale`, `targetFrameMs`).
- `src/flight/`: untouched. No exit or landing zone moved. No new dependency.
- Docs: `docs/design/scoring.md`, `docs/agents/09-restart-resolution-risk.md`, this report, `docs/status/stage-9/` (probe outputs before and after), `docs/status/STATUS.md`.

## Tuning changes

| constant | old | new | why |
|---|---|---|---|
| `SCORING.proximity.gain` | 4 | 2 | the risk multiplier averages 0.27 on open ground and about 1.6 in the Platteklip gully, so a skim of open slope falls from 152 to about 20 points a second and a gully pass sits near 90 |
| `SCORING.proximity.riskFloor`, `riskSpan` | none | 0.25, 4.5 | multiplier `0.25 + 4.5 * narrowness`: 0.27x open, 2.5x half closed, 4.75x a closed gorge or gap |
| proximity closeness input | AGL under the pilot | nearest of AGL and the close side and ahead samples | a wall 8 m off the wingtip is as close as a slope 8 m below |
| `SCORING.risk.*` | none | levelBelowM 15, riseFullM 20, sides 30 and 70 m, ahead 50 and 110 m, sidesWeight 0.7, near 8 m sides and 12 and 25 m ahead, sense every 4 steps (30 Hz) | sized to the Platteklip gully (60 to 120 m wide, 30 to 100 m walls); wall height is measured from the ground under the pilot so flat ground reads 0 at any AGL |
| `SCORING.nearMiss.*` | none | within 6 m, above 40 m/s, rearm 20 m, cooldown 4 s, grace 3 s, 300 base, floor 0.3, cap 3,000 | one stamp per pass; 90 over open ground, about 190 in the gully, 300 in a closed gap |
| `QUICK_COUNTDOWN_S` | 2.7 (3 x 0.9) plus gates | 0.6 | long enough that the cut and the GO register, short enough to read as a restart |
| mobile `dynamicResolution`, `minRenderScale`, `maxRenderScale` | fixed scale 1 | on, 0.6, 1.0 | 1.0 is the Stage 7b canvas (1.2 held only 57.9 fps on the Mali-G78); 0.6 is where texture starts to read as mud |
| desktop presets (low, medium, high) | fixed scale 1 | unchanged (off, 1, 1) | not shown to help on the 4060 |
| `DynamicResolution` constants | none | step 0.1, smoothing 0.5 s, over 1.15 x and on target 1.05 x of 16.7 ms, down hold 0.5 s, up hold 4 s (back-off to 64 s, reset after 120 s), min interval 1 s, futile if under 5% gain then 60 s blocked (to 480 s) | the brief's once-a-second limit, a slow upward probe because a vsynced frame hides headroom, and a revert for caps the pixels cannot help |
| `MAX_TARGET_SETS` (PostStack) | n/a (one set, reallocated) | 8 | five dynamic levels, the results canvas, slack |
| HUD proximity bar | `k = (40 - agl) / 40` under 40 m at 35 m/s | `tracker.proximityMeter` | follows the new rule: closeness weighted by narrowness |
| `SCORING_HINT` | `POINTS: FLY LOW AND FAST PAST ROCK. LAND IN A GREEN RING FOR THE BONUS.` | `POINTS: FLY FAST AND CLOSE TO ROCK, NARROW GAPS PAY MOST. LAND IN A GREEN RING.` | still true, and now says what the score rewards |

## Known issues and deferred items

- **The scripted pilot cannot fly the Platteklip gully** (a 40 degree gully with a 5 m DEM floor; every variant crashes at the east rim 7 to 13 s in), so the gorge versus open-slope proof is the kinematic `ghost` mode on the real DEM plus the unit tests on a synthetic gorge, not a flown run. A human, or a better terrain follower, should fly the gully and report the tally. Stage 6 / owner.
- **The gully is shallow in this DEM** (peak narrowness 0.73, mean about 0.3), so the narrowness term pays 3 to 4 times open ground there rather than the 10 times a slot would give. If testers find the multiplier too gentle, raise `riskSpan` or shrink the side samples; both are one line.
- **Phone frame rates and heat are the owner's check.** The controller's behaviour is verified with a synthetic phone through the real game; no real phone ran this build. The signal is the frame interval, so on a 60 Hz display it cannot see headroom (it probes up every 4 s to 64 s) and a 120 Hz display reads as endless headroom (it holds the ceiling, 1.0).
- **Dynamic resolution applies to the scene and bloom chain only**, through the post stack. If the post stack were ever disabled (`PostStack.enabled`, never done in the game) there would be no dynamic resolution.
- **Restart when the terrain is unsettled at the press** (a phone mid-stream, 3 builds a frame) takes the full countdown, as briefed. On a slow phone this may be common during the first minute; the overlay's `settled | busy` shows it. A softer rule (settled for the exit pose after the first frame) is the follow-up if testers still wait.
- **`low-line.ts` is stale** (see above) and is superseded by `risk-probe.ts`; left in place.
- **Expert 15,000 and first-time 5,000** are estimated from probe pieces, not played.
- A hidden pane throttles to 1 to 30 fps; every frame rate in this report is therefore either a game-time figure or a GPU or CPU time.

## Decisions made

- **Quick countdown is one `GO!` for 0.6 s**, not a short 3-2-1: the player already knows the line, the warm-up keeps streaming during it, and the GO beep still sounds.
- **Quick restart is decided at the press**, from the terrain's own `isSettled()`, the sampler, the preload and the shader flag, before `beginWarmup` clears the flag. A retry from `highScores` counts (it is JUMP AGAIN); `intro`, `title` and `exitSelect` never do.
- **Shaders are not recompiled on a quick restart**; the full path still recompiles (cheap, programs are cached).
- **Dynamic scale rides on the post stack**, not the canvas pixel ratio: the canvas stays at 1 CSS px per pixel, HUD and menus stay sharp, and the results screen's 0.75 canvas scale composes with it by multiplication.
- **Steps are 0.1 both ways** so the post stack can cache and prepare exactly five sets (1.0, 0.9, 0.8, 0.7, 0.6).
- **A down step that buys nothing is reverted** (found in the pane: a 30 Hz-capped display drove the scale to the floor in 3.6 s with the GPU idle at 3 ms).
- **Near-miss points go into `RunResult.proximityScore`** rather than changing a frozen type; noted above and in `scoring.md`.
- **Near misses and the pass rule** need a terrain sampler; without one (old unit tests, headless callers) proximity falls back to AGL alone at narrowness 0 and no near misses are scored.
- **`RunController` always passes its terrain**, so the game and every probe use the new scoring.
- The gh CLI's active account was already ToastSeagers at the start; it was left as found.

## Suggested next step

Orchestrator: Gate 9 with the pane visible (restart feel at 60 fps, `res` in the overlay on the emulated phone), then merge. Owner: fly the phone build with `?dev=1`, send a screenshot 30 s in (the overlay shows `res` and `settled`), and fly the Platteklip gully once at low height for the near-miss stamps and the tally.
