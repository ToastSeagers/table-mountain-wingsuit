"""Download and cache the raw inputs for the terrain pipeline.

Everything lands in ``tools/terrain/cache/`` (git-ignored). Re-running skips
anything already cached, so a partial download can be resumed.

Sources (see docs/ASSETS.md for licences):

* City of Cape Town Ground Level Map 2 m contours (CCT GLM 2019, LiDAR 2019B),
  hosted ArcGIS feature service. The City's 5 m DEM is only served as a
  rendered 8-bit picture (no WCS, no float export), so the contours are the
  highest-fidelity elevation source we can actually download.
* Copernicus GLO-30 DEM tile S34 E018 (AWS open data), used as the sea mask and
  as the fallback surface where contours are missing.
* Sentinel-2 L2A bands B02, B03, B04, B08 at 10 m from the AWS ``sentinel-cogs``
  bucket (Element84 Earth Search STAC), windowed to the AOI.
* City of Cape Town aerial orthophoto mosaic (January 2025) via the City's
  image server, exported straight onto the texture grid. Its terms allow
  non-commercial use, which this project is. ``--no-cct-aerial`` skips it
  (then build with ``--imagery s2``).

Run from the repo root: ``python tools/terrain/fetch.py [--no-cct-aerial]``
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

import geo

CONTOUR_LAYER = (
    "https://services6.arcgis.com/nyYfO9SxHU2ChQd9/arcgis/rest/services/GLM_2m/FeatureServer/1"
)
# Hartebeesthoek94 / Lo19 as the service reports it: plain Transverse Mercator,
# central meridian 19 E, no false origin, x east and y north (both negative here).
CONTOUR_PROJ = "+proj=tmerc +lat_0=0 +lon_0=19 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
CONTOUR_SIMPLIFY_M = 0.5  # Douglas-Peucker tolerance applied server-side
CONTOUR_BATCH = 25
CONTOUR_MARGIN_M = 250.0  # extra contours beyond the grid so edge cells interpolate

GLO30_URL = (
    "https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_S34_00_E018_00_DEM/Copernicus_DSM_COG_10_S34_00_E018_00_DEM.tif"
)

STAC_ITEMS = "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/"
# Summer scene, cloud cover 0.04 %, checked visually over the AOI against five
# other candidates (see stage-1 report). Change here to re-texture from another scene.
S2_SCENE = "S2C_34HBH_20260114_0_L2A"
S2_BANDS = ("B02", "B03", "B04", "B08")
S2_MARGIN_M = 500.0

CCT_AERIAL_SERVICE = (
    "https://cityimg.capetown.gov.za/erdas-iws/esri/GeoSpatial%20Datasets/rest/services/"
    "Aerial%20Imagery_Aerial%20Imagery%202025Jan/MapServer/export"
)
CCT_AERIAL_CHUNK_PX = 4000  # server maximum

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "table-mountain-wingsuit-terrain-pipeline/1.0"


def _get_json(url: str, params: dict, retries: int = 5) -> dict:
    for attempt in range(retries):
        try:
            r = SESSION.get(url, params=params, timeout=300)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(f"ArcGIS error: {data['error']}")
            return data
        except (requests.RequestException, ValueError, RuntimeError) as e:
            if attempt == retries - 1:
                raise
            wait = 2**attempt
            print(f"  retry in {wait}s after: {e}", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("unreachable")


# --------------------------------------------------------------------------- contours
def fetch_contours(out_dir: Path) -> Path:
    """Fetch every 2 m contour intersecting the grid (+margin) and compact them.

    Writes ``contours.npz`` with float32 arrays ``x``, ``z`` (world metres) and
    ``elev`` (metres ASL, orthometric SA Land Levelling Datum), one row per
    vertex, plus ``line_id`` so build.py can densify along each line.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / "contours.npz"
    if final.exists():
        print(f"contours: cached ({final})")
        return final

    west, south, east, north = geo.height_sample_grid().geo_bounds(CONTOUR_MARGIN_M)
    geometry = f"{west},{south},{east},{north}"
    base = {
        "where": "1=1",
        "geometry": geometry,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "f": "json",
    }
    ids_file = out_dir / "object_ids.json"
    if ids_file.exists():
        ids = json.loads(ids_file.read_text())
    else:
        print("contours: listing object ids ...")
        ids = sorted(_get_json(f"{CONTOUR_LAYER}/query", {**base, "returnIdsOnly": "true"})["objectIds"])
        ids_file.write_text(json.dumps(ids))
    print(f"contours: {len(ids)} lines in the AOI")

    to_lonlat = Transformer.from_crs(CONTOUR_PROJ, "EPSG:4326", always_xy=True)
    xs: list[np.ndarray] = []
    zs: list[np.ndarray] = []
    es: list[np.ndarray] = []
    lids: list[np.ndarray] = []
    n_lines = 0
    for b in range(0, len(ids), CONTOUR_BATCH):
        batch = ids[b : b + CONTOUR_BATCH]
        cache = out_dir / f"batch_{b // CONTOUR_BATCH:04d}.json"
        if cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
        else:
            data = _get_json(
                f"{CONTOUR_LAYER}/query",
                {
                    "objectIds": ",".join(map(str, batch)),
                    "outFields": "OBJECTID,ELVT",
                    "returnGeometry": "true",
                    "maxAllowableOffset": str(CONTOUR_SIMPLIFY_M),
                    "geometryPrecision": "1",
                    "f": "json",
                },
            )
            if len(data.get("features", [])) != len(batch):
                raise RuntimeError(f"batch {b}: expected {len(batch)} features, got {len(data.get('features', []))}")
            cache.write_text(json.dumps(data), encoding="utf-8")
            print(f"  fetched {b + len(batch)}/{len(ids)}", end="\r", flush=True)
        for feat in data["features"]:
            elev = float(feat["attributes"]["ELVT"])
            for path in feat["geometry"]["paths"]:
                arr = np.asarray(path, dtype=np.float64)
                if len(arr) < 2:
                    continue
                lon, lat = to_lonlat.transform(arr[:, 0], arr[:, 1])
                x = (np.asarray(lon) - geo.ORIGIN_LON) * geo.METRES_PER_DEG_LON
                z = -(np.asarray(lat) - geo.ORIGIN_LAT) * geo.METRES_PER_DEG_LAT
                xs.append(x.astype(np.float32))
                zs.append(z.astype(np.float32))
                es.append(np.full(len(arr), elev, dtype=np.float32))
                lids.append(np.full(len(arr), n_lines, dtype=np.int32))
                n_lines += 1
    print()
    x = np.concatenate(xs)
    z = np.concatenate(zs)
    e = np.concatenate(es)
    lid = np.concatenate(lids)
    np.savez_compressed(final, x=x, z=z, elev=e, line_id=lid)
    print(f"contours: {n_lines} paths, {len(x):,} vertices, elev {e.min():.0f}..{e.max():.0f} m -> {final}")
    return final


