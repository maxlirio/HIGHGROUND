"""Vale of Harrow: landform + hydrology generator for HIGHGROUND.

    python3 tools/map/landform.py            (numpy only; also runs under Blender's python)

Pipeline
  1. DESIGN   macro landforms placed by hand (ridge, motte, defile hills, upland,
              river valley, tributary valleys, mere basin, town plateaus, plain)
              on a domain-warped fBm base.
  2. FLUVIAL  stream-power incision (Braun & Willett 2013 implicit solver, m=0.5 n=1)
              + hillslope diffusion at half resolution, routed with priority-flood
              so there are no pits; the erosion delta is upsampled onto the design.
  3. HYDRAULIC  ~250k vectorised rain droplets (sediment capacity model) at full res.
  4. THERMAL  talus relaxation (34 deg soil / 40 deg rock) -> scree aprons below crags.
  5. HYDROLOGY  main river channel carved on a meandering centreline with a monotone
              water surface, fords (wide, shallow riffles), a bridge site (narrow,
              firm high banks), tributary becks, the mere, marsh by height-above-
              drainage, final priority-flood so every drop reaches a map edge.
  6. DERIVED  slope, crest/military crest, scree/rock, hillshade, overview.

Outputs go to maps/vale/ (see maps/vale/README.md).
"""
import heapq
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapkit as K  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "maps", "vale")
N = 1025
SIZE = 4000.0
DX = SIZE / (N - 1)          # 3.90625 m
SEED = 1307
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


# Arrays are NORTH-UP while working (row 0 = y 4000 m); flipped on export for height.f32.
xs = np.arange(N) * DX
X, Y = np.meshgrid(xs, xs[::-1])


def km(*p):
    return [(a * 1000.0, b * 1000.0) for a, b in p]


# ============================================================================ layout
RIVER_CTRL = km((-0.05, 3.38), (0.3, 3.2), (0.55, 3.05), (0.85, 2.86), (1.05, 2.74), (1.5, 2.5),
                (1.9, 2.22), (2.1, 2.0), (2.45, 1.86), (2.8, 1.64), (3.05, 1.36), (3.3, 1.1),
                (3.55, 0.78), (3.7, 0.4), (3.78, -0.05))
WEST_FORD = (850.0, 2860.0)
EAST_FORD = (3050.0, 1360.0)
BRIDGE = (2100.0, 2000.0)
MOTTE = (2650.0, 2470.0)
BLUE_TOWN = (820.0, 800.0)
RED_TOWN = (3300.0, 3250.0)
MERE_C = (1950.0, 3330.0)
RIDGE = km((1.55, 0.36), (1.9, 0.66), (2.25, 0.98), (2.62, 1.38))
BRANT = km((3.09, 1.72), (3.15, 2.05), (3.19, 2.4))
COLD = km((3.6, 1.56), (3.53, 1.9), (3.58, 2.26))
GAP = km((3.34, 1.62), (3.35, 1.95), (3.34, 2.32))
WYCH = km((1.02, -0.02), (1.12, 0.4), (1.3, 0.78), (1.2, 1.2), (1.32, 1.62), (1.22, 2.02), (1.3, 2.36), (1.18, 2.64))
ROOK = km((3.98, 3.66), (3.8, 3.5), (3.72, 3.26), (3.52, 3.1), (3.44, 2.9), (3.22, 2.86), (3.06, 2.7),
           (2.95, 2.52), (2.94, 2.3), (2.84, 2.12), (2.82, 1.94), (2.72, 1.73))
KNOLL = (2560.0, 3560.0)
GILL = km((1.95, 3.13), (1.9, 2.98), (1.94, 2.82), (1.87, 2.68), (1.84, 2.52), (1.77, 2.42), (1.74, 2.34))
MERE_NOTCH = (1950.0, 3130.0)
BECK = km((1.62, 4.03), (1.74, 3.8), (1.8, 3.62), (1.9, 3.5))
LANE = km((1.36, 1.2), (1.55, 1.3), (1.66, 1.47), (1.76, 1.58), (1.9, 1.66), (1.97, 1.8), (2.03, 1.9))
UPLAND_C = (560.0, 3740.0)
PLAIN_C = (3080.0, 430.0)


def along_river(x, y):
    """Smooth (crease-free) normalised position along the river's general course,
    for levelling terrain far from the channel. The channel itself uses true arc length."""
    ax, ay, bx, by = 0.0, 3380.0, 3780.0, 0.0
    dx_, dy_ = bx - ax, by - ay
    return np.clip(((x - ax) * dx_ + (y - ay) * dy_) / (dx_ * dx_ + dy_ * dy_), 0, 1)


def river_level(tn):
    """Designed water surface (m) vs normalised arc length 0 (W edge) .. 1 (S edge)."""
    return 45.0 + 19.0 * (1 - tn) ** 1.12


