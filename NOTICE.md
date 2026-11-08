# Third-party data notice

The code in this repository is MIT licensed (see `LICENSE`). The terrain data under `public/terrain/` is derived from third-party sources with their own terms, listed in full in `docs/ASSETS.md`. In short:

| Data | Source | Terms |
|---|---|---|
| Heights (`public/terrain/h/`) | City of Cape Town Ground Level Map 2 m contours (2019 LiDAR), via the City's Open Data Portal | City of Cape Town open data; the City's Open Data Policy defines open data as data that can be freely used, shared and built on by anyone for any purpose. Attribution: "Elevation data: City of Cape Town Ground Level Map 2019". |
| Textures (`public/terrain/t/`, `overview.webp`) | City of Cape Town aerial orthophoto mosaic, January 2025 | **Non-commercial use only.** The dataset's own terms state: no restrictions on the digital file for non-commercial purposes. Commercial use is not granted. Attribution: "Aerial imagery: City of Cape Town, January 2025". |
| Sea mask and alternative textures | Copernicus Sentinel-2 and Copernicus DEM GLO-30 | Free and open, including commercial use, with attribution: "Contains modified Copernicus Sentinel data 2026" and the Copernicus DEM attribution in `docs/ASSETS.md`. |

**What this means for you if you fork or redistribute this project:**

- You may play, share, modify and host the game for free. Keep the attribution lines (they are shown in the game's settings screen).
- You may not sell it, put it behind a paywall, run paid advertising on it or otherwise make money from it **while it ships the City aerial textures**.
- If you want a commercial version, rebuild the textures from the fully open Sentinel-2 imagery with `tools/terrain/build.py --textures-only --imagery s2` (10 m resolution, softer), or obtain permission from the City of Cape Town. Everything else in the repository is MIT.

This notice is a good-faith summary written by the project maintainer, not legal advice.
