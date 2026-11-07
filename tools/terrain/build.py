"""Build ``public/terrain/`` from the cached raw inputs.

Heights: the City's 2 m LiDAR contours are densified to a point cloud and
linearly interpolated (Delaunay, block by block) onto the 5 m world grid.
Sea is forced to exactly 0 using the Copernicus GLO-30 water mask; negative
land (dredged basins, quarries) is clamped to 0. Output: uint16 tiles with a
1-sample overlap, ``heightScale`` 0.05.

Textures: by default the City of Cape Town aerial orthophoto mosaic, exported
by ``fetch.py`` straight onto the 1.25 m/px texture grid and graded with
``grade.py`` (this is a non-commercial project, which its terms allow). With
``--imagery s2`` the Sentinel-2 L2A bands are warped onto the world grid at
10 m, graded, then upsampled. Sentinel-2 is always fetched: it provides the
water index for the sea mask and the grade. All WebP, sRGB, quality 80.

Run from the repo root after ``fetch.py``:
    python tools/terrain/build.py [--heights-only | --textures-only] [--imagery cct-aerial|s2]
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.warp import reproject
from scipy.interpolate import LinearNDInterpolator
from scipy.ndimage import distance_transform_edt, label, uniform_filter
from scipy.spatial import QhullError

import geo
import grade

Image.MAX_IMAGE_PIXELS = None

DENSIFY_SPACING_M = 4.0  # points added along contour segments so Delaunay edges follow the lines
BLOCK_SAMPLES = 256  # interpolation block size in grid samples
BLOCK_MARGIN_M = 150.0  # contour points gathered beyond each block
SEA_HEIGHT_MAX_M = 2.5  # interpolated heights below this where GLO-30 says water become 0
GLO30_WATER_MAX_M = 0.01  # GLO-30 ocean is exactly 0; bilinear resampling blurs the coast slightly
SEA_OFFSHORE_M = 60.0  # GLO-30 water mask seeds the flood fill only this far beyond its own coastline
SEA_RAMP_M = 25.0  # low land within this distance of the sea slopes down to 0 at the waterline
SEA_MIN_ENCLOSED_CELLS = 200  # low water bodies this big (0.5 ha) are sea even if breakwaters cut them off
SEA_WATER_INDEX_MAX_M = 6.0  # imagery water up to quay height counts: dock basins interpolate at 2..5 m between quay contours
WEBP_QUALITY = 80

S2_RAW_PATH = grade.RAW_PATH
GRADED_PATH = grade.GRADED_PATH
HEIGHTS_CACHE = geo.CACHE_DIR / "heights_5m.npy"  # final, after sea mask
INTERP_CACHE = geo.CACHE_DIR / "heights_interp_5m.npy"  # raw interpolation, reused unless --reinterpolate


# --------------------------------------------------------------------------- heights
def densify(x: np.ndarray, z: np.ndarray, e: np.ndarray, line_id: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Insert points every DENSIFY_SPACING_M along consecutive vertices of each line."""
    same_line = line_id[1:] == line_id[:-1]
    dx = x[1:] - x[:-1]
    dz = z[1:] - z[:-1]
    seg_len = np.hypot(dx, dz)
    n_extra = np.where(same_line, np.floor(seg_len / DENSIFY_SPACING_M).astype(np.int64), 0)
    n_extra = np.minimum(n_extra, 100_000)
    total = int(n_extra.sum())
    if total == 0:
        return x, z, e
    seg_idx = np.repeat(np.arange(len(seg_len)), n_extra)
    # position k/(n+1) along each segment, k = 1..n
    k = np.arange(total) - np.repeat(np.cumsum(n_extra) - n_extra, n_extra) + 1
    t = k / (n_extra[seg_idx] + 1)
    nx = x[seg_idx] + dx[seg_idx] * t
    nz = z[seg_idx] + dz[seg_idx] * t
    ne = e[seg_idx]
    return (
        np.concatenate([x, nx.astype(np.float32)]),
        np.concatenate([z, nz.astype(np.float32)]),
        np.concatenate([e, ne.astype(np.float32)]),
    )


