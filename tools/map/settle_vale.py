#!/usr/bin/env python3
"""settle_vale.py: settlements, roads and resources for maps/vale (numpy only, deterministic).

    python3 tools/map/settle_vale.py          (~1 min)

Reads maps/vale/{meta.json,height.f32,water.f32,marsh.png,river_flow.png,rock.png,preview_hillshade.png}
and writes:
  maps/vale/settlements.json   towns (hall, green, church, tofts & crofts, enceinte), hamlets,
                               roads, bridges, fords, reserved footprints, woodland hints
  maps/vale/objects.json       resource nodes + placed structures (asset ids for the artists)
  maps/vale/settle_overview.png annotated map (hillshade, roads, plots, resources)

Conventions: world metres, SW origin, +x east, +y north (as meta.json). `rot` = radians,
counter-clockwise from +x (east) about +z; a model's long axis is its local +x.
Rectangles/polygons are lists of [x, y] in world metres, counter-clockwise.

Roads are least-cost paths (A*) on a 10 m grid: cost grows with grade squared (carts),
cross slope, marsh and water; the river (> 0.8 m) is impassable except over the fords and
the bridge; existing roads are discounted so the network merges instead of duplicating.
Villages grow along the last few hundred metres of the roads that reach them.
"""
import heapq
import json
import math
import os
import struct
import sys
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapkit as K  # noqa: E402

SEED = 1349
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
D = os.path.join(ROOT, "maps", "vale")
rng = np.random.default_rng(SEED)


def log(*a):
    print("[settle]", *a, flush=True)


# ============================================================================ load
def read_png(path):
    """Minimal PNG reader (8-bit grey/RGB, all filter types). Returns array as stored (north-up)."""
    data = open(path, "rb").read()
    pos, idat = 8, b""
    while pos < len(data):
        L = struct.unpack(">I", data[pos:pos + 4])[0]
        t = data[pos + 4:pos + 8]
        d = data[pos + 8:pos + 8 + L]
        pos += 12 + L
        if t == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", d[:10])
        elif t == b"IDAT":
            idat += d
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    bpp = ch * bd // 8
    raw = np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, 1 + w * bpp)
    out = np.zeros((h, w * bpp), np.int32)
    prev = np.zeros(w * bpp, np.int32)
    for r in range(h):
        f, line = raw[r, 0], raw[r, 1:].astype(np.int32)
        if f == 0:
            cur = line
        elif f == 2:
            cur = (line + prev) % 256
        elif f == 1:
            cur = line.copy()
            for k in range(bpp):
                cur[k::bpp] = np.cumsum(line[k::bpp]) % 256
        else:
            cur = line.copy()
            for x in range(w * bpp):
                a = cur[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                if f == 3:
                    cur[x] = (line[x] + (a + b) // 2) % 256
                else:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    cur[x] = (line[x] + pr) % 256
        out[r] = cur
        prev = cur
    out = out.astype(np.uint8)
    return out.reshape(h, w, ch) if ch > 1 else out


meta = json.load(open(os.path.join(D, "meta.json")))
N, CELL, SIZE = meta["res"], meta["cell_m"], meta["size_m"]
H = np.fromfile(os.path.join(D, "height.f32"), "<f4").reshape(N, N).astype(np.float64)
W = np.fromfile(os.path.join(D, "water.f32"), "<f4").reshape(N, N).astype(np.float64)
MARSH = read_png(os.path.join(D, "marsh.png"))[::-1].astype(np.float64)       # -> south-first
FLOW = read_png(os.path.join(D, "river_flow.png"))[::-1].astype(np.float64)
ROCK = read_png(os.path.join(D, "rock.png"))[::-1].astype(np.float64)
SHADE = read_png(os.path.join(D, "preview_hillshade.png")).astype(np.float64)  # north-up
gy_, gx_ = np.gradient(H, CELL)
SLOPE = np.degrees(np.arctan(np.hypot(gx_, gy_)))
FEAT = {f["name"]: f for f in meta["features"]}


def fxy(name):
    return tuple(FEAT[name]["xy_m"])


def samp(a, x, y):
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    return K.sample_bilinear(a, x / CELL, y / CELL)


def h(x, y):
    return float(samp(H, x, y))


def wd(x, y):
    return float(samp(W, x, y))


def sl(x, y):
    return float(samp(SLOPE, x, y))


def ms(x, y):
    return float(samp(MARSH, x, y))


def grad(x, y, e=6.0):
    return ((h(x + e, y) - h(x - e, y)) / (2 * e), (h(x, y + e) - h(x, y - e)) / (2 * e))


def R2(v):
    return round(float(v), 2)


def P(p):
    return [R2(p[0]), R2(p[1])]


# ============================================================================ geometry
def rect(cx, cy, ang, L, Wd):
    """Rectangle centred (cx,cy), long side L along angle ang, width Wd. CCW corners."""
    c, s = math.cos(ang), math.sin(ang)
    out = []
    for u, v in ((-L / 2, -Wd / 2), (L / 2, -Wd / 2), (L / 2, Wd / 2), (-L / 2, Wd / 2)):
        out.append((cx + u * c - v * s, cy + u * s + v * c))
    return out


def poly_area(p):
    p = np.asarray(p)
    return 0.5 * float(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1]))


def ccw(p):
    return p if poly_area(p) >= 0 else p[::-1]


def pip(px, py, poly):
    """Vectorised even-odd point-in-polygon."""
    poly = np.asarray(poly, float)
    inside = np.zeros(np.shape(px), bool)
    x0, y0 = poly[-1]
    for x1, y1 in poly:
        cond = ((y1 > py) != (y0 > py))
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = (x0 - x1) * (py - y1) / (y0 - y1 + 1e-12) + x1
        inside ^= cond & (px < xi)
        x0, y0 = x1, y1
    return inside


def arclen(pts):
    pts = np.asarray(pts, float)
    return np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])


def at_s(pts, s):
    """Point and unit tangent at arc length s."""
    pts = np.asarray(pts, float)
    c = arclen(pts)
    s = min(max(s, 0), c[-1] - 1e-6)
    i = int(np.searchsorted(c, s, side="right") - 1)
    i = min(i, len(pts) - 2)
    t = pts[i + 1] - pts[i]
    L = np.hypot(*t) or 1.0
    u = (s - c[i]) / L
    return pts[i] + t * u, t / L


def chaikin(pts, it=2):
    p = np.asarray(pts, float)
    for _ in range(it):
        if len(p) < 3:
            break
        q = [p[0]]
        for a, b in zip(p[:-1], p[1:]):
            q.append(0.75 * a + 0.25 * b)
            q.append(0.25 * a + 0.75 * b)
        q.append(p[-1])
        p = np.array(q)
    return p


def rdp(pts, eps):
    pts = np.asarray(pts, float)
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    L = np.hypot(*ab)
    if L < 1e-9:
        d = np.hypot(*(pts - a).T)
    else:
        d = np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / L
    i = int(np.argmax(d))
    if d[i] > eps:
        return np.vstack([rdp(pts[:i + 1], eps)[:-1], rdp(pts[i:], eps)])
    return np.array([a, b])


def resample(pts, step):
    pts = np.asarray(pts, float)
    c = arclen(pts)
    ss = np.linspace(0, c[-1], max(2, int(c[-1] / step) + 1))
    return np.stack([np.interp(ss, c, pts[:, 0]), np.interp(ss, c, pts[:, 1])], 1)


def seg_dist(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy or 1e-9
    t = np.clip(((px - a[0]) * dx + (py - a[1]) * dy) / L2, 0, 1)
    return np.hypot(a[0] + t * dx - px, a[1] + t * dy - py)


def line_dist(px, py, pts):
    d = np.full(np.shape(px), 1e9)
    for a, b in zip(pts[:-1], pts[1:]):
        d = np.minimum(d, seg_dist(px, py, a, b))
    return d


# ============================================================================ occupancy (2 m)
OC = 2.0
ON = int(SIZE / OC)
OCC = np.zeros((ON, ON), np.uint8)   # [y, x]; 0 free, 1 building/plot, 2 road


def _bbox_grid(poly, pad=0.0):
    p = np.asarray(poly, float)
    x0 = max(0, int((p[:, 0].min() - pad) / OC))
    x1 = min(ON, int((p[:, 0].max() + pad) / OC) + 2)
    y0 = max(0, int((p[:, 1].min() - pad) / OC))
    y1 = min(ON, int((p[:, 1].max() + pad) / OC) + 2)
    ys, xs = np.mgrid[y0:y1, x0:x1]
    return (slice(y0, y1), slice(x0, x1)), (xs + 0.5) * OC, (ys + 0.5) * OC


def poly_cells(poly):
    win, X, Y = _bbox_grid(poly)
    return win, pip(X, Y, poly)


def poly_free(poly, allow_road=False):
    win, m = poly_cells(poly)
    o = OCC[win][m]
    return not (np.any(o == 1) or (not allow_road and np.any(o == 2)))


def mark(poly, v=1):
    win, m = poly_cells(poly)
    sub = OCC[win]
    sub[m] = np.maximum(sub[m], v)


def mark_road(pts, width):
    pts = np.asarray(pts, float)
    for a, b in zip(pts[:-1], pts[1:]):
        seg = np.array([a, b])
        win, X, Y = _bbox_grid(seg, width)
        m = seg_dist(X, Y, a, b) < width / 2 + 1.5
        sub = OCC[win]
        sub[m & (sub == 0)] = 2


def buildable(poly, max_slope=7.5, step=3.0):
    p = np.asarray(poly, float)
    x0, y0 = p.min(0)
    x1, y1 = p.max(0)
    xs, ys = np.meshgrid(np.arange(x0, x1 + 0.1, step), np.arange(y0, y1 + 0.1, step))
    m = pip(xs, ys, poly)
    if not m.any():
        return False
    X, Y = xs[m], ys[m]
    if X.min() < 20 or Y.min() < 20 or X.max() > SIZE - 20 or Y.max() > SIZE - 20:
        return False
    return (samp(SLOPE, X, Y).max() < max_slope and samp(W, X, Y).max() < 0.02
            and samp(MARSH, X, Y).max() < 40 and samp(ROCK, X, Y).max() < 100)


# ============================================================================ routing grid
G = 10.0
GN = int(SIZE / G)
gc = (np.arange(GN) + 0.5) * G
GX, GY = np.meshgrid(gc, gc)                         # [j, i] -> y, x
GH = samp(H, GX, GY)
GW = np.zeros_like(GX)
GS = np.zeros_like(GX)
GM = np.zeros_like(GX)
GR = np.zeros_like(GX)
for ox in (-4, 0, 4):
    for oy in (-4, 0, 4):
        GW = np.maximum(GW, samp(W, GX + ox, GY + oy))
        GS = np.maximum(GS, samp(SLOPE, GX + ox, GY + oy))
        GR = np.maximum(GR, samp(ROCK, GX + ox, GY + oy))
        GM += samp(MARSH, GX + ox, GY + oy) / 9


def cross_geom(c, look=80.0):
    """River crossing at c: returns (south/west bank pt, north/east bank pt, depth max, depth mean,
    river-axis unit vector, wet width along the crossing)."""
    cx, cy = c
    xs, ys = np.meshgrid(np.arange(cx - look, cx + look, 2.0), np.arange(cy - look, cy + look, 2.0))
    w = samp(W, xs, ys)
    m = w > 0.25
    X, Y = xs[m] - cx, ys[m] - cy
    cov = np.cov(np.vstack([X, Y]))
    ev, evec = np.linalg.eigh(cov)
    axis = evec[:, 1]
    n = np.array([-axis[1], axis[0]])
    if n[1] < 0:
        n = -n                                         # n points north-ish
    ends = []
    depths = []
    for sgn in (-1, 1):
        r = 0.0
        while r < 120:
            p = np.array(c) + sgn * n * r
            d = wd(*p)
            depths.append(d)
            if d < 0.02 and r > 3:
                break
            r += 1.0
        ends.append(np.array(c) + sgn * n * (r + 3.0))
    wet = np.hypot(*(ends[1] - ends[0])) - 6.0
    return ends[0], ends[1], max(depths), float(np.mean([d for d in depths if d > 0.02] or [0])), axis, wet


BRIDGE_C = fxy("Harrow Bridge site")
br_s, br_n, br_dmax, br_dmean, br_axis, br_wet = cross_geom(BRIDGE_C)
FORDS = {}
for nm in ("Hob's Ford", "Stane Ford"):
    FORDS[nm] = cross_geom(fxy(nm))

# bridge deck: passable, flat
bmask = seg_dist(GX, GY, br_s, br_n) < 9
GW[bmask] = 0.0
GM[bmask] = 0.0
GS[bmask] = 0.0
bt = np.clip(((GX - br_s[0]) * (br_n[0] - br_s[0]) + (GY - br_s[1]) * (br_n[1] - br_s[1]))
             / np.sum((br_n - br_s) ** 2), 0, 1)
GH[bmask] = (h(*br_s) + (h(*br_n) - h(*br_s)) * bt)[bmask]

# sunken lane cells (carved ~3 m below the local surface on the LANE control line)
LANE_CTRL = np.array([(1.36, 1.2), (1.55, 1.3), (1.66, 1.47), (1.76, 1.58), (1.9, 1.66), (1.97, 1.8), (2.03, 1.9)]) * 1000
dip = K.blur(H, 6) - H
near_lane = line_dist(GX, GY, LANE_CTRL) < 90
_dmax = np.zeros_like(GX)
for ox in (-4, 0, 4):
    for oy in (-4, 0, 4):
        _dmax = np.maximum(_dmax, samp(dip, GX + ox, GY + oy))
GLANE = near_lane & (_dmax > 1.2)
LANE_FINE = None


def base_mult():
    M = np.ones_like(GX)
    M *= 1 + (np.maximum(0, GS - 9) / 6.0) ** 2           # cross slope: terraced tracks are costly
    M[GS > 32] = np.inf
    M[GR > 100] = np.inf
    wet = GW > 0.03
    M[wet] *= 5 + 12 * GW[wet]                            # wading a beck / ford
    M[GW > 0.8] = np.inf                                  # river & mere
    M *= 1 + 5 * (GM / 255.0)
    M[GM > 150] *= 2.5
    edge = (GX < 15) | (GY < 15) | (GX > SIZE - 15) | (GY > SIZE - 15)
    M[edge] = np.inf
    near_edge = np.minimum(np.minimum(GX, GY), np.minimum(SIZE - GX, SIZE - GY))
    M *= 1 + 0.8 * np.clip((180 - near_edge) / 180, 0, 1)   # keep roads off the map rim
    return M


BASE = base_mult()
# low-frequency "history" noise: old boundaries, a lost ford, a landowner's whim. Keeps roads from
# running ruler-straight across open ground without changing where they can go.
BASE *= 1 + 0.45 * np.clip(K.fbm(GX, GY, 520.0, 3, np.random.default_rng(SEED + 1)) * 1.6, -1, 1)
ROADG = np.zeros((GN, GN), bool)
ROADG_MAJOR = np.zeros((GN, GN), bool)   # spurs join these (not footpaths)


NB16 = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1),
        (1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)]


