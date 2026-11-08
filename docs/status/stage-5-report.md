# Stage 5 report — Audio and post-FX

**Agent:** Audio and Post-FX Engineer · **Model/effort:** Sonnet 5.5 / medium · **Branch:** stage-5-audio-fx · **Date:** 2026-11-08

## What was built
- `src/audio/`: `AudioEngine` (context unlock on first key, click, touch or pad; master, world and UI buses; limiter; reads and follows the persisted `masterVolume`, `worldVolume`, `uiVolume`), `Wind`, `Altimeter`, `Canopy`, `UiSounds` (including the four-bar title loop), and `GameAudio`, which wires them to `Game.bus` and the per-frame flight state. Everything is synthesised with oscillators and noise: 0 bytes of audio assets.
- `src/fx/PostStack.ts`: HDR scene target, bright pass and mip chain, one composite shader (chromatic aberration, bloom, sun shafts, ACES, warm grade, sRGB, VHS look, vignette 0.3, grain 0.035). Presets low, medium and high follow the existing quality setting.
- `src/fx/CameraEffects.ts`: opening-shock kick and FOV punch, extra FOV stretch in a full dive, reduced-motion switch-off, and `introEase` for the intro flyover. Drives `CameraRig` through three new public parameters only.
- `src/fx/ReplayDirector.ts`: shot list for `RunResult.replay` (ground cams at the closest approaches, chase and side cams cut about every 3.6 s, canopy wide, landing), skip with Tab. Used for the results backdrop and for attract mode.
- Settings: audio sliders, quality, VHS and shake rows already existed from Stage 4 and are now live. Added rows AUDIO (on / press any key) and REDUCED MOTION, and a synthesised-audio line in the attribution text.
- Tests: `src/fx/fx.test.ts` (shot list contiguity, ground cam placement, rhythm, skip, intro easing).

**Post stack: our own passes, not `EffectComposer` and not the `postprocessing` package.** The world renders with a reversed-Z depth buffer and tone mapping already tuned against Three's ACES, and the effect list is short, so one hand-written composite shader that can be toggled effect by effect was simpler and cheaper than pulling in a pass graph. No dependency was added (Three stays pinned at 0.187.0). The scene target uses a 32-bit float depth texture to keep the reverse-Z precision; close terrain and far ridges show no depth artefacts in the screenshots.

## How to run and verify
```
npm run dev      # http://localhost:5173/
```
- `?dev=1&auto=1&exit=the-table` flies a whole run. Press any key first so audio unlocks. Wind is audible in flight (master RMS about 0.05 at 41 m/s), altimeter beeps at 250, 160 and 120 m AGL then pulses under 150, canopy snap at deploy, landing thump by surface.
- Results: replay behind the panel cuts between shots; Tab skips to the next shot. Settings, VHS OVERLAY toggles the 3D VHS look and the CSS scanlines.
- Title: wait 30 s with a stored run for attract mode (any key stops it).
- Dev console: `__tmw.post.effects.bloom = false` (also `tonemap, grade, shafts, aberration, vignette, grain`) and `__tmw.post.enabled = false` for the Stage 4 look. `__tmw.audio`, `__tmw.camFx` are exposed too.
- Screenshots: `docs/status/stage-5/before-no-post.jpg` (Stage 4 render path) and `after-post-stack.jpg` (same frame with the stack).

## Gate results
| Gate item | Result |
|---|---|
| `npm test` | 182 passed (5 new) |
| `npm run lint`, `typecheck`, `build` | green |
| Medium holds 60 fps at 1920x1080 | Yes. Overlay reads 60.0 fps, 16.67 ms frame, on the RTX 4060 with the full medium stack; GPU cost below |
| Audio assets under 8 MB | 0 bytes (all synthesised) |
| No physics, scoring or game-state changes | Confirmed; Game only gained wiring |

### Frame cost, RTX 4060, Chromium in the Claude pane, 1920x1080
GPU time from `EXT_disjoint_timer_query_webgl2`, median of 90 back-to-back frames, three interleaved rounds, title-orbit view (a cheap scene, about 1.1 ms with no post). The wall clock and `readPixels` syncs were useless here because they lock to the compositor's vsync, so these are timer-query numbers. The query is noisy at this scale (the occasional 15 ms outlier was dropped by taking medians; per-effect differences of 0.1 ms are within noise).

