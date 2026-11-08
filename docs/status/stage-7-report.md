# Stage 7 report — Mobile (v0.2)

**Agent:** Mobile Engineer · **Model/effort:** Sonnet 5.5 / high · **Branch:** stage-7-mobile · **Date:** 2026-11-08

## What was built

- **Touch steering** (`src/core/touchMapping.ts`, pure and DOM-free): a drag virtual stick anchored where the finger lands on the left two thirds, roll from horizontal offset and pitch from vertical offset (drag down dives, drag up pulls up, the invert setting flips it), dead zone 12 percent, full at 25 percent of the screen width, release to zero. A still hold of 120 ms on the left or right third of the steering area banks at 0.6; a touch that moves more than 10 px becomes a drag; a short tap does nothing. Fed through the same 120 ms low-pass as the keyboard in `InputManager.readRaw`. A marked `TILT HOOK` comment sits in `readRaw` and in `touchMapping.ts`; no tilt code.
- **On-screen controls** (`src/ui/TouchControls.ts`): PULL (at least 72 px, bottom right) that becomes FLARE after deploy, BRAKE above it under canopy only, pause (top left) and camera (top right), all 44 px or larger, a ring and knob showing the steering finger, and the rotate-to-landscape prompt. A tap shorter than one simulation step still counts as a press (`TouchButtons.consume`).
- **Touch-first UI**: `body`/`html` get `touch-ui` on a phone or `?touch=1`. Menu rows, settings rows, arrows and scores tabs are 44 px targets; exit select shows one card with swipe left/right, arrows, dots, a BACK button and a tappable line picker; initials entry has up and down arrows per letter and an OK button; a tap skips the intro and wakes or ends the attract replay; the countdown cheat sheet and HUD prompts have touch wording.
- **Mobile quality preset** (`Game.ts` `QUALITY.mobile`, `PostStack` `mobile`, `WorldSettings.renderScale`), auto-selected by `src/core/device.ts` when `maxTouchPoints > 0` and the screen's shorter side is under 900 CSS px; the settings QUALITY row now cycles AUTO, LOW, MEDIUM, HIGH, MOBILE (`qualityAuto` flag, so a choice sticks and AUTO follows the device again).
- **`?dev=1&nofloat=1&noclip=1`** (`src/world/hideExtensions.ts`, installed first in `main.ts`, dev only): hides `OES_texture_float_linear` and `EXT_clip_control` from the WebGL context.
- **Phone layout**: root font size limited by width as well as height, `clamp()`/`min()` display sizes for the logo, wait banner, intro name and wipeout card, fluid panel widths, tight short-landscape rules, `viewport-fit=cover` and safe-area insets on the corner buttons and HUD, a rotate prompt in portrait during countdown and flight (the countdown holds and flight auto-pauses behind it).
- Open first: `src/core/touchMapping.ts`, `src/core/InputManager.ts`, `src/ui/TouchControls.ts`, the Stage 7 block at the end of `src/ui/ui.css`.

## How to run and verify

```
npm run dev            # then open http://localhost:5173/?touch=1 on a desktop to see the touch UI
npm test && npm run lint && npm run typecheck && npm run build
```

- On a phone: open the site; the preset and touch controls auto-select. Add `?dev=1&auto=1&exit=the-table` for the overlay and the autopilot run. `?touch=1` forces the touch UI on any device (mouse clicks and drags then act as a finger).
- Extension fallbacks: `?dev=1&nofloat=1&noclip=1`; the overlay line shows `logarithmic` depth and the console warns that normals will be faceted.
- Screenshots are in `docs/status/stage-7/`.

## Device section: owner's phone (from the Orchestrator, before the preset was tuned)

Android Chrome, Mali-G78, portrait viewport 360x643 CSS px, live v0.1 site, `?dev=1&auto=1&exit=the-table`: 60.0 fps, 16.66 ms frame, p95 16.70 ms, cpu 3.09 ms, GPU ms column cut off, 23 chunks, 20/20 height tiles, 31 texture tiles resident, 18.7 MB fetched, AGL 171 m at 0:11. That is the default (medium) preset at 1 CSS px per pixel, so it already held 60 fps. I therefore loosened the mobile preset from the brief's starting values for thermal headroom, not raw fit (see Tuning changes). No mobile-preset numbers from the phone yet: **the owner should run `?dev=1&auto=1&exit=the-table` once more on this branch's build and send the overlay**.

