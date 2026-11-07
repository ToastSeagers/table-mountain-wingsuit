"""Snap exits and landing zones to the built terrain (one-off helper, Stage 1).

Exits: within a search radius of the authored position, pick the sample that
maximises the drop along the stated heading over the first 120 m while still
standing near the local top (a ledge, not a point half way down the face).
Landing zones: within the search radius, pick the disc centre with the lowest
mean slope that is on land, favouring the authored surface's look in the
imagery (green for grass, bright for sand).

Prints a table of old and new lat/lon/elevation and writes crops to
``cache/refine/`` for eyeballing. Pass ``--write`` to update the JSON files.

Run from the repo root after build.py: ``python tools/terrain/refine_positions.py [--write]``
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from scipy.ndimage import uniform_filter

import geo
from validate import hillshade

HEIGHTS = geo.CACHE_DIR / "heights_5m.npy"
GRADED = geo.CACHE_DIR / "imagery" / "graded_10m.tif"
OUT = geo.CACHE_DIR / "refine"
EXIT_SEARCH_M = 220.0
ZONE_SEARCH_M = 180.0
# Per-site search radii, after eyeballing the first pass on the City aerial:
# the-table's authored point is 130 m below the western edge, and with a wider
# search it drifts 200 m north to the cable-station corner; 170 m reaches the
# edge south-west of the station without reaching the station.
SEARCH_OVERRIDE_M = {"the-table": 170.0}
# Placed by hand on the January 2025 City aerial imagery where the DEM alone
# cannot tell a lawn from a flat roof: Sea Point lawns run along the promenade
# (buildings are equally flat in a bare-earth DEM), and the Upper Orange field
# is the fenced grass east of the Molteno reservoir, not the reservoir wall.
# The Table: the western edge runs north-south at lon 18.4026; the search picks
# the biggest drop 55 m north of the authored latitude, which is 50 m from the
# cable station. Pinning it due east of the authored point keeps it on the same
# edge, about 1050 m, and 85 m south-west of the station as the design asks.
MANUAL_EXIT_LAT_LON = {"the-table": (-33.9585, 18.4026)}
MANUAL_LAT_LON = {
    "sea-point-prom": (-33.9120, 18.3891),
    "upper-orange": (-33.9386, 18.4148),
    "clifton": (-33.9409, 18.3745),  # Fourth Beach sand; the authored point is on the houses at Third Beach
}
CELL = geo.CELL_SIZE_M


def world_to_rc(x: float, z: float) -> tuple[float, float]:
    return (z - geo.MIN_Z) / CELL, (x - geo.MIN_X) / CELL


def rc_to_world(r: float, c: float) -> tuple[float, float]:
    return geo.MIN_X + c * CELL, geo.MIN_Z + r * CELL


def bilinear(h: np.ndarray, r: float, c: float) -> float:
    r0, c0 = int(np.floor(r)), int(np.floor(c))
    r0 = min(max(r0, 0), h.shape[0] - 2)
    c0 = min(max(c0, 0), h.shape[1] - 2)
    tr, tc = r - r0, c - c0
    return float(
        h[r0, c0] * (1 - tr) * (1 - tc) + h[r0, c0 + 1] * (1 - tr) * tc + h[r0 + 1, c0] * tr * (1 - tc) + h[r0 + 1, c0 + 1] * tr * tc
    )


def heading_dir(heading_deg: float) -> tuple[float, float]:
    """World direction (dx, dz) for a compass heading: dir = (sin h, -cos h)."""
    a = np.deg2rad(heading_deg)
    return float(np.sin(a)), float(-np.cos(a))


def profile(h: np.ndarray, x: float, z: float, heading_deg: float, dists: np.ndarray) -> np.ndarray:
    dx, dz = heading_dir(heading_deg)
    return np.array([bilinear(h, *world_to_rc(x + dx * d, z + dz * d)) for d in dists])


def refine_exit(h: np.ndarray, x0: float, z0: float, heading_deg: float, search_m: float = EXIT_SEARCH_M) -> tuple[float, float, float, dict]:
    r0, c0 = world_to_rc(x0, z0)
    n = int(search_m / CELL)
    rr, cc = np.mgrid[int(r0) - n : int(r0) + n + 1, int(c0) - n : int(c0) + n + 1]
    inside = (rr - r0) ** 2 + (cc - c0) ** 2 <= n * n
    local_top = h[rr[inside], cc[inside]].max()
    best = None
    for r, c in zip(rr[inside], cc[inside]):
        x, z = rc_to_world(r, c)
        here = h[r, c]
        if here < local_top - 40.0:
            continue  # not on the top: half way down the face or in a gully
        p = profile(h, x, z, heading_deg, np.array([30.0, 60.0, 90.0, 120.0]))
        drop = here - p.min()
        if p[0] > here - 5.0:
            continue  # ground ahead is level: still 30 m back from the edge
        dist_pen = 0.15 * np.hypot(x - x0, z - z0)  # 100 m of travel costs 15 m of drop
        score = drop + 0.25 * (here - local_top) - dist_pen  # prefer big drops, then height, near the author's point
        if best is None or score > best[0]:
            best = (score, x, z, here, drop)
    assert best is not None
    _, x, z, y, drop = best
    far = profile(h, x, z, heading_deg, np.arange(0, 801, 50))
    return x, z, y, {"drop120m": round(float(drop), 1), "profile50m": [round(float(v)) for v in far]}


def slope_deg(h: np.ndarray) -> np.ndarray:
    gz, gx = np.gradient(h, CELL)
    return np.degrees(np.arctan(np.hypot(gx, gz)))


def refine_zone(
    h: np.ndarray, slope: np.ndarray, img: np.ndarray, x0: float, z0: float, radius_m: float, surface: str, search_m: float = ZONE_SEARCH_M
) -> tuple[float, float, float, dict]:
    r0, c0 = world_to_rc(x0, z0)
    n = int(search_m / CELL)
    k = max(3, int(round(radius_m / CELL)) | 1)
    mean_slope = uniform_filter(slope, size=k, mode="nearest")
    land = uniform_filter((h > 0.3).astype(np.float32), size=k, mode="nearest")
    # imagery on the 10 m grid: map height sample (r, c) to image pixel
    tg = geo.texture_grid()
    img_rows, img_cols = img.shape[:2]
    rr, cc = np.mgrid[int(r0) - n : int(r0) + n + 1, int(c0) - n : int(c0) + n + 1]
    inside = (rr - r0) ** 2 + (cc - c0) ** 2 <= n * n
    best = None
    for r, c in zip(rr[inside], cc[inside]):
        x, z = rc_to_world(r, c)
        ir = min(int((z - tg.min_z) / (tg.cell_z_m * 8)), img_rows - 1)
        ic = min(int((x - tg.min_x) / (tg.cell_x_m * 8)), img_cols - 1)
        pr, pg, pb = img[ir, ic].astype(float) / 255.0
        if surface == "grass":
            look = np.clip((pg - max(pr, pb)) / 0.08, 0, 1)
        elif surface == "sand":
            look = np.clip(((pr + pg + pb) / 3 - 0.55) / 0.25, 0, 1)
        else:
            look = 0.5
        if surface in ("grass", "tarmac") and land[r, c] < 0.95:
            continue
        if surface == "sand" and (land[r, c] < 0.3 or h[r, c] <= 0.3):
            continue
        dist_pen = np.hypot(x - x0, z - z0) / search_m
        score = mean_slope[r, c] * (1.0 - 0.5 * look) + 2.0 * dist_pen
        if best is None or score < best[0]:
            best = (score, x, z, h[r, c], mean_slope[r, c])
    assert best is not None
    _, x, z, y, ms = best
    return x, z, y, {"meanSlopeDeg": round(float(ms), 1)}


def crop(h: np.ndarray, img: np.ndarray, x: float, z: float, half_m: float, marks: list, path: Path) -> None:
    r, c = world_to_rc(x, z)
    n = int(half_m / CELL)
    r0, r1 = max(0, int(r) - n), min(h.shape[0], int(r) + n)
    c0, c1 = max(0, int(c) - n), min(h.shape[1], int(c) + n)
    sub = h[r0:r1, c0:c1]
    shade = (hillshade(sub, CELL) * 255).astype(np.uint8)
    left = Image.fromarray(shade).convert("RGB").resize(((c1 - c0) * 3, (r1 - r0) * 3), Image.Resampling.NEAREST)
    tg = geo.texture_grid()
    ir0 = int((geo.MIN_Z + r0 * CELL - tg.min_z) / (tg.cell_z_m * 8))
    ir1 = int((geo.MIN_Z + r1 * CELL - tg.min_z) / (tg.cell_z_m * 8))
    ic0 = int((geo.MIN_X + c0 * CELL - tg.min_x) / (tg.cell_x_m * 8))
    ic1 = int((geo.MIN_X + c1 * CELL - tg.min_x) / (tg.cell_x_m * 8))
    right = Image.fromarray(img[ir0:ir1, ic0:ic1]).resize(left.size, Image.Resampling.LANCZOS)
    for im in (left, right):
        d = ImageDraw.Draw(im)
        for mx, mz, colour, label, rad in marks:
            px = ((mx - geo.MIN_X) / CELL - c0) * 3
            py = ((mz - geo.MIN_Z) / CELL - r0) * 3
            rp = max(4, rad / CELL * 3)
            d.ellipse([px - rp, py - rp, px + rp, py + rp], outline=colour, width=2)
            d.text((px + rp + 2, py - 5), label, fill=colour)
    out = Image.new("RGB", (left.width * 2 + 6, left.height))
    out.paste(left, (0, 0))
    out.paste(right, (left.width + 6, 0))
    out.save(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="update data/exits.json and data/landing-zones.json")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    h = np.load(HEIGHTS)
    slope = slope_deg(h)
    with rasterio.open(GRADED) as src:
        img = np.moveaxis(src.read(), 0, -1)

    exits_path = geo.DATA_DIR / "exits.json"
    zones_path = geo.DATA_DIR / "landing-zones.json"
    exits_text = exits_path.read_text(encoding="utf-8")
    zones_text = zones_path.read_text(encoding="utf-8")
    exits = json.loads(exits_text)
    zones = json.loads(zones_text)

    print(f"{'id':<18} {'old lat':>9} {'old lon':>9} {'old m':>6}   {'new lat':>9} {'new lon':>9} {'new m':>6}  moved  notes")
    for e in exits["exits"]:
        lat0, lon0 = e["latLon"]["lat"], e["latLon"]["lon"]
        x0, _, z0 = geo.lat_lon_to_world(lat0, lon0)
        if e["id"] in MANUAL_EXIT_LAT_LON:
            mlat, mlon = MANUAL_EXIT_LAT_LON[e["id"]]
            x, _, z = geo.lat_lon_to_world(mlat, mlon)
            y = bilinear(h, *world_to_rc(x, z))
            far = profile(h, x, z, e["headingDeg"], np.arange(0, 801, 50))
            info = {"manual": "pinned on the western edge", "profile50m": [round(float(v)) for v in far]}
        else:
            x, z, y, info = refine_exit(h, x0, z0, e["headingDeg"], SEARCH_OVERRIDE_M.get(e["id"], EXIT_SEARCH_M))
        lat, lon = geo.world_to_lat_lon(x, z)
        moved = np.hypot(x - x0, z - z0)
        print(f"{e['id']:<18} {lat0:9.4f} {lon0:9.4f} {e['elevationM']:6.0f}   {lat:9.4f} {lon:9.4f} {y:6.0f}  {moved:4.0f} m  {info}")
        marks = [(x0, z0, "#ff4040", "old", 8), (x, z, "#40ff40", "new", 8)]
        dx, dz = heading_dir(e["headingDeg"])
        marks.append((x + dx * 150, z + dz * 150, "#ffff40", "heading", 4))
        crop(h, img, (x0 + x) / 2, (z0 + z) / 2, 400, marks, OUT / f"exit_{e['id']}.png")
        e["latLon"] = {"lat": round(lat, 5), "lon": round(lon, 5)}
        e["elevationM"] = int(round(y))

    for zn in zones["zones"]:
        lat0, lon0 = zn["latLon"]["lat"], zn["latLon"]["lon"]
        x0, _, z0 = geo.lat_lon_to_world(lat0, lon0)
        if zn["id"] in MANUAL_LAT_LON:
            mlat, mlon = MANUAL_LAT_LON[zn["id"]]
            x, _, z = geo.lat_lon_to_world(mlat, mlon)
            y, info = bilinear(h, *world_to_rc(x, z)), {"manual": "placed on City aerial imagery"}
        else:
            x, z, y, info = refine_zone(h, slope, img, x0, z0, zn["radiusM"], zn["surface"], SEARCH_OVERRIDE_M.get(zn["id"], ZONE_SEARCH_M))
        lat, lon = geo.world_to_lat_lon(x, z)
        moved = np.hypot(x - x0, z - z0)
        print(f"{zn['id']:<18} {lat0:9.4f} {lon0:9.4f} {'':>6}   {lat:9.4f} {lon:9.4f} {y:6.1f}  {moved:4.0f} m  {info}")
        marks = [(x0, z0, "#ff4040", "old", zn["radiusM"]), (x, z, "#40ff40", "new", zn["radiusM"])]
        crop(h, img, (x0 + x) / 2, (z0 + z) / 2, 350, marks, OUT / f"zone_{zn['id']}.png")
        zn["latLon"] = {"lat": round(lat, 5), "lon": round(lon, 5)}

    if args.write:
        # Patch values in place so the hand-formatted JSON keeps its layout.
        for e in exits["exits"]:
            exits_text = re.sub(
                rf'("id": "{e["id"]}",.*?"latLon": )\{{[^}}]*\}}(,\s*"elevationM": )\d+',
                lambda m: f'{m.group(1)}{{ "lat": {e["latLon"]["lat"]}, "lon": {e["latLon"]["lon"]} }}{m.group(2)}{e["elevationM"]}',
                exits_text,
                flags=re.S,
            )
        for zn in zones["zones"]:
            zones_text = re.sub(
                rf'("id": "{zn["id"]}",.*?"latLon": )\{{[^}}]*\}}',
                lambda m: f'{m.group(1)}{{ "lat": {zn["latLon"]["lat"]}, "lon": {zn["latLon"]["lon"]} }}',
                zones_text,
                flags=re.S,
            )
        exits_path.write_text(exits_text, encoding="utf-8")
        zones_path.write_text(zones_text, encoding="utf-8")
        json.loads(exits_text)
        json.loads(zones_text)
        print("wrote data/exits.json and data/landing-zones.json")
    print(f"crops in {OUT}")


if __name__ == "__main__":
    main()