# ---------------------------------------------------------------- meandering river line
def build_river_line(rng):
    base = K.catmull(RIVER_CTRL, 40)
    seg = np.hypot(*np.diff(base, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    # resample at 5 m
    ss = np.arange(0, L, 5.0)
    px = np.interp(ss, s, base[:, 0])
    py = np.interp(ss, s, base[:, 1])
    tx = np.gradient(px)
    ty = np.gradient(py)
    tl = np.hypot(tx, ty)
    nx, ny = -ty / tl, tx / tl
    # meander offset: wavelength drifts 260-420 m, amplitude 15-55 m, damped near crossings
    phase = np.cumsum(2 * np.pi * 5.0 / (340 + 80 * np.sin(ss / 900.0 + 1.3)))
    amp = 34 + 20 * np.sin(ss / 1300.0 + 0.4) + 6 * np.sin(ss / 170.0)
    for site, keep in ((WEST_FORD, 150), (EAST_FORD, 150), (BRIDGE, 180)):
        dd = np.hypot(px - site[0], py - site[1])
        amp = amp * K.smoothstep(keep * 0.5, keep * 2.2, dd)
    amp *= K.smoothstep(0, 250, ss) * K.smoothstep(0, 250, L - ss)
    off = amp * (np.sin(phase) + 0.25 * np.sin(2.1 * phase + 0.7))
    pts = np.stack([px + nx * off, py + ny * off], 1)
    # smooth
    for _ in range(3):
        pts[1:-1] = 0.25 * pts[:-2] + 0.5 * pts[1:-1] + 0.25 * pts[2:]
    return pts


def sinuous(pts, amp, wavelength, rng, step=4.0, keep_ends=60.0):
    """Densify a designed path and add natural meander (noise-modulated sine offsets)."""
    base = K.catmull(pts, 30)
    seg = np.hypot(*np.diff(base, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    ss = np.arange(0, L, step)
    px, py = np.interp(ss, s, base[:, 0]), np.interp(ss, s, base[:, 1])
    tx, ty = np.gradient(px), np.gradient(py)
    tl = np.hypot(tx, ty)
    ph0 = rng.uniform(0, 6.28)
    phase = ph0 + np.cumsum(2 * np.pi * step / (wavelength * (1 + 0.35 * np.sin(ss / 330.0 + ph0))))
    a = amp * (0.6 + 0.4 * np.sin(ss / 510.0 + 2 * ph0))
    a *= K.smoothstep(0, keep_ends, ss) * K.smoothstep(0, keep_ends, L - ss)
    off = a * (np.sin(phase) + 0.3 * np.sin(2.3 * phase + 1.0))
    out = np.stack([px - ty / tl * off, py + tx / tl * off], 1)
    for _ in range(2):
        out[1:-1] = 0.25 * out[:-2] + 0.5 * out[1:-1] + 0.25 * out[2:]
    return out


# ============================================================================ design
def design(rng):
    log("design")
    wx = X + 90 * K.fbm(X, Y, 1400, 4, rng) + 25 * K.fbm(X, Y, 300, 3, rng)
    wy = Y + 90 * K.fbm(X, Y, 1400, 4, rng) + 25 * K.fbm(X, Y, 300, 3, rng)
    Xk, Yk = wx / 1000.0, wy / 1000.0

    d0, t0, _, L0 = K.polyline_field(X, Y, K.catmull(RIVER_CTRL, 30))
    d0 = K.blur(d0, 25)   # distance fields crease along vertex bisectors; smooth them out
    H = river_level(along_river(X, Y)) + 20 + 0.0165 * d0 + 3.0 * (Yk + Xk - 4)
    # extra relief on the red (NE) side, which otherwise is a long even slope
    ne = K.smoothstep(2.0, 3.2, Xk + 0.6 * Yk - 0.6)
    roll = (15 + 6 * ne) * K.fbm(wx, wy, 1300, 4, rng) + 4.5 * K.fbm(wx, wy, 320, 3, rng) + 1.2 * K.fbm(wx, wy, 90, 2, rng)
    H += roll
    masks = {}

    # --- rocky upland NW (Blackfell): massif + ridged relief + bedding terraces
    du = np.hypot((wx - UPLAND_C[0]) / 1.15, (wy - UPLAND_C[1]))
    mu = np.exp(-(du / 620.0) ** 2.2)
    ridged = K.fbm(wx, wy, 520, 5, rng, ridged=True)
    up = 84 * mu + 26 * mu * (ridged - 0.2)
    H = H + up
    frac = (H / 11.0) % 1.0
    terr = np.floor(H / 11.0) * 11.0 + 11.0 * K.smoothstep(0.55, 1.0, frac)
    H = H + (terr - H) * 0.6 * K.smoothstep(0.35, 0.7, mu)
    masks["upland"] = mu

    # --- Harrow Ridge: asymmetric (steep forward face NW toward river, long reverse slope SE)
    d, t, side, L = K.polyline_field(wx, wy, K.catmull(RIDGE, 30))
    tn = t / L
    crest = 74 * (0.55 + 0.45 * np.sin(np.pi * np.clip(tn, 0, 1)) ** 0.7)
    crest += 7 * K.fbm(wx, wy, 260, 2, rng)                  # knolls along the crest
    # side>0 = NW (left of NE travel); smoothed so the flip beyond the end caps leaves no seam
    w = K.blur(np.where(side > 0, 215.0, 470.0), 25)
    ridge = crest * np.exp(-(d / w) ** 1.7)
    # spur seeds: lobes on both flanks perpendicular to the crest
    spur = 0.5 + 0.5 * np.sin(t / 150.0 * np.pi + 1.1 * K.fbm(wx, wy, 400, 2, rng))
    ridge *= 1 + 0.22 * spur * K.smoothstep(40, 200, d)
    H += K.blur(ridge, 3)
    masks["ridge"] = np.exp(-(d / w) ** 1.7)

    # --- defile hills: Brant Hill (west) and Cold Knowe (east) with Gallows Gap between
    for pts, inner_side, amp in ((BRANT, -1, 50.0), (COLD, 1, 54.0)):
        d, t, side, L = K.polyline_field(wx, wy, K.catmull(pts, 30))
        tn = np.clip(t / L, 0, 1)
        w = K.blur(np.where(side == inner_side, 115.0, 270.0), 20)
        prof = amp * (0.6 + 0.4 * np.sin(np.pi * tn)) * np.exp(-(d / w) ** 1.8)
        H += K.blur(prof * (1 + 0.1 * K.fbm(wx, wy, 180, 2, rng)), 3)
    dg, tg, _, Lg = K.polyline_field(X, Y, K.catmull(GAP, 20), maxd=400)
    gap_floor = 84 - 4 * (tg / Lg)
    V = gap_floor + np.maximum(dg - 25, 0) * 0.35
    hh = np.clip(0.5 + 0.5 * (H - V) / 6.0, 0, 1)
    H = np.minimum(H, V * hh + H * (1 - hh) - 6.0 * hh * (1 - hh))
    # moraine dam along the south shore of the mere basin (natural lake containment)
    ang = np.radians(18)
    ux = (wx - MERE_C[0]) * np.cos(ang) + (wy - MERE_C[1]) * np.sin(ang)
    uy = -(wx - MERE_C[0]) * np.sin(ang) + (wy - MERE_C[1]) * np.cos(ang)
    qm = np.hypot(ux / 300.0, uy / 175.0)
    south = K.smoothstep(0.3, -0.6, uy / 175.0)
    notch = K.smoothstep(40, 120, np.hypot(X - MERE_NOTCH[0], Y - MERE_NOTCH[1]))
    H += 7.0 * np.exp(-((qm - 1.2) / 0.28) ** 2) * (0.35 + 0.65 * south) * notch

    # --- main river valley: floodplain + valley sides
    rpts = RIVER_PTS
    d, t, side, L = K.polyline_field(wx, wy, rpts[::2])
    d = K.blur(d, 4)
    tn = np.clip(t / L, 0, 1)
    rl = river_level(tn)

    def tbump(site, width):
        k = np.argmin(np.hypot(rpts[:, 0] - site[0], rpts[:, 1] - site[1]))
        ts = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(rpts, axis=0).T))])[k]
        return np.exp(-((t - ts) / width) ** 2)

    marsh_c = (2600.0, 1700.0)
    fw = 150 + 200 * tbump(marsh_c, 380) - 90 * tbump(BRIDGE, 130) + 35 * K.fbm(wx, wy, 500, 2, rng)
    vw = 430 + 140 * K.fbm(wx, wy, 700, 3, rng)
    fp = K.blur(rl, 6) + 1.3 + 0.7 * K.fbm(wx, wy, 180, 3, rng)
    bl = K.smoothstep(fw, fw + vw, d) ** 0.85
    H = fp + (H - fp) * bl
    masks["floodplain"] = 1 - K.smoothstep(fw, fw + 60, d)

    # --- cavalry plain (Harrow Field): long gentle surface rising from the river
    dp = np.hypot((X - PLAIN_C[0]) / 700.0, (Y - PLAIN_C[1]) / 460.0)
    mp = 1 - K.smoothstep(0.55, 1.25, dp)
    dr, tr, _, Lr = K.polyline_field(X, Y, rpts)
    dr = K.blur(dr, 10)
    plain_t = river_level(along_river(X, Y)) + 3.0 + 0.019 * dr + 1.2 * K.fbm(X, Y, 600, 2, rng)
    H = H + (plain_t - H) * 0.88 * mp
    masks["plain"] = mp

    # --- motte: steep isolated hill (Tor Knap), flat summit for the ruin
    ang = np.arctan2(Y - MOTTE[1], X - MOTTE[0])
    r = np.hypot((X - MOTTE[0]) / 1.18, Y - MOTTE[1]) * (1 + 0.14 * K.fbm(X, Y, 70, 3, rng)
                                                       + 0.06 * np.sin(7 * ang + 1.0))
    prof = np.where(r < 30, 1.0, 1 - 0.84 * np.clip((r - 30) / 78.0, 0, 1) ** 0.9)
    prof = np.where(r < 108, prof, 0.16 * (1 - K.smoothstep(108, 240, r)))
    base_m = H.copy()
    H = H + 44 * K.blur(prof, 1.5)
    masks["motte"] = (r < 240).astype(float)

    # --- small wooded knoll in the NE (Hanger Knoll)
    rk = np.hypot((wx - KNOLL[0]) / 1.3, wy - KNOLL[1])
    H += 15 * np.exp(-(rk / 150.0) ** 2)

    # --- town sites: a low rise (gentle dome, <3 deg) on an irregular outline, near water
    for c, r0, r1 in ((BLUE_TOWN, 170, 430), (RED_TOWN, 190, 450)):
        ang = np.arctan2(Y - c[1], X - c[0])
        lobes = 1 + 0.22 * np.sin(3 * ang + c[0] * 1e-3) + 0.12 * np.sin(5 * ang + 1.7)
        rr = np.hypot(X - c[0], Y - c[1]) / lobes * (1 + 0.1 * K.fbm(X, Y, 250, 2, rng))
        m = np.hypot(X - c[0], Y - c[1]) < 60
        lvl = float(K.blur(H, 20)[m].mean()) + 3.5
        dome = lvl + 2.5 * (1 - np.clip(rr / r1, 0, 1) ** 2) + 0.5 * K.fbm(X, Y, 140, 2, rng)
        wgt = 1 - K.smoothstep(r0, r1, rr)
        H = H + (dome - H) * wgt * 0.9
    masks["towns"] = sum(1 - K.smoothstep(150, 420, np.hypot(X - c[0], Y - c[1])) for c in (BLUE_TOWN, RED_TOWN))
    return H, masks


