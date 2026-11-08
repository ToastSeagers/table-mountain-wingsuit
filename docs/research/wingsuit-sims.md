# Research note: other wingsuit games and sims, and what to take from them

Written 2026-11-08 after v0.2.0-alpha.2 shipped. Sources were read by the Orchestrator and two research subagents; where a claim rests on a reviewer's inference rather than a developer statement it says so. Ideas only: none of the code below may be copied (Volo Airsport is GPL-3.0, which is incompatible with this repository's MIT licence; the arcade prototype's licence is a PDF we did not read).

## 1. The field

| Project | What it is | Why it matters to us |
|---|---|---|
| **Volo Airsport** (Ramjet Anvil, Unity, 2013 to 2017, open-sourced 2020, GPL-3.0) | The most serious wingsuit and BASE sim made: full-body physics, pose drives lift and drag, Alps terrain, VR | The flight-model reference, and the clearest cautionary tale about building a sim without a game around it |
| **Wingsuit Arcade Prototype** (same developer, 2011 jam, source released 2020) | One-week arcade take: Wing and Controller scripts, third-person camera, a Score folder | The same author's own simplification of the sim |
| **Superflight** (Grizzly Games, 2017, PC, 96 percent positive on Steam) | Procedural low-poly mountains, one steering input, proximity scoring, instant restart, seed sharing, Zen mode | The best-liked proximity scoring loop in the genre, and its best-documented weaknesses |
| **Steep** (Ubisoft, 2016) | Open-world Alps; wingsuit steered with one stick, third person with first-person and GoPro cameras | Mass-market proof that one-stick steering plus a camera choice is enough |
| **Skydive: Proximity Flight** (2013, consoles, Metascore 62) | Trick-based proximity flying with motion controls | What not to do: tricks over flight, thin content, finicky input |
| **Laya's Horizon** (Snowman for Netflix, 2023, mobile) | Wingsuit-cape gliding with a two-thumb touch scheme, praised once learned | The only mobile flying game whose touch controls reviewers single out as good |
| **OpenSkyFlight** (jeanjerome, 2025 to 2026, Three.js WebGPU, MIT) | Browser flight sim over real terrain tiles, quadtree LOD, dynamic resolution, built-in benchmark | Our closest engineering cousin; its performance tooling is directly reusable in spirit |
| Wingsuit Ride, Base Jump Wing Suit Flying, Wingsuit Stickman (mobile) | Casual tilt or one-touch wingsuit games | Confirm that tilt is common, and that reviewers find it imprecise once wind or terrain gets involved |

Academic and measured data: skilled pilots hold about 2.5:1 to 3:1 glide in modern suits, the record is around 4:1, lift coefficient is close to linear in angle of attack, and CFD tends to underestimate drag. Our trim glide of 3.0 and best glide of 3.4 sit at the generous end of real numbers, which is the right place for a game.

## 2. Lessons, in order of importance for us

### 2.1 A sim needs a hook (Volo)

Volo's developer, closing the project in 2017, wrote that the team "spent too much time focusing on the details of the simulation model" and that without a game framework "it didn't really have a hook." A player in the same thread asked for Pilotwings-style challenges, flags and landing zones. We already have exits, landing zones, style bonuses and a high-score table, which is more structure than Volo ever shipped. The lesson is to keep adding light structure rather than physics depth: per-exit challenges with medals (land on the Glen, through the gorge, under 60 seconds), not a more accurate suit.

### 2.2 Score risk, not time (Superflight)

Superflight's loop is loved, but its best-documented criticism is that the multiplier rewards time spent near a surface, so the optimal strategy is to skim safely along the outside of rock masses and skip the risky gaps. Our proximity score is also time-integrated (seconds under 50 m at speed). Two changes keep the thrill honest:

- Weight proximity by risk: closeness times speed times a "narrowness" term from how much terrain surrounds the pilot (sample a few rays, not just the ground below), so a gorge pass is worth far more than skimming an open slope.
- Add discrete near-miss events (a stamp and a lump sum when passing within a few metres of a ridge or through a gap at speed), which Superflight pays out as bonuses and reviewers enjoy.

### 2.3 Instant restart and a Zen mode (Superflight)

Reviewers praise that a crash is "a brief interruption": restart is immediate. Our countdown warm-up (Stage 7b) is right for a cold start but must not cost a retry anything: when the player restarts at the same exit with terrain already settled, GO should be immediate. Superflight's Zen toggle hides the score and is called out as a strength; our settings should offer the same, since this project's own brief says the points are not the point.

### 2.4 One steering input is enough (Superflight, Steep, Laya's Horizon)

Every well-liked wingsuit game is steered with a single stick or thumb. Pitch control exists in ours and matters for the flight model, but a beginner assist mode where pitch auto-trims and the player only steers, with dive on a hold, would match the genre's entry point and suit touch. Keep full pitch as the default for keyboard and gamepad.

### 2.5 Input that accumulates and decays (Volo)

Volo's mouse handling accumulates pitch and roll from deltas and decays them toward zero, with a faster cancel when the input reverses. Its own code comment says the click-and-hold scheme was "too complex" and should be mode-less. Our touch drag already behaves like a stick that returns to centre; the accumulate-and-decay idea is worth trying for hold-to-bank on touch and for the mouse, and the mode-less warning supports our choice of no tap-to-arm gestures.

### 2.6 Ground effect as a feel tool (Volo)

Volo doubles dynamic pressure as the body approaches the ground over about 32 m with a squared ramp. Physically it is a stretch for a wingsuit, but as a game device it makes low passes float a little and feel more controllable, exactly where proximity happens. A capped version (1.0 to 1.3 over 20 m) is a one-constant experiment for the flight model, to be judged in play, not by the spec.

