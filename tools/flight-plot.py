"""Plot y versus x for harness CSVs over the stub terrain profile.

Usage:
    npm run harness -- trim > docs/status/stage-3/trim.csv
    python tools/flight-plot.py docs/status/stage-3/trim.csv docs/status/stage-3/trim.png "Trim"

The CSV is the harness output (columns t,x,y,z,vx,vy,vz,airspeed,glide,agl,alpha,phase). The
ground line is the analytic stub cliff from src/flight/stub-terrain.ts.
"""

from __future__ import annotations

import csv
import math
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

PHASE_COLOURS = {
    "freefall": "#7f7f7f",
    "wingsuit": "#1f77b4",
    "deploying": "#ff7f0e",
    "canopy": "#2ca02c",
    "landed": "#17becf",
    "crashed": "#d62728",
}


def stub_ground(x: float) -> float:
    if x < 0:
        return 1050.0
    shore = 350.0 / math.tan(math.radians(15))
    if x < shore:
        return 350.0 - x * math.tan(math.radians(15))
    return 0.0


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    src, dst = argv[1], argv[2]
    title = argv[3] if len(argv) > 3 else src
    rows = list(csv.DictReader(open(src, newline="", encoding="utf-8")))
    xs = [float(r["x"]) for r in rows]
    ys = [float(r["y"]) for r in rows]
    phases = [r["phase"] for r in rows]

    fig, ax = plt.subplots(figsize=(11, 5.5), dpi=130)
    gx = [i * 10.0 for i in range(-20, int(max(xs) / 10) + 40)]
    ax.fill_between(gx, [stub_ground(x) for x in gx], -50, color="#d9c9a3", label="stub terrain")
    ax.fill_between([2900, 3100], [0, 0], [-50, -50], color="#f2d16b", label="beach (2,900 to 3,100)")

    start = 0
    for i in range(1, len(rows) + 1):
        if i == len(rows) or phases[i] != phases[start]:
            ph = phases[start]
            ax.plot(xs[start:i], ys[start:i], color=PHASE_COLOURS.get(ph, "k"), lw=2, label=ph)
            start = i
    ax.plot(xs[-1], ys[-1], "o", color=PHASE_COLOURS.get(phases[-1], "k"), ms=6)

    # Time ticks every 5 s along the line.
    for r in rows:
        t = float(r["t"])
        if abs(t - round(t / 5) * 5) < 1e-6 and t > 0:
            ax.annotate(f"{t:.0f}s", (float(r["x"]), float(r["y"])), fontsize=7, xytext=(3, 3),
                        textcoords="offset points", color="#444")

    handles, labels = ax.get_legend_handles_labels()
    seen: dict[str, object] = {}
    for h, l in zip(handles, labels):
        seen.setdefault(l, h)
    ax.legend(seen.values(), seen.keys(), loc="upper right", fontsize=8)
    ax.set_xlabel("x (m, stub frame; flight heads +x)")
    ax.set_ylabel("y (m ASL)")
    ax.set_title(title)
    ax.set_ylim(-50, max(ys) + 60)
    ax.set_xlim(min(xs) - 60, max(max(xs) + 100, 1400))
    ax.set_aspect("equal", adjustable="box")
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(dst)
    print(f"wrote {dst}: {len(rows)} rows, end x {xs[-1]:.0f} y {ys[-1]:.0f} phase {phases[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