def carve_valley(H, pts, depth, floor_hw, side_slope, end_level=None, start_level=None, soft=6.0, reach=300.0):
    """Carve a stream valley along pts: bed = running-min of the terrain minus depth
    (monotone downhill), V-ish section with a flat floor, blended with smooth-min."""
    dense = np.asarray(pts) if len(pts) > 40 else K.catmull(pts, 30)
    d, t, _, L = K.polyline_field(X, Y, dense, maxd=reach + 50)
    seg = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(dense, axis=0).T))])
    fx, fy = dense[:, 0] / DX, (SIZE - dense[:, 1]) / DX
    hs = K.sample_bilinear(K.blur(H, 3), fx, fy) - depth
    if start_level is not None:
        hs[0] = min(hs[0], start_level)
    bed = np.minimum.accumulate(hs)
    if end_level is not None:
        # grade the whole profile so it meets end_level without a step
        bed = np.maximum(bed, end_level)
        bed = np.minimum.accumulate(bed)
        bed = bed + (end_level - bed[-1]) * (seg / seg[-1]) ** 3
    bed = np.convolve(np.pad(bed, 8, mode="edge"), np.ones(17) / 17, "valid")
    bed = np.minimum.accumulate(bed)
    b = np.interp(t, seg, bed)
    V = b + np.maximum(0, d - floor_hw) * side_slope
    # smooth min
    h = np.clip(0.5 + 0.5 * (H - V) / soft, 0, 1)
    out = V * h + H * (1 - h) - soft * h * (1 - h)
    fade = 1 - K.smoothstep(0.6 * reach, reach, d)   # valley influence ends smoothly at `reach`
    return H + (np.minimum(out, H) - H) * fade, d, b