### 2.7 Speed is sold by wind and blur (Superflight)

Both Superflight reviews credit wind audio and motion blur, above anything else, for the sense of speed. We have the wind and a speed-scaled chromatic aberration; a cheap radial blur at the frame edge above about 55 m/s is the missing piece and belongs in the post stack's medium and high presets.

### 2.8 Two-thumb touch is the proven mobile scheme (Laya's Horizon)

Laya's Horizon steers by sliding each thumb up and down on its own side of the screen (left up and right down to turn), and reviewers say it is hard for a minute and then precise, including near obstacles. Our drag stick is simpler to learn; the two-thumb scheme gives finer control. Offer it later as an alternative in settings, and add a 20-second first-flight overlay that teaches whichever scheme is active, since every mobile review mentions the learning curve.

### 2.9 Tricks and motion controls do not carry a flying game (Skydive: Proximity Flight)

Its scoring was built on rolls and flips near surfaces with motion controls, and reviewers found the content thin and the input finicky. Our instinct to score the line rather than tricks is right. Do not add trick scoring.

### 2.10 Engineering lessons (OpenSkyFlight)

- Dynamic resolution scaling driven by measured frame time, which holds frame rate on weak GPUs and under heat. This is the direct answer to phone throttling and should replace our fixed mobile render scale with a floor and ceiling.
- A built-in benchmark camera path that records fps and GPU time and compares against a stored baseline, so regressions show up in a number. We have the pieces (`bench`, autopilot, overlay); formalise them as a `?bench=1` run that prints a JSON summary.
- Safari rated "very bad" for its WebGPU build. We are on WebGL2, but iOS Safari is untested and needs a run before mobile is called done.
- Its imagery is ESRI under non-commercial terms, the same situation as our City aerial photo. The pattern of a documented open fallback is the right one.

## 3. Recommendations mapped to our backlog

| Priority | Change | Where | Size |
|---|---|---|---|
| 1 | Instant restart when terrain is settled at the same exit (skip warm-up hold) | `src/game/Game.ts` countdown gate | small |
| 1 | Dynamic resolution scaling from frame time on touch devices | `src/world/World.ts`, `WorldSettings` | small |
| 1 | Risk-weighted proximity plus near-miss stamps | `src/game/Scoring.ts`, `scoring-tuning.ts`, `docs/design/scoring.md` | medium |
| 2 | Zen mode toggle (hide score and stamps) | settings, HUD | small |
| 2 | Per-exit challenges with medals, three per exit, optional | `data/challenges.json`, results screen | medium |
| 2 | Beginner assist: auto-pitch, steer only, dive on hold | input mapping, flight model wrapper | medium |
| 2 | First-flight tutorial overlay (20 s, per control scheme) | `src/ui/` | small |
| 2 | Radial speed blur in the post stack | `src/fx/PostStack.ts` | small |
| 3 | Ground-effect float, capped, judged in play | `src/flight/tuning.ts` | small, needs a human |
| 3 | Two-thumb touch scheme as an alternative | `src/core/touchMapping.ts` | medium |
| 3 | `?bench=1` benchmark run with JSON summary and baseline | `src/world/PerfOverlay.ts`, tools | small |
| 3 | iOS Safari test pass | owner or a borrowed iPhone | human |

## 4. Sources

- Volo Airsport repository: https://github.com/mzandvliet/VoloAirsport (GPL-3.0; aerodynamics under `Assets/Plugins/RamjetAnvil/Aero/Scripts/Physics/Aerodynamics`)
- Volo "Goodbye, Volo" devlog, 2017: https://ramjetanvil.itch.io/volo-airsport/devlog/2064/goodbye-volo
- Volo open-source announcements: https://ramjetanvil.itch.io/volo-airsport/devlog/207644/volo-is-now-open-source and https://ramjetanvil.itch.io/volo-airsport/devlog/1624510/volo-open-source-update
- Wingsuit Arcade Prototype: https://github.com/mzandvliet/WingsuitArcadePrototype and https://ramjetanvil.itch.io/wingsuit-arcade-prototype/devlog/199463/source-code-on-github
- Superflight: https://store.steampowered.com/app/732430/SUPERFLIGHT/ , https://pixelpoppers.com/review/superflight/ , https://antlionaudio.com/blogs/news/come-fly-with-me-superflight-review
- Steep: https://gamesbeat.com/how-ubisoft-built-a-mountain-and-then-created-a-video-game-around-it/ , https://www.redbull.com/ca-en/ubisoft-steep-interview-red-bull-games
- Skydive: Proximity Flight: https://www.gamerevolution.com/review/63805-skydive-proximity-flight-review , https://gamecritics.com/kristin-renee-taylor/skydive-proximity-flight-review/
- Laya's Horizon: https://9to5mac.com/2023/05/02/layas-horizon-flying-adventure-review/ , https://adrianhon.substack.com/p/layas-horizon , https://en.wikipedia.org/wiki/Laya%27s_Horizon
- OpenSkyFlight: https://github.com/jeanjerome/OpenSkyFlight (MIT)
- Mobile wingsuit games: https://www.appspy.com/wingsuit-stickman/review/ , https://apps.apple.com/app/id6443847213 , https://apps.apple.com/us/app/id1545112621
- Wingsuit aerodynamics: https://www.xsens.com/cases/wingsuit-flight-analysis-using-mti-g , https://ntnuopen.ntnu.no/ntnu-xmlui/handle/11250/234388 , https://erau.edu/research-and-innovation/projects/wingsuit-aerodynamic-performance-measurement-and-design-improvements
- Terrain techniques: https://techblog.geekyants.com/recreating-real-world-terrain-with-react-threejs-and-webgl-shaders , https://discourse.threejs.org/t/mini-flight-simulator-over-static-3d-terrain/40428
