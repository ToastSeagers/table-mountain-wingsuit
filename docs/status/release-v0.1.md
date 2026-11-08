# Release v0.1.0 — Table Mountain Wingsuit

Personal, non-commercial. Live URL (after Gate 6, the first deploy from main): https://toastseagers.github.io/table-mountain-wingsuit/

## What shipped
- Three exits (The Table, Platteklip, Lion's Head with Sea Point and Clifton headings) over real Table Mountain terrain: City of Cape Town 2 m LiDAR heights and January 2025 aerial imagery, 26.7 MB of tiles streamed on demand.
- Full loop: title, exit select, intro flyover, countdown, wingsuit, canopy, landing, results with replay, initials, high scores, pause, settings.
- Scoring with distance, air time, proximity, landing and seven style bonuses; scores, unlocks and best runs persist in the browser.
- Synthesised audio, post-FX presets (low, medium, high), replay director with a VHS look.
- Static site, no backend, deployed by GitHub Actions to GitHub Pages.

## Controls
| Input | Action |
|---|---|
| W / S (arrows) | Dive / pull up (invert in settings) |
| A / D | Bank left / right |
| Q / E | Yaw |
| Space | Deploy, then flare (fresh press) |
| Shift | Brake |
| C, R, Esc, Tab | Camera, restart, pause, skip replay shot |
| Mouse | Click the canvas to capture, move to fly, Esc releases |
| Gamepad | Stick, triggers, A, LB, Start |

`?dev=1` adds the perf overlay (P) and free camera (F2).

## Known issues
- Results-screen GPU cost was reduced with a lower render scale but not measured with the pane visible; target under 4 ms.
- Not tested: physical gamepad, mouse pointer lock, the mix on headphones, other GPUs, Firefox, Edge, and the live URL.
- Lion's Head to Sea Point is an expert stretch (best scripted run 470 m short); Clifton is the standard line.
- Proximity and expert scores are estimated from scripted probes, not human runs.
- Chase camera pulls in under ledges; close textures are soft inside 30 m.
- The Clifton blank-coverage patch is masked in the shader, not rebuilt in the tiles.

## Quality numbers
- Tests: 183, all green; lint, typecheck and build green.
- Lighthouse performance on the local production build at the Pages base path, desktop preset, real GPU: **97** (FCP 0.2 s, TBT 150 ms). With the default mobile preset and software GL it is 71, dominated by software-rendered WebGL (TBT 1.1 s); that run is not representative. **Not yet run on the live URL.**
- Bundle: 187 kB game and 528 kB Three.js (gzip 64 and 131 kB). About 11.5 MB raw to the title.

## How to deploy again
1. Merge to `main` (a push to main deploys), or run
   ```
   npm run deploy
   ```
   which dispatches `.github/workflows/pages.yml` on main (needs `gh auth switch --user ToastSeagers`).
2. Check the run with `gh run list --workflow pages.yml`. Pages is set to "GitHub Actions" in the repository settings.
3. The build uses base `/table-mountain-wingsuit/`; change `vite.config.ts` if the repository is renamed.

## Attribution check
Checked `docs/ASSETS.md`, `NOTICE.md` and `src/ui/SettingsScreen.ts`:
- The settings screen lists elevation data (City of Cape Town GLM 2019), aerial imagery (City of Cape Town, January 2025), the Sentinel-2 line, the Copernicus WorldDEM-30 line, the font (OFL 1.1) and the synthesised-audio note. Every row of ASSETS.md that requires attribution is covered.
- `NOTICE.md` states the non-commercial limit on the aerial textures. Nothing monetises the page: no ads, analytics or payment code was added.
- The font licence text ships in `public/fonts/OFL-PressStart2P.txt`.
- No new third-party asset was added in Stage 6.
