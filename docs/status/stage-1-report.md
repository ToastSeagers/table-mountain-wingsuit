# Stage 1 report — Terrain data pipeline

**Agent:** Terrain Data Engineer · **Model/effort:** Fable 5.1 / high · **Branch:** claude/stage-1-terrain-data-fde883 (worktree created by the Orchestrator) · **Date:** 2026-11-08

## What was built
- `public/terrain/`: 20 height tiles (`h/{col}_{row}.bin`, uint16 LE, 512 x 512, 1-sample overlap, `heightScale` 0.05), 80 texture tiles (`t/{col}_{row}.webp`, 1024 px, sRGB, quality 80), `overview.webp` (2048 px) and `meta.json` in the format of `docs/01-architecture.md` section 4. Total 13.6 MB (heights 10.5 MB, textures 3.1 MB). Open `meta.json` first.
- Elevation source is the **City of Cape Town Ground Level Map 2 m contours** (same 2019B LiDAR as the 5 m DEM, 0.3 m vertical accuracy), linearly interpolated to the 5 m grid. The City's 5 m DEM raster is only served as an 8-bit picture with a per-request stretch (no WCS, no ImageServer, float TIFF export errors), so it cannot be downloaded as data; see `tools/terrain/README.md` for the probes. Copernicus GLO-30 is used only to seed the sea mask. No 30 m heights ship.
- Imagery is **Sentinel-2 L2A** scene `S2C_34HBH_20260114_0_L2A` (14 Jan 2026, 0.04 % cloud), bands B02/B03/B04/B08 at 10 m from the AWS open bucket, graded per look-and-feel section 4, then upsampled to the 1.25 m/px tiles.
- `tools/terrain/`: `geo.py` (frame constants and grid), `fetch.py`, `build.py`, `grade.py`, `validate.py`, `refine_positions.py` (one-off snapping helper), `requirements.txt`, `README.md`. Python venv at `tools/terrain/.venv` (git-ignored), cache at `tools/terrain/cache/` (git-ignored, about 160 MB).
- `tools/terrain/preview.png` (committed): hillshade beside the texture overview with checkpoints, exits and zones marked.
- `docs/ASSETS.md`: rows for the contours, GLO-30, Sentinel-2, and the City aerial imagery (optional, not shipped), each with URL, date, licence and attribution text.

## How to run and verify
From the repo root (Python 3.11+; built with 3.13):

```
python -m venv tools/terrain/.venv
tools/terrain/.venv/Scripts/python.exe -m pip install -r tools/terrain/requirements.txt
tools/terrain/.venv/Scripts/python.exe tools/terrain/fetch.py      # ~4 min, 123 contour pages + 4 S2 bands + GLO-30
tools/terrain/.venv/Scripts/python.exe tools/terrain/build.py      # ~5 min, Delaunay over 8.0 M contour points in 80 blocks
tools/terrain/.venv/Scripts/python.exe tools/terrain/validate.py   # seconds; prints the table below, writes preview.png
```

To only check the committed output: run `validate.py` alone (it needs the venv but no cache). Expected: six `ok` checkpoint lines, `ok tile seams`, `ok public/terrain total 13.6 MB`, `validate: PASS`, exit code 0.

`npm test` (8/8), `npm run lint`, `npm run typecheck`, `npm run build` pass on the branch.

## Gate results
- [x] `python tools/terrain/validate.py` passes checkpoints within tolerance:

| Checkpoint | expected | sampled | error | tolerance |
|---|---|---|---|---|
| Maclear's Beacon | 1085 | 1084.0 | -1.0 | 15 |
| Upper cable station | 1067 | 1064.1 | -2.9 | 15 |
| Lion's Head summit | 669 | 664.8 | -4.2 | 15 |
| Signal Hill summit | 350 | 349.6 | -0.4 | 15 |
| Camps Bay beach (sea) | 0 | 0.0 | 0.0 | 3 |
| Sea Point promenade | 5 | 6.4 | +1.4 | 5 |

- [x] `public/terrain/` under 60 MB: 13.6 MB (20 x 0.52 MB heights, 80 texture tiles averaging 33 KB, overview 0.47 MB).
- [x] No visible seams: `validate.py` checks every neighbouring height tile pair's shared edge for exact equality (max difference 0 steps), and `preview.png` is a single stitched image.
- [x] `docs/ASSETS.md` has DEM and imagery rows with licence.
- [x] `tools/terrain/README.md` lets a stranger rebuild (commands above, plus why contours, the grid definition and the imagery choice).