# ============================================================================ routing
def flood_route(h, blocked=None, eps=1e-3):
    """Priority-flood (Barnes 2014) with epsilon: returns filled heights, receivers,
    and the pop order (ascending => valid downstream-first topological order)."""
    Hh, W = h.shape
    W2 = W + 2
    hp = np.full((Hh + 2, W2), np.inf)
    hp[1:-1, 1:-1] = h
    fl = hp.ravel().tolist()
    n = len(fl)
    closed = bytearray(n)
    for r in (0, Hh + 1):
        for c in range(W2):
            closed[r * W2 + c] = 1
    for r in range(Hh + 2):
        closed[r * W2] = 1
        closed[r * W2 + W2 - 1] = 1
    rec = list(range(n))
    heap = []
    edge = np.zeros((Hh, W), bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    if blocked is not None:
        edge &= ~blocked
    rr, cc = np.nonzero(edge)
    for r, c in zip(rr.tolist(), cc.tolist()):
        i = (r + 1) * W2 + c + 1
        closed[i] = 1
        heap.append((fl[i], i))
    heapq.heapify(heap)
    offs = (-W2 - 1, -W2, -W2 + 1, -1, 1, W2 - 1, W2, W2 + 1)
    order = []
    push, pop = heapq.heappush, heapq.heappop
    ap = order.append
    while heap:
        z, i = pop(heap)
        ap(i)
        for o in offs:
            j = i + o
            if not closed[j]:
                closed[j] = 1
                nz = fl[j]
                if nz <= z:
                    nz = z + eps
                    fl[j] = nz
                rec[j] = i
                push(heap, (nz, j))
    filled = np.array(fl).reshape(Hh + 2, W2)[1:-1, 1:-1]
    # convert padded indices to unpadded flat indices
    o = np.array(order)
    orow, ocol = o // W2 - 1, o % W2 - 1
    order_u = orow * W + ocol
    recp = np.array(rec)[o]
    rrow, rcol = recp // W2 - 1, recp % W2 - 1
    rec_u = np.arange(Hh * W)
    rec_u[order_u] = rrow * W + rcol
    return filled, rec_u, order_u


def accumulate(rec, order, w):
    A = w.ravel().astype(np.float64).tolist()
    recl = rec.tolist()
    for i in reversed(order.tolist()):
        r = recl[i]
        if r != i:
            A[r] += A[i]
    return np.array(A)


def mfd_accumulate(h, order, w, dx, p=1.1):
    """Multiple-flow-direction (Freeman 1991) accumulation on a filled surface.
    Spreads flow on planar slopes so channels only form where the ground converges."""
    Hh, W = h.shape
    n = Hh * W
    hp = np.pad(h, 1, constant_values=np.inf)
    dirs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    wts = []
    for dr, dc in dirs:
        nb = hp[1 + dr:Hh + 1 + dr, 1 + dc:W + 1 + dc]
        drop = (h - nb) / (np.hypot(dr, dc) * dx)
        wts.append(np.where(np.isfinite(drop) & (drop > 0), drop, 0.0) ** p)
    wts = np.stack(wts, -1).reshape(n, 8)
    tot = wts.sum(1, keepdims=True)
    wts = np.where(tot > 0, wts / np.maximum(tot, 1e-30), 0)
    idx = np.arange(n)
    offs = np.array([dr * W + dc for dr, dc in dirs])
    nz = wts > 1e-4
    cnt = nz.sum(1)
    ptr = np.concatenate([[0], np.cumsum(cnt)]).tolist()
    tgt = (idx[:, None] + offs[None, :])[nz].tolist()
    ww = wts[nz].tolist()
    A = w.ravel().astype(np.float64).tolist()
    for i in reversed(order.tolist()):
        a = A[i]
        for k in range(ptr[i], ptr[i + 1]):
            A[tgt[k]] += a * ww[k]
    return np.array(A)


def fluvial(Hfull, kmap_full, iters=60, rng=None):
    """Stream-power + diffusion at half resolution. Returns the eroded full-res field."""
    log("fluvial erosion (half res)")
    h = Hfull[::2, ::2].copy()
    km_ = kmap_full[::2, ::2]
    Hh, W = h.shape
    dx = DX * 2
    blocked = np.zeros_like(h, bool)
    # keep the river entry on the W edge from draining straight back out
    ey = int(round((SIZE - RIVER_PTS[0, 1]) / dx))
    blocked[max(0, ey - 25):ey + 25, 0] = True
    inflow = np.zeros_like(h)
    inflow[ey, 2] = 1.6e8                      # ~160 km2 of catchment upstream of the map
    Kdt = 2.2e-2
    m = 0.5
    h0 = h.copy()
    for it in range(iters):
        jit = rng.normal(0, 0.35, h.shape)
        filled, rec, order = flood_route(h + jit, blocked)
        h = np.maximum(h, filled - jit)
        A = mfd_accumulate(filled, order, dx * dx + inflow, dx)
        rr, rc = rec // W, rec % W
        ii = np.arange(Hh * W)
        dist = np.hypot(rr - ii // W, rc - ii % W) * dx
        dist[dist == 0] = 1
        F = (Kdt * km_.ravel() * A ** m / dist).tolist()
        hl = h.ravel().tolist()
        recl = rec.tolist()
        for i in order.tolist():
            r = recl[i]
            if r != i:
                f = F[i]
                hl[i] = (hl[i] + f * hl[r]) / (1 + f)
        h = np.array(hl).reshape(Hh, W)
        # hillslope diffusion (convex hilltops); weaker on rock
        lap = (K.shift(h, 1, 0) + K.shift(h, -1, 0) + K.shift(h, 1, 1) + K.shift(h, -1, 1) - 4 * h)
        h += 0.12 * (0.4 + 0.6 * km_) * lap
        if it % 10 == 0:
            log(f"  iter {it}: max erosion {np.max(h0 - h):.1f} m")
    delta = h - h0
    # upsample delta to full res
    fy = np.arange(N) / 2.0
    FX, FY = np.meshgrid(fy, fy)
    dfull = K.blur(K.sample_bilinear(delta, FX, FY), 2.0)
    return Hfull + dfull, A.reshape(Hh, W)


def droplets(h, kmask, rng, n_total=150000, batch=50000, life=48):
    log("hydraulic droplets")
    hc = h / DX
    Hh, W = hc.shape
    inertia, capf, minsl, er, dep, evap, grav = 0.1, 5.0, 0.004, 0.3, 0.25, 0.025, 6.0
    offs = [(a, b, np.exp(-(a * a + b * b) / 1.2)) for a in (-1, 0, 1) for b in (-1, 0, 1)]
    ws = sum(o[2] for o in offs)
    for _ in range(n_total // batch):
        x = rng.uniform(2, W - 3, batch)
        y = rng.uniform(2, Hh - 3, batch)
        vx = np.zeros(batch)
        vy = np.zeros(batch)
        sp = np.ones(batch)
        wt = np.ones(batch)
        sed = np.zeros(batch)
        alive = np.ones(batch, bool)
        for _s in range(life):
            ix = x.astype(np.int64)
            iy = y.astype(np.int64)
            u = x - ix
            v = y - iy
            h00 = hc[iy, ix]
            h10 = hc[iy, ix + 1]
            h01 = hc[iy + 1, ix]
            h11 = hc[iy + 1, ix + 1]
            gx = (h10 - h00) * (1 - v) + (h11 - h01) * v
            gy = (h01 - h00) * (1 - u) + (h11 - h10) * u
            hh = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v
            vx = vx * inertia - gx * (1 - inertia)
            vy = vy * inertia - gy * (1 - inertia)
            ln = np.hypot(vx, vy)
            z = ln < 1e-9
            ln[z] = 1
            vx /= ln
            vy /= ln
            nx, ny = x + vx, y + vy
            out = (nx < 1) | (nx > W - 3) | (ny < 1) | (ny > Hh - 3) | z
            alive &= ~out
            nx = np.clip(nx, 1, W - 3)
            ny = np.clip(ny, 1, Hh - 3)
            nh = K.sample_bilinear(hc, nx, ny)
            dh = nh - hh
            cap = np.maximum(-dh, minsl) * sp * wt * capf
            depm = alive & ((sed > cap) | (dh > 0))
            amt_dep = np.where(dh > 0, np.minimum(dh, sed), (sed - cap) * dep) * depm
            erm = alive & ~depm
            amt_er = np.minimum((cap - sed) * er, -dh) * kmask[iy, ix] * erm
            amt_er = np.maximum(amt_er, 0)
            sed += amt_er - amt_dep
            for (px, py, wgt) in ((0, 0, (1 - u) * (1 - v)), (1, 0, u * (1 - v)), (0, 1, (1 - u) * v), (1, 1, u * v)):
                np.add.at(hc, (iy + py, ix + px), amt_dep * wgt)
            for a, b, wgt in offs:
                np.add.at(hc, (np.clip(iy + a, 0, Hh - 1), np.clip(ix + b, 0, W - 1)), -amt_er * wgt / ws)
            sp = np.sqrt(np.maximum(sp * sp - dh * grav, 0.0))
            wt *= (1 - evap)
            x, y = nx, ny
            if not alive.any():
                break
    out = hc * DX
    return h + K.blur(out - h, 0.8)


def thermal(h, tan_map, iters=40, c=0.45):
    log("thermal")
    dirs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    for _ in range(iters):
        flows = []
        for dr, dc in dirs:
            nb = K.shift(K.shift(h, -dr, 0), -dc, 1)
            dist = np.hypot(dr, dc) * DX
            flows.append(np.maximum(h - nb - tan_map * dist, 0))
        tot = sum(flows)
        mx = np.maximum.reduce(flows)
        s = np.where(tot > 0, c * mx * 0.5 / np.maximum(tot, 1e-9), 0)
        h = h - tot * s
        for (dr, dc), f in zip(dirs, flows):
            a = f * s
            # zero-fill shift: out[i] = a[i - (dr,dc)]
            b = np.zeros_like(a)
            ys = slice(max(dr, 0), N + min(dr, 0))
            yd = slice(max(-dr, 0), N + min(-dr, 0))
            xs_ = slice(max(dc, 0), N + min(dc, 0))
            xd = slice(max(-dc, 0), N + min(-dc, 0))
            b[ys, xs_] = a[yd, xd]
            h = h + b
    return h


# ============================================================================ hydrology
def river_channel(H, rng):
    log("river channel")
    rpts = RIVER_PTS
    d, t, side, L = K.polyline_field(X, Y, rpts, maxd=500)
    tn = np.clip(t / L, 0, 1)
    wl = river_level(tn)
    seg = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(rpts, axis=0).T))])

    def site_t(site):
        k = np.argmin(np.hypot(rpts[:, 0] - site[0], rpts[:, 1] - site[1]))
        return seg[k]

    tw, te, tb = site_t(WEST_FORD), site_t(EAST_FORD), site_t(BRIDGE)
    fordw = np.maximum(np.exp(-((t - tw) / 75) ** 2), np.exp(-((t - te) / 75) ** 2))
    bridgew = np.exp(-((t - tb) / 40) ** 2)
    nz = K.fbm(X, Y, 160, 2, rng)
    hw = 11.5 + 2.5 * nz                              # normal half-width ~ 23 m wide
    hw = hw * (1 - fordw) + 23.0 * fordw               # fords widen to ~46 m
    hw = hw * (1 - bridgew) + 8.0 * bridgew            # bridge narrows to ~16 m
    dp = 1.9 + 0.4 * nz
    dp = dp * (1 - fordw) + 0.42 * fordw
    dp = dp * (1 - bridgew) + 2.6 * bridgew
    bank = 1.3 + 0.5 * K.fbm(X, Y, 300, 2, rng)       # cut-bank height above water
    bank = bank * (1 - fordw) + 0.35 * fordw
    bank = bank * (1 - bridgew) + 3.6 * bridgew
    bw = 5.0 * (1 - fordw) + 30.0 * fordw + 4.0 * bridgew   # gentle gravel ramps at fords
    q = np.clip(d / hw, 0, 1)
    bed = wl - dp * (1 - q ** 2.5)
    inside = d < hw
    bank_prof = wl + bank * K.smoothstep(0, 1, (d - hw) / bw)
    H = np.where(inside, bed, H)
    near = (d >= hw) & (d < hw + bw)
    H = np.where(near, np.minimum(H, bank_prof), H)
    # banks must stand above water everywhere just outside the channel
    ring = (d >= hw) & (d < hw + bw + 25)
    H = np.where(ring & (H < wl + 0.25), wl + 0.25 + 0.15 * K.smoothstep(0, 1, (d - hw) / 20), H)
    # bridge abutments: firm raised banks both sides
    ab = (d >= hw) & (d < hw + 45) & (bridgew > 0.3)
    H = np.where(ab, np.maximum(H, wl + bank * bridgew * (1 - K.smoothstep(25, 45, d - hw))), H)
    depth = np.where(inside, wl - H, 0)
    info = dict(t=t, d=d, wl=wl, L=L, tw=tw, te=te, tb=tb, hw=hw)
    return H, np.maximum(depth, 0), info


