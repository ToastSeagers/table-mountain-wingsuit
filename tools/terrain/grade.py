"""Imagery colour grade from docs/design/look-and-feel.md section 4.

Target: a well-exposed golden-hour photo, not a map. The steps, in order:
exposure stretch (reflectance -> display), lift shadows slightly, warm the
midtones (+8/255 toward orange), desaturate greens 15 percent, and push the sea
toward a deep blue so it is not the near-black Sentinel-2 renders it as.

``grade_rgb`` is pure numpy so Stage 5 can re-grade by editing the constants
and running ``python tools/terrain/grade.py`` (re-grades the cached raw image,
then ``python tools/terrain/build.py --textures-only`` re-tiles it).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio

import geo

# Sentinel-2 L2A exposure. BOA reflectance of bright sand is about 0.45; the
# white point is set a little above that so beaches do not clip, and the black
# point lifts the darkest shadows off zero before the shadow lift.
S2_BLACK_REFLECTANCE = 0.01
S2_WHITE_REFLECTANCE = 0.42
DISPLAY_GAMMA = 1.0 / 1.9  # reflectance is linear light; sRGB-ish display curve

SHADOW_LIFT = 0.045  # added as lift * (1 - x)^2, so highlights are untouched
WARM_MIDTONE_RGB = (8.0 / 255.0, 2.5 / 255.0, -6.0 / 255.0)  # +8 toward orange
GREEN_DESATURATE = 0.15
GREEN_MASK_WIDTH = 0.08  # how far G must exceed max(R, B) for the full effect
SEA_BLUE = np.array([0.16, 0.38, 0.58], dtype=np.float32)  # Atlantic at golden hour
SEA_MIX = 0.85  # L2A sea is almost black, so paint most of the way to SEA_BLUE
SEA_BRIGHTEN = 6.0  # sea texture (swell, shallows) gain before mixing
AERIAL_SEA_MIX = 0.25  # the City mosaic's sea is already blue-green; just the "touch of blue"
AERIAL_SEA_BRIGHTEN = 1.0
NDWI_WATER_THRESHOLD = 0.3
DARK_REFLECTANCE = 0.012  # below this the L2A correction has bottomed out: black water or hard shadow
WATER_DILATE_PX = 6  # dark pixels this close (60 m) to known water are water (surf, glint-corrected shallows)
SHADOW_FILL_RADIUS_PX = 8  # neighbourhood (80 m) whose lit colour replaces baked shadow
SHADOW_FILL_MIX = 0.85  # the scene's 10:50 sun shadows fight the game's golden-hour lighting
WATER_MAX_BRIGHTNESS = 0.09  # mean RGB reflectance; open sea is about 0.005, wet sand 0.18

RAW_PATH = geo.CACHE_DIR / "imagery" / "s2_raw_10m.tif"
GRADED_PATH = geo.CACHE_DIR / "imagery" / "graded_10m.tif"


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def s2_reflectance_to_display(reflectance: np.ndarray) -> np.ndarray:
    """Linear BOA reflectance (H, W, 3) -> display-referred 0..1."""
    x = (reflectance - S2_BLACK_REFLECTANCE) / (S2_WHITE_REFLECTANCE - S2_BLACK_REFLECTANCE)
    return np.clip(x, 0.0, 1.0) ** DISPLAY_GAMMA


def water_mask(rgb_refl: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """True where water: NDWI (McFeeters) high and the pixel is dark.

    ``rgb_refl`` is (3, H, W) reflectance in R, G, B order. Wet sand and surf
    also score high on NDWI, so the brightness test keeps beaches as land.
    """
    green = rgb_refl[1]
    denom = green + nir
    ndwi = np.where(denom > 1e-6, (green - nir) / np.maximum(denom, 1e-6), 0.0)
    brightness = rgb_refl.mean(axis=0)
    return (ndwi > NDWI_WATER_THRESHOLD) & (brightness < WATER_MAX_BRIGHTNESS)


def terrain_sea_on_raster(heights: np.ndarray, dst_transform, shape: tuple[int, int]) -> np.ndarray:
    """Resample the built height field's sea (h <= 0) onto a raster of the given transform."""
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    sea = (heights <= 0.0).astype(np.float32)
    dst = np.zeros(shape, dtype=np.float32)
    reproject(
        sea,
        dst,
        src_transform=geo.height_sample_grid().geo_transform,
        src_crs="EPSG:4326",
        dst_transform=dst_transform,
        dst_crs="EPSG:4326",
        resampling=Resampling.average,
    )
    return dst > 0.5