def interpolate_heights(contours_npz: Path) -> np.ndarray:
    """Linear Delaunay interpolation of contour points onto the height sample grid.

    Returns float32 (rows, cols) with NaN where no triangle covers a sample
    (open sea beyond the coast contours).
    """
    grid = geo.height_sample_grid()
    d = np.load(contours_npz)
    x, z, e = densify(d["x"], d["z"], d["elev"], d["line_id"])
    print(f"heights: {len(x):,} contour points after densifying")

    # Sort points into blocks so each block's neighbourhood is a cheap slice.
    block_m = BLOCK_SAMPLES * geo.CELL_SIZE_M
    order = np.lexsort((x, z))
    x, z, e = x[order], z[order], e[order]
    z_sorted = z  # z is the primary sort key

    out = np.full((grid.height, grid.width), np.nan, dtype=np.float32)
    n_blocks_x = int(np.ceil(grid.width / BLOCK_SAMPLES))
    n_blocks_z = int(np.ceil(grid.height / BLOCK_SAMPLES))
    t0 = time.time()
    for bz in range(n_blocks_z):
        r0 = bz * BLOCK_SAMPLES
        r1 = min(grid.height, r0 + BLOCK_SAMPLES)
        z0 = geo.MIN_Z + r0 * geo.CELL_SIZE_M
        z1 = geo.MIN_Z + (r1 - 1) * geo.CELL_SIZE_M
        lo = np.searchsorted(z_sorted, z0 - BLOCK_MARGIN_M)
        hi = np.searchsorted(z_sorted, z1 + BLOCK_MARGIN_M)
        sx, sz, se = x[lo:hi], z[lo:hi], e[lo:hi]
        for bx in range(n_blocks_x):
            c0 = bx * BLOCK_SAMPLES
            c1 = min(grid.width, c0 + BLOCK_SAMPLES)
            x0 = geo.MIN_X + c0 * geo.CELL_SIZE_M
            x1 = geo.MIN_X + (c1 - 1) * geo.CELL_SIZE_M
            m = (sx >= x0 - BLOCK_MARGIN_M) & (sx <= x1 + BLOCK_MARGIN_M)
            px, pz, pe = sx[m], sz[m], se[m]
            if len(px) < 3:
                continue
            # Deduplicate to 0.1 m so Qhull does not see coincident points.
            key = np.round(px * 10).astype(np.int64) * 10_000_003 + np.round(pz * 10).astype(np.int64)
            _, uniq = np.unique(key, return_index=True)
            pts = np.column_stack([px[uniq], pz[uniq]]).astype(np.float64)
            try:
                interp = LinearNDInterpolator(pts, pe[uniq].astype(np.float64))
            except QhullError:
                continue
            gx = geo.MIN_X + np.arange(c0, c1) * geo.CELL_SIZE_M
            gz = geo.MIN_Z + np.arange(r0, r1) * geo.CELL_SIZE_M
            mx, mz = np.meshgrid(gx, gz)
            out[r0:r1, c0:c1] = interp(mx, mz).astype(np.float32)
        done = (bz + 1) * n_blocks_x
        print(f"  blocks {done}/{n_blocks_x * n_blocks_z}  {time.time() - t0:5.0f}s", end="\r", flush=True)
    print()
    return out


def glo30_on_grid(glo30_path: Path) -> np.ndarray:
    grid = geo.height_sample_grid()
    dst = np.zeros((grid.height, grid.width), dtype=np.float32)
    with rasterio.open(glo30_path) as src:
        reproject(
            rasterio.band(src, 1),
            dst,
            dst_transform=grid.geo_transform,
            dst_crs="EPSG:4326",
            resampling=Resampling.bilinear,
            src_nodata=-32767.0,  # GLO-30 has no nodata tag; this keeps GDAL from treating 0 as nodata
            dst_nodata=-32767.0,
        )
    return np.where(dst <= -32767.0, 0.0, dst)


