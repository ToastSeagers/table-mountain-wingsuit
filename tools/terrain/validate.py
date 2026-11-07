"""Validate ``public/terrain/`` against data/checkpoints.json and the format spec.

Checks, in order (any failure exits non-zero):

1. ``geo.py`` constants match ``src/world/geo.ts``.
2. ``meta.json`` exists and every height and texture tile it names exists with
   the right size.
3. Every checkpoint in ``data/checkpoints.json`` samples (bilinear, from the
   tiles on disk, not from any intermediate) within its tolerance.
4. Tile seams: the shared edge samples of neighbouring height tiles are equal.
5. Total bytes under the 60 MB budget.

Also writes ``tools/terrain/preview.png``: hillshaded heights beside the
texture overview, with the checkpoints, exits and landing zones marked.

Run from the repo root: ``python tools/terrain/validate.py``
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import geo

BUDGET_BYTES = 60_000_000
PREVIEW_PATH = geo.TOOLS_DIR / "preview.png"


class Failure(Exception):
    pass


def check_geo_constants() -> None:
    ts = (geo.REPO_ROOT / "src" / "world" / "geo.ts").read_text(encoding="utf-8")

    def ts_const(name: str) -> float:
        m = re.search(rf"export const {name}\s*=\s*([-\d_.]+)", ts)
        if not m:
            raise Failure(f"geo.ts: constant {name} not found")
        return float(m.group(1).replace("_", ""))

    pairs = {
        "ORIGIN_LAT": geo.ORIGIN_LAT,
        "ORIGIN_LON": geo.ORIGIN_LON,
        "METRES_PER_DEG_LAT": geo.METRES_PER_DEG_LAT,
        "METRES_PER_DEG_LON": geo.METRES_PER_DEG_LON,
    }
    for name, py_value in pairs.items():
        if abs(ts_const(name) - py_value) > 1e-9:
            raise Failure(f"geo constant {name} differs: ts={ts_const(name)} py={py_value}")
    print("ok   geo.py constants match src/world/geo.ts")


class TileSampler:
    """Reads height tiles from disk exactly as a client would."""

    def __init__(self, terrain_dir: Path, meta: dict):
        self.dir = terrain_dir
        self.meta = meta
        ht = meta["heightTiles"]
        self.size = ht["size"]
        self.scale = ht["heightScale"]
        self.offset = ht["heightOffset"]
        self.cols = ht["cols"]
        self.rows = ht["rows"]
        self.cell = meta["cellSizeM"]
        self.min_x = meta["boundsWorld"]["minX"]
        self.min_z = meta["boundsWorld"]["minZ"]
        self.tiles: dict[tuple[int, int], np.ndarray] = {}

    def tile(self, col: int, row: int) -> np.ndarray:
        key = (col, row)
        if key not in self.tiles:
            path = self.dir / self.meta["heightTiles"]["path"].format(col=col, row=row)
            raw = np.frombuffer(path.read_bytes(), dtype="<u2")
            if raw.size != self.size * self.size:
                raise Failure(f"{path.name}: {raw.size} samples, expected {self.size * self.size}")
            self.tiles[key] = raw.reshape(self.size, self.size)
        return self.tiles[key]

    def mosaic(self) -> np.ndarray:
        """Full height field in metres (stitched, overlaps collapsed)."""
        step = self.size - 1
        out = np.zeros((step * self.rows + 1, step * self.cols + 1), dtype=np.float32)
        for r in range(self.rows):
            for c in range(self.cols):
                out[r * step : r * step + self.size, c * step : c * step + self.size] = self.tile(c, r)
        return out * self.scale + self.offset

    def height_at(self, x: float, z: float) -> float:
        fx = (x - self.min_x) / self.cell
        fz = (z - self.min_z) / self.cell
        step = self.size - 1
        n_cols = step * self.cols
        n_rows = step * self.rows
        if not (0 <= fx < n_cols and 0 <= fz < n_rows):
            return 0.0
        i0, j0 = int(fx), int(fz)
        tx, tz = fx - i0, fz - j0

        def sample(i: int, j: int) -> float:
            i = min(i, n_cols)
            j = min(j, n_rows)
            c, r = min(i // step, self.cols - 1), min(j // step, self.rows - 1)
            return float(self.tile(c, r)[j - r * step, i - c * step]) * self.scale + self.offset

        h00, h10 = sample(i0, j0), sample(i0 + 1, j0)
        h01, h11 = sample(i0, j0 + 1), sample(i0 + 1, j0 + 1)
        return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz


def check_files(terrain_dir: Path, meta: dict) -> int:
    total = 0
    ht, tt = meta["heightTiles"], meta["textureTiles"]
    for r in range(ht["rows"]):
        for c in range(ht["cols"]):
            p = terrain_dir / ht["path"].format(col=c, row=r)
            if not p.exists():
                raise Failure(f"missing height tile {p.name}")
            if p.stat().st_size != ht["size"] * ht["size"] * 2:
                raise Failure(f"{p.name}: {p.stat().st_size} bytes, expected {ht['size'] * ht['size'] * 2}")
            total += p.stat().st_size
    for r in range(tt["rows"]):
        for c in range(tt["cols"]):
            p = terrain_dir / tt["path"].format(col=c, row=r)
            if not p.exists():
                raise Failure(f"missing texture tile {p.name}")
            with Image.open(p) as im:
                if im.size != (tt["size"], tt["size"]):
                    raise Failure(f"{p.name}: size {im.size}, expected {tt['size']}")
            total += p.stat().st_size
    ov = terrain_dir / "overview.webp"
    if not ov.exists():
        raise Failure("missing overview.webp")
    with Image.open(ov) as im:
        if im.size != (2048, 2048):
            raise Failure(f"overview.webp is {im.size}, expected 2048 x 2048")
    total += ov.stat().st_size
    total += (terrain_dir / "meta.json").stat().st_size
    print(f"ok   {ht['cols'] * ht['rows']} height tiles, {tt['cols'] * tt['rows']} texture tiles, overview present")
    return total


def check_checkpoints(sampler: TileSampler) -> list[tuple[str, float, float, float, bool]]:
    results = []
    all_ok = True
    for p in geo.load_checkpoints():
        x, _, z = geo.lat_lon_to_world(p["lat"], p["lon"])
        y = sampler.height_at(x, z)
        err = y - p["expectedY"]
        ok = abs(err) <= p["toleranceM"]
        all_ok &= ok
        results.append((p["name"], x, z, y, ok))
        print(f"{'ok  ' if ok else 'FAIL'} {p['name']:<24} sampled {y:8.1f} m  expected {p['expectedY']:6.0f} ± {p['toleranceM']:2d}  (err {err:+.1f})")
    if not all_ok:
        raise Failure("checkpoint(s) out of tolerance")
    return results


def check_seams(sampler: TileSampler) -> None:
    worst = 0
    for r in range(sampler.rows):
        for c in range(sampler.cols):
            t = sampler.tile(c, r)
            if c + 1 < sampler.cols:
                right = sampler.tile(c + 1, r)
                worst = max(worst, int(np.abs(t[:, -1].astype(int) - right[:, 0].astype(int)).max()))
            if r + 1 < sampler.rows:
                below = sampler.tile(c, r + 1)
                worst = max(worst, int(np.abs(t[-1, :].astype(int) - below[0, :].astype(int)).max()))
    if worst != 0:
        raise Failure(f"tile seams differ by up to {worst} steps")
    print("ok   tile seams: shared edge samples identical on every neighbour pair")


def hillshade(h: np.ndarray, cell: float, azimuth_deg: float = 290.0, elevation_deg: float = 25.0) -> np.ndarray:
    dz_dx = np.gradient(h, cell, axis=1)
    dz_dz = np.gradient(h, cell, axis=0)
    slope = np.arctan(np.hypot(dz_dx, dz_dz))
    aspect = np.arctan2(-dz_dz, dz_dx)  # world: col east, row south
    az = np.deg2rad(360.0 - azimuth_deg + 90.0)
    el = np.deg2rad(elevation_deg)
    shade = np.sin(el) * np.cos(slope) + np.cos(el) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)


def write_preview(sampler: TileSampler, terrain_dir: Path, checkpoints: list) -> None:
    h = sampler.mosaic()
    shade = hillshade(h, sampler.cell)
    # Tint by height so flat sea and flat table top are distinguishable.
    t = np.clip(h / 1100.0, 0, 1)
    rgb = np.stack([0.35 + 0.65 * t, 0.45 + 0.4 * t, 0.55 - 0.1 * t], axis=-1)
    rgb = (rgb * (0.25 + 0.75 * shade[..., None]) * 255).astype(np.uint8)
    rgb[h <= 0] = (24, 56, 96)
    left = Image.fromarray(rgb)
    scale = 1024 / left.width
    left = left.resize((1024, int(left.height * scale)), Image.Resampling.LANCZOS)
    right = Image.open(terrain_dir / "overview.webp").convert("RGB").resize(left.size, Image.Resampling.LANCZOS)

    def mark(im: Image.Image, x: float, z: float, colour: str, label: str, radius_px: int = 5) -> None:
        d = ImageDraw.Draw(im)
        px = (x - geo.MIN_X) / (geo.MAX_X - geo.MIN_X) * im.width
        py = (z - geo.MIN_Z) / (geo.MAX_Z - geo.MIN_Z) * im.height
        d.ellipse([px - radius_px, py - radius_px, px + radius_px, py + radius_px], outline=colour, width=2)
        d.text((px + radius_px + 2, py - 6), label, fill=colour)

    exits = json.loads((geo.DATA_DIR / "exits.json").read_text(encoding="utf-8"))["exits"]
    zones = json.loads((geo.DATA_DIR / "landing-zones.json").read_text(encoding="utf-8"))["zones"]
    for im in (left, right):
        for name, x, z, _y, ok in checkpoints:
            mark(im, x, z, "#00ff66" if ok else "#ff3030", name.split(" (")[0])
        for e in exits:
            x, _, z = geo.lat_lon_to_world(e["latLon"]["lat"], e["latLon"]["lon"])
            mark(im, x, z, "#ffd200", e["id"], 7)
        for zn in zones:
            x, _, z = geo.lat_lon_to_world(zn["latLon"]["lat"], zn["latLon"]["lon"])
            r_px = max(3, int(zn["radiusM"] / (geo.MAX_X - geo.MIN_X) * im.width))
            mark(im, x, z, "#40c0ff", zn["id"], r_px)
    out = Image.new("RGB", (left.width * 2 + 8, left.height), (0, 0, 0))
    out.paste(left, (0, 0))
    out.paste(right, (left.width + 8, 0))
    out.save(PREVIEW_PATH)
    print(f"ok   preview written to {PREVIEW_PATH.relative_to(geo.REPO_ROOT)}")


def main() -> int:
    terrain_dir = geo.OUTPUT_DIR
    try:
        check_geo_constants()
        meta_path = terrain_dir / "meta.json"
        if not meta_path.exists():
            raise Failure("public/terrain/meta.json missing; run build.py")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        total = check_files(terrain_dir, meta)
        sampler = TileSampler(terrain_dir, meta)
        checkpoints = check_checkpoints(sampler)
        check_seams(sampler)
        if total > BUDGET_BYTES:
            raise Failure(f"public/terrain is {total / 1e6:.1f} MB, over the 60 MB budget")
        print(f"ok   public/terrain total {total / 1e6:.1f} MB of 60 MB budget")
        write_preview(sampler, terrain_dir, checkpoints)
    except Failure as e:
        print(f"FAIL {e}")
        return 1
    print("validate: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