def extend_water_with_dark_fringe(water: np.ndarray, rgb_refl: np.ndarray) -> np.ndarray:
    """Add near-black pixels that touch known water: shallows and surf the index misses."""
    from scipy.ndimage import binary_dilation

    dark = rgb_refl.mean(axis=0) < DARK_REFLECTANCE
    near = binary_dilation(water, iterations=WATER_DILATE_PX)
    return water | (dark & near)


def fill_shadows(display_rgb: np.ndarray, water: np.ndarray, raw_brightness: np.ndarray) -> np.ndarray:
    """Replace baked hard shadows on land with the average colour of lit pixels around them."""
    from scipy.ndimage import uniform_filter

    size = 2 * SHADOW_FILL_RADIUS_PX + 1
    shadow = (raw_brightness < DARK_REFLECTANCE) & ~water
    lit = (~shadow & ~water).astype(np.float32)
    lit_sum = uniform_filter(lit, size=size, mode="nearest")
    out = display_rgb.copy()
    for ch in range(3):
        col_sum = uniform_filter(display_rgb[..., ch] * lit, size=size, mode="nearest")
        fill = np.where(lit_sum > 1e-3, col_sum / np.maximum(lit_sum, 1e-3), display_rgb[..., ch])
        out[..., ch] = np.where(shadow, display_rgb[..., ch] + (fill - display_rgb[..., ch]) * SHADOW_FILL_MIX, display_rgb[..., ch])
    return out


def grade_rgb(
    display_rgb: np.ndarray,
    water: np.ndarray | None = None,
    sea_mix: float = SEA_MIX,
    sea_brighten: float = SEA_BRIGHTEN,
) -> np.ndarray:
    """Apply the look to a display-referred float image (H, W, 3) in 0..1.

    Returns uint8 sRGB. ``water`` is an optional boolean mask of sea pixels.
    ``sea_mix`` and ``sea_brighten`` default to the Sentinel-2 values (its sea
    is black); the aerial mosaic already has a good sea and uses AERIAL_SEA_*.
    """
    img = display_rgb.astype(np.float32, copy=True)

    # 1. Lift shadows slightly (strongest at black, zero at white).
    img += SHADOW_LIFT * (1.0 - img) ** 2

    # 2. Warm the midtones: weight 1 at mid grey, 0 at black and white.
    luma = luminance(img)
    mid_w = np.clip(1.0 - np.abs(2.0 * luma - 1.0), 0.0, 1.0)[..., None]
    img += mid_w * np.asarray(WARM_MIDTONE_RGB, dtype=np.float32)

    # 3. Desaturate greens: satellite greens read neon.
    greenness = np.clip((img[..., 1] - np.maximum(img[..., 0], img[..., 2])) / GREEN_MASK_WIDTH, 0.0, 1.0)
    luma = luminance(img)[..., None]
    img = img + (luma - img) * (GREEN_DESATURATE * greenness)[..., None]

    # 4. Sea toward blue, keeping swell and foam texture.
    if water is not None:
        sea = np.clip(img * sea_brighten, 0.0, 1.0)
        sea_luma = luminance(sea)[..., None]
        target = SEA_BLUE * (0.6 + 0.8 * sea_luma)
        blended = sea + (target - sea) * sea_mix
        img = np.where(water[..., None], blended, img)

    return (np.clip(img, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def grade_s2_raw(raw_path: Path = RAW_PATH, out_path: Path = GRADED_PATH) -> Path:
    """Read the cached 4-band Sentinel-2 raw (B04, B03, B02, B08 as DN) and grade it."""
    with rasterio.open(raw_path) as src:
        dn = src.read().astype(np.float32)
        profile = src.profile.copy()
        offset = float(src.tags().get("BOA_ADD_OFFSET", "0"))
    refl = np.clip((dn + offset) / 10000.0, 0.0, 1.0)
    rgb = np.moveaxis(refl[:3], 0, -1)
    water = water_mask(refl[:3], refl[3])
    heights = geo.CACHE_DIR / "heights_5m.npy"
    if heights.exists():
        # Agree with the terrain: wherever the built heights are sea, grade as sea.
        water |= terrain_sea_on_raster(np.load(heights), profile["transform"], water.shape)
    water = extend_water_with_dark_fringe(water, refl[:3])
    display = fill_shadows(s2_reflectance_to_display(rgb), water, refl[:3].mean(axis=0))
    graded = grade_rgb(display, water)
    profile.update(count=3, dtype="uint8", compress="deflate", photometric="RGB")
    profile.pop("nodata", None)
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(np.moveaxis(graded, -1, 0))
        dst.update_tags(GRADE="look-and-feel section 4", SOURCE=str(raw_path.name))
    print(f"grade: {out_path}")
    return out_path


if __name__ == "__main__":
    grade_s2_raw()
