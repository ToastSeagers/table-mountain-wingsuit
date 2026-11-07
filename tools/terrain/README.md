# Terrain data pipeline

Turns real elevation and imagery for the Table Mountain area into the tile set
under `public/terrain/` (format: `docs/01-architecture.md` section 4). Runs once,
offline; the output is committed, the raw cache is not.

## Rebuild from an empty cache

From the repo root, on Windows (PowerShell or Git Bash):

```
python -m venv tools/terrain/.venv
tools/terrain/.venv/Scripts/python.exe -m pip install -r tools/terrain/requirements.txt
tools/terrain/.venv/Scripts/python.exe tools/terrain/fetch.py
tools/terrain/.venv/Scripts/python.exe tools/terrain/build.py
tools/terrain/.venv/Scripts/python.exe tools/terrain/validate.py
```

On macOS or Linux replace `tools/terrain/.venv/Scripts/python.exe` with
`tools/terrain/.venv/bin/python`. If the venv is activated, plain
`python tools/terrain/fetch.py` etc. works. Python 3.11 or newer; built with 3.13.

Timings on the reference laptop: fetch about 10 minutes (contours are 123 paged
requests, Sentinel-2 bands are windowed reads of cloud-optimised GeoTIFFs, the
aerial mosaic is nine 4000 px exports), build about 6 minutes, validate a few
seconds. Cache size about 400 MB.

## Scripts

| Script | What it does |
|---|---|
| `geo.py` | Frame constants (must match `src/world/geo.ts`), the output grid definition, lat/lon to world. `python tools/terrain/geo.py` prints the checkpoints in world metres. |
| `fetch.py` | Downloads into `tools/terrain/cache/`: City of Cape Town 2 m contours (ArcGIS feature service, paged), Copernicus GLO-30 tile S34 E018, Sentinel-2 L2A bands B02/B03/B04/B08 for the AOI, and the City aerial orthophoto mosaic exported onto the texture grid. `--no-cct-aerial` skips the mosaic. `--scene <id>` picks another Sentinel-2 STAC item. |
| `build.py` | Interpolates the contours to the 5 m grid (block-wise Delaunay, linear), applies the GLO-30 sea mask, writes `h/{col}_{row}.bin`; warps and grades the imagery, writes `t/{col}_{row}.webp`, `overview.webp`, `meta.json`. Flags: `--heights-only`, `--textures-only`, `--regrade`, `--imagery cct-aerial|s2` (default aerial). |
| `grade.py` | The colour grade from `docs/design/look-and-feel.md` section 4 as pure numpy. Edit the constants, then `python tools/terrain/grade.py && python tools/terrain/build.py --textures-only`. Raw (`cache/imagery/s2_raw_10m.tif`, 4-band DN) and graded (`cache/imagery/graded_10m.tif`) stay in the cache. |
| `validate.py` | Checks geo constants against `geo.ts`, file presence and sizes, every checkpoint in `data/checkpoints.json` (bilinear from the tiles on disk), tile seams, the 60 MB budget; writes `tools/terrain/preview.png`. Exits non-zero on failure. |
| `refine_positions.py` | Helper used once to snap exits and landing zones to the DEM and imagery (writes crops to the cache for eyeballing, prints candidate positions). Not part of the build. |

## Why contours and not the 5 m DEM raster

The City publishes the GLM 2019 5 m DEM only through an ERDAS Apollo image
server whose Esri-style `export` renders an 8-bit picture with a per-request
stretch (no WCS, no ImageServer, `format=tiff` float errors out, `identify` is
unsupported). Heights cannot be recovered from that. The 2 m contours of the
same Ground Level Map (same LiDAR, 0.3 m vertical accuracy) are a hosted feature
service that pages cleanly, so they are the elevation source. Linear
interpolation between 2 m contours sampled at 5 m is, in practice, the 5 m DEM
with sub-metre differences on slopes and small flat spots on ridges and summits.
The alternative, Copernicus GLO-30, is used only for the sea mask (its ocean is
exactly 0).

## Output grid

Height samples are 5 m apart. 5 x 4 tiles of 512 x 512 samples with a
1-sample overlap advance 511 cells (2555 m) per tile, giving world bounds
X -5925..6850, Z -5665..4555 (12 775 x 10 220 m), centred on the architecture's
AOI with a margin. Texture tiles are 10 x 8 of 1024 px over the same bounds
(1.2476 m/px east-west, 1.2476 m/px north-south). `meta.json` is the source of
truth for the renderer; nothing in `src/` should hard-code these numbers.

## Imagery choice

Default: the City of Cape Town January 2025 aerial orthophoto mosaic (5 cm
source), exported by `fetch.py` straight onto the texture grid at 1.25 m/px in
nine 4000 px requests, then graded. The City's terms state "no restrictions on
the digital file for non-commercial purposes"; the project owner confirmed on
2026-11-08 that the game is personal and non-commercial, so it ships. See
`docs/ASSETS.md`.

Alternative: Sentinel-2 L2A scene `S2C_34HBH_20260114_0_L2A` (14 January 2026,
cloud cover 0.04 percent, visually checked over the AOI against five other
cloud-free candidates from Nov 2024 to Mar 2026), free and open with
attribution, 10 m pixels. `python tools/terrain/build.py --textures-only --imagery s2`
re-tiles from it; it is always fetched because its water index drives the sea
mask and the grade.