## Gate results

- [x] Complete run title to high score with touch only in the emulated phone viewport, no console errors. Taps (real clicks in the phone emulation) took the title, JUMP, exit card, intro skip, countdown and flight start, then results, NEW HIGH SCORE, initials via the letter arrows ("BAZ") and OK to the scores table. See the caveat under Known issues about how the in-flight inputs were produced.
- [x] Drag steering, hold-to-bank, PULL then FLARE, BRAKE, pause and camera all work by touch (measured below).
- [x] Headline and panels fit at 375 px wide (portrait) and in 812x375 landscape without wrapping or overlap (screenshots).
- [x] Mobile preset auto-selects on the touch emulation (quality `mobile`, AUTO, pixel ratio 1.2 at DPR 2, 300k triangles) and can be overridden (settings row, persisted; AUTO restores it). Unit-tested.
- [x] No depth or lighting artefacts with both extensions forced off (below).
- [ ] On the owner's phone: steady frame rate and time to title. Needs the owner (see Device section). Time to title is computed, not measured.
- [x] Desktop play unchanged: keyboard (D banks 57.9 degrees, Space deploys), 60.0 fps and 16.67 ms frame in flight on the RTX 4060 at 757x846. Mouse pointer lock and gamepad code paths are untouched (`mapGamepad`, `MouseStick` and pad polling are not edited; pointer lock is skipped only when the touch UI is on). Not tested with a physical gamepad or pointer lock.