Note: the checkpoint lat/lons in `data/checkpoints.json` were moved (see below). Before moving them, Maclear's Beacon sampled 1066, the cable station 874 and Signal Hill 282, because the authored coordinates were on the plateau 1.5 km west of the beacon, on the north face below the station, and 700 m south-west of the Signal Hill summit. GLO-30 agrees with the contours at those points to within a few metres, and a cross-correlation of the two surfaces finds zero shift, so the frame is right and the authored points were approximate.

## Interface or shared-file changes
- `data/checkpoints.json`: lat/lon of five points snapped to the DEM features (expected heights and tolerances unchanged; comment updated).

| Checkpoint | old lat, lon | new lat, lon | why |
|---|---|---|---|
| Maclear's Beacon | -33.9628, 18.4098 | -33.9668, 18.4255 | the 1084 m top of the table is 1.5 km east of the authored point; matches the real beacon |
| Upper cable station | -33.9566, 18.4036 | -33.9578, 18.4032 | authored point is 130 m down the north face (874 m); moved onto the plateau edge by the station |
| Lion's Head summit | -33.9353, 18.3890 | -33.9350, 18.3891 | 30 m onto the summit cell |
| Signal Hill summit | -33.9218, 18.3990 | -33.9170, 18.4038 | the 350 m summit is 690 m north-east; the authored point is 282 m |
| Camps Bay beach (sea) | -33.9510, 18.3770 | -33.9510, 18.3762 | 70 m further out so it is water, not the 2 m sand |

- `data/exits.json` (positions and `elevationM` only; headings, ids, blurbs untouched):

| Exit | old lat, lon, m | new lat, lon, m | moved | how |
|---|---|---|---|---|
| the-table | -33.9585, 18.4010, 1050 | -33.9585, 18.4033, 1050 | 215 m E | authored point is 300 m below the western edge; pinned on the edge due east of it, 80 m south of the cable station. Drop along 265°: 1050 → 931 at 100 m → 535 at 350 m |
| platteklip | -33.9605, 18.4090, 1070 | -33.95978, 18.40995, 1031 | 118 m NE | snapped to the rim at the head of the gorge; 258 m drop in the first 120 m along 350° |
| lions-head | -33.9353, 18.3890, 669 | -33.93526, 18.38905, 662 | 7 m | summit cell; 156 m drop in 120 m along 300° |

- `data/landing-zones.json` (centres only; radii, surfaces, difficulties untouched):

| Zone | old lat, lon | new lat, lon | moved | how |
|---|---|---|---|---|
| camps-bay-beach | -33.9510, 18.3775 | -33.95099, 18.37753 | 3 m | already on the sand |
| the-glen | -33.9437, 18.3800 | -33.94473, 18.37882 | 157 m SW | onto the club's oval (authored point was scrub by the road); mean slope 1.3° |
| clifton | -33.9400, 18.3760 | -33.9409, 18.3745 | 171 m SW | authored point is on the houses at Third Beach; placed on Fourth Beach sand from the City aerial |
| sea-point-prom | -33.9125, 18.3900 | -33.9120, 18.3891 | 100 m NW | authored point is a flat roof (bare-earth DEM cannot tell); placed on the lawn strip from the City aerial |
| upper-orange | -33.9385, 18.4140 | -33.9386, 18.4148 | 75 m E | authored point is the Molteno reservoir wall; placed on the fenced field east of it from the City aerial |
| uct-fields | -33.9570, 18.4640 | -33.95735, 18.46315 | 87 m W | onto the rugby fields (authored point was the road) |
| tafelberg-road | -33.9530, 18.4120 | -33.95234, 18.41244 | 83 m N | onto the road bend at 361 m; mean slope 7.8° |

- `docs/ASSETS.md`: DEM row replaced by the contours row; GLO-30, Sentinel-2 and City-aerial rows added; attribution lines listed.
- `.gitignore`: `tools/terrain/.venv/`, `tools/terrain/__pycache__/`.
- `docs/status/STATUS.md`: one line appended.
- `src/` untouched.

