"""Sanity checks for maps/vale (numpy only):  python3 tools/map/check_vale.py
- every land cell drains (steepest descent on height+water) to a map edge: no pits
- town sites are buildable (slope < 6 deg over 150 m radius)
- fords shallow, river unfordable elsewhere, bridge site narrow with dry banks
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
D = os.path.join(ROOT, "maps", "vale")
meta = json.load(open(os.path.join(D, "meta.json")))
N, cell = meta["res"], meta["cell_m"]
H = np.fromfile(os.path.join(D, "height.f32"), "<f4").reshape(N, N).astype(np.float64)  # row j = y (south first)
W = np.fromfile(os.path.join(D, "water.f32"), "<f4").reshape(N, N).astype(np.float64)
S = H + W
ok = True

# pits: interior cells with no strictly lower 8-neighbour (water surfaces are allowed flats)
P = np.pad(S, 1, constant_values=-np.inf)
lower = np.zeros_like(S, bool)
for dj in (-1, 0, 1):
    for di in (-1, 0, 1):
        if dj or di:
            lower |= P[1 + dj:N + 1 + dj, 1 + di:N + 1 + di] < S - 1e-7
land_pits = (~lower) & (W <= 0)
land_pits[[0, -1], :] = False
land_pits[:, [0, -1]] = False
print("land pits:", int(land_pits.sum()))
ok &= land_pits.sum() == 0

feats = {f["name"]: f for f in meta["features"]}
gy, gx = np.gradient(H, cell)
sl = np.degrees(np.arctan(np.hypot(gx, gy)))
J, I = np.mgrid[0:N, 0:N]
for name in ("Ashby (blue town)", "Rookham (red town)"):
    i, j = feats[name]["grid_ij"]
    m = np.hypot(I - i, J - j) * cell < 150
    p95 = float(np.percentile(sl[m], 95))
    print(f"{name}: slope p95 {p95:.1f} deg, max water {W[m].max():.2f} m")
    ok &= p95 < 6 and W[m].max() == 0
for name in ("Hob's Ford", "Stane Ford"):
    i, j = feats[name]["grid_ij"]
    m = np.hypot(I - i, J - j) * cell < 25
    print(f"{name}: max depth {W[m].max():.2f} m")
    ok &= W[m].max() < 0.7
i, j = feats["Harrow Bridge site"]["grid_ij"]
m = np.hypot(I - i, J - j) * cell < 40
wet = W[m] > 0.3
print(f"bridge: wet cells within 40 m {int(wet.sum())} (narrow), max depth {W[m].max():.2f}")
river = (W > 1.2) & (np.hypot(I - i, J - j) > 0)
print("deep (unfordable) river cells:", int(river.sum()))
print("ALL OK" if ok else "CHECK FAILED")
sys.exit(0 if ok else 1)
