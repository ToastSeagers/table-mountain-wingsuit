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
SEA_BLUE = np.array([0.10, 0.30, 0.50], dtype=np.float32)
SEA_MIX = 0.65  # how far sea pixels move toward SEA_BLUE (texture retained)
SEA_BRIGHTEN = 1.6  # sea texture (foam, swell) gain before mixing
NDWI_WATER_THRESHOLD = 0.05

RAW_PATH = geo.CACHE_DIR / "imagery" / "s2_raw_10m.tif"
GRADED_PATH = geo.CACHE_DIR / "imagery" / "graded_10m.tif"


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def s2_reflectance_to_display(reflectance: np.ndarray) -> np.ndarray:
    """Linear BOA reflectance (H, W, 3) -> display-referred 0..1."""
    x = (reflectance - S2_BLACK_REFLECTANCE) / (S2_WHITE_REFLECTANCE - S2_BLACK_REFLECTANCE)
    return np.clip(x, 0.0, 1.0) ** DISPLAY_GAMMA


def water_mask_from_ndwi(green: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """McFeeters NDWI on reflectance arrays; True where water."""
    denom = green + nir
    ndwi = np.where(denom > 1e-6, (green - nir) / np.maximum(denom, 1e-6), 0.0)
    return ndwi > NDWI_WATER_THRESHOLD


def grade_rgb(display_rgb: np.ndarray, water: np.ndarray | None = None) -> np.ndarray:
    """Apply the look to a display-referred float image (H, W, 3) in 0..1.

    Returns uint8 sRGB. ``water`` is an optional boolean mask of sea pixels.
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
        sea = np.clip(img * SEA_BRIGHTEN, 0.0, 1.0)
        sea_luma = luminance(sea)[..., None]
        target = SEA_BLUE * (0.6 + 0.8 * sea_luma)
        blended = sea + (target - sea) * SEA_MIX
        img = np.where(water[..., None], blended, img)

    return (np.clip(img, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def grade_s2_raw(raw_path: Path = RAW_PATH, out_path: Path = GRADED_PATH) -> Path:
    """Read the cached 4-band Sentinel-2 raw (B04, B03, B02, B08 as DN) and grade it."""
    with rasterio.open(raw_path) as src:
        dn = src.read().astype(np.float32)
        profile = src.profile.copy()
        offset = float(src.tags().get("BOA_ADD_OFFSET", "-1000"))
    refl = np.clip((dn + offset) / 10000.0, 0.0, 1.0)
    rgb = np.moveaxis(refl[:3], 0, -1)
    water = water_mask_from_ndwi(refl[1], refl[3])
    graded = grade_rgb(s2_reflectance_to_display(rgb), water)
    profile.update(count=3, dtype="uint8", compress="deflate", photometric="RGB")
    profile.pop("nodata", None)
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(np.moveaxis(graded, -1, 0))
        dst.update_tags(GRADE="look-and-feel section 4", SOURCE=str(raw_path.name))
    print(f"grade: {out_path}")
    return out_path


if __name__ == "__main__":
    grade_s2_raw()