def mere(H, rng):
    """Dig a smooth glacial bowl; the lake level is the natural spill height of its rim
    (lowest point of the surrounding ring, the outlet notch excepted), so the shoreline
    follows the contours instead of a drawn ellipse."""
    log("mere")
    ang = np.radians(18)
    ux = (X - MERE_C[0]) * np.cos(ang) + (Y - MERE_C[1]) * np.sin(ang)
    uy = -(X - MERE_C[0]) * np.sin(ang) + (Y - MERE_C[1]) * np.cos(ang)
    q = np.hypot(ux / 300.0, uy / 175.0) * (1 + 0.10 * K.fbm(X, Y, 160, 3, rng))
    bowl = 11.0 * np.clip(1 - q ** 2, 0, 1) ** 1.3
    H = H - K.blur(bowl, 4)
    notch = np.hypot(X - MERE_NOTCH[0], Y - MERE_NOTCH[1]) < 90
    ring = (q > 1.0) & (q < 1.4) & ~notch
    level = round(float(H[ring].min()) - 0.35, 2)
    return H, level, q


def fill_lake(H, level, q):
    """Connected region below `level` seeded in the mere basin."""
    below = H < level
    below &= q < 1.12
    seed = (q < 0.3) & below
    reg = seed.copy()
    for _ in range(400):
        grown = reg | (below & (K.shift(reg, 1, 0) | K.shift(reg, -1, 0) | K.shift(reg, 1, 1) | K.shift(reg, -1, 1)))
        if (grown == reg).all():
            break
        reg = grown
    return np.where(reg, level - H, 0.0), reg


def carve_lane(H, dense):
    log("sunken lane")
    d, t, _, L = K.polyline_field(X, Y, dense, maxd=40)
    depth = 3.2 * K.smoothstep(0, 120, t) * K.smoothstep(0, 140, L - t)
    # 5 m floor, near-vertical 1.2 m banks, hedge bank lip +0.6 m
    prof = np.where(d < 2.5, -depth, -depth * (1 - K.smoothstep(2.5, 4.2, d)))
    lip = 0.6 * np.exp(-((d - 5.5) / 1.5) ** 2) * (depth > 0.5)
    base = K.blur(H, 2.5)
    Hn = np.where(d < 4.2, base + prof, H) + np.where(d < 9, lip, 0)
    return np.where(d < 12, Hn, H), dense


# ============================================================================ derived
def gradient(h):
    gy, gx = np.gradient(h, DX)
    return gx, -gy       # gy computed north-up: row increases southward


def slope_deg(h):
    gx, gy = gradient(h)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def hillshade(h, az=315, alt=45, z=1.6):
    gx, gy = gradient(h * z)
    az_r = np.radians(az)
    alt_r = np.radians(alt)
    lx, ly, lz = np.sin(az_r) * np.cos(alt_r), np.cos(az_r) * np.cos(alt_r), np.sin(alt_r)
    nrm = np.sqrt(gx * gx + gy * gy + 1)
    return np.clip((-gx * lx - gy * ly + lz) / nrm, 0, 1)


def crests(h):
    """255 = topographic crest / ridgeline, 150 = military crest (forward break of slope)."""
    hs = K.blur(h, 2.0)
    relief = hs - K.local_min(hs, 38)                # relief within ~150 m
    ridge = np.zeros_like(hs, bool)
    cnt = np.zeros(hs.shape, int)
    for dr, dc in ((0, 3), (3, 0), (3, 3), (3, -3)):
        a = K.shift(K.shift(hs, dr, 0), dc, 1)
        b = K.shift(K.shift(hs, -dr, 0), -dc, 1)
        cnt += ((hs > a + 0.15) & (hs > b + 0.15)).astype(int)
    ridge = (cnt >= 2) & (relief > 14)
    # military crest: strongest convex profile curvature on slopes below a crest
    gx, gy = gradient(hs)
    sl = np.hypot(gx, gy)
    ux, uy = gx / np.maximum(sl, 1e-6), gy / np.maximum(sl, 1e-6)
    step = 4  # px
    fx = np.arange(N)[None, :] + 0 * Y
    fy = np.arange(N)[:, None] + 0 * X
    up = K.sample_bilinear(hs, fx + ux * step, fy - uy * step)
    dn = K.sample_bilinear(hs, fx - ux * step, fy + uy * step)
    curv = (up + dn - 2 * hs) / (step * DX) ** 2          # <0 convex
    sd = np.degrees(np.arctan(sl))
    below = hs - K.local_min(hs, 50)
    cand = (curv < -0.0009) & (sd > 3) & (sd < 28) & (below > 18)
    # thin: keep local minima of curvature along the fall line
    cu = K.sample_bilinear(curv, fx + ux * 2, fy - uy * 2)
    cd = K.sample_bilinear(curv, fx - ux * 2, fy + uy * 2)
    mil = cand & (curv <= cu) & (curv <= cd)
    out = np.zeros(h.shape, np.uint8)
    out[mil] = 150
    out[ridge] = 255
    return out


# ============================================================================ main
RIVER_PTS = None
PATHS = {}