# --------------------------------------------------------------------------- GLO-30
def fetch_glo30(out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / Path(GLO30_URL).name
    if dest.exists():
        print(f"glo30: cached ({dest})")
        return dest
    print("glo30: downloading tile S34 E018 (about 34 MB) ...")
    with SESSION.get(GLO30_URL, stream=True, timeout=600) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.rename(dest)
    return dest


# --------------------------------------------------------------------------- Sentinel-2
def fetch_sentinel2(out_dir: Path, scene: str = S2_SCENE) -> Path:
    """Window the AOI out of each band COG and save it as a local GeoTIFF."""
    scene_dir = out_dir / scene
    scene_dir.mkdir(parents=True, exist_ok=True)
    item_file = scene_dir / "stac_item.json"
    if not item_file.exists():
        item_file.write_text(json.dumps(_get_json(STAC_ITEMS + scene, {}), indent=1), encoding="utf-8")
    item = json.loads(item_file.read_text(encoding="utf-8"))
    west, south, east, north = geo.texture_grid().geo_bounds(S2_MARGIN_M)
    env = rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif")
    asset_key = {"B02": "blue", "B03": "green", "B04": "red", "B08": "nir"}
    for band in S2_BANDS:
        dest = scene_dir / f"{band}.tif"
        if dest.exists():
            continue
        href = item["assets"][asset_key[band]]["href"]
        print(f"s2: {scene} {band} <- {href}")
        with env, rasterio.open("/vsicurl/" + href) as src:
            b = transform_bounds("EPSG:4326", src.crs, west, south, east, north)
            win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
            data = src.read(1, window=win)
            profile = src.profile.copy()
            profile.update(
                driver="GTiff",
                width=data.shape[1],
                height=data.shape[0],
                transform=src.window_transform(win),
                compress="deflate",
                tiled=False,
            )
            profile.pop("blockxsize", None)
            profile.pop("blockysize", None)
            with rasterio.open(dest, "w", **profile) as dst:
                dst.write(data, 1)
    print(f"s2: bands cached in {scene_dir}")
    return scene_dir


# --------------------------------------------------------------------------- CCT aerial (optional)
def fetch_cct_aerial(out_dir: Path) -> Path:
    """Export the City orthophoto mosaic onto the texture grid, in 4000 px chunks.

    The server renders into the requested bbox/size, so asking for exactly our
    grid cells in EPSG:4326 gives a pixel-aligned mosaic with no resampling step.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "cct_aerial_2025jan_rgb.tif"
    if dest.exists():
        print(f"cct-aerial: cached ({dest})")
        return dest
    grid = geo.texture_grid()
    t = grid.geo_transform
    profile = {
        "driver": "GTiff",
        "dtype": "uint8",
        "count": 3,
        "width": grid.width,
        "height": grid.height,
        "crs": "EPSG:4326",
        "transform": t,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 512,
        "blockysize": 512,
    }
    from io import BytesIO

    from PIL import Image

    with rasterio.open(dest.with_suffix(".part.tif"), "w", **profile) as dst:
        for row0 in range(0, grid.height, CCT_AERIAL_CHUNK_PX):
            for col0 in range(0, grid.width, CCT_AERIAL_CHUNK_PX):
                w = min(CCT_AERIAL_CHUNK_PX, grid.width - col0)
                h = min(CCT_AERIAL_CHUNK_PX, grid.height - row0)
                west, north = t * (col0, row0)
                east, south = t * (col0 + w, row0 + h)
                params = {
                    "bbox": f"{west},{south},{east},{north}",
                    "bboxSR": "4326",
                    "imageSR": "4326",
                    "size": f"{w},{h}",
                    "format": "png24",
                    "f": "image",
                }
                print(f"cct-aerial: chunk col {col0} row {row0} ({w}x{h})")
                r = SESSION.get(CCT_AERIAL_SERVICE, params=params, timeout=600)
                r.raise_for_status()
                img = np.asarray(Image.open(BytesIO(r.content)).convert("RGB"))
                dst.write(img.transpose(2, 0, 1), window=((row0, row0 + h), (col0, col0 + w)))
    dest.with_suffix(".part.tif").rename(dest)
    return dest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-cct-aerial", action="store_true", help="skip the City aerial mosaic export (then build --imagery s2)")
    ap.add_argument("--scene", default=S2_SCENE, help="Sentinel-2 L2A STAC item id")
    args = ap.parse_args()

    fetch_glo30(geo.CACHE_DIR / "glo30")
    fetch_contours(geo.CACHE_DIR / "contours")
    fetch_sentinel2(geo.CACHE_DIR / "s2", args.scene)
    if not args.no_cct_aerial:
        fetch_cct_aerial(geo.CACHE_DIR / "imagery")
    print("fetch: done")


if __name__ == "__main__":
    main()