| Config | GPU ms (three rounds) |
|---|---|
| No post (Stage 4 path, canvas MSAA) | 1.12 / 0.82 / 1.17 |
| Tonemap only | 1.40 / 1.05 / 1.31 |
| Tonemap + grade | 1.35 / 1.40 / (15.09 outlier) |
| Tonemap + vignette | 1.39 / 1.45 / 1.34 |
| Tonemap + grain | 1.42 / 1.51 / 1.51 |
| Tonemap + aberration | 1.42 / 1.44 / 1.33 |
| Tonemap + bloom (3 mips, medium) | 1.38 / 1.52 / (15.03 outlier) |
| Tonemap + shafts (10 samples) | 1.41 / 1.45 / 1.40 |
| **Full medium** | 1.41 / 1.46 / 1.40 |
| Full low | 1.43 / 1.45 / 1.18 |
| Full high (5 mips, 20 samples) | 1.49 / 1.17 / 1.19 |

Reading: the whole medium stack costs about 0.3 ms over the direct render; no single effect is above about 0.15 ms. The brief's budget is met with large headroom, but this view is light; a heavy shot (low over the Apostles) was not isolated.

### Results screen (replay behind the panel, Stage 4 reported about 7.6 ms)
Same method, 1920x1080, median GPU ms over three rounds: no post, VHS off 1.22 / 0.69 / 1.01; medium, VHS off 0.55 / 0.41 / 1.57; medium, VHS on 0.53 / 0.42 / 1.74; low 1.29 / 1.42 / 1.40; high 1.55 / 1.90 / 1.83. All under 2 ms. The 7.6 ms figure did not reproduce here: the director changes the framing (ground and side cams), and Stage 4's number may have been taken in a heavier shot or with a hidden-pane timer. Treat the replay as cheap, but recheck on the reference laptop at Gate 5.

## Interface or shared-file changes
- `src/world/World.ts`: one new public field `renderHook` and a two-line branch in `frame()` so the post stack can render the scene; default `null` leaves Stage 2 behaviour unchanged.
- `src/game/CameraRig.ts`: three public parameters (`shakeScale`, `fovOffsetDeg`, `kickM`) applied in `apply()`; defaults leave behaviour unchanged. Not a rewrite.
- `src/game/Game.ts`: wiring only (post stack, camera effects, audio, replay director, intro easing, Tab to skip a shot, two settings rows, dev hook entries).
- `src/ui/SettingsScreen.ts`: one attribution line. `docs/ASSETS.md`: audio row and attribution line.
- No frozen type in `src/types/` changed.

## Tuning changes
No change to `src/flight/tuning.ts` or `src/game/scoring-tuning.ts`. New constants live in `src/fx/PostStack.ts`:

| constant | old | new | why |
|---|---|---|---|
| `GRAIN` | none | 0.035 | Look spec section 4 |
| `VIGNETTE` | none | 0.3 | Look spec section 4 |
| `BLOOM_THRESHOLD` | none | 5 (scene-linear) | The sky's sun disc is 12x and sea glints exceed 5; sand and sky do not |
| `SHAFT_STRENGTH` | none | 0.09 | 0.22 drew a beam down the whole frame from the sea glitter |
| `CA_START_MPS` / `CA_FULL_MPS` / `CA_MAX_UV` | none | 55 / 80 / 0.0035 | Look spec: aberration above 55 m/s |

## Known issues and deferred items
- No ear-tested mix: levels were set by reasoning and one analyser reading; the Orchestrator or user should listen once (wind balance against the altimeter beeps, title loop level).
- Ground cams are placed at the closest-approach points to the terrain, but those can still be 100+ m above the ground (the exit drops steeply), so the pilot is small in those shots. A tighter pass needs a hand-flown low line (Stage 6).
- Sun shafts and bloom also pick up the sea glitter column (it is far above 5); this reads as sun glitter and is faint at 0.09.
- Reduced motion freezes shake, kick and the grain pattern; the VHS band also stops. Chrome animation already respected the media query.
- The attract replay plays silent (title loop muted); wind is not played over replays.
- The 3D VHS look and the existing CSS scanlines both follow the one VHS toggle.
- Not done: ear check on a physical headset, gamepad test, performance on the reference laptop itself (measured on the same RTX 4060 inside the app pane).

## Decisions made
- Own post passes instead of `EffectComposer` or `postprocessing`; no new dependency.
- Quality presets: low = no bloom, shafts or aberration, MSAA 2; medium = 3 bloom mips, 10 shaft samples, MSAA 4; high = 5 mips, 20 samples.
- Settings rows for sliders, quality, VHS and shake already existed, so none were duplicated.
- Volume sliders are squared into gain so mid-slider is audibly half.
- Skip-a-shot is Tab (the existing `skip` nav event); the results panel buttons are unaffected.
- Intro flyover polish is easing only (75% smoothstep, 25% linear) on the existing per-exit duration; the camera path itself is unchanged.
- Audio is synthesised only, so no sample licences were needed.

## Suggested next step
Gate 5: listen to a full run on headphones, check the 60 fps at 1080p with the overlay on the reference laptop, then Stage 6 balance and polish.
