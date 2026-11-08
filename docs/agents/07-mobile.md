# Agent brief 07 — Mobile Engineer (Stage 7, v0.2)

**Recommended settings:** Sonnet 5.5, effort high, permission mode auto, fresh session in the main checkout. Raise to Opus only if the shader fallback work (section "Rendering on phones") turns into real debugging on a device.

**Depends on:** v0.1.0 on `main` (all of Stages 0 to 6). **Runs alone**; nothing else writes to the repo during this stage.

**Owns:** `src/core/` (touch input), `src/ui/` (touch targets, on-screen buttons, type scale), `src/world/WorldSettings.ts` presets (one new preset), a small `src/world` fallback fix if a device needs it, `docs/status/stage-7-*`. Does not touch `src/flight/`, scoring, or `src/types/`.

## Mission

Make the game playable on a phone held in landscape, with one thumb steering and one thumb on a pull button, at a frame rate that does not stutter on a mid-range device. No tilt controls in this stage.

## Owner's control design (decided 2026-11-08)

The owner wants steering by touch position, not by tilting the phone:

1. **Drag to steer (primary).** One finger anywhere on the left two-thirds of the screen acts as a virtual stick anchored where the finger lands. Horizontal offset from the anchor maps to bank (`roll` in -1..1, full at about 25 percent of screen width, with a small dead zone). Vertical offset maps to pitch (`pitch`, drag down to dive and up to pull up, respecting the existing invert setting). Release returns both to zero; the flight model's auto-level does the rest. Apply the same 120 ms low-pass used for keyboard axes.
2. **Tap-and-hold to steer (coarse).** A touch held still on the left or right third of the steering area without dragging banks that way at about 0.6 after a 120 ms hold, so a player who never discovers dragging can still fly. A touch that moves becomes a drag; a short tap does nothing in flight.
3. **Pull button.** A large button in the bottom-right corner, labelled PULL in the pixel font, at least 72 CSS px. Tapping it deploys. After deploy its label becomes FLARE and holding it flares (the model needs a fresh press after deploy, which a tap-then-hold gives naturally). A smaller BRAKE button sits above it under canopy only.
4. **Pause** is a small button top-left. **Camera** cycles on a small button top-right. Both are 44 px minimum.
5. **Menus** work by tapping. Cards and menu rows are tap targets of at least 44 px; swiping left or right on the exit select changes the selected card; the initials entry gets up and down arrows per letter. The title's "press any key" also accepts a tap.
6. **No tilt** in this stage. Leave a clearly marked hook so tilt can be added later as an option in settings.

## Rendering on phones

7. **Mobile preset** in `WorldSettings`: render scale 0.6 to 0.7 of device pixels, `maxTerrainTriangles` 200k, `lodErrorPx` 4, `maxResidentTextureTiles` 16, post stack with tonemap, grade and vignette only (no bloom, shafts or aberration), shadows off. Auto-select it when `navigator.maxTouchPoints > 0` and the screen's shorter side is under 900 CSS px; the user can override in settings.
8. **Fallbacks.** Test the renderer with `OES_texture_float_linear` and `EXT_clip_control` forced off (add a `?nofloat=1&noclip=1` dev switch that hides the extensions) and fix any depth or normal artefacts you see, since many mobile GPUs lack them.
9. **Type scale.** The headline (`LOADING TERRAIN`, title logo, results heading) must not wrap or overlap at 375 px wide; scale the display sizes with `clamp()`.
10. **Landscape.** Show a rotate prompt in portrait during flight; menus may stay portrait-friendly. Use the `:root` safe-area insets so buttons clear notches.
11. **Data.** Keep the existing tiles; measure time to title on a throttled 4G profile (about 10 Mbps) and report it. If over 15 s, add a half-resolution texture set for the mobile preset (Stage 1 tooling, `build.py --textures-only` with a smaller tile size) as a follow-up, not in this stage.

## Verification

- The in-app browser's mobile viewport emulates touch points and a phone screen but not a phone GPU. Use it for layout, touch handling and the autopilot run. Report GPU numbers from it as desktop numbers.
- Ask the Orchestrator for the owner's real-phone overlay screenshot (`?dev=1&auto=1&exit=the-table` on the phone prints fps, GPU ms and extension support). Tune the mobile preset against that device.
- Unit tests for the touch mapping (anchor, dead zone, saturation, hold-to-bank timing, release to zero) and for preset auto-selection.

## Gate 7 (checked by the Orchestrator)

- [ ] A complete run from title to high score using only touch in the emulated phone viewport, with no console errors.
- [ ] Drag steering, hold-to-bank, PULL then FLARE, BRAKE, pause and camera all work by touch.
- [ ] Headline and panels fit at 375 px wide without wrapping or overlap.
- [ ] Mobile preset auto-selects on a touch device and can be overridden.
- [ ] Renderer shows no depth or lighting artefacts with both extensions forced off.
- [ ] On the owner's phone: steady frame rate during a flight (owner reports), time to title under 15 s on Wi-Fi.
- [ ] Desktop play unchanged: keyboard, mouse and gamepad still work, 60 fps on the reference laptop.

## Kickoff prompt (paste into a new Sonnet 5.5 session, effort high, auto mode, main checkout)

```
You are the Mobile Engineer for Table Mountain Wingsuit. Read CLAUDE.md, PLAN.md, docs/01-architecture.md, docs/03-handoff-protocol.md, docs/design/look-and-feel.md, docs/status/STATUS.md, docs/status/release-v0.1.md, docs/status/stage-4-report.md (input and UI structure), docs/status/stage-5-report.md (post stack presets) and your brief docs/agents/07-mobile.md. Then read src/core/InputManager.ts, src/core/inputMapping.ts, src/ui/Screen.ts, src/ui/HudScreen.ts, src/world/WorldSettings.ts and src/game/Game.ts so you build on their real APIs. Create branch stage-7-mobile from main. Implement the owner's touch control design exactly as the brief describes (drag virtual stick, hold-to-bank, PULL then FLARE and BRAKE buttons, pause and camera buttons, tappable menus, swipe on exit select, no tilt), the mobile quality preset with auto-selection, the forced-off extension switch and any fallback fixes it reveals, the responsive type scale and landscape prompt, and unit tests for the touch mapping and preset selection. Verify a full touch-only run in the in-app browser's mobile viewport and keep desktop controls and 60 fps intact. Keep npm test, lint, typecheck and build green. Commit as you go. Write docs/status/stage-7-report.md from the template with phone-width screenshots, append one line to docs/status/STATUS.md, then stop. Do not push.
```