## Tuning changes
None in `src/flight/tuning.ts` or `src/game/scoring-tuning.ts` (not this stage). Imagery grade constants live at the top of `tools/terrain/grade.py` with comments; the values beyond the look-and-feel numbers are: white point 0.42 reflectance, gamma 1/1.9, shadow lift 0.045, warm +8/+2.5/-6 (of 255) at mid grey, green desaturation 15 % with a 0.08 greenness ramp, sea painted 85 % toward (41, 97, 148) because L2A sea is black, baked hard shadows (reflectance < 0.012) filled 85 % from the lit 80 m neighbourhood.

## Known issues and deferred items
- **10 m imagery on 1.25 m tiles.** Up close the texture is soft; the Stage 2 slope and altitude detail blend is meant to cover this. If it is not enough, the City's January 2025 aerial mosaic (5 cm source) is wired in: `fetch.py --cct-aerial` then `build.py --imagery cct-aerial` (about 15 minutes, 9 export requests). Its terms say "no restrictions ... for non-commercial purposes", so the Orchestrator decides. Stage 2 or 5.
- **Baked shadows.** The scene's 10:50 sun leaves soft shading on west faces even after the hard-shadow fill; golden-hour lighting from the west will disagree slightly. Acceptable at distance; the aerial mosaic has the same issue. Stage 5 can re-grade (`grade.py` then `build.py --textures-only`).
- **Flat spots on ridges and summits.** Linear interpolation between 2 m contours leaves facets up to 2 m high where a triangle's three vertices share a contour; summits read 1 to 4 m low (see the checkpoint table). No visible terracing at 5 m.
- **Sea edge.** The coastline comes from the Sentinel-2 water index at 10 m plus a 25 m ramp, so beaches slope into the water; sea cells are exactly 0 (25.3 % of samples). Rock shelves below 2 m within 25 m of the water also ramp to 0.
- **Grid bounds differ from the architecture's illustrative numbers.** `meta.json` says X -5925..6850, Z -5665..4555 (5 x 4 tiles of 511 cells), which contains the architecture AOI with a margin. Stage 2 must read `meta.json`, not the doc.
- The `WorldGrid` for textures has slightly anisotropic pixels (1.2476 m E-W, 1.2476 m N-S by construction of the bounds; the overview is 6.24 x 4.99 m/px). Harmless for texturing.
- The-table exit is 80 m south of the upper cable station because that is where the western edge is. Stage 4 should fly it and may slide it south along the edge (lon about 18.4035 to 18.405 for lat -33.959 to -33.962); the summit area is flat so any edge cell works.
- Python 3.13 venv; rasterio 1.4 wheels worked on Windows without GDAL installs. `tools/terrain/preview.png` (2.3 MB) is committed for the gate review.

## Decisions made
- Contours over the DEM raster (raster not downloadable as data); GLO-30 only as a sea seed, never as heights.
- Sentinel-2 over the City aerial for the shipped textures because its licence is unambiguous; aerial kept as an opt-in build flag with the licence check recorded.
- Scene `S2C_34HBH_20260114_0_L2A` chosen from six cloud-free candidates (Nov 2024 to Mar 2026) for summer tones and lowest cloud; previews were compared side by side.
- Earth Search COGs already have the BOA offset applied (`earthsearch:boa_offset_applied`); `build.py` reads that flag instead of assuming baseline 04.00 semantics.
- Interpolation is block-wise Delaunay (256-sample blocks, 150 m margin) over contour vertices densified to 4 m, with vertices deduplicated to 0.1 m; the raw result is cached in `cache/heights_interp_5m.npy` so sea-rule or grade changes do not redo the 4-minute step.
- Sea: flood fill from GLO-30 water more than 60 m beyond its coast, through cells under 6 m that the Sentinel-2 water index (NDWI > 0.3 and mean reflectance < 0.09) calls water, plus any such body over 0.5 ha (enclosed dock basins). Negative heights clamp to 0.
- Checkpoint positions were moved rather than tolerances widened, since the data and GLO-30 agree and the authored points were off the features.
- Exits snapped by a search for the biggest drop along the heading while staying within 40 m of the local top, with a distance penalty; The Table pinned by hand (see table). Zones snapped by lowest mean slope on land, with three placed by hand from City aerial crops where a bare-earth DEM cannot separate lawns from roofs.
- Git: committed in three commits on the worktree branch; nothing pushed, no remote, identity untouched.

## Suggested next step
Orchestrator runs Gate 1 (`validate.py`, open `tools/terrain/preview.png`), merges, and starts Stage 2 with `meta.json` as the contract. Decide on the City aerial imagery before Stage 5 grades anything.
