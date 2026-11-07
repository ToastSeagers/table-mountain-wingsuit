# Look and feel

Owner: Stage 4 (UI), Stage 5 (post-FX, audio), Stage 2 (world lighting). One sentence: **a late-afternoon Cape Town, rendered cinematic, watched through a 1987 sports game's television.**

## 1. The two layers

**The world** is modern and sincere. Real terrain, real colours pushed toward golden hour, haze over the Atlantic, long shadows across the Apostles, film grain and a gentle vignette. No pixelation of the 3D view. The world must look like a place you would want to fly over.

**The chrome** is retro and affectionate. Everything the game draws in 2D (title, menus, HUD, results, high scores, countdown, bonus stamps) uses a pixel font, a limited palette, hard edges, big chunky panels, and the event-select energy of California Games and Skate or Die. Scanline overlay only on the 2D layer and the replay, never on live flight.

The contrast between the two layers is the identity. Keep them distinct.

## 2. Palette (chrome)

Six colours, from the Cape Town evening sky and the old EGA/Amiga sports games:

| Token | Use | Hex (start) |
|---|---|---|
| `--c-ink` | Panel backgrounds, text on light | `#1b1230` |
| `--c-paper` | Panel fills, text on dark | `#f4e9d2` |
| `--c-sun` | Primary accent, highlights, selected items | `#ffb347` |
| `--c-coral` | Secondary accent, warnings, bonus stamps | `#ff5e5b` |
| `--c-sea` | Tertiary, HUD readouts | `#3fb8c9` |
| `--c-fynbos` | Success, landing zone markers | `#7fb069` |

Panels: 4 px hard borders, 2 px inner highlight, no rounded corners, drop shadow offset 6 px with no blur.

## 3. Type

- Display and UI: a pixel font from Google Fonts chosen in Stage 0 (Press Start 2P is the safe pick; Silkscreen is lighter and reads better small). Self-host the woff2.
- Numbers in HUD: same pixel font, tabular, with a one-pixel dark outline so it reads over bright sky.
- Body copy in blurbs and settings: the same pixel font at a readable size, line height 1.6, maximum 50 characters per line. Nothing else; mixing in a modern sans breaks the chrome.

## 4. World look (Stage 1 grading, Stage 2 lighting, Stage 5 post)

- Time of day: fixed golden hour, sun at about 15 degrees elevation in the west-north-west (azimuth 290). Long shadows down the Apostles, Camps Bay lit from the sea side.
- Imagery grading in the pipeline: lift shadows slightly, warm the midtones (+8 toward orange), desaturate greens 15 percent (satellite greens read neon), add a touch of blue to the sea. Target a frame that looks like a well-exposed photo, not a map.
- Renderer detail blend: steep slopes get a rock detail normal and a cooler tint; gentle high ground gets a fynbos noise; beaches get a bright sand tint. Scale the detail with altitude of the camera so it is strong on the deck and gone at the exit.
- Fog: height fog, denser below 200 m, warm grey-blue, hiding the far AOI edge. Horizon haze over the sea.
- Sky: gradient with a sun disc and a warm band near the horizon; a few stationary high clouds as a texture. The tablecloth cloud is on the roadmap.
- Post stack (Stage 5): filmic tonemap, slight warm LUT, grain 0.035, vignette 0.3, bloom only on sun and sea specular, sun shafts at low opacity, chromatic aberration scaling with airspeed above 55 m/s.

## 5. Screens

**Title.** The world camera drifts slowly around the Table at golden hour behind a big pixel logo "TABLE MOUNTAIN WINGSUIT". Menu: JUMP, HIGH SCORES, SETTINGS. Disclaimer line small at the bottom. Attract mode: after 30 s idle, play the best stored replay.

**Exit select.** A stylised overview map of the AOI (from `overview.webp`, posterised to the palette) on the left with three pins; three event cards on the right in the California Games style, each with a chunky illustration (a posterised screenshot from the exit camera), name, difficulty stars, your best score. Locked cards show a padlock and "FLY THE TABLE FIRST".

**Intro.** 6 to 8 second flyover along `ExitDefinition.intro.cameraPath`, ending at the ledge behind the player. Skippable.

**Countdown.** "3 2 1 GO" in the pixel font, each number with a drum hit. On GO the player is already falling; the first input is live.

**HUD.** Four readouts in the corners (airspeed, AGL, glide, time), a thin proximity line indicator bottom centre, bonus stamps slide in from the right and out again. Deploy warning under 160 m: the AGL readout turns coral and pulses with the beeps.

**Pause.** Dim the world, panel with RESUME, RESTART, SETTINGS, QUIT.

**Results.** Replay plays full screen with the VHS overlay (toggle). Over it, a panel tallies: DISTANCE, AIR TIME, PROXIMITY, LANDING, BONUSES, TOTAL, each with a counting tick. Then JUMP AGAIN, CHANGE EXIT, SAVE REPLAY (later). Crash: cut to black, thud, "WIPEOUT" card with the coral palette, then the same tally.

**High score entry.** Three-letter initials, arrow keys or stick to spin letters, the classic way.

**Settings.** Audio sliders (master, world, UI), quality preset, VHS overlay on/off, invert pitch, gamepad detected indicator, attribution text, version.

## 6. Motion and feel rules

- Every 2D element moves in steps (8 px) or snaps; no eased tweens on the chrome. Panels pop in over two frames.
- The 3D camera is smooth: a chase cam with 0.25 s position lag and 0.12 s rotation lag at trim, tightening with speed. FOV from 70 at trim to 85 at max dive.
- Camera shake only above 60 m/s and in the opening shock. Small.
- Respect `prefers-reduced-motion` for the chrome and offer a camera shake off toggle.

## 7. Audio direction (Stage 5)

- World: wind is the main instrument. Filtered noise that opens up with speed, with a low rumble under 20 m AGL. Canopy opening is a sharp snap then quiet. Landing thud by surface.
- UI: short chiptune blips and a four-bar title loop in the Amiga sports game style. The high score fanfare is the only long sound.
- No voice, no music during flight. The silence after the opening is the point.