def s2_water_on_height_grid() -> np.ndarray:
    """Sentinel-2 water mask (grade.water_mask) resampled onto the height samples."""
    grid = geo.height_sample_grid()
    with rasterio.open(S2_RAW_PATH) as src:
        dn = src.read().astype(np.float32)
        offset = float(src.tags().get("BOA_ADD_OFFSET", "0"))
        src_transform, src_crs = src.transform, src.crs
    refl = np.clip((dn + offset) / 10000.0, 0.0, 1.0)
    water = grade.water_mask(refl[:3], refl[3]).astype(np.float32)
    dst = np.zeros((grid.height, grid.width), dtype=np.float32)
    reproject(
        water,
        dst,
        src_transform=src_transform,
        src_crs=src_crs,
        dst_transform=grid.geo_transform,
        dst_crs="EPSG:4326",
        resampling=Resampling.bilinear,
    )
    return dst > 0.5


def build_heights(contours_npz: Path, glo30_path: Path, reinterpolate: bool = False) -> np.ndarray:
    if INTERP_CACHE.exists() and not reinterpolate:
        print(f"heights: reusing {INTERP_CACHE.name} (pass --reinterpolate to redo the Delaunay step)")
        h = np.load(INTERP_CACHE)
    else:
        h = interpolate_heights(contours_npz)
        np.save(INTERP_CACHE, h)
    glo = glo30_on_grid(glo30_path)
    nan = np.isnan(h)
    print(f"heights: {nan.mean() * 100:.1f}% of samples outside the contour hull (open sea)")
    h = np.where(nan, 0.0, h)
    # The lowest contour along most of the coast is 2 m, so the Delaunay step
    # spans the bays with a flat shelf at about 2 m. Sea is that shelf, found by
    # flooding from open water (GLO-30 water well beyond its own 30 m coast)
    # through low cells that the Sentinel-2 water index also calls water, so
    # the shoreline comes from 10 m imagery, not the blocky GLO-30 mask, and
    # beaches keep their interpolated 0..2 m. A short ramp eases the step at
    # the waterline. Dredged basins (negative) clamp to 0.
    glo_land = glo >= GLO30_WATER_MAX_M
    open_water = (distance_transform_edt(~glo_land) * geo.CELL_SIZE_M > SEA_OFFSHORE_M) & (h < SEA_HEIGHT_MAX_M)
    water_idx = s2_water_on_height_grid()
    candidate = open_water | ((h < SEA_WATER_INDEX_MAX_M) & water_idx)
    labels, n_labels = label(candidate)
    touching = np.unique(labels[open_water])
    areas = np.bincount(labels.ravel(), minlength=n_labels + 1)
    big = np.flatnonzero(areas >= SEA_MIN_ENCLOSED_CELLS)
    keep = np.union1d(touching[touching > 0], big[big > 0])
    sea = np.isin(labels, keep)
    h = np.where(sea, 0.0, h)
    dist_m = distance_transform_edt(~sea) * geo.CELL_SIZE_M
    ramp = np.clip(dist_m / SEA_RAMP_M, 0.0, 1.0)
    h = np.where(h < SEA_HEIGHT_MAX_M, h * ramp, h)
    h = np.maximum(h, 0.0)
    print(f"heights: range {h.min():.1f}..{h.max():.1f} m, sea {sea.mean() * 100:.1f}% of samples")
    return h.astype(np.float32)


