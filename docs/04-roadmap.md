# 04 — Roadmap (everything after v0.1)

Anything not in `PLAN.md` section 1 lives here. Agents add ideas to the bottom with a one-line rationale; the Orchestrator orders them.

## v0.2 candidates (pick three or four)

- **More launch points.** Devil's Peak saddle, Signal Hill, Chapman's Peak (needs AOI extension to the south). Each is one JSON entry plus an intro path, which is the whole point of the data-driven design.
- **Conditions.** Tablecloth cloud rolling over the edge (visibility hazard, volumetric or layered planes), south-easter wind pushing the line, time of day presets (dawn, golden hour, midday, dusk).
- **Daily challenge.** Seeded conditions and exit for everyone on a given day. Local only until there is a backend.
- **Photo mode.** Pause, free camera, filters, save to PNG.
- **Ghost run.** Play alongside your best run's replay.
- **Rings or gates mode.** Optional target rings along a suggested line for players who want structure.

## Later

- Online leaderboards and sharing (needs a small backend or a hosted DB).
- Mobile touch and tilt controls.
- City buildings from OpenStreetMap footprints extruded by height tag, low-poly.
- Terrain detail: higher resolution tiles near the exits from the 2025/26 LiDAR, scattered rocks and vegetation cards.
- Character model and suit customisation.
- Controller rumble on deploy and landing.
- Localisation.

## Explicitly out

- Real BASE exit coordinates, routes or footage. See `docs/design/exits.md` section 4.
- Anything that needs Google Photorealistic 3D Tiles baked into assets (licence).

## Ideas log (append here)

- 
- Stage 6 follow-ups: reuse PostStack targets across render-scale changes (hitch on entering results); CI step running tests and lint before Pages deploy; terrain-aware autopilot for balance probes; replace the Clifton shader mask with a rebuilt sea mask.