Measurements from the emulated phone (landscape 812x375 with `?touch=1`; the in-app browser's real phone emulation is portrait only):

| check | result |
| --- | --- |
| hold left third 0.5 s | mode `hold`, roll target -0.6, bank -15.5 degrees; release returns target to 0 |
| drag 180 px right, 60 px down | roll 0.87, pitch -0.20 (dive), bank +20 degrees |
| tap PULL (real click) | wingsuit to deploying to canopy, label PULL to FLARE, BRAKE appears |
| hold BRAKE 2 s under canopy | sink 7.6 to 1.05 m/s |
| steer by drag only, The Table to Camps Bay | reached 69 m from the zone centre at 160 m AGL |
| full touch flight (drag, PULL, hold BRAKE, hold FLARE at 3.5 m) | landed in `camps-bay-beach`, 7,636 points |
| pause and camera buttons | pause screen up and touch controls hidden; camera toggled |
| portrait during countdown | rotate prompt shown (verified); the countdown hold and the flight auto-pause are code paths I did not exercise in the browser |

Extension fallback check (`nofloat=1&noclip=1` against the normal build, four measurement views, same page size, after terrain streaming settled): mean absolute pixel difference 1.6 to 1.9 of 255 and at most 0.07 percent of pixels differing by more than 40, which is film grain and sea glint. Depth mode switched to `logarithmic` and normals fell back to the faceted path with a console warning; nothing needed fixing. One forced-off view: `docs/status/stage-7/forced-off-nofloat-noclip-view2.jpg`. This is a desktop GPU with the extensions hidden by software, not a phone GPU, so a real device may still differ.

Time to title (not measured on a throttled profile; the in-app browser has no throttling control). From the production build: JS 0.2 MB gzipped, CSS 5 KB, font 10 KB, `meta.json` 2 KB, then the title waits for `overview.webp` (0.84 MB), about 1.1 MB in all, so roughly 1 to 2 s on 10 Mbps. The scene behind the title is then filled by streaming: all 20 height tiles (10.5 MB) plus the resident texture tiles (8.2 MB seen on first load), about 19 MB, which is about 15 s at 10 Mbps for a fully populated title scene. The title is usable far sooner but terrain pops in. If the owner finds the pop-in slow, the follow-up the brief names (half-resolution texture set for the mobile preset) applies; not done here.

## Interface or shared-file changes

- `src/game/Game.ts` (not in my folders): wiring for touch controls, preset table with `mobile`, auto quality, tap to skip, portrait pause. Needed because the Game owns input and presets.
- `src/fx/PostStack.ts`: `mobile` post preset and a `PostPreset.off` list (tonemap, grade, vignette stay; bloom, shafts, aberration, grain forced off).
- `src/world/World.ts`, `src/world/WorldSettings.ts`: `renderScale` (default 1, so no desktop change); new `src/world/hideExtensions.ts`.
- `src/main.ts` (switches), `index.html` (viewport meta: `viewport-fit=cover`, no pinch zoom).
- `src/core/Settings.ts`: `QualityPreset` gains `'mobile'`, `Settings` gains `qualityAuto`. Saves from v0.1 still load; a v0.1 save with a non-default preset counts as a choice. `src/types/`, `src/flight/` and scoring untouched.

## Tuning changes

| constant | old | new | why |
| --- | --- | --- | --- |
| mobile preset maxTerrainTriangles | (brief 200k) | 300,000 | owner's Mali-G78 held 60 fps on medium at 560k; headroom for throttling, not fit |
| mobile lodErrorPx | (brief 4) | 3 | same |
| mobile maxResidentTextureTiles | (brief 16) | 24 | same |
| mobile render scale | (brief 0.6 to 0.7) | 0.8 of a pixel ratio capped at 1.5, so 1.2 CSS px per pixel at most | the phone held 60 fps at 1.0; 1.2 is sharper and still well under the desktop pixel count |
| mobile post | (brief) | tonemap, grade, vignette; 2x MSAA; no bloom, shafts, aberration or grain | per brief |
| low/medium/high | unchanged | now also set `maxPixelRatio: 1, renderScale: 1` explicitly | so switching away from mobile restores them |

The phone numbers will decide whether to move scale or triangles; each is one line in `QUALITY.mobile`.

## Known issues and deferred items

- **How the in-flight touch inputs were produced.** The in-app browser sends clicks as mouse events and has no multi-touch or press-and-hold. Menu taps, the PULL tap, the arrows and the swipe were real clicks and drags. Held steering, hold-to-bank, BRAKE and FLARE holds were synthetic `PointerEvent`s (pointerType `touch`) on the canvas and buttons, with the animation loop frozen and driven by `__tmw.advance`, through the same listeners. A real thumb on a real phone is the remaining check; the owner's session covers it.
- The emulation reports `navigator.maxTouchPoints` as 0 (it does expose `ontouchstart` and a coarse pointer), so `readDeviceEnv` also treats coarse pointer plus `ontouchstart` as touch. Real phones report the real count. The mobile preset test with a real touch count is a unit test, not a device check.
- The emulated phone is portrait only (375x812), so landscape layouts were checked with `?touch=1` at 812x375, which does not pass the phone gate for auto-select.
- Landing needs BRAKE then a late FLARE (hold FLARE in the last 3 to 4 m). A first-time touch player may flare early; the HUD says "HOLD BRAKE, FLARE LOW". Worth a playtest note, not changed (flight model is out of scope).
- Sun glint column on the sea is prominent at phone aspect ratio (owner's note); not changed here, belongs with a Stage 5 look pass.
- Not done: tilt (hook only), safe-area on a device with a notch (CSS uses `env()` but nothing tested with a real inset), the half-resolution texture set, audio on a phone speaker, orientation lock (browsers only allow it in fullscreen).
- `dist/` still ships the full desktop terrain set.

## Decisions made

- Drag down dives, drag up pulls up, as the brief says; this is the opposite of the pointer-lock mouse (down pulls up). The invert setting flips both.
- "Third of the steering area" is measured on the 2/3 steering area (so the left third is x under 2/9 of the screen, the right is 4/9 to 6/9); the middle third does nothing on a still hold.
- Hold-to-bank turns into a drag when the finger moves more than 10 px at any time; a drag never goes back to hold.
- On a touch-first device a mouse pointer counts as a finger (emulators, Bluetooth mice). A finger on a hybrid laptop turns the touch UI on for the session.
- Mobile cap is a settings value, not a hard device rule: the player can pick any preset, including MOBILE on a desktop for testing.
- Exit select on touch shows one card; tapping the card jumps, because a separate JUMP button would add a step.
- The initials screen gains an OK button on all devices (it is harmless on desktop).
- Rotating to portrait pauses a flight (not abort); the countdown simply waits.
- Pixel-font text sizes stay in `rem`; the root size gets a width limit so panels never exceed the viewport.

## Suggested next step

Orchestrator: merge after the owner runs the autopilot URL on the phone with this build and confirms steady fps on the MOBILE preset, plus one hand-flown touch run. If fps is low, drop `renderScale` to 0.65 first, then triangles. After that, a playtest of the landing on touch and the half-resolution texture follow-up if title loading feels slow.