def write_height_tiles(h: np.ndarray, out_dir: Path) -> int:
    hd = out_dir / "h"
    hd.mkdir(parents=True, exist_ok=True)
    for stale in hd.glob("*.bin"):
        stale.unlink()
    q = np.clip(np.round((h - geo.HEIGHT_OFFSET) / geo.HEIGHT_SCALE), 0, 65535).astype("<u2")
    step = geo.HEIGHT_TILE_SIZE - 1
    total = 0
    for row in range(geo.HEIGHT_ROWS):
        for col in range(geo.HEIGHT_COLS):
            tile = q[row * step : row * step + geo.HEIGHT_TILE_SIZE, col * step : col * step + geo.HEIGHT_TILE_SIZE]
            assert tile.shape == (geo.HEIGHT_TILE_SIZE, geo.HEIGHT_TILE_SIZE), tile.shape
            data = np.ascontiguousarray(tile).tobytes()
            (hd / f"{col}_{row}.bin").write_bytes(data)
            total += len(data)
    print(f"heights: {geo.HEIGHT_COLS * geo.HEIGHT_ROWS} tiles, {total / 1e6:.1f} MB")
    return total


# --------------------------------------------------------------------------- textures
def s2_raw_on_grid(scene_dir: Path) -> Path:
    """Warp B04, B03, B02, B08 onto the world grid at 10 m (texture grid / 8)."""
    S2_RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    tg = geo.texture_grid()
    factor = 8
    grid = geo.WorldGrid(tg.min_x, tg.min_z, tg.cell_x_m * factor, tg.cell_z_m * factor, tg.width // factor, tg.height // factor)
    bands = ["B04", "B03", "B02", "B08"]
    dst = np.zeros((len(bands), grid.height, grid.width), dtype=np.uint16)
    item = json.loads((scene_dir / "stac_item.json").read_text(encoding="utf-8"))
    # Baseline >= 04.00 adds 1000 to every DN, but Earth Search's COGs already
    # have that offset removed (earthsearch:boa_offset_applied). Honour the flag.
    props = item["properties"]
    offset_applied = bool(props.get("earthsearch:boa_offset_applied", False))
    offset = 0 if offset_applied or float(props.get("s2:processing_baseline", "05.00")) < 4.0 else -1000
    for i, band in enumerate(bands):
        with rasterio.open(scene_dir / f"{band}.tif") as src:
            reproject(
                rasterio.band(src, 1),
                dst[i],
                dst_transform=grid.geo_transform,
                dst_crs="EPSG:4326",
                resampling=Resampling.cubic,
            )
    profile = {
        "driver": "GTiff",
        "dtype": "uint16",
        "count": len(bands),
        "width": grid.width,
        "height": grid.height,
        "crs": "EPSG:4326",
        "transform": grid.geo_transform,
        "compress": "deflate",
    }
    with rasterio.open(S2_RAW_PATH, "w", **profile) as out:
        out.write(dst)
        out.update_tags(
            BANDS=",".join(bands),
            BOA_ADD_OFFSET=str(offset),
            SCENE=item["id"],
            DATETIME=item["properties"]["datetime"],
        )
    print(f"textures: raw 10 m Sentinel-2 -> {S2_RAW_PATH}")
    return S2_RAW_PATH


def graded_full_res(imagery: str) -> np.ndarray:
    """Return the graded image at the texture grid resolution as uint8 (H, W, 3)."""
    tg = geo.texture_grid()
    if imagery == "s2":
        with rasterio.open(GRADED_PATH) as src:
            small = np.moveaxis(src.read(), 0, -1)
        img = Image.fromarray(small).resize((tg.width, tg.height), Image.Resampling.LANCZOS)
        return np.asarray(img)
    # City aerial mosaic is already on the texture grid; grade with the S2 water mask.
    cct = geo.CACHE_DIR / "imagery" / "cct_aerial_2025jan_rgb.tif"
    with rasterio.open(cct) as src:
        rgb = np.moveaxis(src.read(), 0, -1).astype(np.float32) / 255.0
    with rasterio.open(S2_RAW_PATH) as src:
        dn = src.read().astype(np.float32)
        offset = float(src.tags().get("BOA_ADD_OFFSET", "0"))
    refl = np.clip((dn + offset) / 10000.0, 0.0, 1.0)
    water_small = grade.water_mask(refl[:3], refl[3])
    water = np.asarray(Image.fromarray(water_small.astype(np.uint8) * 255).resize((tg.width, tg.height), Image.Resampling.BILINEAR)) > 127
    rgb = fill_aerial_open_sea(rgb, water_small.shape)
    out = np.empty(rgb.shape, dtype=np.uint8)
    rows = geo.TEXTURE_TILE_SIZE
    for r0 in range(0, tg.height, rows):
        out[r0 : r0 + rows] = grade.grade_rgb(
            rgb[r0 : r0 + rows], water[r0 : r0 + rows], grade.AERIAL_SEA_MIX, grade.AERIAL_SEA_BRIGHTEN
        )
    return out


AERIAL_SEA_FADE_START_M = 150.0  # offshore of this, the mosaic's water fades into one sea colour
AERIAL_SEA_FADE_END_M = 700.0  # ...and is fully that colour here, well inside the mosaic's coverage edge
AERIAL_SEA_TEXTURE_GAIN = 0.35  # how much Sentinel-2 swell luminance modulates the filled sea
AERIAL_BLANK_MIN = 0.85  # all three channels above this over water = no mosaic coverage (served white)
AERIAL_BLANK_MIN_DIST_M = 40.0  # closer to the coast than this, white is surf, not blank
AERIAL_BLANK_FEATHER_PX = 15  # box feather (about 19 m) on the blank edge


def fill_aerial_open_sea(rgb: np.ndarray, small_shape: tuple[int, int]) -> np.ndarray:
    """The City mosaic stops a few hundred metres offshore (white beyond).

    Open water, by the built terrain's sea mask, fades with distance from the
    coast into the mosaic's own median sea colour, textured with the graded
    Sentinel-2 sea so it is not flat. The fade finishes before the coverage
    edge, so that edge never shows.
    """
    tg = geo.texture_grid()
    h = np.load(HEIGHTS_CACHE)
    # Work at the 10 m grid: sea mask, coast distance, S2 texture; then upsample.
    small_t = geo.WorldGrid(tg.min_x, tg.min_z, tg.cell_x_m * 8, tg.cell_z_m * 8, small_shape[1], small_shape[0])
    sea_small = grade.terrain_sea_on_raster(h, small_t.geo_transform, small_shape)
    dist_small = distance_transform_edt(sea_small) * small_t.cell_x_m
    fade_small = np.clip((dist_small - AERIAL_SEA_FADE_START_M) / (AERIAL_SEA_FADE_END_M - AERIAL_SEA_FADE_START_M), 0.0, 1.0)
    with rasterio.open(GRADED_PATH) as src:
        s2 = np.moveaxis(src.read(), 0, -1).astype(np.float32) / 255.0
    s2_luma = grade.luminance(s2)
    sea_luma = s2_luma[sea_small]
    tex_small = np.zeros(small_shape, dtype=np.float32)
    if sea_luma.size:
        tex_small = (s2_luma - float(np.median(sea_luma))) / max(float(np.std(sea_luma)), 1e-3)
        tex_small = np.clip(tex_small, -2.0, 2.0) * 0.5
    size = (tg.width, tg.height)
    fade = np.asarray(Image.fromarray(fade_small.astype(np.float32), mode="F").resize(size, Image.Resampling.BILINEAR))
    tex = np.asarray(Image.fromarray(tex_small.astype(np.float32), mode="F").resize(size, Image.Resampling.BILINEAR))
    dist = np.asarray(Image.fromarray(dist_small.astype(np.float32), mode="F").resize(size, Image.Resampling.BILINEAR))
    sea = np.asarray(Image.fromarray(sea_small.astype(np.float32), mode="F").resize(size, Image.Resampling.BILINEAR)) > 0.5
    # Blank mosaic (white) over water, away from the surf line where real foam is white too.
    blank = sea & (rgb.min(axis=-1) > AERIAL_BLANK_MIN) & (dist > AERIAL_BLANK_MIN_DIST_M)
    blank_w = np.clip(uniform_filter(blank.astype(np.float32), size=AERIAL_BLANK_FEATHER_PX, mode="nearest") * 2.5, 0.0, 1.0)
    weight = np.maximum(fade, blank_w)
    del blank, dist
    # Median colour of the mosaic's real (non-blank) water, sampled every 8th pixel.
    sub = rgb[::8, ::8]
    sea_px = sea_small[: sub.shape[0], : sub.shape[1]] & (sub.min(axis=-1) < 0.9)
    colour = np.median(sub[sea_px], axis=0) if sea_px.any() else np.array([0.12, 0.35, 0.45], dtype=np.float32)
    fill = colour[None, None, :] * (1.0 + AERIAL_SEA_TEXTURE_GAIN * tex)[..., None]
    out = rgb + (np.clip(fill, 0.0, 1.0) - rgb) * weight[..., None]
    print(f"textures: open sea filled with mosaic sea colour {np.round(colour * 255).astype(int).tolist()}")
    return out.astype(np.float32)


def write_texture_tiles(full: np.ndarray, out_dir: Path) -> int:
    td = out_dir / "t"
    td.mkdir(parents=True, exist_ok=True)
    for stale in td.glob("*.webp"):
        stale.unlink()
    s = geo.TEXTURE_TILE_SIZE
    total = 0
    for row in range(geo.TEXTURE_ROWS):
        for col in range(geo.TEXTURE_COLS):
            tile = full[row * s : (row + 1) * s, col * s : (col + 1) * s]
            p = td / f"{col}_{row}.webp"
            Image.fromarray(tile).save(p, "WEBP", quality=WEBP_QUALITY, method=5)
            total += p.stat().st_size
    overview = Image.fromarray(full).resize((geo.OVERVIEW_SIZE, geo.OVERVIEW_SIZE), Image.Resampling.LANCZOS)
    op = out_dir / "overview.webp"
    overview.save(op, "WEBP", quality=WEBP_QUALITY, method=5)
    total += op.stat().st_size
    print(f"textures: {geo.TEXTURE_COLS * geo.TEXTURE_ROWS} tiles + overview, {total / 1e6:.1f} MB")
    return total


# --------------------------------------------------------------------------- meta
def write_meta(out_dir: Path, imagery: str) -> None:
    raw_tags = {}
    if S2_RAW_PATH.exists():
        with rasterio.open(S2_RAW_PATH) as src:
            raw_tags = src.tags()
    scene = raw_tags.get("SCENE", "Sentinel-2 L2A")
    scene_date = raw_tags.get("DATETIME", "")[:10]
    if imagery == "s2":
        imagery_desc = f"Sentinel-2 L2A {scene} ({scene_date}), 10 m true colour, graded"
        imagery_licence = (
            "Contains modified Copernicus Sentinel data 2026, "
            "free and open (Copernicus Sentinel Data Terms and Conditions), attribution required"
        )
    else:
        imagery_desc = (
            "City of Cape Town aerial orthophoto mosaic January 2025 (5 cm source, exported at 1.25 m/px "
            "from the City image server), graded"
        )
        imagery_licence = (
            "City of Cape Town Open Data Terms of Use, imagery property of the City, "
            "no restrictions for non-commercial purposes (this game is non-commercial), attribution given"
        )
    checkpoints = []
    for p in geo.load_checkpoints():
        x, _, z = geo.lat_lon_to_world(p["lat"], p["lon"])
        checkpoints.append({"name": p["name"], "x": round(x, 1), "z": round(z, 1), "expectedY": p["expectedY"]})
    meta = {
        "version": 1,
        "originLat": geo.ORIGIN_LAT,
        "originLon": geo.ORIGIN_LON,
        "boundsWorld": {"minX": geo.MIN_X, "maxX": geo.MAX_X, "minZ": geo.MIN_Z, "maxZ": geo.MAX_Z},
        "cellSizeM": geo.CELL_SIZE_M,
        "heightTiles": {
            "size": geo.HEIGHT_TILE_SIZE,
            "cols": geo.HEIGHT_COLS,
            "rows": geo.HEIGHT_ROWS,
            "format": "r16",
            "path": "h/{col}_{row}.bin",
            "heightScale": geo.HEIGHT_SCALE,
            "heightOffset": geo.HEIGHT_OFFSET,
        },
        "textureTiles": {
            "size": geo.TEXTURE_TILE_SIZE,
            "cols": geo.TEXTURE_COLS,
            "rows": geo.TEXTURE_ROWS,
            "format": "webp",
            "path": "t/{col}_{row}.webp",
        },
        "overview": {"path": "overview.webp", "size": geo.OVERVIEW_SIZE},
        "source": {
            "dem": (
                "City of Cape Town Ground Level Map 2 m contours (CCT GLM 2019, LiDAR 2019B, 0.3 m vertical accuracy), "
                "linearly interpolated to 5 m; Copernicus GLO-30 used only as the sea mask"
            ),
            "imagery": imagery_desc,
            "licence": (
                "DEM: City of Cape Town Open Data Terms of Use (free, as-is). "
                "Sea mask: Copernicus DEM GLO-30, ESA/Airbus licence, attribution required. "
                f"Imagery: {imagery_licence}."
            ),
        },
        "checkpoints": checkpoints,
        "generated": date.today().isoformat(),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"meta: {out_dir / 'meta.json'}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--heights-only", action="store_true")
    ap.add_argument("--textures-only", action="store_true")
    ap.add_argument(
        "--imagery",
        choices=["cct-aerial", "s2"],
        default="cct-aerial",
        help="cct-aerial: City 5 cm orthophoto (default, non-commercial project); s2: Sentinel-2 10 m, fully open",
    )
    ap.add_argument("--regrade", action="store_true", help="re-run grade.py on the cached raw before tiling")
    ap.add_argument("--reinterpolate", action="store_true", help="redo the contour interpolation instead of reusing the cache")
    args = ap.parse_args()

    out_dir = geo.OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = geo.CACHE_DIR

    scene_dirs = sorted(p for p in (cache / "s2").iterdir() if p.is_dir()) if (cache / "s2").exists() else []
    if not scene_dirs:
        raise SystemExit("no Sentinel-2 scene in cache; run fetch.py first")
    if not S2_RAW_PATH.exists():
        s2_raw_on_grid(scene_dirs[-1])

    if not args.textures_only:
        h = build_heights(
            cache / "contours" / "contours.npz",
            cache / "glo30" / "Copernicus_DSM_COG_10_S34_00_E018_00_DEM.tif",
            args.reinterpolate,
        )
        np.save(HEIGHTS_CACHE, h)
        write_height_tiles(h, out_dir)

    if not args.heights_only:
        if args.imagery == "s2" and (args.regrade or not GRADED_PATH.exists()):
            grade.grade_s2_raw()
        if args.imagery == "cct-aerial" and not (cache / "imagery" / "cct_aerial_2025jan_rgb.tif").exists():
            raise SystemExit("City aerial mosaic not in cache; run fetch.py (it is fetched by default)")
        full = graded_full_res(args.imagery)
        write_texture_tiles(full, out_dir)

    write_meta(out_dir, args.imagery)
    total = sum(p.stat().st_size for p in out_dir.rglob("*") if p.is_file())
    print(f"build: public/terrain is {total / 1e6:.1f} MB (budget 60 MB)")


if __name__ == "__main__":
    main()