def main():
    global RIVER_PTS
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(SEED)
    RIVER_PTS = build_river_line(rng)
    H, masks = design(rng)

    # tributary valleys, cut before erosion so drainage organises around them
    rd, rt, _, rL = K.polyline_field(X, Y, RIVER_PTS[::2], maxd=300)
    def wl_at(p):
        k = np.argmin(np.hypot(RIVER_PTS[:, 0] - p[0], RIVER_PTS[:, 1] - p[1]))
        seg = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(RIVER_PTS, axis=0).T))])
        return float(river_level(seg[k] / seg[-1]))

    paths = {
        "wych": sinuous(WYCH, 20, 190, rng), "beck": sinuous(BECK, 10, 110, rng),
        "gill": sinuous(GILL, 7, 85, rng, keep_ends=40), "rook": sinuous(ROOK, 30, 250, rng),
        "lane": sinuous(LANE, 5, 240, rng, keep_ends=100),
    }
    PATHS.update(paths)
    H, _, _ = carve_valley(H, WYCH, 18.0, 25, 0.2, end_level=wl_at(WYCH[-1]) + 0.5, soft=8, reach=450)
    H, _, _ = carve_valley(H, ROOK, 8.0, 20, 0.09, end_level=wl_at(ROOK[-1]) + 0.5, soft=6, reach=350)
    H, _, _ = carve_valley(H, BECK, 4.0, 8, 0.12, soft=3)
    # pre-carve the main channel so routing follows the designed course
    tn = np.clip(rt / rL, 0, 1)
    H = np.where(rd < 14, np.minimum(H, river_level(tn) - 1.5), H)

    # erodibility: soft farmland/valley fill, hard upland, protected towns/motte
    kmap = np.clip(1.0 - 0.6 * masks["upland"] - 0.8 * masks["plain"] - 0.6 * masks["motte"] - 0.7 * masks["towns"], 0.08, 1.0)
    for c in (BLUE_TOWN, RED_TOWN):
        kmap *= K.smoothstep(150, 400, np.hypot(X - c[0], Y - c[1])) * 0.85 + 0.15
    kmap *= K.smoothstep(0, 40, rd) * 0.9 + 0.1

    H, Ahalf = fluvial(H, kmap, rng=rng)
    H = droplets(H, 0.25 + 0.75 * kmap, rng)
    tan_map = np.tan(np.radians(34 + 8 * K.smoothstep(0.35, 0.8, masks["upland"])))
    tan_map = np.where(masks["motte"] > 0, np.tan(np.radians(36)), tan_map)
    H = thermal(H, tan_map)

    # re-level town plateaus (settlements need flat, dry ground)
    for c, r0, r1 in ((BLUE_TOWN, 200, 380), (RED_TOWN, 230, 420)):
        wgt = 1 - K.smoothstep(r0, r1, np.hypot(X - c[0], Y - c[1]))
        H = H + (K.blur(H, 14) - H) * wgt * 0.95

    # restore the floodplain: erosion/deposition must not build it above flood reach
    fpd, fpt, _, fpL = K.polyline_field(X, Y, RIVER_PTS[::4], maxd=700)
    fp_top = river_level(np.clip(fpt / fpL, 0, 1)) + 1.35 + 0.55 * K.fbm(X, Y, 200, 3, rng)
    fm = K.blur(masks["floodplain"], 4)
    H = H + (np.minimum(H, fp_top) - H) * fm

    # --- hydrology
    H, level, q = mere(H, rng)
    H, _, gill_bed = carve_valley(H, paths["gill"], 9.0, 5, 0.9, start_level=level - 0.6,
                                  end_level=wl_at(GILL[-1]) + 0.3, soft=2.5)
    H, depth, rinfo = river_channel(H, rng)
    H, lane_pts = carve_lane(H, paths["lane"])

    # becks: small channels inside the tributary valleys
    beck_depth = np.zeros_like(H)
    for pts, end in ((paths["wych"], wl_at(WYCH[-1])), (paths["gill"], wl_at(GILL[-1])),
                     (paths["beck"], level), (paths["rook"], wl_at(ROOK[-1]))):
        Hc, dd, bed = carve_valley(H, pts, 1.1, 1.2, 0.55, end_level=end + 0.05, soft=0.6)
        ch = (dd < 2.6) & (depth <= 0)
        beck_depth = np.where(ch, np.maximum(beck_depth, 0.3 * (1 - (dd / 2.6) ** 2)), beck_depth)
        H = Hc

    lake_depth, lake = fill_lake(H, level, q)
    depth = np.maximum(depth, lake_depth)
    depth = np.maximum(depth, beck_depth)

    # --- final drainage: fill every land pit so each cell drains to a map edge
    log("final fill + flow accumulation")
    surf = H + depth
    wet = depth > 0
    filled, rec, order = flood_route(surf, eps=2e-4)
    raised = filled - surf
    pits_before = int((raised[~wet] > 0.05).sum())
    H = np.where(~wet, H + raised, H)   # land cells lifted (sediment infill); water keeps its surface
    surf = H + depth
    filled, rec, order = flood_route(surf, eps=1e-4)
    # side streams: single-direction (D8) accumulation keeps channels contiguous;
    # only where the ground is a real valley (concave) and above the floodplain
    A8 = (accumulate(rec, order, np.full(H.shape, DX * DX)) / 1e6).reshape(H.shape)  # km2
    concave = (K.blur(H, 5) - H) > 0.15
    side = (A8 > 0.6) & ~wet & (rinfo["d"] > 30) & (H - rinfo["wl"] > 2.0) & concave
    side = K.blur(side.astype(float), 0.6) > 0.35
    lg = np.log2(np.maximum(A8, 0.6) / 0.6)
    sdep = np.where(side, np.clip(0.08 + 0.05 * lg, 0.08, 0.3), 0)
    H = np.where(side, H - (0.35 + 0.15 * np.clip(lg, 0, 3)), H)
    depth = np.maximum(depth, sdep)
    surf = H + depth
    filled, rec, order = flood_route(surf, eps=5e-4)
    raised = filled - surf
    H = np.where(depth <= 0, H + raised, H)
    residual_pits = int(((filled - (H + depth)) > 0.05)[depth <= 0].sum())
    A = (mfd_accumulate(filled, order, np.full(H.shape, DX * DX), DX) / 1e6).reshape(H.shape)

    # --- marsh: height above nearest drainage on the floodplain
    log("marsh")
    sl = slope_deg(H)
    hand = H - rinfo["wl"]
    mz = np.exp(-((X - 2640) ** 2 / 330 ** 2 + (Y - 1720) ** 2 / 190 ** 2))
    mz = np.maximum(mz, np.exp(-((X - 1860) ** 2 / 150 ** 2 + (Y - 3520) ** 2 / 110 ** 2)))
    mz = np.maximum(mz, 0.9 * np.exp(-((X - 250) ** 2 / 260 ** 2 + (Y - 3200) ** 2 / 110 ** 2)))
    nz = K.fbm(X, Y, 90, 3, rng)
    wet_low = (1 - K.smoothstep(0.8, 2.3, hand)) * (rinfo["d"] < 420)
    lake_edge = (1 - K.smoothstep(0.0, 1.6, H - level)) * (q < 1.8) * (q > 0.8)
    base = np.maximum(wet_low * (0.35 + 0.9 * mz), lake_edge * (0.4 + 0.8 * mz))
    marsh = base * (1 - K.smoothstep(2.0, 4.5, sl)) * (0.75 + 0.45 * nz)
    for site in (WEST_FORD, EAST_FORD, BRIDGE):   # crossings sit on firm gravel
        marsh *= K.smoothstep(60, 160, np.hypot(X - site[0], Y - site[1]))
    marsh = np.clip(marsh, 0, 1) * (depth <= 0.35)
    marsh8 = (K.blur(marsh, 1.2) * 255).clip(0, 255).astype(np.uint8)
    marsh8[marsh8 < 40] = 0

    # float32 export can merge nearly-equal neighbours into ties; nudge those cells so
    # every land cell keeps a strictly lower neighbour after quantisation
    for _ in range(50):
        S32 = (H.astype(np.float32) + depth.astype(np.float32)).astype(np.float64)
        P = np.pad(S32, 1, constant_values=-np.inf)
        low = np.zeros(H.shape, bool)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr or dc:
                    low |= P[1 + dr:N + 1 + dr, 1 + dc:N + 1 + dc] < S32
        pit = ~low & (depth <= 0)
        pit[[0, -1], :] = False
        pit[:, [0, -1]] = False
        if not pit.any():
            break
        # raise the pit cell a hair above its lowest neighbour (it then drains into it)
        H = np.where(pit, H + 2e-3, H)
    residual_pits = int(pit.sum())
    # --- outputs
    log("write outputs")
    hmin, hmax = float(H.min()), float(H.max())
    np.flipud(H).astype("<f4").tofile(os.path.join(OUT, "height.f32"))
    np.flipud(depth).astype("<f4").tofile(os.path.join(OUT, "water.f32"))
    h16 = ((H - hmin) / (hmax - hmin) * 65535).round().astype(np.uint16)
    K.write_png(os.path.join(OUT, "height.png"), h16)
    K.write_png(os.path.join(OUT, "water.png"), np.clip(depth / 0.05, 0, 255).round().astype(np.uint8))
    K.write_png(os.path.join(OUT, "marsh.png"), marsh8)
    flow8 = np.clip(np.log10(np.maximum(A, 1e-6) / (DX * DX / 1e6)) / np.log10(3e7) * 255, 0, 255)
    # main river carries its off-map catchment
    flow8 = np.where(rinfo["d"] < rinfo["hw"], 255, flow8)
    K.write_png(os.path.join(OUT, "river_flow.png"), flow8.astype(np.uint8))
    sl = slope_deg(H)
    K.write_png(os.path.join(OUT, "slope.png"), np.clip(sl * 4, 0, 255).round().astype(np.uint8))
    cr = crests(H)
    K.write_png(os.path.join(OUT, "crest.png"), cr)
    up = masks["upland"]
    rock = (sl > 38) & (up > 0.25) | (sl > 45)
    steep_above = K.local_max(rock.astype(float), 10) > 0
    scree = ((sl > 22) & (sl <= 38.5) & (up > 0.3) & steep_above) | ((sl > 30) & (up > 0.45))
    scree = scree & ~rock
    K.write_png(os.path.join(OUT, "scree.png"), (K.blur(scree.astype(float), 0.8) * 255).astype(np.uint8))
    K.write_png(os.path.join(OUT, "rock.png"), (rock * 255).astype(np.uint8))
    hs = 0.6 * hillshade(H) + 0.25 * hillshade(H, 225, 40) + 0.15 * hillshade(H, 0, 70)
    K.write_png(os.path.join(OUT, "preview_hillshade.png"), (np.clip(hs, 0, 1) * 225 + 20).astype(np.uint8))

    feats = features(H, level, rinfo, lane_pts)
    meta = {
        "name": "Vale of Harrow",
        "size_m": SIZE, "res": N, "cell_m": DX,
        "origin": "SW corner; +x east, +y north, metres; z up (metres above datum)",
        "height_f32_row_order": "row 0 = SOUTH edge (y=0); index = j*res + i, x=i*cell, y=j*cell",
        "png_row_order": "row 0 = NORTH edge (north-up images)",
        "height_min_m": round(hmin, 2), "height_max_m": round(hmax, 2),
        "height_png_scale": {"min_m": round(hmin, 3), "max_m": round(hmax, 3), "note": "height = min + v/65535*(max-min)"},
        "sea_level_m": None,
        "water": {
            "datum_note": "no sea on this map; water surface = height + water depth",
            "river_surface_m": {"enters_west": round(float(river_level(0)), 2), "exits_south": round(float(river_level(1)), 2),
                                 "at_bridge": round(float(river_level(rinfo['tb'] / rinfo['L'])), 2)},
            "mere_level_m": level,
            "water_png_scale_m_per_unit": 0.05,
        },
        "layers": {
            "height.f32": "float32 LE terrain/bed height (m), south-first rows",
            "water.f32": "float32 LE water depth (m), south-first rows (js/sim/map.js loads this)",
            "height.png": "16-bit preview, north-up",
            "water.png": "uint8 depth, 0.05 m per unit",
            "marsh.png": "uint8 marsh intensity 0-255",
            "river_flow.png": "uint8 log10 upstream area; 255 = main river channel",
            "slope.png": "uint8 slope, 0.25 deg per unit",
            "crest.png": "uint8: 255 topographic crest/ridgeline, 150 military crest",
            "scree.png": "uint8 scree intensity", "rock.png": "uint8 bare crag mask",
        },
        "stats": {"land_pits_filled": pits_before, "residual_pits": residual_pits,
                  "max_upstream_area_km2_onmap": round(float(A.max()), 2)},
        "features": [{k: v for k, v in f.items() if not k.startswith("_")} for f in feats],
    }
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    overview(H, depth, marsh8, cr, scree, rock, feats, lane_pts)
    log(f"done: h {hmin:.1f}..{hmax:.1f} m, mere {level} m, land pits filled {pits_before}, residual {residual_pits}")