def astar(a, b, goal_set=None, lane_bonus=True):
    """Least-cost path on the 10 m grid. a, b world points (b may be None if goal_set given)."""
    M = BASE.copy()
    M[ROADG] *= 0.62
    if lane_bonus:
        M[GLANE] = np.minimum(M[GLANE], 1.3) * 0.2   # its own banks are not a cross-slope
    Mf = M.ravel().tolist()
    Hf = GH.ravel().tolist()
    si = int(min(GN - 1, max(0, a[1] // G))) * GN + int(min(GN - 1, max(0, a[0] // G)))
    goal = None
    if b is not None:
        goal = int(min(GN - 1, max(0, b[1] // G))) * GN + int(min(GN - 1, max(0, b[0] // G)))
        gi, gj = goal % GN, goal // GN
    gs = set(np.flatnonzero(goal_set.ravel()).tolist()) if goal_set is not None else None
    Mf[si] = min(Mf[si], 50.0)
    if goal is not None:
        Mf[goal] = min(Mf[goal], 50.0)
    dist = {si: 0.0}
    prev = {}
    hq = [(0.0, si)]
    nb = NB16
    done = set()
    hw = 0.2 * G
    end = None
    while hq:
        f, u = heapq.heappop(hq)
        if u in done:
            continue
        done.add(u)
        if u == goal or (gs is not None and u in gs and u != si):
            end = u
            break
        ui, uj = u % GN, u // GN
        du = dist[u]
        hu = Hf[u]
        mu = Mf[u]
        for di, dj in nb:
            vi, vj = ui + di, uj + dj
            if vi < 0 or vj < 0 or vi >= GN or vj >= GN:
                continue
            v = vj * GN + vi
            mv = Mf[v]
            if mv == math.inf or v in done:
                continue
            if abs(di) + abs(dj) == 3:          # knight move: both cells it clips must be passable
                c1 = (uj + (dj // 2 if abs(dj) == 2 else 0)) * GN + ui + (di // 2 if abs(di) == 2 else 0)
                c2 = (uj + (dj if abs(dj) == 1 else dj // 2)) * GN + ui + (di if abs(di) == 1 else di // 2)
                mx = max(Mf[c1], Mf[c2])
                if mx == math.inf:
                    continue
                mv = max(mv, mx)
                L = G * 2.2360680
            else:
                L = G * (1.41421356 if di and dj else 1.0)
            gr = (Hf[v] - hu) / L
            c = L * (1 + (gr / 0.07) ** 2) * 0.5 * (mu + mv if mu != math.inf else mv * 2)
            nd = du + c
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = u
                hh = hw * math.hypot(vi - gi, vj - gj) if goal is not None else 0.0
                heapq.heappush(hq, (nd + hh, v))
    if end is None:
        raise RuntimeError(f"no route {a} -> {b}")
    path = [end]
    while path[-1] != si:
        path.append(prev[path[-1]])
    path.reverse()
    return [((p % GN + 0.5) * G, (p // GN + 0.5) * G) for p in path]


def dijkstra_all(a):
    """Travel cost field (metres-equivalent) from a over the base grid (no road discounts)."""
    Mf = BASE.ravel().tolist()
    Hf = GH.ravel().tolist()
    si = int(a[1] // G) * GN + int(a[0] // G)
    dist = [math.inf] * (GN * GN)
    dist[si] = 0.0
    hq = [(0.0, si)]
    nb = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
    while hq:
        du, u = heapq.heappop(hq)
        if du > dist[u]:
            continue
        ui, uj = u % GN, u // GN
        mu = Mf[u]
        for di, dj in nb:
            vi, vj = ui + di, uj + dj
            if vi < 0 or vj < 0 or vi >= GN or vj >= GN:
                continue
            v = vj * GN + vi
            mv = Mf[v]
            if mv == math.inf:
                continue
            L = G * (1.41421356 if di and dj else 1.0)
            gr = (Hf[v] - Hf[u]) / L
            nd = du + L * (1 + (gr / 0.07) ** 2) * 0.5 * (mu + mv if mu != math.inf else 2 * mv)
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(hq, (nd, v))
    return np.array(dist).reshape(GN, GN)


# ============================================================================ roads
ROADS = []


def finish_path(raw, straight_ends=()):
    p = np.array(raw, float)
    p = chaikin(p, 3)
    p = rdp(p, 1.5)
    return p


def add_road(name, rtype, width, legs, note=""):
    """legs: list of (a, b, mode) with mode 'route' or 'straight' (bridge/ford spans)."""
    pts = []
    for a, b, mode in legs:
        if mode == "straight":
            seg = [tuple(a), tuple(b)]
        else:
            raw = astar(a, b)
            raw[0], raw[-1] = tuple(a), tuple(b)
            seg = [tuple(q) for q in finish_path(raw)]
        if pts and np.hypot(pts[-1][0] - seg[0][0], pts[-1][1] - seg[0][1]) < 1:
            seg = seg[1:]
        pts += seg
    pts = np.array(pts)
    _register(name, rtype, width, pts, note)
    return pts


def add_spur(name, rtype, width, a, note=""):
    """Route from a to the nearest existing road."""
    raw = astar(a, None, goal_set=ROADG_MAJOR)
    raw[0] = tuple(a)
    pts = finish_path(raw)
    _register(name, rtype, width, pts, note)
    return pts


def _register(name, rtype, width, pts, note):
    ROADS.append({"name": name, "type": rtype, "width": width, "pts": np.asarray(pts, float), "note": note})
    dense = resample(pts, 5.0)
    ii = np.clip((dense[:, 0] // G).astype(int), 0, GN - 1)
    jj = np.clip((dense[:, 1] // G).astype(int), 0, GN - 1)
    ROADG[jj, ii] = True
    if rtype != "path":
        ROADG_MAJOR[jj, ii] = True
    mark_road(pts, width)


# ============================================================================ features / anchors
ASHBY = np.array(fxy("Ashby (blue town)"))
ROOK = np.array(fxy("Rookham (red town)"))


def search(c, r, score, step=8.0, rmin=0.0):
    """Best-scoring point within r of c (score(X, Y) -> array, higher is better)."""
    xs, ys = np.meshgrid(np.arange(c[0] - r, c[0] + r + 0.1, step), np.arange(c[1] - r, c[1] + r + 0.1, step))
    d = np.hypot(xs - c[0], ys - c[1])
    m = (d <= r) & (d >= rmin) & (xs > 30) & (ys > 30) & (xs < SIZE - 30) & (ys < SIZE - 30)
    X, Y = xs[m], ys[m]
    s = score(X, Y)
    i = int(np.nanargmax(s))
    return np.array([X[i], Y[i]])


def flat_dry(X, Y, rad=25):
    s = np.zeros_like(X)
    for ox, oy in ((0, 0), (rad, 0), (-rad, 0), (0, rad), (0, -rad)):
        s = np.maximum(s, samp(SLOPE, X + ox, Y + oy))
    wet = np.zeros_like(X)
    for ox, oy in ((0, 0), (rad, 0), (-rad, 0), (0, rad), (0, -rad)):
        wet = np.maximum(wet, samp(W, X + ox, Y + oy) + samp(MARSH, X + ox, Y + oy) / 100)
    return -s - 50 * (wet > 0.02)


def near_stream(X, Y, lo=0.04, hi=0.8, r=150):
    best = np.full(X.shape, 1e9)
    for a in np.linspace(0, 2 * np.pi, 16, endpoint=False):
        for rr in range(10, r + 1, 10):
            w = samp(W, X + math.cos(a) * rr, Y + math.sin(a) * rr)
            hit = (w > lo) & (w < hi)
            best = np.where(hit & (rr < best), rr, best)
    return best


# ---- hamlet sites (flat, dry, 40-160 m from a beck: water without flood)
def hamlet_site(c, r):
    def sc(X, Y):
        ns = near_stream(X, Y, r=200)
        return flat_dry(X, Y, 30) - np.abs(ns - 90) / 25 - np.hypot(X - c[0], Y - c[1]) / 120
    return search(c, r, sc, step=10)


HAMLET_DEF = [
    # id, name, search centre, radius, side, dilemma note
    ("wychcote", "Wychcote", (1000, 1680), 220, 0,
     "Blue's safe farm: a woodland clearing up Wychwood Bottom, hidden from the red bank; little land, few recruits."),
    ("harrow_grange", "Harrow Grange", (2980, 640), 260, 0,
     "Blue's rich grange on Harrow Field: best arable on the map, but open cavalry ground 900 m from Stane Ford."),
    ("beckfoot", "Beckfoot", (2980, 2600), 200, 1,
     "Red's sheltered farm in the Rook Beck valley below Rookham; covered from the bridge by the Knap."),
    ("hobsgarth", "Hobsgarth", (900, 3180), 220, 1,
     "Red-bank farm under Blackfell, far from Rookham and one ford from Ashby: whoever holds Hob's Ford owns it."),
]


# ============================================================================ build: crossings & fixed sites
log("crossings")
ford_out = []
for nm, (a, b, dmax, dmean, axis, wet) in FORDS.items():
    ford_out.append({"id": nm.lower().replace("'", "").replace(" ", "_"), "name": nm, "center": P(fxy(nm)),
                     "bank_south": P(a), "bank_north": P(b), "depth_max_m": R2(dmax), "depth_mean_m": R2(dmean),
                     "wet_length_m": R2(wet), "width_m": 40.0, "river_axis": [R2(axis[0]), R2(axis[1])],
                     "bed": "gravel riffle", "feature": "ford"})
F_HOB, F_STANE = FORDS["Hob's Ford"], FORDS["Stane Ford"]

ANCHORS = {}
tk = fxy("Tor Knap (ruin)")
ANCHORS["ruin"] = search(tk, 90, lambda X, Y: samp(H, X, Y) - 0.3 * samp(SLOPE, X, Y), step=4)
for hid, nm, c, r, side, note in HAMLET_DEF:
    ANCHORS[hid] = hamlet_site(c, r)
    log("hamlet", nm, ANCHORS[hid].round())

# Crake Mill: on Crake Gill where it still has fall, 350-700 m above the confluence, west bank
GILL = np.array([(1.95, 3.13), (1.9, 2.98), (1.94, 2.82), (1.87, 2.68), (1.84, 2.52), (1.77, 2.42), (1.74, 2.34)]) * 1000


def mill_site(c, r, toward):
    def sc(X, Y):
        ns = near_stream(X, Y, lo=0.05, hi=0.9, r=40)
        return flat_dry(X, Y, 10) * 0.6 - np.abs(ns - 18) / 3 - np.hypot(X - toward[0], Y - toward[1]) / 150
    return search(c, r, sc, step=4)


ANCHORS["crake_mill"] = mill_site((1880, 2560), 160, (1700, 2500))


def gap_road_side(X, Y):
    return -samp(SLOPE, X, Y) * 0.3


# ============================================================================ roads
log("roads")
# Rookham: lay the main street along the contour first (a street village on a south-facing slope)


def trace_contour(c, length, sgn, step=8.0):
    p = np.array(c, float)
    z0 = h(*c)
    out = [p.copy()]
    for _ in range(int(length / step)):
        gx, gy = grad(*p, e=10)
        g = np.hypot(gx, gy) + 1e-9
        t = np.array([-gy, gx]) / g * sgn
        p = p + t * step
        # pull back toward the start height (gentle, keeps the street level)
        gx, gy = grad(*p, e=10)
        g2 = gx * gx + gy * gy + 1e-9
        dz = h(*p) - z0
        p = p - np.array([gx, gy]) * dz / g2 * 0.5 if g2 > 1e-4 else p
        out.append(p.copy())
    return np.array(out)


# find the contour direction and extend both ways
east = trace_contour(ROOK, 230, 1)
west = trace_contour(ROOK, 230, -1)
if east[-1][0] < west[-1][0]:
    east, west = west, east
street = np.vstack([west[::-1], east[1:]])
street = rdp(chaikin(street, 2), 1.0)
_register("Rookham Street", "village_street", 7.0, street, "Main street of Rookham, laid along the contour.")
ROOK_W, ROOK_E = street[0], street[-1]

hb_s, hb_n = F_HOB[0], F_HOB[1]
st_s, st_n = F_STANE[0], F_STANE[1]
lane_s, lane_n = LANE_CTRL[0], LANE_CTRL[-1]

# Ashby is a green village: a triangular green whose corners the roads leave from.
def green_corners(c, targets, r=52, minsep=62):
    b = np.array([math.degrees(math.atan2(t[1] - c[1], t[0] - c[0])) for t in targets])
    order = np.argsort(b)
    ang = b[order].copy()
    for _ in range(200):
        for i in range(len(ang) - 1):
            if ang[i + 1] - ang[i] < minsep:
                m = (ang[i] + ang[i + 1]) / 2
                ang[i], ang[i + 1] = m - minsep / 2, m + minsep / 2
    out = [None] * len(targets)
    for k, i in enumerate(order):
        rr_ = r * (0.85 + 0.3 * ((k * 7919) % 5) / 4)
        out[i] = np.array(c) + rr_ * np.array([math.cos(math.radians(ang[k])), math.sin(math.radians(ang[k]))])
    return out


ASH_FIELD = np.array([470.0, 470.0])
ASH_TG = [lane_s, ANCHORS["harrow_grange"], ANCHORS["wychcote"], ASH_FIELD]
ASH_V = green_corners(ASHBY, ASH_TG)
_gord = np.argsort([math.atan2(v[1] - ASHBY[1], v[0] - ASHBY[0]) for v in ASH_V])
_gp = []
_rg = np.random.default_rng(SEED + 5)
for k in range(len(_gord)):
    a, b = ASH_V[_gord[k]], ASH_V[_gord[(k + 1) % len(_gord)]]
    _gp.append(a)
    for tt in (0.33, 0.66):
        m = a + (b - a) * tt
        _gp.append(ASHBY + (m - ASHBY) * _rg.uniform(0.92, 1.12))
ASH_GREEN = [tuple(q) for q in chaikin(np.array(_gp + [_gp[0]]), 2)[:-1]]
# the lanes round the green (houses face onto it)
_register("Ashby Green", "village_street", 5.0, np.array(ASH_GREEN + [ASH_GREEN[0]]), "Lanes round Ashby green.")
mark(ASH_GREEN, 2)

# 1. Bridge Road: Ashby -> Holloway -> bridge -> Rookham (the spine of the map)
add_road("Bridge Road", "highway", 5.0,
         [(ASH_V[0], lane_n, "route"), (lane_n, br_s, "route"),
          (br_s, br_n, "straight"), (br_n, ROOK, "route")],
         "Ashby to Rookham over Harrow Bridge; the southern stretch runs down the Holloway.")
# 1b. the whole Holloway is a lane (its lower end runs out into the Wychwood fields)
add_road("Holloway", "hollow_way", 5.0, [(lane_s, lane_n, "route")],
         "The sunken lane: worn 3 m into the slope, a ready-made trench and covered approach to the bridge; its foot runs out into the Wychwood fields.")
# 2. Stane Street: Ashby -> Harrow Grange -> Stane Ford -> Gallows Gap -> Rookham
GALLOWS_C = np.array(fxy("Gallows Gap"))
add_road("Stane Street", "highway", 5.0,
         [(ASH_V[1], ANCHORS["harrow_grange"], "route"), (ANCHORS["harrow_grange"], st_s, "route"),
          (st_s, st_n, "straight"), (st_n, GALLOWS_C, "route"), (GALLOWS_C, ROOK, "route")],
         "Ashby's road east: shares the Bridge Road over Wychwood gorge (Ashby's single wheeled crossing: a chokepoint), forks at the Holloway's mouth, skirts the ridge's forward foot and the Moss lip to Harrow Grange, then over Stane Ford and through the Gallows Gap.")
# 3. Hob's Way: Ashby -> Wychcote -> Hob's Ford -> Hobsgarth
add_road("Hob's Way", "track", 3.5,
         [(ASH_V[2], ANCHORS["wychcote"], "route"), (ANCHORS["wychcote"], hb_s, "route"),
          (hb_s, hb_n, "straight"), (hb_n, ANCHORS["hobsgarth"], "route")],
         "Western track up Wychwood Bottom to Hob's Ford and the Blackfell farms.")
# 4. Mere Road: Hobsgarth -> Harrow Mere outflow -> Rookham (north-bank lateral)
MERE_OUT = np.array([1950.0, 3100.0])
SPRING = search(MERE_OUT + np.array([60, -40]), 140,
                lambda X, Y: flat_dry(X, Y, 8) - np.abs(samp(H, X, Y) - (meta["water"]["mere_level_m"] - 2)) * 0.5
                - 40 * (samp(W, X, Y) > 0.02), step=4)
ANCHORS["spring"] = SPRING
add_road("Mere Road", "track", 3.5,
         [(ANCHORS["hobsgarth"], SPRING, "route"), (SPRING, ROOK_W, "route")],
         "North-bank track from Hobsgarth past the holy spring at the mere's outfall to Rookham.")
# 5. Crake Lane: bridge north -> Crake Mill -> Mere Road
add_road("Crake Lane", "track", 3.5,
         [(br_n, ANCHORS["crake_mill"], "route"), (ANCHORS["crake_mill"], SPRING, "route")],
         "Up Crake Gill from the bridgehead to the mill and the spring.")
# 6. Beck Lane: Rookham -> Beckfoot -> Tor Knap foot
add_road("Ashby Field Lane", "track", 3.5, [(ASH_V[3], ASH_FIELD, "route")],
         "Ashby's lane out to its south-west open fields.")
add_road("Rookham Back Lane", "track", 3.5, [(ROOK_W, np.array([2950.0, 3560.0]), "route")],
         "Rookham's lane up to its northern open fields.")
add_spur("Beck Lane", "track", 3.5, ANCHORS["beckfoot"], "Rookham's lane down Rook Beck to Beckfoot.")
add_spur("Knap Path", "path", 2.0, ANCHORS["ruin"], "Steep path up to the ruined keep on Tor Knap.")

# ============================================================================ outputs accumulate
OBJ = []
RESERVED = []
WOOD_HINTS = []


def obj(id_, kind, asset, x, y, rot=0.0, scale=1.0, **kw):
    o = {"id": id_, "kind": kind, "asset": asset, "x": R2(x), "y": R2(y), "z": R2(h(x, y)),
         "rot": round(float(rot), 3), "scale": R2(scale)}
    o.update({k: v for k, v in kw.items() if v is not None})
    OBJ.append(o)
    return o


def reserve(id_, use, poly, surface=None, note=None):
    r = {"id": id_, "use": use, "poly": [P(q) for q in ccw(list(poly))]}
    if surface:
        r["surface"] = surface
    if note:
        r["note"] = note
    RESERVED.append(r)
    return r


def circle(c, r, n=16, jitter=0.0):
    out = []
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = r * (1 + jitter * (rng.random() - 0.5))
        out.append((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr))
    return out


# ============================================================================ villages
def roads_near(c, r):
    out = []
    for rd in ROADS:
        d = np.hypot(*(rd["pts"] - c).T)
        if d.min() < r:
            out.append(rd)
    return out


def lane_from(c, rd, length):
    """The stretch of road rd leaving point c (ordered outward), up to `length` m."""
    pts = resample(rd["pts"], 4.0)
    d = np.hypot(*(pts - c).T)
    i = int(np.argmin(d))
    fw = pts[i:]
    bw = pts[:i + 1][::-1]
    out = []
    for seg in (fw, bw):
        if len(seg) < 3:
            continue
        c_ = arclen(seg)
        out.append(seg[c_ <= length])
    return out


def plant_plots(town, lane, s0, s1, sides, lane_w, maxn, rng_, house_team):
    """Tofts (house yards) and crofts (gardens) along a lane, both sides, organic spacing."""
    plots = []
    if len(lane) < 2:
        return plots
    L = arclen(lane)[-1]
    s = s0
    while s < min(s1, L - 8) and len(plots) < maxn:
        f = rng_.uniform(15, 24)
        if rng_.random() < 0.10:
            s += rng_.uniform(10, 25)    # a vacant or lost holding
            continue
        p, t = at_s(lane, s + f / 2)
        ang = math.atan2(t[1], t[0])
        nrm = np.array([-t[1], t[0]])
        for side in sides:
            if len(plots) >= maxn:
                break
            off = lane_w / 2 + 1.5
            dep = rng_.uniform(26, 40)
            mid = p + side * nrm * (off + dep / 2)
            toft = rect(mid[0], mid[1], ang, f - 1.0, dep)
            if not (poly_free(toft) and buildable(toft)):
                continue
            croft = None
            for cd in (rng_.uniform(45, 80), 35, 22):
                cm = p + side * nrm * (off + dep + cd / 2 + 0.5)
                cr = rect(cm[0], cm[1], ang, f - 1.0, cd)
                if poly_free(cr) and buildable(cr, max_slope=11):
                    croft = cr
                    break
            mark(toft)
            if croft:
                mark(croft)
            # house: long side to the street (70 %) or gable-end on (30 %)
            along = rng_.uniform(-(f / 2 - 5.5), f / 2 - 5.5)
            if rng_.random() < 0.7:
                hrot, dn = ang, off + 2 + 2.5
            else:
                hrot, dn = ang + math.pi / 2, off + 2 + 4
            hc = p + t * along + side * nrm * dn
            plots.append({"toft": toft, "croft": croft, "house": (hc, hrot), "front": p, "side": side,
                          "dist": float(np.hypot(*(p - town)))})
        s += f
    return plots


def convex_hull(pts):
    P_ = sorted(map(tuple, np.asarray(pts, float)))

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in P_:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(P_):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return np.array(lo[:-1] + up[:-1])


def ray_poly(u, poly):
    """Distance from the origin along unit u to the boundary of a convex polygon containing the origin."""
    best = 0.0
    for a, b in zip(poly, np.roll(poly, -1, 0)):
        e = b - a
        den = u[0] * e[1] - u[1] * e[0]
        if abs(den) < 1e-9:
            continue
        t = (a[0] * e[1] - a[1] * e[0]) / den
        w = (a[0] * u[1] - a[1] * u[0]) / den
        if t > 0 and -1e-6 <= w <= 1 + 1e-6:
            best = max(best, t)
    return best


def contour_ring(center, core_pts, rng_, margin=14, extra=45):
    """Suggested enceinte: just outside the core, pushed out to the brow (steepest fall) of the rise,
    smoothed. Returns closed polyline (world)."""
    core = np.asarray(core_pts, float) - center
    ang = np.arctan2(core[:, 1], core[:, 0])
    rad = np.hypot(core[:, 0], core[:, 1])
    n = 72
    rmin = np.full(n, 60.0)
    for k in range(n):
        a = 2 * np.pi * k / n
        dd = np.abs((ang - a + np.pi) % (2 * np.pi) - np.pi)
        m = dd < np.radians(9)
        if m.any():
            rmin[k] = max(rmin[k], rad[m].max() + margin)
    # convexify: town circuits are ovals, not stars (a re-entrant angle is a weak point)
    U = np.stack([np.cos(2 * np.pi * np.arange(n) / n), np.sin(2 * np.pi * np.arange(n) / n)], 1)
    hull = convex_hull(U * rmin[:, None])
    for k in range(n):
        rmin[k] = max(rmin[k], ray_poly(U[k], hull))
    rs = np.zeros(n)
    for k in range(n):
        a = 2 * np.pi * k / n
        u = np.array([math.cos(a), math.sin(a)])
        best, bv = rmin[k], -1e9
        for r in np.arange(rmin[k], rmin[k] + extra, 4.0):
            p0 = center + u * r
            p1 = center + u * (r + 8)
            fall = (h(*p0) - h(*p1)) / 8.0                 # positive = falling away
            v = fall - 0.004 * (r - rmin[k])                # prefer the first real brow
            if wd(*p1) > 0.02 or ms(*p1) > 40:
                break
            if v > bv:
                bv, best = v, r
        rs[k] = best
    for _ in range(8):
        rs = 0.5 * rs + 0.25 * (np.roll(rs, 1) + np.roll(rs, -1))
        rs = np.maximum(rs, rmin)
    pts = [center + np.array([math.cos(2 * np.pi * k / n), math.sin(2 * np.pi * k / n)]) * rs[k] for k in range(n)]
    pts = rdp(np.array(pts + [pts[0]]), 1.5)
    return pts


def ring_gates(ring, names=None):
    gates = []
    for rd in ROADS:
        p = rd["pts"]
        for a, b in zip(p[:-1], p[1:]):
            for c, d in zip(ring[:-1], ring[1:]):
                r_ = b - a
                s_ = d - c
                den = r_[0] * s_[1] - r_[1] * s_[0]
                if abs(den) < 1e-9:
                    continue
                t = ((c[0] - a[0]) * s_[1] - (c[1] - a[1]) * s_[0]) / den
                u = ((c[0] - a[0]) * r_[1] - (c[1] - a[1]) * r_[0]) / den
                if 0 <= t <= 1 and 0 <= u <= 1:
                    q = a + t * r_
                    if all(np.hypot(*(np.array(g["xy"]) - q)) > 25 for g in gates):
                        gates.append({"xy": P(q), "road": rd["name"],
                                      "rot": round(math.atan2(s_[1], s_[0]), 3)})
    return gates


def place_on_edge(center, cands_fn, fp, prefer_high=True, tries=400, rng_=None, pad=0.0):
    """Try candidate (x,y,rot) and keep the free & buildable one that is highest (or nearest)."""
    best = None
    for (x, y, rot) in cands_fn(tries):
        poly = rect(x, y, rot, fp[0] + pad, fp[1] + pad)
        if not (poly_free(poly) and buildable(poly, max_slope=6)):
            continue
        score = h(x, y) if prefer_high else -math.hypot(x - center[0], y - center[1])
        score -= math.hypot(x - center[0], y - center[1]) * 0.02
        if best is None or score > best[0]:
            best = (score, x, y, rot, poly)
    return best


def build_town(tid, name, team, center, style):
    log("town", name, style)
    rr = np.random.default_rng(SEED + 17 * (team + 1))
    town = {"id": tid, "name": name, "team": team, "style": style, "site": P(center)}
    rds = roads_near(center, 90)
    lanes = []
    for rd in rds:
        for ln in lane_from(center, rd, 360):
            if len(ln) > 3:
                lanes.append((rd, ln))

    # ---- green / market place
    if style == "green":
        green = ASH_GREEN
        green_c = np.array(green).mean(0)
        green_surface = "short_meadow"
    else:
        # a market widening on the downhill side of the street, near the centre
        s_mid = float(np.argmin(np.hypot(*(resample(street, 4.0) - center).T))) * 4.0
        p, t = at_s(street, s_mid)
        ang = math.atan2(t[1], t[0])
        nrm = np.array([-t[1], t[0]])
        down = -1 if (h(*(p + nrm * 20)) > h(*(p - nrm * 20))) else 1
        mc = p + down * nrm * 16
        green = rect(mc[0], mc[1], ang, 64, 26)
        green_c = mc
        green_surface = "trampled_ground"
    mark(green, 2)
    town["green"] = {"poly": [P(q) for q in ccw(green)], "kind": "green" if style == "green" else "market_place"}
    reserve(f"{tid}_green", "green" if style == "green" else "market_place", green, green_surface)
    well = green_c + np.array([rr.uniform(-6, 6), rr.uniform(-6, 6)])
    town["well"] = P(well)
    obj(f"{tid}_well", "well", "well", well[0], well[1], 0, team=team, category="structure")

    # ---- manor (town hall) on the highest ground near the centre, within a ditched curia
    def hall_cands(n):
        for _ in range(n):
            a = rr.uniform(0, 2 * np.pi)
            r = rr.uniform(35, 150)
            x, y = center[0] + math.cos(a) * r, center[1] + math.sin(a) * r
            # face the nearest road
            dmin, bt_ = 1e9, None
            for rd in rds:
                pp = resample(rd["pts"], 6)
                d = np.hypot(*(pp - (x, y)).T)
                if d.min() < dmin:
                    dmin = d.min()
                    bt_ = pp[int(np.argmin(d))]
            rot = math.atan2(bt_[1] - y, bt_[0] - x) + math.pi / 2 if bt_ is not None else 0
            yield x, y, rot
    hb = place_on_edge(center, hall_cands, (66, 50), prefer_high=True)
    _, hx, hy, hrot, curia = hb
    mark(curia)
    reserve(f"{tid}_curia", "manor_curia", curia, "trampled_ground", "Manor court: hall, barns, ditch & hedge-bank")
    town["hall"] = {"x": R2(hx), "y": R2(hy), "z": R2(h(hx, hy)), "rot": round(hrot, 3), "curia": [P(q) for q in ccw(curia)]}
    obj(f"{tid}_town_hall", "town_hall", "town_hall", hx, hy, hrot, team=team, category="structure", start=True)
    # manor barn / granary inside the curia
    u = np.array([math.cos(hrot), math.sin(hrot)])
    v = np.array([-u[1], u[0]])
    gpos = np.array([hx, hy]) - v * 16 + u * 14
    obj(f"{tid}_granary", "granary", "granary", gpos[0], gpos[1], hrot, team=team, category="structure", start=True)

    # ---- church: east-west, by the green, on a rise
    def church_cands(n):
        gp = np.array(green)
        for _ in range(n):
            q = gp[rr.integers(len(gp))]
            dirv = q - green_c
            dirv /= np.hypot(*dirv) + 1e-9
            c_ = q + dirv * rr.uniform(26, 60)
            yield c_[0], c_[1], 0.0 + rr.uniform(-0.12, 0.12)   # chancel to the east (liturgical)
    cb = place_on_edge(green_c, church_cands, (46, 34), prefer_high=True)
    _, cx_, cy_, crot, yard = cb
    mark(yard)
    reserve(f"{tid}_churchyard", "churchyard", yard, "short_meadow")
    town["church"] = {"x": R2(cx_), "y": R2(cy_), "rot": round(crot, 3), "churchyard": [P(q) for q in ccw(yard)]}
    obj(f"{tid}_church", "temple", "church", cx_, cy_, crot, team=team, category="structure", start=True,
        note="Parish church (sim kind 'temple': heals, prebuilt)")

    # ---- plots along every lane leaving town
    plots = []
    base_s = 30 if style == "green" else 6
    sides = (-1, 1)
    for k, (rd, ln) in enumerate(lanes):
        ln = np.asarray(ln)
        lane_w = rd["width"]
        # skip the part inside the green
        s0 = base_s
        for s in np.arange(0, arclen(ln)[-1], 4):
            p, _ = at_s(ln, s)
            if not pip(np.array([p[0]]), np.array([p[1]]), green)[0]:
                s0 = max(s0, s + 4)
                break
        smax = 300 if rd["type"] in ("highway", "village_street") else 190
        plots += plant_plots(center, ln, s0, smax, sides, lane_w, 26, rr, team)
    if style == "green":
        # houses round the green, facing it
        gp = np.array(green + [green[0]])
        gp = gp[::-1] if poly_area(green) > 0 else gp     # walk CW so +normal... side chosen below
        plots += plant_plots(center, resample(gp, 3), 0, arclen(gp)[-1], (1, -1), 2.0, 14, rr, team)
    plots.sort(key=lambda p: p["dist"])
    plots = plots[:42]
    town_plots = []
    for i, pl in enumerate(plots):
        (hc, hrot_) = pl["house"]
        pid = f"{tid}_plot{i:02d}"
        town_plots.append({"id": pid, "toft": [P(q) for q in ccw(pl["toft"])],
                           "croft": [P(q) for q in ccw(pl["croft"])] if pl["croft"] else None,
                           "house": {"x": R2(hc[0]), "y": R2(hc[1]), "rot": round(hrot_, 3), "footprint": [8, 5]},
                           "start_house": i < 6})
        reserve(f"{pid}_toft", "toft", pl["toft"], "trampled_ground")
        if pl["croft"]:
            reserve(f"{pid}_croft", "croft", pl["croft"], "kitchen_garden")
    town["plots"] = town_plots
    log(f"  {len(town_plots)} plots")
    # start houses = the 6 nearest the green; smithy & weaver take the next two street-front plots
    for i, tp in enumerate(town_plots[:6]):
        hs = tp["house"]
        obj(f"{tid}_house{i}", "house", "house", hs["x"], hs["y"], hs["rot"], team=team, category="structure",
            start=True, plot=tp["id"])
    for i, (kind, asset) in enumerate((("blacksmith", "blacksmith"), ("weaver", "fletcher"))):
        tp = town_plots[6 + i]
        hs = tp["house"]
        obj(f"{tid}_{kind}", kind, asset, hs["x"], hs["y"], hs["rot"], team=team, category="structure",
            start=True, plot=tp["id"], note="craft workshop on a street-front toft" if kind != "weaver" else
            "weaver & armourer (no own asset yet: uses the fletcher workshop)")
        tp["occupied_by"] = kind
    # wattle fences along each toft's street front
    for tp in town_plots:
        t = np.array(tp["toft"])
        # the edge nearest the road
        best, bd = None, 1e9
        for a, b in zip(t, np.roll(t, -1, 0)):
            m = (a + b) / 2
            d = min(np.hypot(*(rd["pts"] - m).T).min() for rd in rds) if rds else 1e9
            if d < bd:
                bd, best = d, (a, b)
        a, b = best
        m = (a + b) / 2
        obj(f"{tp['id']}_fence", "fence", "fence", m[0], m[1], math.atan2(b[1] - a[1], b[0] - a[0]),
            scale=float(np.hypot(*(b - a))) / 4.0, category="structure", note="wattle fence, scale = length/4 m")
    town["_core"] = np.vstack([np.array(curia), np.array(yard), np.array(green)]
                              + [np.array(tp["toft"]) for tp in town_plots[:28]])
    return town


TOWNS = []
TOWNS.append(build_town("ashby", "Ashby", 0, ASHBY, "green"))
TOWNS.append(build_town("rookham", "Rookham", 1, ROOK, "street"))


# ---- mills on the nearest beck
def town_mill(t, center, maxr=900):
    def sc(X, Y):
        ns = near_stream(X, Y, lo=0.05, hi=0.85, r=40)
        d = np.hypot(X - center[0], Y - center[1])
        return flat_dry(X, Y, 8) * 0.5 - np.abs(ns - 16) / 2.5 - d / 60
    p = search(center, maxr, sc, step=6, rmin=150)
    # orient along the stream: gradient of water depth
    best = None
    for a in np.linspace(0, np.pi, 18, endpoint=False):
        u = np.array([math.cos(a), math.sin(a)])
        v = sum(wd(*(p + u * r)) + wd(*(p - u * r)) for r in (10, 20, 30))
        if best is None or v > best[0]:
            best = (v, a)
    rot = best[1]
    poly = rect(p[0], p[1], rot, 14, 12)
    mark(poly)
    reserve(f"{t['id']}_mill", "mill", poly, "trampled_ground", "Watermill, leat and tail-race")
    obj(f"{t['id']}_mill", "mill", "mill", p[0], p[1], rot, team=t["team"], category="structure", start=True)
    t["mill"] = {"x": R2(p[0]), "y": R2(p[1]), "rot": round(rot, 3)}
    add_spur(f"{t['name']} Mill Lane", "track", 3.0, p, f"Lane from {t['name']} to its mill.")
    return p


for t, c in zip(TOWNS, (ASHBY, ROOK)):
    town_mill(t, c)

# ============================================================================ hamlets & sites
log("hamlets")
HAMLETS = []


def build_hamlet(hid, name, c, team_lean, note, kind="hamlet", n_houses=None):
    rr = np.random.default_rng(SEED + sum(map(ord, hid)))
    c = np.array(c, float)
    rd_pts = np.vstack([r["pts"] for r in ROADS])
    dd = np.hypot(*(rd_pts - c).T)
    toward = rd_pts[int(np.argmin(dd))]
    face = math.atan2(toward[1] - c[1], toward[0] - c[0])
    blds = []
    n = n_houses or rr.integers(3, 5)
    kinds = [("farm", "farm"), ("granary", "granary"), ("house", "house"), ("house", "house"), ("fence", "fence")]
    k = 0
    tries = 0
    while len(blds) < n and tries < 200:
        tries += 1
        a = face + math.pi + (k - (n - 1) / 2) * 1.2 + rr.uniform(-0.3, 0.3) if k else face + rr.uniform(-0.4, 0.4)
        r = rr.uniform(10, 18) if k else 4
        kind, asset = kinds[min(len(blds), 3)]
        fp = {"farm": (16, 8), "granary": (18, 9), "house": (8, 5)}[kind]
        x, y = c[0] + math.cos(a) * r, c[1] + math.sin(a) * r
        rot = a + math.pi / 2 + rr.uniform(-0.15, 0.15)
        poly = rect(x, y, rot, fp[0] + 2, fp[1] + 2)
        if poly_free(poly) and buildable(poly, 9):
            mark(poly)
            blds.append((kind, asset, x, y, rot))
            k += 1
        elif tries % 20 == 0:
            k += 1
    yard = circle(c, 38, 14, 0.25)
    reserve(f"{hid}_yard", "hamlet_yard", yard, "trampled_ground")
    infield = circle(c, 180, 18, 0.5)
    for i, (kind, asset, x, y, rot) in enumerate(blds):
        obj(f"{hid}_{kind}{i}", kind, asset, x, y, rot, category="structure", hamlet=hid)
    HAMLETS.append({"id": hid, "name": name, "kind": kind, "center": P(c), "z": R2(h(*c)),
                    "lean": ["blue", "red", "neutral"][team_lean] if team_lean is not None else "neutral",
                    "buildings": [{"kind": b[0], "x": R2(b[2]), "y": R2(b[3]), "rot": round(b[4], 3)} for b in blds],
                    "yard": [P(q) for q in ccw(yard)], "infield_hint": [P(q) for q in ccw(infield)],
                    "yields": {"food_kg_day": 60 if hid != "harrow_grange" else 110, "recruits": 6 if hid != "harrow_grange" else 10},
                    "note": note})


for hid, nm, cc, r, side, note in HAMLET_DEF:
    build_hamlet(hid, nm, ANCHORS[hid], side, note)

SITES = []


def site(sid, name, kind, asset, p, rot=0.0, note="", fp=(10, 10), surface="short_meadow", **kw):
    poly = rect(p[0], p[1], rot, fp[0], fp[1])
    mark(poly)
    reserve(sid, kind, poly, surface, note)
    obj(sid, kind, asset, p[0], p[1], rot, category="structure", **kw)
    SITES.append({"id": sid, "name": name, "kind": kind, "asset": asset, "x": R2(p[0]), "y": R2(p[1]),
                  "z": R2(h(*p)), "rot": round(rot, 3), "note": note})


# Crake Mill (the contested watermill)
cm = ANCHORS["crake_mill"]
site("crake_mill", "Crake Mill", "watermill", "mill", cm, 1.45, fp=(16, 14), surface="trampled_ground",
     note="Watermill on Crake Gill 600 m above the bridge: grinds for whoever holds it (+food), "
          "but it sits in a gully the Knap and the bridgehead overlook.")
# Ruined keep on Tor Knap
rk = ANCHORS["ruin"]
site("tor_knap_keep", "Tor Knap Keep (ruin)", "ruin_keep", "ruin_keep", rk, 0.35, fp=(34, 34), surface="boulder_field",
     note="Shell keep on the Knap summit: commands bridge, Moss and Rook Beck; roofless, can be refortified.")
# Gallows at the Gap: on the knoll beside Stane Street at the Gap mouth
st = next(r for r in ROADS if r["name"] == "Stane Street")["pts"]
dd = np.hypot(*(resample(st, 5) - GALLOWS_C).T)
gp_ = resample(st, 5)[int(np.argmin(dd))]
gal = search(gp_, 45, lambda X, Y: samp(H, X, Y) * 0.2 - np.abs(line_dist(X, Y, st) - 16) - samp(SLOPE, X, Y) * 0.3, step=3)
site("gallows", "Gallows at the Gap", "gallows", "gallows", gal, 0.0, fp=(8, 8),
     note="Gibbet on the road through the Gap: a landmark every scout can range from.")
# Wayside chapel: at the Holloway's upper mouth, where the lane opens onto the bridge flats
br = next(r for r in ROADS if r["name"] == "Bridge Road")["pts"]
chap = search(LANE_CTRL[-1] + np.array([-60, -20]), 120,
              lambda X, Y: -np.abs(line_dist(X, Y, br) - 14) * 2 - samp(SLOPE, X, Y) * 2
              - 50 * (samp(W, X, Y) > 0.02) - 30 * (samp(MARSH, X, Y) > 30), step=3)
site("wayside_chapel", "St Hob's Chapel", "chapel", "chapel", chap, 0.0, fp=(10, 7),
     note="Wayside chapel at the Holloway's mouth: last cover before the bridge flats; a small shrine (mana).")

# ============================================================================ resources
log("resources")
RES = []


def res(rid, kind, asset, p, resname, amount, note, rot=None, scale=1.0, clear_r=None, surface=None, **kw):
    rot = rng.uniform(0, 2 * np.pi) if rot is None else rot
    o = obj(rid, kind, asset, p[0], p[1], rot, scale, res=resname, amount=amount, category="resource", note=note, **kw)
    RES.append(o)
    if clear_r:
        poly = circle(p, clear_r, 12)
        mark(poly)
        reserve(rid, kind, poly, surface)
    return o


def crag_foot(c, r, lo=16, hi=28, prefer=None):
    def sc(X, Y):
        s = samp(SLOPE, X, Y)
        up = np.zeros_like(X)
        for a in np.linspace(0, 2 * np.pi, 8, endpoint=False):
            up = np.maximum(up, samp(SLOPE, X + math.cos(a) * 20, Y + math.sin(a) * 20))
        v = -np.abs(s - (lo + hi) / 2) * 0.3 + np.minimum(up, 45) * 0.4 - 80 * (samp(W, X, Y) > 0.02)
        v -= 60 * (samp(ROCK, X, Y) > 100)
        if prefer is not None:
            v -= np.hypot(X - prefer[0], Y - prefer[1]) / 40
        return v
    return search(c, r, sc, step=5)


# --- precious metal: veins in the rock uplands
up_c = np.array(fxy("Blackfell"))
gold = crag_foot((980, 3330), 200, prefer=(960, 3260))
res("gold_blackfell", "gold_vein", "gold_vein", gold, "gold", 3200,
    "Quartz-gold stringer at the crag foot above Hob's Ford: roughly equidistant from both towns, "
    "but worked in full view of the ford and under the Blackfell scree. Rich, exposed.", clear_r=18, surface="scree")
silv_w = crag_foot((430, 3620), 240, prefer=(420, 3560))
res("silver_blackfell", "silver_vein", "silver_vein", silv_w, "silver", 4000,
    "Lead-silver working deep in the Blackfell crags: safe from raiders, but a long haul over the ford and bad going.",
    clear_r=18, surface="scree")
silv_e = crag_foot((3520, 1640), 180, prefer=(3470, 1600))
res("silver_cold_knowe", "silver_vein", "silver_vein", silv_e, "silver", 6000,
    "Galena vein on Cold Knowe's south shoulder: Rookham's richest purse, but it faces Stane Ford "
    "and a blue raid through the ford can reach it before the Gap is shut.", clear_r=18, surface="scree")

# --- iron
moss = np.array(fxy("Harrow Moss"))


def marsh_edge(c, r, prefer):
    def sc(X, Y):
        m = samp(MARSH, X, Y)
        return -np.abs(m - 70) / 10 - 60 * (samp(W, X, Y) > 0.05) - np.hypot(X - prefer[0], Y - prefer[1]) / 80
    return search(c, r, sc, step=6)


bog = marsh_edge(moss, 420, (2450, 1600))
res("bog_iron_moss", "bog_iron", "bog_iron", bog, "ore", 80000,
    "Bog-ore beds on the south lip of Harrow Moss below the bridge: the best iron on the map, "
    "dug in soft ground under the eyes of Tor Knap.", clear_r=20, surface="mud")
bog2 = marsh_edge((300, 3250), 350, (330, 3330))
res("bog_iron_west", "bog_iron", "bog_iron", bog2, "ore", 40000,
    "Small bog-ore bed at the flooded river entry on the red bank: poor and remote, but behind the river from Ashby.",
    clear_r=16, surface="mud")
iron_ridge = crag_foot((2380, 1060), 220, lo=12, hi=24, prefer=(2330, 1000))
res("ironstone_ridge", "iron_outcrop", "iron_outcrop", iron_ridge, "ore", 55000,
    "Ironstone band outcropping on Harrow Ridge's forward face: Ashby's iron, but miners there are "
    "visible from the red bank and from the Knap.", clear_r=16, surface="rock_slab")

# --- stone
oldq = crag_foot((2530, 1180), 160, lo=14, hi=30, prefer=(2540, 1170))
res("old_quarry", "quarry", "quarry_face", oldq, "stone", 3000000,
    "The abandoned quarry that built the Knap keep: huge reserves already opened, on the ridge's NE nose "
    "facing the Moss and Stane Ford. Whoever wants stone walls fights for it.", rot=0.8, clear_r=40,
    surface="quarry_floor")
for t, c, pc in ((TOWNS[0], ASHBY, (1150, 820)), (TOWNS[1], ROOK, (3640, 3120))):
    q = crag_foot(pc, 320, lo=10, hi=22, prefer=pc)
    res(f"quarry_{t['id']}", "quarry", "quarry_face", q, "stone", 900000,
        f"{t['name']}'s own stone pit: close and safe, but a small, poor bed.", clear_r=22, surface="quarry_floor",
        team=t["team"])
    t["quarry"] = P(q)
    mc_ = q + (c - q) / np.hypot(*(c - q)) * 30
    obj(f"{t['id']}_mining_camp", "mining_camp", "mining_camp", mc_[0], mc_[1], math.atan2(*(c - q)[::-1]),
        team=t["team"], category="structure", start=True)
    mark(rect(mc_[0], mc_[1], 0, 14, 14))
    add_spur(f"{t['name']} Quarry Track", "track", 3.0, mc_, f"Cart track to {t['name']}'s stone pit.")
add_spur("Old Quarry Track", "track", 3.0, oldq + np.array([-25, -30]), "Overgrown track to the old quarry.")

# --- timber: lumber sites at forest edges (woodland hints for the land-use agent)
WOODS = [
    # id, centre, radius, lean, amount, note
    ("wychwood_south", (1270, 980), 180, 0, 1100000, "Wychwood Bottom (south): Ashby's close timber, in the valley below the town."),
    ("wychwood_north", (1250, 1900), 200, 0, 1500000, "Wychwood Bottom (north): bigger stand, but toward Hob's Ford and the river."),
    ("ridge_hanger", (1880, 560), 170, 0, 600000, "Hanger wood on Harrow Ridge's SW flank: safe behind the crest, steep hauling."),
    ("hanger_knoll", (2560, 3560), 200, 1, 900000, "Hanger Knoll wood: Rookham's timber, 800 m west of the town."),
    ("rook_beck_wood", (3080, 2780), 150, 1, 700000, "Rook Beck hanging wood below Rookham: close and covered."),
    ("knowe_wood", (3800, 2400), 190, 1, 800000, "Cold Knowe's north-east wood: large, but on the far side of the Gap."),
    ("mere_wood", (2250, 3180), 160, None, 800000, "Mere-side wood on the moraine: neutral timber between the mere and the Knap."),
]
for wid, c, r, lean, amount, note in WOODS:
    poly = circle(c, r, 18, 0.45)
    WOOD_HINTS.append({"id": wid, "poly": [P(q) for q in ccw(poly)], "lean": lean, "note": note})
    # lumber site on the edge facing the nearest town
    tc = ASHBY if lean == 0 else ROOK if lean == 1 else BRIDGE_C
    u = (np.array(tc) - c)
    u /= np.hypot(*u)
    edge = np.array(c) + u * r * 0.85
    edge = search(edge, 50, lambda X, Y: flat_dry(X, Y, 6) - 30 * (samp(W, X, Y) > 0.02), step=4)
    res(f"lumber_{wid}", "wood", "lumber_site", edge, "timber", amount, note,
        team=lean if lean in (0, 1) else None, woodland=wid)
for t, wid in ((TOWNS[0], "wychwood_south"), (TOWNS[1], "rook_beck_wood")):
    ls = next(o for o in RES if o["id"] == f"lumber_{wid}")
    c = ASHBY if t["team"] == 0 else ROOK
    p = np.array([ls["x"], ls["y"]])
    u = (c - p) / np.hypot(*(c - p))
    lc = p + u * 25
    obj(f"{t['id']}_lumber_camp", "lumber_camp", "lumber_camp", lc[0], lc[1], math.atan2(u[1], u[0]),
        team=t["team"], category="structure", start=True)
    mark(rect(lc[0], lc[1], 0, 14, 12))
    add_spur(f"{t['name']} Wood Lane", "track", 3.0, lc, f"Timber lane to {t['name']}'s lumber camp.")

# --- food
mere_c = np.array(fxy("Harrow Mere"))
fish_m = search(mere_c, 260, lambda X, Y: -np.abs(samp(W, X, Y) - 2.5) - 20 * (samp(W, X, Y) < 0.5), step=6)
res("fish_mere", "fishery", "fish_school", fish_m, "fresh", 16000,
    "Pike, perch and eel in Harrow Mere: the largest fishery, restocks 1 %/day; the shore is red-bank and remote from Ashby.")
for rid, c, amt, note in (
        ("fish_stane", F_STANE[0] + (F_STANE[1] - F_STANE[0]) * 0.5 + F_STANE[4] * 70, 6000,
         "Salmon pool below Stane Ford: fished from either bank, and the ford is the front line."),
        ("fish_hob", F_HOB[0] + (F_HOB[1] - F_HOB[0]) * 0.5 - F_HOB[4] * 70, 6000,
         "Trout run above Hob's Ford, contested between the western farms.")):
    p = search(c, 60, lambda X, Y: -np.abs(samp(W, X, Y) - 1.5), step=3)
    res(rid, "fishery", "fish_school", p, "fresh", amt, note)
eel = search(np.array([2450.0, 1560.0]), 300,
             lambda X, Y: -np.abs(samp(W, X, Y) - 0.5) * 4 - 30 * (samp(W, X, Y) < 0.15) - 30 * (samp(W, X, Y) > 1.2)
             - np.hypot(X - 2350, Y - 1450) / 60, step=5)
res("fish_moss_eels", "fishery", "fish_school", eel, "fresh", 8000,
    "Eel weirs and fowling in the pools of Harrow Moss: rich and on the blue bank, but in the flooded "
    "ground everyone must cross, under the Knap.")
for t, c in ((TOWNS[0], ASHBY), (TOWNS[1], ROOK)):
    mp = np.array([t["mill"]["x"], t["mill"]["y"]])
    p = search(mp, 160, lambda X, Y: -np.abs(samp(W, X, Y) - 0.4) - 20 * (samp(W, X, Y) < 0.1)
               - np.hypot(X - mp[0], Y - mp[1]) / 30, step=3, rmin=40)
    res(f"fish_{t['id']}_pond", "fishery", "fish_school", p, "fresh", 3000,
        f"{t['name']}'s mill-pond and beck: small, safe, slow.", team=t["team"])
DEER = [("deer_wychwood", (1180, 1450), 2600, 0, "Red deer in Wychwood: good hunting, but the herd drifts toward Hob's Ford."),
        ("deer_ridge", (2250, 450), 1400, 0, "Roe on the ridge's reverse slope: small and safe."),
        ("deer_knowe", (3750, 2350), 2200, 1, "Red deer in the Knowe woods: beyond the Gap, safe from all but raiders."),
        ("deer_blackfell", (650, 3550), 1800, None, "Hill deer on Blackfell: nobody's, a long way from anybody.")]
for rid, c, amt, lean, note in DEER:
    p = search(c, 150, lambda X, Y: flat_dry(X, Y, 10), step=8)
    res(rid, "deer_herd", "deer_herd", p, "fresh", amt, note, team=lean, wanders_m=250)
BERRY = [("berries_ashby_w", (560, 980), 0), ("hazel_ashby_s", (1130, 520), 0),
         ("berries_rook_n", (3180, 3560), 1), ("hazel_rook_e", (3620, 3380), 1),
         ("berries_knap", (2440, 2300), None), ("hazel_field", (2560, 380), None)]
for rid, c, lean in BERRY:
    p = search(c, 140, lambda X, Y: flat_dry(X, Y, 6) - 20 * (samp(W, X, Y) > 0.02), step=8)
    res(rid, "forage", "berry_bush", p, "fresh", 600 if lean is not None else 900,
        "Bramble & hazel thicket (autumn berries, nuts): seasonal, a few weeks of gathering.", team=lean, scale=2.0)

# --- mana: ley sites
kn = np.array(fxy("Hanger Knoll"))
ring_c = search(kn, 80, lambda X, Y: samp(H, X, Y) - samp(SLOPE, X, Y) * 0.5, step=3)
res("ley_hanger_ring", "ley", "ley_stone", ring_c, "mana", 350,
    "Stone ring on Hanger Knoll's crown: close to Rookham, but a clearing on a hill every scout watches.",
    rot=0.0, clear_r=20, surface="short_meadow")
nst = 11
for k in range(nst):
    a = 2 * math.pi * k / nst + rng.uniform(-0.08, 0.08)
    rr_ = 12.5 + rng.uniform(-0.8, 0.8)
    obj(f"ley_hanger_ring_stone{k}", "structure", "standing_stone", ring_c[0] + math.cos(a) * rr_,
        ring_c[1] + math.sin(a) * rr_, a + rng.uniform(-0.3, 0.3), scale=R2(rng.uniform(0.7, 1.3)),
        category="structure", part_of="ley_hanger_ring")
res("ley_holy_spring", "ley", "holy_spring", SPRING, "mana", 600,
    "Holy spring at the mere's outfall: the strongest ley, on the red bank but a long walk from Rookham, "
    "one gill from the bridge and one ford from Ashby: the map's most contested prize.", rot=0.0, clear_r=14,
    surface="short_meadow")
# barrow on Harrow Ridge crest (a long barrow on the skyline, as they were sited)
ridge_c = np.array(fxy("Harrow Ridge"))
bar = search(np.array([1780.0, 560.0]), 180,
             lambda X, Y: samp(H, X, Y) - samp(SLOPE, X, Y) * 1.2, step=5)
res("ley_ridge_barrow", "ley", "barrow", bar, "mana", 700,
    "Long barrow on Harrow Ridge crest: Ashby's ley, but on the skyline, the first place red guns and eyes look.",
    rot=0.78, clear_r=24, surface="short_meadow")
res("ley_chapel", "ley", "chapel", chap, "mana", 300,
    "St Hob's shrine: a weak, forward holy site at the Holloway's mouth.", rot=0.0)
add_spur("Barrow Path", "path", 2.0, bar, "Ridgeway path to the barrow.")
add_spur("Knoll Path", "path", 2.0, ring_c + np.array([0, -18]), "Path up Hanger Knoll to the stones.")
add_spur("Knowe Mine Track", "track", 3.0, silv_e + np.array([-15, -15]), "Cart track to the Cold Knowe silver.")
add_spur("Blackfell Mine Track", "track", 3.0, gold + np.array([0, -18]), "Track up the scree to the gold working.")

# ============================================================================ enceintes & gates
for t in TOWNS:
    c = ASHBY if t["team"] == 0 else ROOK
    hall = np.array([t["hall"]["x"], t["hall"]["y"]])
    ring = contour_ring((hall + c) / 2, t.pop("_core"), rng)
    t["enceinte"] = {"poly": [P(q) for q in ring], "perimeter_m": R2(arclen(ring)[-1]),
                     "gates": ring_gates(ring),
                     "note": "Suggested circuit for palisade/stone wall: just outside the core tofts, pushed out "
                             "to the brow of the rise so attackers climb to it. Gates where roads cross.",
                     "palisade_man_days": R2(arclen(ring)[-1] * 0.6),
                     "stone_wall_worker_days": R2(arclen(ring)[-1] * 110)}
    log(f"  {t['name']} enceinte {arclen(ring)[-1]:.0f} m, {len(t['enceinte']['gates'])} gates")

# ============================================================================ road typing
log("road typing")


SR = 4.0
SHR = np.zeros((int(SIZE / SR) + 1, int(SIZE / SR) + 1), bool)   # cells already covered by an emitted road


def type_road(rd):
    pts = resample(rd["pts"], 5.0)
    typ = []
    ii = np.clip((pts[:, 0] / SR).astype(int), 0, SHR.shape[1] - 1)
    jj = np.clip((pts[:, 1] / SR).astype(int), 0, SHR.shape[0] - 1)
    shared = SHR[jj, ii]
    for p, sh_ in zip(pts, shared):
        tt = rd["type"]
        if sh_:
            typ.append("shared")
            continue
        if ms(*p) > 40:
            tt = "causeway"
        gi, gj = int(p[0] // G), int(p[1] // G)
        if GLANE[min(gj, GN - 1), min(gi, GN - 1)] and rd["type"] != "path":
            tt = "hollow_way"
        typ.append(tt)
    # clean runs shorter than 30 m
    typ = np.array(typ, object)
    for _ in range(2):
        i = 0
        while i < len(typ):
            j = i
            while j < len(typ) and typ[j] == typ[i]:
                j += 1
            if (j - i) * 5 < 30 and 0 < i and j < len(typ):
                typ[i:j] = typ[i - 1]
            i = j
    out = []
    i = 0
    k = 0
    while i < len(pts):
        j = i
        while j < len(pts) and typ[j] == typ[i]:
            j += 1
        seg = pts[max(0, i - 1):j + (1 if j < len(pts) else 0)]
        seg = rdp(seg, 1.0)
        tt = typ[i]
        if tt == "shared":
            i = j
            continue
        width = {"causeway": 4.0, "hollow_way": 5.0}.get(tt, rd["width"])
        out.append({"id": f"{rd['name'].lower().replace(' ', '_').replace(chr(39), '')}_{k}", "route": rd["name"],
                    "type": tt, "width": width, "pts": [P(q) for q in seg],
                    "length_m": R2(arclen(seg)[-1])})
        k += 1
        i = j
    # stamp this road (dilated ~9 m) so later routes that run along it are not emitted twice
    for p in pts:
        i0, j0 = int(p[0] / SR), int(p[1] / SR)
        SHR[max(0, j0 - 2):j0 + 3, max(0, i0 - 2):i0 + 3] = True
    return out


ROAD_OUT = []
for rd in ROADS:
    ROAD_OUT += type_road(rd)

# beck crossings: where a road wades a stream (not the river fords, not the bridge)
BECKS = []
for r in ROAD_OUT:
    for p in resample(np.array(r["pts"]), 3.0):
        d = wd(*p)
        if 0.04 < d < 0.8 and seg_dist(p[0], p[1], br_s, br_n) > 30 and \
                all(np.hypot(*(p - np.array(f["center"]))) > 70 for f in ford_out):
            for b in BECKS:
                if np.hypot(*(p - b["_p"])) < 35:
                    b["depth_max_m"] = max(b["depth_max_m"], R2(d))
                    break
            else:
                BECKS.append({"_p": p, "center": P(p), "depth_max_m": R2(d), "road": r["route"]})
for k, b in enumerate(BECKS):
    b.pop("_p")
    b.update({"id": f"beck_crossing_{k}", "name": f"splash on {b['road']}", "feature": "ford",
              "bed": "stony beck", "note": "shallow beck crossing (wet feet, slows carts); a stepping-stone or plank crossing"})
ford_out += BECKS
log(f"  {len(BECKS)} beck crossings")

# sanity: roads never in deep water except on the bridge
bad = 0
for r in ROAD_OUT:
    for p in resample(np.array(r["pts"]), 3.0):
        if wd(*p) > 0.8 and seg_dist(p[0], p[1], br_s, br_n) > 6:
            bad += 1
log("road points in deep water off the bridge:", bad)

# ============================================================================ fairness (travel cost)
log("fairness fields")
cost_b = dijkstra_all(ASHBY)
cost_r = dijkstra_all(ROOK)


def access(p):
    i, j = int(min(GN - 1, p[0] // G)), int(min(GN - 1, p[1] // G))
    best = [np.inf, np.inf]
    for dj in range(-9, 10):
        for di in range(-9, 10):
            ii, jj = min(GN - 1, max(0, i + di)), min(GN - 1, max(0, j + dj))
            best[0] = min(best[0], cost_b[jj, ii])
            best[1] = min(best[1], cost_r[jj, ii])
    return [R2(best[0]) if np.isfinite(best[0]) else None, R2(best[1]) if np.isfinite(best[1]) else None]


for o in RES:
    o["access_cost_m"] = {"blue": access((o["x"], o["y"]))[0], "red": access((o["x"], o["y"]))[1]}
fair = {}
for o in RES:
    b, r = o["access_cost_m"]["blue"], o["access_cost_m"]["red"]
    k = o["res"]
    f = fair.setdefault(k, {"blue_near": 0, "red_near": 0, "blue_weighted": 0.0, "red_weighted": 0.0})
    if b is None or r is None:
        continue
    if b < r:
        f["blue_near"] += 1
    else:
        f["red_near"] += 1
    f["blue_weighted"] += o["amount"] * r / (b + r)
    f["red_weighted"] += o["amount"] * b / (b + r)
for k, f in fair.items():
    tot = f["blue_weighted"] + f["red_weighted"]
    f["blue_share"] = R2(f["blue_weighted"] / tot) if tot else None
    f["blue_weighted"] = R2(f["blue_weighted"])
    f["red_weighted"] = R2(f["red_weighted"])
    log(f"  {k:8s} blue share {f['blue_share']}  nearer: blue {f['blue_near']} red {f['red_near']}")

# ============================================================================ write
bridges = [{"id": "harrow_bridge", "name": "Harrow Bridge", "center": P(BRIDGE_C), "end_south": P(br_s),
            "end_north": P(br_n), "length_m": R2(np.hypot(*(br_n - br_s))), "wet_span_m": R2(br_wet),
            "deck_z": [R2(h(*br_s)), R2(h(*br_n))], "rot": round(math.atan2(*(br_n - br_s)[::-1]), 3),
            "width_m": 4.5, "asset": "bridge_wood", "upgrade_asset": "bridge_stone",
            "feature": "bridge_timber_wide", "river_depth_m": R2(br_dmax),
            "note": "Timber trestle road bridge on the narrow deep reach; the only dry crossing. Burnable "
                    "(demolish 40 man-h), rebuildable in stone."}]
reserve("harrow_bridge_south", "bridge_abutment", circle(br_s, 14, 10), "bare_earth")
reserve("harrow_bridge_north", "bridge_abutment", circle(br_n, 14, 10), "bare_earth")
for f in ford_out:
    if "bank_south" not in f:
        continue
    reserve(f["id"] + "_south", "ford_approach", circle(f["bank_south"], 16, 10), "gravel")
    reserve(f["id"] + "_north", "ford_approach", circle(f["bank_north"], 16, 10), "gravel")

settle = {
    "map": "vale", "generator": "tools/map/settle_vale.py", "seed": SEED,
    "conventions": {"units": "metres, SW origin, +x east, +y north (as meta.json)",
                    "rot": "radians CCW from +x about +z; model long axis = local +x",
                    "polys": "[[x,y],...] counter-clockwise, not closed unless noted (enceinte is closed)"},
    "towns": TOWNS, "hamlets": HAMLETS, "sites": SITES,
    "roads": ROAD_OUT, "bridges": bridges, "fords": ford_out,
    "reserved": RESERVED, "woodland_hints": WOOD_HINTS, "fairness": fair,
    "contract": {
        "land_use_must": ["leave every `reserved` polygon free of trees, crops and hedges (paint its `surface` if given)",
                          "paint roads with their width: highway/track -> dirt_track, hollow_way -> hollow_way, "
                          "causeway -> dirt_track raised over marsh, village_street -> village_street, path -> short_meadow worn",
                          "put woodland on `woodland_hints` (the lumber_site markers sit on their town-facing edges)",
                          "hamlet `infield_hint` rings are good arable; town crofts are kitchen_garden/orchard"],
        "settlements_provides": ["town halls, plots, roads, crossings, resource nodes; objects.json for placement"]},
}


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


with open(os.path.join(D, "settlements.json"), "w") as f:
    json.dump(clean(settle), f, indent=1)
with open(os.path.join(D, "objects.json"), "w") as f:
    json.dump(clean({"map": "vale", "generator": "tools/map/settle_vale.py", "seed": SEED,
                     "note": "category 'resource' = gatherable node (res, amount); 'structure' = placed model. "
                             "rot radians CCW from +x.", "objects": OBJ}), f, indent=1)
log(f"wrote settlements.json ({len(ROAD_OUT)} road segments, {len(RESERVED)} reserved) and objects.json ({len(OBJ)} objects)")

# ============================================================================ overview image
log("overview")
S2 = 2
IM = N * S2
img = np.zeros((IM, IM, 3))
Hn = H[::-1]
Wn = W[::-1]
Mn = MARSH[::-1]
t = (Hn - Hn.min()) / (Hn.max() - Hn.min())
tint = np.stack([0.80 + 0.14 * t, 0.84 + 0.02 * t, 0.66 - 0.08 * t], -1)
sh = SHADE / 255.0
base = tint * (0.55 + 0.6 * sh[..., None])
wm = Wn > 0.03
base[wm] = np.array([0.45, 0.62, 0.80]) * (1 - np.clip(Wn[wm] / 10, 0, 0.35))[:, None]
mm = (Mn > 60) & ~wm
base[mm] = base[mm] * 0.85 + np.array([0.35, 0.5, 0.45]) * 0.15
# contours every 5 m
cz = np.floor(Hn / 5)
edge = (cz != np.roll(cz, 1, 0)) | (cz != np.roll(cz, 1, 1))
base[edge & ~wm] *= 0.88
img = K.upscale(np.clip(base, 0, 1), S2)


def w2p(x, y):
    return x / CELL * S2, (N - 1 - y / CELL) * S2


def fill(poly, color, alpha=1.0):
    pp = np.array([w2p(*q) for q in poly])
    x0, y0 = np.floor(pp.min(0)).astype(int)
    x1, y1 = np.ceil(pp.max(0)).astype(int)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(IM - 1, x1), min(IM - 1, y1)
    if x1 <= x0 or y1 <= y0:
        return
    ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
    m = pip(xs + 0.5, ys + 0.5, pp)
    sub = img[y0:y1 + 1, x0:x1 + 1]
    sub[m] = sub[m] * (1 - alpha) + np.array(color) * alpha


def stroke(pts, color, width_px, alpha=1.0, dash=None, closed=False):
    pp = np.array([w2p(*q) for q in pts])
    if closed:
        pp = np.vstack([pp, pp[:1]])
    acc = 0.0
    for a, b in zip(pp[:-1], pp[1:]):
        L = np.hypot(*(b - a))
        if dash:
            ph = (acc % sum(dash))
            acc += L
            if ph > dash[0]:
                continue
        x0, y0 = np.floor(np.minimum(a, b) - width_px - 1).astype(int)
        x1, y1 = np.ceil(np.maximum(a, b) + width_px + 1).astype(int)
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(IM - 1, x1), min(IM - 1, y1)
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        d = seg_dist(xs + 0.5, ys + 0.5, a, b)
        cov = np.clip(width_px / 2 + 0.5 - d, 0, 1) * alpha
        sub = img[y0:y1 + 1, x0:x1 + 1]
        img[y0:y1 + 1, x0:x1 + 1] = sub * (1 - cov[..., None]) + np.array(color) * cov[..., None]


def label(s, x, y, color=(0.1, 0.1, 0.1), scale=2, dx=8, dy=-6):
    px, py = w2p(x, y)
    tmp = (img * 255).astype(np.uint8)
    K.draw_text(tmp, s, int(px + dx), int(py + dy), tuple(int(c * 255) for c in color), scale)
    img[:] = tmp / 255.0


def dot(x, y, color, r=4, square=False):
    px, py = w2p(x, y)
    y0, y1 = int(max(0, py - r)), int(min(IM, py + r + 1))
    x0, x1 = int(max(0, px - r)), int(min(IM, px + r + 1))
    ys, xs = np.mgrid[y0:y1, x0:x1]
    m = np.ones_like(xs, bool) if square else np.hypot(xs - px, ys - py) <= r
    img[y0:y1, x0:x1][m] = np.array(color)
    if not square:
        m2 = (np.hypot(xs - px, ys - py) <= r) & (np.hypot(xs - px, ys - py) > r - 1.2)
        img[y0:y1, x0:x1][m2] = np.array((0.1, 0.1, 0.1))


for wh in WOOD_HINTS:
    fill(wh["poly"], (0.28, 0.45, 0.25), 0.35)
for hm in HAMLETS:
    fill(hm["infield_hint"], (0.85, 0.78, 0.45), 0.25)
ROAD_STYLE = {"highway": ((0.55, 0.18, 0.10), 4.2), "track": ((0.45, 0.30, 0.15), 3.0),
              "village_street": ((0.50, 0.22, 0.12), 4.2), "hollow_way": ((0.25, 0.15, 0.08), 4.6),
              "causeway": ((0.35, 0.35, 0.30), 4.2), "path": ((0.40, 0.30, 0.20), 1.8)}
for r in ROAD_OUT:
    col, wpx = ROAD_STYLE[r["type"]]
    stroke(r["pts"], (0.98, 0.95, 0.85), wpx + 2.0)
for r in ROAD_OUT:
    col, wpx = ROAD_STYLE[r["type"]]
    stroke(r["pts"], col, wpx, dash=(10, 6) if r["type"] == "path" else None)
for t in TOWNS:
    tc = (0.15, 0.25, 0.75) if t["team"] == 0 else (0.75, 0.12, 0.12)
    fill(t["green"]["poly"], (0.55, 0.75, 0.40), 0.9)
    for pl in t["plots"]:
        if pl["croft"]:
            fill(pl["croft"], (0.70, 0.78, 0.45), 0.7)
        fill(pl["toft"], (0.86, 0.80, 0.62), 0.9)
        stroke(pl["toft"], (0.45, 0.38, 0.25), 1.0, closed=True)
    fill(t["hall"]["curia"], (0.80, 0.74, 0.60), 0.9)
    stroke(t["hall"]["curia"], (0.3, 0.25, 0.2), 1.2, closed=True)
    fill(t["church"]["churchyard"], (0.62, 0.72, 0.52), 0.9)
    stroke(t["enceinte"]["poly"], tc, 1.6)
for o in OBJ:
    if o["category"] != "structure" or o["asset"] in ("fence", "standing_stone"):
        continue
    fp = {"town_hall": (22, 18), "church": (24, 14), "house": (8, 5), "granary": (18, 9), "farm": (16, 8),
          "mill": (10, 10), "blacksmith": (10, 8), "fletcher": (8, 8), "lumber_camp": (10, 8), "mining_camp": (10, 8),
          "well": (4, 4), "ruin_keep": (26, 26), "chapel": (10, 7), "gallows": (5, 5)}.get(o["asset"], (6, 6))
    col = (0.35, 0.12, 0.10) if o.get("team") is None else ((0.1, 0.15, 0.55) if o["team"] == 0 else (0.55, 0.08, 0.08))
    if o["asset"] in ("ruin_keep",):
        col = (0.3, 0.3, 0.3)
    fill(rect(o["x"], o["y"], o["rot"], fp[0] * 1.2, fp[1] * 1.2), col, 1.0)
for b in bridges:
    stroke([b["end_south"], b["end_north"]], (0.2, 0.1, 0.05), 6)
for f in ford_out:
    if "bank_south" not in f:
        dot(*f["center"], (0.95, 0.9, 0.6), 4)
        continue
    stroke([f["bank_south"], f["bank_north"]], (0.95, 0.9, 0.6), 7, alpha=0.8)
RCOL = {"gold": (0.95, 0.78, 0.1), "silver": (0.8, 0.8, 0.85), "ore": (0.55, 0.25, 0.15), "stone": (0.6, 0.6, 0.6),
        "timber": (0.15, 0.4, 0.15), "fresh": (0.3, 0.7, 0.9), "mana": (0.7, 0.3, 0.9)}
for o in RES:
    if o["kind"] in ("deer_herd", "forage"):
        dot(o["x"], o["y"], (0.9, 0.5, 0.3) if o["kind"] == "deer_herd" else (0.7, 0.2, 0.4), 4)
    else:
        dot(o["x"], o["y"], RCOL[o["res"]], 6, square=o["res"] in ("stone", "timber"))
# labels
for t in TOWNS:
    tc = (0.1, 0.15, 0.6) if t["team"] == 0 else (0.6, 0.08, 0.08)
    label(t["name"].upper(), t["hall"]["x"], t["hall"]["y"] + 260, tc, 3, dx=-30)
for hm in HAMLETS:
    label(hm["name"], *hm["center"], (0.2, 0.15, 0.1), 2, dx=14)
for s_ in SITES:
    label(s_["name"], s_["x"], s_["y"], (0.25, 0.2, 0.2), 2, dx=14, dy=22 if s_["id"] == "crake_mill" else 6)
RLAB = {"gold_blackfell": "GOLD", "silver_blackfell": "SILVER", "silver_cold_knowe": "SILVER",
        "bog_iron_moss": "BOG IRON", "bog_iron_west": "BOG IRON", "ironstone_ridge": "IRONSTONE",
        "old_quarry": "OLD QUARRY", "quarry_ashby": "QUARRY", "quarry_rookham": "QUARRY",
        "fish_mere": "FISH", "ley_hanger_ring": "STONE RING (LEY)", "ley_holy_spring": "HOLY SPRING (LEY)",
        "ley_ridge_barrow": "BARROW (LEY)", "deer_wychwood": "DEER", "deer_knowe": "DEER", "deer_blackfell": "DEER",
        "deer_ridge": "DEER", "fish_stane": "FISH", "fish_hob": "FISH"}
for o in RES:
    if o["id"] in RLAB:
        label(RLAB[o["id"]], o["x"], o["y"], (0.15, 0.1, 0.1), 2, dx=10, dy=-18)
    elif o["kind"] == "wood":
        label("TIMBER", o["x"], o["y"], (0.1, 0.3, 0.1), 2, dx=10, dy=-18)
named = set()
for r in ROAD_OUT:
    if r["route"] in named or r["length_m"] < 300 or r["type"] in ("path",):
        continue
    named.add(r["route"])
    pts = np.array(r["pts"])
    m = at_s(pts, arclen(pts)[-1] * 0.5)[0]
    label(r["route"], m[0], m[1], (0.4, 0.15, 0.05), 2, dx=6, dy=6)
tmp = (np.clip(img, 0, 1) * 255).astype(np.uint8)
K.draw_text(tmp, "VALE OF HARROW - SETTLEMENTS, ROADS & RESOURCES (settle_vale.py)", 16, IM - 30, (20, 20, 20), 2)
K.write_png(os.path.join(D, "settle_overview.png"), tmp)
if os.environ.get("SETTLE_CROPS"):
    out = os.environ["SETTLE_CROPS"]
    for t in TOWNS:
        px, py = w2p(t["hall"]["x"], t["hall"]["y"])
        px, py = int(px), int(py)
        crop = tmp[max(0, py - 260):py + 260, max(0, px - 260):px + 260]
        K.write_png(os.path.join(out, f"crop_{t['id']}.png"), np.kron(crop, np.ones((2, 2, 1), np.uint8)))
log("done")
