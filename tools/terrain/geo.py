"""Coordinate frame and output grid for the terrain pipeline.

The constants here must match ``src/world/geo.ts`` (docs/01-architecture.md
section 3). World space is metres: X east, Y up (metres above sea level),
Z south. The lat/lon conversion is a fixed linear scaling, which means the
world grid is also a plain geographic (EPSG:4326) grid with anisotropic cells,
so rasterio can warp straight into it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from rasterio.transform import Affine

ORIGIN_LAT = -33.95
ORIGIN_LON = 18.41
METRES_PER_DEG_LAT = 110_940  # at 34 degrees south
METRES_PER_DEG_LON = 92_380  # 111_320 * cos(33.95 deg)

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = Path(__file__).resolve().parent
CACHE_DIR = TOOLS_DIR / "cache"
OUTPUT_DIR = REPO_ROOT / "public" / "terrain"
DATA_DIR = REPO_ROOT / "data"

# Height grid: 5 m cells, 512-sample tiles with a 1-sample overlap, so each
# tile advances 511 cells (2555 m). 5 x 4 tiles = 12 775 x 10 220 m, centred on
# the AOI from docs/01-architecture.md section 3 (X -5540..6470, Z -5550..4440)
# with a small margin on every side. Origins are multiples of 5 m.
CELL_SIZE_M = 5.0
HEIGHT_TILE_SIZE = 512
HEIGHT_COLS = 5
HEIGHT_ROWS = 4
HEIGHT_SCALE = 0.05  # uint16 steps of 5 cm, 0..3276 m
HEIGHT_OFFSET = 0.0
MIN_X = -5925.0
MIN_Z = -5665.0
MAX_X = MIN_X + CELL_SIZE_M * (HEIGHT_TILE_SIZE - 1) * HEIGHT_COLS  # 6850
MAX_Z = MIN_Z + CELL_SIZE_M * (HEIGHT_TILE_SIZE - 1) * HEIGHT_ROWS  # 4555

# Texture grid: 10 x 8 tiles of 1024 px over the same bounds (1.2476 m/px).
TEXTURE_TILE_SIZE = 1024
TEXTURE_COLS = 10
TEXTURE_ROWS = 8
OVERVIEW_SIZE = 2048


def lat_lon_to_world(lat: float, lon: float, elevation_m: float = 0.0) -> tuple[float, float, float]:
    """Same formula as latLonToWorld in src/world/geo.ts. North is negative Z."""
    x = (lon - ORIGIN_LON) * METRES_PER_DEG_LON
    z = -(lat - ORIGIN_LAT) * METRES_PER_DEG_LAT
    return x, elevation_m, z


def world_to_lat_lon(x: float, z: float) -> tuple[float, float]:
    lat = ORIGIN_LAT - z / METRES_PER_DEG_LAT
    lon = ORIGIN_LON + x / METRES_PER_DEG_LON
    return lat, lon


@dataclass(frozen=True)
class WorldGrid:
    """A raster aligned to the world frame: row 0 is the northern edge (min Z)."""

    min_x: float
    min_z: float
    cell_x_m: float
    cell_z_m: float
    width: int
    height: int

    @property
    def max_x(self) -> float:
        return self.min_x + self.cell_x_m * self.width

    @property
    def max_z(self) -> float:
        return self.min_z + self.cell_z_m * self.height

    @property
    def geo_transform(self) -> Affine:
        """EPSG:4326 transform with the pixel grid of this world grid."""
        lat0, lon0 = world_to_lat_lon(self.min_x, self.min_z)
        return Affine(
            self.cell_x_m / METRES_PER_DEG_LON,
            0.0,
            lon0,
            0.0,
            -self.cell_z_m / METRES_PER_DEG_LAT,
            lat0,
        )

    def geo_bounds(self, margin_m: float = 0.0) -> tuple[float, float, float, float]:
        """(west, south, east, north) in degrees, with a margin in metres."""
        south, west = world_to_lat_lon(self.min_x - margin_m, self.max_z + margin_m)
        north, east = world_to_lat_lon(self.max_x + margin_m, self.min_z - margin_m)
        return west, south, east, north

    def world_to_pixel(self, x: float, z: float) -> tuple[float, float]:
        """Fractional (col, row) of a world point; pixel centres sit at +0.5."""
        return (x - self.min_x) / self.cell_x_m, (z - self.min_z) / self.cell_z_m


def height_sample_grid() -> WorldGrid:
    """Grid of height *samples* (cell corners): 2556 x 2045 points, 5 m apart.

    Sample (col, row) is at world (MIN_X + 5 col, MIN_Z + 5 row). As a raster
    with pixel centres on the samples, the raster origin is half a cell up-left.
    """
    w = (HEIGHT_TILE_SIZE - 1) * HEIGHT_COLS + 1
    h = (HEIGHT_TILE_SIZE - 1) * HEIGHT_ROWS + 1
    return WorldGrid(MIN_X - CELL_SIZE_M / 2, MIN_Z - CELL_SIZE_M / 2, CELL_SIZE_M, CELL_SIZE_M, w, h)


def texture_grid() -> WorldGrid:
    w = TEXTURE_TILE_SIZE * TEXTURE_COLS
    h = TEXTURE_TILE_SIZE * TEXTURE_ROWS
    return WorldGrid(MIN_X, MIN_Z, (MAX_X - MIN_X) / w, (MAX_Z - MIN_Z) / h, w, h)


def overview_grid() -> WorldGrid:
    return WorldGrid(
        MIN_X,
        MIN_Z,
        (MAX_X - MIN_X) / OVERVIEW_SIZE,
        (MAX_Z - MIN_Z) / OVERVIEW_SIZE,
        OVERVIEW_SIZE,
        OVERVIEW_SIZE,
    )


def load_checkpoints() -> list[dict]:
    with open(DATA_DIR / "checkpoints.json", encoding="utf-8") as f:
        return json.load(f)["points"]


if __name__ == "__main__":
    for p in load_checkpoints():
        x, _, z = lat_lon_to_world(p["lat"], p["lon"])
        print(f"{p['name']:<24} x={x:9.1f} z={z:9.1f} expectedY={p['expectedY']}")
    g = height_sample_grid()
    print("height samples", g.width, "x", g.height, "bounds", MIN_X, MAX_X, MIN_Z, MAX_Z)
    print("geo bounds", g.geo_bounds())
