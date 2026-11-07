# Agent brief 01 — Terrain Data Engineer (Stage 1)

**Recommended settings:** Opus 5.5, effort high, permission mode auto, browser tools allowed, fresh session. Why Opus: finding a usable export of the City's DEM, handling projections and GDAL edge cases is debugging-heavy work where a weaker model burns more tokens flailing than a stronger one spends thinking.

**Depends on:** Stage 0 merged. **Runs in parallel with:** Stage 3.

**Owns:** `tools/terrain/`, `public/terrain/`, the DEM and imagery rows in `docs/ASSETS.md`. May refine coordinates in `data/checkpoints.json`, `data/exits.json` and `data/landing-zones.json` (snap to the DEM and imagery) and must list every change in the report.

## Mission

Turn real elevation and imagery data for the Table Mountain area into the tile set the renderer loads, in the exact format of `docs/01-architecture.md` section 4, with a validation script that proves it is right.

## Sources, in order of preference

**Elevation**
1. City of Cape Town 5 m bare-earth DEM (2019B LiDAR). Start at the City's Open Data Portal (`odp-cctegis.opendata.arcgis.com`), search "DEM", "elevation", "LiDAR". If a raster download exists for the AOI, use it. If only the ArcGIS ImageServer or MapServer exists (`cityimg.capetown.gov.za/erdas-iws/esri/GeoSpatial Datasets/rest/services/Elevation_CCT_GLM2019_5m_DEM/MapServer`), try an `exportImage` or `export` request for the AOI bbox at 5 m with a float or 16-bit format; tile the requests if the server caps the size.
2. City of Cape Town 2 m or 5 m contours (also on the portal, and mirrored at `gis.westerncape.gov.za`) interpolated to a 5 m grid with `gdal_grid` or `scipy.interpolate`.
3. Copernicus GLO-30 (free, worldwide, 30 m). If this is used, say so loudly in the report; Gate 1 tolerances allow it but the cliffs will be softer.

**Imagery**
1. Sentinel-2 L2A, 10 m, true colour (B4, B3, B2), a cloud-free summer scene, from the Copernicus Data Space Ecosystem or the AWS open data bucket. Free and redistributable with attribution.
2. Do not use Google, Bing, Mapbox or Esri basemap tiles as a baked asset unless you have read their terms and they allow it; most do not. Document any check you made.

Record source, date, licence and URL for each in `docs/ASSETS.md`.

## Deliverables

1. `tools/terrain/requirements.txt` (rasterio, numpy, Pillow, requests, scipy as needed) and a `README.md` with the exact commands to rebuild from an empty cache.
2. `tools/terrain/geo.py` with the same frame constants as `src/world/geo.ts`.
3. `tools/terrain/fetch.py`: downloads and caches raw inputs into `tools/terrain/cache/` (git-ignored).
4. `tools/terrain/build.py`: reprojects to the local metric frame (an azimuthal equidistant or transverse Mercator centred on the origin is fine), resamples to 5 m, crops to the AOI, writes `public/terrain/h/{col}_{row}.bin` uint16 tiles with the 1-sample overlap, `public/terrain/t/{col}_{row}.webp` texture tiles, `public/terrain/overview.webp`, and `public/terrain/meta.json`.
5. `tools/terrain/grade.py`: the imagery grade from `docs/design/look-and-feel.md` section 4, applied before tiling. Keep the raw and graded versions in the cache so Stage 5 can re-grade later.
6. `tools/terrain/validate.py`: checks every checkpoint in `data/checkpoints.json` against the tiles, checks tile seams (edge samples equal across neighbours), reports total bytes versus the 60 MB budget, writes `tools/terrain/preview.png` (hillshaded heights plus the texture side by side), exits non-zero on failure.
7. Refined positions for the three exits and seven landing zones: open the hillshade and imagery, snap each exit to a point on a steep edge facing its stated heading, and each landing zone centre onto the open area. Update the JSON files and list old and new values in the report.
8. `docs/status/stage-1-report.md`.

## Constraints

- Sea must be exactly 0 m (clamp negative values and NoData over water to 0).
- Heights stored as uint16 with `heightScale` 0.05 (0 to 3,276 m range, 5 cm steps).
- Textures sRGB WebP quality 80. If total exceeds the budget, drop texture tiles to 768 px before touching heights.
- No lat/lon in the output except in `meta.json` metadata.
- Python 3.11+, run scripts as `python tools/terrain/build.py` from the repo root.

## Kickoff prompt (paste into a new Opus 5.5 session, effort high, auto mode, browser allowed)

```
You are the Terrain Data Engineer for Table Mountain Wingsuit. Read CLAUDE.md, PLAN.md, docs/01-architecture.md (sections 3 and 4 especially), docs/02-stages.md Stage 1, docs/03-handoff-protocol.md, docs/design/exits.md, docs/design/look-and-feel.md section 4, docs/status/STATUS.md and your brief docs/agents/01-terrain-data.md. Create branch stage-1-terrain-data. Build the terrain data pipeline and produce public/terrain/ in the specified format from the best available real elevation and imagery data for the area of interest, following the source preference order in the brief. Write validate.py and make it pass. Refine the exit and landing zone coordinates against the data. Record every source and licence in docs/ASSETS.md. Commit as you go. Write docs/status/stage-1-report.md from the template, append to STATUS.md, then stop. Do not touch src/ except data/ JSON files, and do not start Stage 2.
```