def feat(name, kind, xy, H, note, label_dx=10, label_dy=-6):
    i = int(round(xy[0] / DX))
    jn = int(round((SIZE - xy[1]) / DX))
    return {"name": name, "type": kind, "xy_m": [round(xy[0], 1), round(xy[1], 1)],
            "grid_ij": [i, N - 1 - jn], "z_m": round(float(H[jn, i]), 1), "note": note,
            "_label": [label_dx, label_dy]}


def features(H, level, rinfo, lane_pts):
    def top(c, r):
        m = np.hypot(X - c[0], Y - c[1]) < r
        k = np.argmax(np.where(m, H, -1e9))
        return (float(X.flat[k]), float(Y.flat[k]))

    rtop = top((2100, 850), 500)
    f = [
        feat("Ashby (blue town)", "town_site", BLUE_TOWN, H, "Blue home plateau: flat, dry, 3 approaches; SW corner has only farmland behind it."),
        feat("Rookham (red town)", "town_site", RED_TOWN, H, "Red home plateau on higher ground; the Gallows Gap and the Knap screen its southern approaches."),
        feat("Harrow Ridge", "ridge", rtop, H, "Dominant ridge: steep NW forward face over the bridge, long reverse slope SE hides troops from the red bank."),
        feat("Harrow Ridge reverse slope", "reverse_slope", (rtop[0] + 330, rtop[1] - 300), H, "Dead ground to anyone north of the river: form up and reserve here unseen.", -40, 10),
        feat("Tor Knap (ruin)", "motte_hill", MOTTE, H, "Steep isolated hill with a flat summit and ruin; commands the bridge and marsh, hard to storm, easy to isolate."),
        feat("River Harrow", "river", (400, 3180), H, "Unfordable (1.7-2.3 m) except at the fords; flows W edge to S edge.", 10, -18),
        feat("Hob's Ford", "ford", WEST_FORD, H, "Wide gravel riffle ~0.4 m deep; western crossing, overlooked by Blackfell scree.", 12, 4),
        feat("Stane Ford", "ford", EAST_FORD, H, "Eastern gravel riffle ~0.4 m deep; links Harrow Field to the Gallows Gap.", 12, 6),
        feat("Harrow Bridge site", "bridge_site", BRIDGE, H, "Narrow deep reach with firm raised banks: the only place to bridge; the centre of the map.", 12, 2),
        feat("Harrow Moss", "marsh", (2640, 1720), H, "Floodplain marsh inside the bend below the bridge: infantry wade, cavalry and guns bog down.", -30, 14),
        feat("Gallows Gap", "defile", (3345, 1950), H, "Narrow pass between Brant Hill and Cold Knowe: a column is trapped; a few can hold it.", -100, 14),
        feat("Brant Hill", "hill", top((3150, 2050), 250), H, "West jaw of the Gap; steep inner face.", -80, -10),
        feat("Cold Knowe", "hill", top((3560, 1900), 260), H, "East jaw of the Gap; steep inner face.", 8, -10),
        feat("Harrow Field", "open_plain", PLAIN_C, H, "Long gentle open plain, <3 deg: ideal cavalry ground behind the ridge's reverse slope."),
        feat("Wychwood Bottom", "wooded_valley", (1210, 1150), H, "Steep-sided tributary valley (intended woodland): a covered approach from Ashby to Hob's Ford.", 10, 0),
        feat("Crake Gill", "gully", (1880, 2700), H, "Deep narrow stream gully draining the mere: covered route and obstacle just upstream of the bridge.", 10, 0),
        feat("Harrow Mere", "lake", MERE_C, H, f"Lake, level {level} m, up to ~8 m deep: anchors a flank, impassable.", -20, -22),
        feat("Blackfell", "rocky_upland", top(UPLAND_C, 500), H, "Rocky upland with crags and scree aprons: slow going, superb observation over the western river.", 10, -4),
        feat("Holloway (sunken lane)", "sunken_lane", tuple(lane_pts[len(lane_pts) // 2]), H, "Lane worn 3 m into the slope: ready-made trench and covered approach to the bridge.", 12, 0),
        feat("Rook Beck", "stream_valley", (2960, 2600), H, "Shallow beck valley past Rookham to the river: a low covered line of approach toward the Knap.", 10, 0),
        feat("Hanger Knoll", "wooded_knoll", KNOLL, H, "Small rounded knoll (intended woodland): observation post and screen west of Rookham.", 10, 0),
        feat("Ashby farmland", "farmland", (1050, 450), H, "Rolling fields, hedge-scale undulation: partial cover for infantry.", 10, 0),
        feat("Rookham farmland", "farmland", (3000, 3500), H, "Rolling fields around Rookham on a gentle south-facing slope.", 10, 0),
    ]
    return f


def overview(H, depth, marsh8, cr, scree, rock, feats, lane_pts):
    log("overview")
    S = 2
    hn = (H - H.min()) / (H.max() - H.min())
    # hypsometric tint: low meadow greens -> upland browns
    stops = np.array([0.0, 0.25, 0.5, 0.75, 1.0])
    cols = np.array([[196, 214, 168], [214, 222, 172], [226, 214, 166], [206, 184, 146], [184, 164, 140]], float)
    tint = np.stack([np.interp(hn, stops, cols[:, c]) for c in range(3)], -1)
    hs = 0.6 * hillshade(H) + 0.25 * hillshade(H, 225, 40) + 0.15 * hillshade(H, 0, 70)
    img = tint * (0.45 + 0.75 * hs[..., None])
    img = K.upscale(img, S)
    Hu = K.upscale(H, S)
    # contours 5 m, index every 25 m
    for iv, colr, a in ((5.0, (120, 90, 60), 0.35), (25.0, (110, 70, 40), 0.75)):
        c = np.floor(Hu / iv)
        edge = (c != K.shift(c, 1, 0)) | (c != K.shift(c, 1, 1))
        img[edge] = img[edge] * (1 - a) + np.array(colr) * a
    sc = K.upscale(scree.astype(float), S) > 0.5
    dots = ((np.arange(img.shape[0])[:, None] % 4 == 0) & (np.arange(img.shape[1])[None, :] % 4 == 0))
    img[sc & dots] = (90, 80, 70)
    rk = K.upscale(rock.astype(float), S) > 0.5
    img[rk] = img[rk] * 0.5 + np.array((70, 60, 55)) * 0.5
    ms = K.upscale(marsh8.astype(float), S) / 255
    tufts = ((np.arange(img.shape[0])[:, None] % 6 == 0) & (np.arange(img.shape[1])[None, :] % 8 < 3))
    img[(ms > 0.3) & tufts] = (40, 110, 120)
    img = img * (1 - 0.25 * ms[..., None]) + np.array((150, 195, 190)) * 0.25 * ms[..., None]
    dw = K.upscale(depth, S)
    water = dw > 0.02
    wc = np.array((120, 170, 215)) * (1 - np.clip(dw / 8, 0, 1))[..., None] + np.array((60, 110, 170)) * np.clip(dw / 8, 0, 1)[..., None]
    img[water] = wc[water]
    c8 = K.upscale(cr.astype(float), S)
    img[c8 > 200] = (150, 40, 30)
    img[(c8 > 120) & (c8 <= 200)] = img[(c8 > 120) & (c8 <= 200)] * 0.4 + np.array((200, 110, 40)) * 0.6
    # lane
    for p in lane_pts:
        i, j = int(p[0] / DX * S), int((SIZE - p[1]) / DX * S)
        img[j - 1:j + 2, i - 1:i + 2] = (90, 50, 30)
    # km grid
    for k in range(1, 8):
        v = int(k * 500 / DX * S)
        img[v, :] = img[v, :] * 0.7 + 60 * 0.3
        img[:, v] = img[:, v] * 0.7 + 60 * 0.3
        K.draw_text(img, f"{k * 500}", v + 3, 4, (50, 50, 50), 2)
        K.draw_text(img, f"{4000 - k * 500}", 4, v + 3, (50, 50, 50), 2)
    for f in feats:
        i, j = f["xy_m"][0] / DX * S, (SIZE - f["xy_m"][1]) / DX * S
        i, j = int(i), int(j)
        colr = {"town_site": (40, 40, 140)}.get(f["type"], (30, 25, 20))
        if "red" in f["name"]:
            colr = (150, 30, 30)
        if "blue" in f["name"]:
            colr = (30, 60, 150)
        img[j - 4:j + 5, i - 4:i + 5] = (250, 245, 230)
        img[j - 3:j + 4, i - 3:i + 4] = colr
        lx, ly = f["_label"]
        K.draw_text(img, f["name"], i + lx * S // 2 + 6, j + ly * S // 2, colr, 2)
    K.draw_text(img, "VALE OF HARROW  4 X 4 KM  N UP  CONTOURS 5 M (25 M INDEX)", 20, img.shape[0] - 26, (30, 30, 30), 2)
    K.write_png(os.path.join(OUT, "overview.png"), np.clip(img, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    main()
