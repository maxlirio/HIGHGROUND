"""landuse_vale.py — land use, vegetation and canopy for the Vale of Harrow.

    python3 tools/map/landuse_vale.py          (numpy only, ~1 min)

Reads  maps/vale/{height,water}.f32, the mask PNGs, meta.json, and (if present)
       maps/vale/settlements.json from the settlements pass.
Writes maps/vale/surface.u8     uint8 res×res, SOUTH-first rows (same as height.f32);
                                 byte = index into meta.json.surfaceKeys (js/sim/terrain-types.js keys)
       maps/vale/canopy.u8      uint8 res×res, SOUTH-first; canopy / tall-vegetation top in metres
                                 above ground (0 = none). Used by vision for LOS through woods.
       maps/vale/vegetation.json tree & shrub instances {asset, x, y, rot, scale} (world metres)
       maps/vale/landuse_overview.png  north-up colour map (TERRAIN colours, hillshade, trees, labels)
       meta.json: adds/updates `surfaceKeys` and `landuse` (all other fields kept).

Deterministic (seed 1307 + fixed salts). Model, in painting order:
  commons base (pasture/heath/bracken/gorse by ground) -> uplands (moor, heath, limestone)
  -> hedged closes ring -> open fields (great fields -> furlongs -> selion strips, three-course
  rotation, late-summer state) -> floodplain meadows -> hedgerows -> woods (Wychwood, hangers,
  dingles, knoll, coppice) -> marsh family -> rock/scree -> river banks -> water -> settlements/roads.
"""
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapkit as K  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
D = os.path.join(ROOT, "maps", "vale")
SEED = 1307
META = json.load(open(os.path.join(D, "meta.json")))
N = META["res"]
C = META["cell_m"]
SIZE = META["size_m"]
CELL_HA = C * C / 10000.0


def log(*a):
    print("[landuse]", *a, flush=True)


# ============================================================================ inputs
def read_png8(name):
    """Grey 8-bit PNG written by mapkit (filter 0) -> SOUTH-first uint8 array."""
    import struct
    import zlib
    d = open(os.path.join(D, name), "rb").read()
    i, idat = 8, b""
    while i < len(d):
        L = struct.unpack(">I", d[i:i + 4])[0]
        t = d[i + 4:i + 8]
        c = d[i + 8:i + 8 + L]
        i += 12 + L
        if t == b"IHDR":
            w, h = struct.unpack(">II", c[:8])
        elif t == b"IDAT":
            idat += c
    r = np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, w + 1)
    assert (r[:, 0] == 0).all(), f"{name}: only filter-0 PNGs supported"
    return r[:, 1:][::-1].copy()


def terrain_table():
    src = open(os.path.join(ROOT, "js", "sim", "terrain-types.js")).read()
    body = src[src.index("export const TERRAIN"):src.index("export const FEATURES")]
    keys, cols = [], {}
    for m in re.finditer(r"^\s{2}(\w+): T\(\{(.*?)\}\),\s*$", body, re.S | re.M):
        keys.append(m.group(1))
        cm = re.search(r"color: '#([0-9a-fA-F]{6})'", m.group(2))
        cols[m.group(1)] = tuple(int(cm.group(1)[k:k + 2], 16) for k in (0, 2, 4))
    return keys, cols


TKEYS, TCOL = terrain_table()
CLEARED = ("dense_forest", "open_forest", "pine_forest", "coppice", "hedgerow", "standing_wheat",
           "standing_barley", "standing_oats_beans", "bramble_thicket", "gorse_scrub", "alder_carr", "orchard")
S = {k: i for i, k in enumerate(TKEYS)}  # working ids = TERRAIN order; remapped on write

H = np.fromfile(os.path.join(D, "height.f32"), "<f4").reshape(N, N).astype(np.float64)
WD = np.fromfile(os.path.join(D, "water.f32"), "<f4").reshape(N, N).astype(np.float64)
MARSH = read_png8("marsh.png").astype(np.float64)
FLOW = read_png8("river_flow.png").astype(np.float64)
ROCK = read_png8("rock.png") > 0
SCREE = read_png8("scree.png").astype(np.float64)
CREST = read_png8("crest.png")

jj, ii = np.mgrid[0:N, 0:N]
X = ii * C
Y = jj * C
FEAT = {f["name"].split(" (")[0]: f["xy_m"] for f in META["features"]}


def rng_for(salt):
    return np.random.default_rng(SEED * 1000 + salt)


def noise(cell, octaves=4, salt=0, gain=0.5):
    return K.fbm(X, Y, cell, octaves, rng_for(salt), gain=gain)


def hash01(*arrs, salt=0):
    """Deterministic per-integer-tuple uniform in [0,1)."""
    h = np.uint64((0x9E3779B97F4A7C15 * (salt + 1)) & 0xFFFFFFFFFFFFFFFF)
    with np.errstate(over="ignore"):
        for a in arrs:
            a = np.asarray(a).astype(np.uint64)
            h = h ^ (a + np.uint64(0x9E3779B97F4A7C15) + (h << np.uint64(6)) + (h >> np.uint64(2)))
            h = (h ^ (h >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
            h = (h ^ (h >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
            h = h ^ (h >> np.uint64(31))
    return (h >> np.uint64(11)).astype(np.float64) / float(1 << 53)


def dist_to(pt):
    return np.hypot(X - pt[0], Y - pt[1])


def slope_deg(h):
    gy, gx = np.gradient(h, C)
    return np.degrees(np.arctan(np.hypot(gx, gy))), gx, gy


def hillshade(h, az=315, alt=45, z=1.6):
    gy, gx = np.gradient(h * z, C)      # south-first: +row = north, so gy is d/dy (north)
    a, e = np.radians(az), np.radians(alt)
    lx, ly, lz = np.sin(a) * np.cos(e), np.cos(a) * np.cos(e), np.sin(e)
    return np.clip((-gx * lx - gy * ly + lz) / np.sqrt(gx * gx + gy * gy + 1), 0, 1)


def propagate(mask, val, iters):
    """Chamfer nearest-source transform: distance (cells) and the source value."""
    dist = np.where(mask, 0.0, 1e9)
    v = np.where(mask, val, 0.0)
    steps = [(0, 1, 1.0), (0, -1, 1.0), (1, 0, 1.0), (-1, 0, 1.0),
             (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142)]
    for _ in range(iters):
        changed = False
        for dj, di, w in steps:
            sj = slice(max(dj, 0), N + min(dj, 0))
            tj = slice(max(-dj, 0), N + min(-dj, 0))
            si = slice(max(di, 0), N + min(di, 0))
            ti = slice(max(-di, 0), N + min(-di, 0))
            cand = dist[tj, ti] + w
            m = cand < dist[sj, si]
            if m.any():
                changed = True
                dist[sj, si] = np.where(m, cand, dist[sj, si])
                v[sj, si] = np.where(m, v[tj, ti], v[sj, si])
        if not changed:
            break
    return dist * C, v


def dilate(m, r):
    return K.local_max(m.astype(np.float64), r) > 0.5


def voronoi(spacing, salt, jitter=0.7, warp=0.0):
    """Jittered-grid Voronoi: (cell id, seed x, seed y, distance to nearest boundary in m)."""
    rng = rng_for(salt)
    g = int(np.ceil(SIZE / spacing)) + 3
    ox = (np.arange(g)[None, :] - 1 + 0.5 + rng.uniform(-jitter / 2, jitter / 2, (g, g))) * spacing
    oy = (np.arange(g)[:, None] - 1 + 0.5 + rng.uniform(-jitter / 2, jitter / 2, (g, g))) * spacing
    Xw, Yw = X, Y
    if warp > 0:
        Xw = X + warp * noise(spacing * 1.5, 3, salt + 1)
        Yw = Y + warp * noise(spacing * 1.5, 3, salt + 2)
    ga = np.floor(Yw / spacing).astype(int) + 1
    gb = np.floor(Xw / spacing).astype(int) + 1
    best = np.full(X.shape, 1e18)
    second = np.full(X.shape, 1e18)
    bid = np.zeros(X.shape, int)
    bx = np.zeros(X.shape)
    by = np.zeros(X.shape)
    cands = []
    for da in (-1, 0, 1):
        for db in (-1, 0, 1):
            a = np.clip(ga + da, 0, g - 1)
            b = np.clip(gb + db, 0, g - 1)
            sx, sy = ox[a, b], oy[a, b]
            d2 = (Xw - sx) ** 2 + (Yw - sy) ** 2
            cands.append((d2, a * g + b, sx, sy))
    for d2, cid, sx, sy in cands:
        m = d2 < best
        second = np.where(m, best, np.minimum(second, d2))
        best = np.where(m, d2, best)
        bid = np.where(m, cid, bid)
        bx = np.where(m, sx, bx)
        by = np.where(m, sy, by)
    # exact distance to the bisector with the runner-up seed: (d2^2 - d1^2) / (2 |s2 - s1|)
    edge = np.full(X.shape, 1e9)
    for d2, cid, sx, sy in cands:
        sep = np.hypot(sx - bx, sy - by)
        e = np.where(cid != bid, (d2 - best) / (2 * np.maximum(sep, 1e-6)), 1e9)
        edge = np.minimum(edge, e)
    return bid, bx, by, edge


def brick(owner, frames, rh, cw_lo, cw_hi, salt, warp=10.0, split_p=0.3):
    """Rectilinear field partition in each settlement's own frame (rows of staggered blocks,
    like surveyed furlongs / enclosures). Returns (id, u, v, edge_m, theta) per cell."""
    th = np.zeros(X.shape)
    ox = np.zeros(X.shape)
    oy = np.zeros(X.shape)
    for k, (t, x0, y0) in enumerate(frames):
        m = owner == k
        th[m], ox[m], oy[m] = t, x0, y0
    dx = X - ox + warp * noise(300, 3, salt + 5)
    dy = Y - oy + warp * noise(300, 3, salt + 6)
    c, s = np.cos(th), np.sin(th)
    u = dx * c + dy * s
    v = -dx * s + dy * c
    # rows of varying height: each band's height set by hashing a coarse band index
    band = np.floor(v / (rh * 3)).astype(np.int64)
    rows_per = 2 + (hash01(band, owner + 7, salt=salt) * 3).astype(np.int64)   # 2..4 rows per band
    rhh = rh * 3 / rows_per
    fvb = v - band * rh * 3
    row = band * 8 + np.floor(fvb / rhh).astype(np.int64)
    fv = fvb / rhh - np.floor(fvb / rhh)
    rr = hash01(row, owner + 7, salt=salt + 1)
    cw = cw_lo + (cw_hi - cw_lo) * rr
    off = hash01(row, owner + 7, salt=salt + 2) * cw
    fu_raw = (u + off) / cw
    col = np.floor(fu_raw).astype(np.int64)
    fu = fu_raw - col
    dv = np.minimum(fv, 1 - fv) * rhh
    du = np.minimum(fu, 1 - fu) * cw
    sp = hash01(row, col, owner + 7, salt=salt + 3) < split_p
    half = sp & (fu >= 0.5)
    du = np.where(sp, np.minimum(du, np.abs(fu - 0.5) * cw), du)
    key = ((owner + 1) * 10 ** 12 + (row + 50000) * 10 ** 6 + (col + 50000) * 2 + half).astype(np.int64)
    _, fid = np.unique(key.ravel(), return_inverse=True)
    return fid.reshape(X.shape), u, v, np.minimum(du, dv), th


# ============================================================================ settlements
FALLBACK_SETTLEMENTS = [
    {"name": "Ashby", "kind": "town", "xy": FEAT["Ashby"]},
    {"name": "Rookham", "kind": "town", "xy": FEAT["Rookham"]},
]


def poly_mask(poly, pad=0.0):
    """Rasterise a polygon [[x,y],...] (world m) -> bool mask (even-odd rule, cell centres)."""
    P = np.asarray(poly, float)
    m = np.zeros((N, N), bool)
    if len(P) < 3:
        return m
    i0 = max(0, int((P[:, 0].min() - pad) / C) - 1)
    i1 = min(N, int((P[:, 0].max() + pad) / C) + 2)
    j0 = max(0, int((P[:, 1].min() - pad) / C) - 1)
    j1 = min(N, int((P[:, 1].max() + pad) / C) + 2)
    if i0 >= i1 or j0 >= j1:
        return m
    xs, ys = X[j0:j1, i0:i1], Y[j0:j1, i0:i1]
    inside = np.zeros(xs.shape, bool)
    for (ax, ay), (bx, by) in zip(P, np.roll(P, -1, 0)):
        cond = (ay > ys) != (by > ys)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = ax + (ys - ay) * (bx - ax) / (by - ay)
        inside ^= cond & (xs < xint)
    m[j0:j1, i0:i1] = inside
    if pad > 0:
        m = dilate(m, int(np.ceil(pad / C)))
    return m


def load_settlements():
    """Read settlements.json (tools/map/settle_vale.py contract). Returns a dict."""
    p = os.path.join(D, "settlements.json")
    out = {"places": [], "roads": [], "reserved": [], "woods": [], "fords": [], "bridges": [], "present": False}
    if not os.path.exists(p):
        log("settlements.json not found - using the two towns only")
        out["places"] = FALLBACK_SETTLEMENTS
        return out
    js = json.load(open(p))
    out["present"] = True
    for t in js.get("towns", []):
        out["places"].append({"name": t["name"], "kind": "town", "xy": tuple(t.get("site", t.get("center")))})
    for h in js.get("hamlets", []):
        k = str(h.get("kind", "hamlet")).lower()
        out["places"].append({"name": h["name"], "kind": "village" if "grange" in (k + h["name"]).lower() else "hamlet",
                              "xy": tuple(h["center"]), "infield": h.get("infield_hint")})
    for s_ in js.get("sites", []):
        out["places"].append({"name": s_["name"], "kind": "site", "xy": (s_["x"], s_["y"])})
    for r in js.get("roads", []):
        out["roads"].append({"pts": [tuple(q) for q in r["pts"]], "kind": r.get("type", "track"),
                             "width": float(r.get("width", 4.0)), "name": r.get("route", "")})
    out["reserved"] = js.get("reserved", [])
    out["woods"] = js.get("woodland_hints", [])
    out["fords"] = js.get("fords", [])
    out["bridges"] = js.get("bridges", [])
    return out


# ============================================================================ main
def main():
    log("derived terrain")
    SL, gx, gy = slope_deg(H)
    SLs, gxs, gys = slope_deg(K.blur(H, 6))
    TPI = H - K.blur(H, 25)          # ~100 m: + spur/knoll, - hollow/gully
    TPIL = H - K.blur(H, 90)         # ~350 m relief

    water = WD > 0.02
    river = water & (FLOW >= 250)
    mere = water & (dist_to(FEAT["Harrow Mere"]) < 450) & ~river
    beck = water & ~river & ~mere
    ws = H + WD
    log("river distance / height-above-river")
    driv, rsurf = propagate(river, ws, 220)
    HAND = np.where(driv < 1e8, H - rsurf, 99.0)
    streams = (FLOW >= 175) & ~river & ~mere
    dstr, ssurf = propagate(streams | beck, H, 40)
    HANDs = np.where(dstr < 1e8, H - ssurf, 99.0)
    dwat, _ = propagate(water, H, 12)
    # soil wetness / thinness proxies
    wet = K.smoothstep(40, 150, MARSH) + 0.6 * K.smoothstep(2.5, 0.3, HAND) * (driv < 700)
    wet = wet + 0.35 * K.smoothstep(1.5, 0.2, HANDs) * (dstr < 60)

    SET = load_settlements()
    places, roads = SET["places"], SET["roads"]
    log(f"{len(places)} place(s), {len(roads)} road segment(s), {len(SET['reserved'])} reserved, "
        f"{len(SET['woods'])} woodland hint(s)")
    reserved = np.zeros((N, N), bool)
    for r in SET["reserved"]:
        reserved |= poly_mask(r["poly"])
    hint_wood = np.zeros((N, N), bool)
    for w in SET["woods"]:
        hint_wood |= poly_mask(w["poly"])
    # organic outline: a woodland follows the ground, not a circle - grow into hollows and
    # steeper ground, retreat from spurs and the flat, with a noisy edge
    hsc = (K.blur(hint_wood.astype(float), 14) + 0.22 * noise(160, 4, 13) + 0.12 * noise(50, 3, 14)
           - 0.04 * (H - K.blur(H, 25)) + 0.012 * (np.degrees(np.arctan(np.hypot(*np.gradient(H, C)))) - 6))
    hint_wood = hsc > 0.42
    RAD = {"town": 950.0, "village": 620.0, "hamlet": 420.0, "farm": 230.0, "site": 0.0}
    CORE = {"town": 170.0, "village": 90.0, "hamlet": 55.0, "farm": 30.0, "site": 0.0}
    fplaces = [p for p in places if RAD.get(p["kind"], 0) > 0]

    # warped coordinates for organic boundaries
    WX = X + 110 * noise(700, 4, 11)
    WY = Y + 110 * noise(700, 4, 12)
    # settlement influence: normalised distance dn = d / R (nearest wins)
    dn = np.full(X.shape, 99.0)
    owner = np.full(X.shape, -1)
    for k, p in enumerate(fplaces):
        R = p.get("radius", 0) * 3.2 if p.get("radius") else RAD[p["kind"]]
        R = max(R, RAD[p["kind"]])
        d = np.hypot(WX - p["xy"][0], WY - p["xy"][1]) / R
        m = d < dn
        dn = np.where(m, d, dn)
        owner = np.where(m, k, owner)
    dcore = np.full(X.shape, 1e9)
    for p in fplaces:
        dcore = np.minimum(dcore, dist_to(p["xy"]) / max(CORE[p["kind"]], 1))

    # ---------------------------------------------------------------- region masks
    n1 = noise(260, 4, 21)
    n2 = noise(120, 4, 22)
    n3 = noise(60, 3, 23)
    bf = FEAT["Blackfell"]
    upland = K.smoothstep(92, 118, H + 15 * n1) * K.smoothstep(3050, 3300, Y + 150 * n1) \
        * K.smoothstep(1900, 1500, X + 200 * n1)
    ridge_top = K.smoothstep(128, 150, H + 10 * n1) * (np.hypot(X - 2100, Y - 800) < 1100)
    knowe = K.smoothstep(118, 135, H + 8 * n1) * (np.hypot(X - 3450, Y - 2050) < 700)
    upland = np.maximum(upland, np.maximum(ridge_top, knowe))
    hfield = ((X - 3050) / 720) ** 2 + ((Y - 480) / 480) ** 2 + 0.25 * n1 < 1.0   # Harrow Field common

    # Wychwood: the Wychwood Bottom valley (brook + its slopes)
    wb = streams & (X > 1050) & (X < 1520) & (Y > 250) & (Y < 2380) | (beck & (X > 1050) & (X < 1520) & (Y < 2380))
    dwb, wbsurf = propagate(wb, H, 110)
    wych_score = K.smoothstep(430, 180, dwb + 110 * n1) * K.smoothstep(26, 8, H - wbsurf + 6 * n2)
    wych_score *= K.smoothstep(300, 750, Y + 150 * n2) * K.smoothstep(2420, 2200, Y + 100 * n2)
    wychwood = wych_score > 0.5
    wych_core = wych_score > 0.8
    wych_tail = (K.smoothstep(380, 150, dwb + 90 * n1) > 0.5) & (Y < 750) & (Y > 150) & (n2 > -0.05)

    # ---------------------------------------------------------------- 1. commons base
    log("commons")
    surf = np.full((N, N), S["pasture"], np.int32)
    rough = n2 + 0.02 * (SL - 6) + 0.012 * (H - 100)          # poorer, rougher ground
    surf[(rough > 0.22) & (SL > 5)] = S["bracken"]
    surf[(rough > 0.35) & (n3 > 0.1)] = S["gorse_scrub"]
    surf[(rough > 0.28) & (H > 112) & (TPI > 0.5) & (n3 < 0.0)] = S["heath_heather"]
    surf[(n2 < -0.35) & (SL < 6)] = S["flower_meadow"]
    surf[(n1 < -0.45) & (SL < 5) & (TPI < 0)] = S["tall_grass"]
    surf[(TPIL < -6) & (SL < 2.5) & (n3 > 0.5) & (n2 < -0.2) & (HAND > 3)] = S["clay_heavy"]
    surf[(n3 > 0.55) & (n2 > 0.1) & (SL < 12)] = S["bramble_thicket"]
    # Harrow Field: the great common - close turf, firm, unhedged (cavalry ground)
    hf_t = np.where(n2 > 0.3, S["pasture"], np.where(n3 > 0.35, S["flower_meadow"], S["short_meadow"]))
    surf[hfield] = hf_t[hfield]

    # ---------------------------------------------------------------- 2. uplands
    log("uplands")
    up = upland > 0.5
    u_moor = (SL < 9) & (TPI < 1.0) & (n2 < 0.25)
    u_heath = (TPI >= 0.3) | (n2 >= 0.25)
    usurf = np.where(u_moor, S["moorland"], np.where(u_heath, S["heath_heather"], S["moorland"]))
    usurf = np.where((SL > 9) & (SL < 26) & (n3 > -0.1), S["bracken"], usurf)
    usurf = np.where((SL > 7) & (n2 > 0.35) & (H < 160), S["gorse_scrub"], usurf)
    # sheep-walk turf on the limestone ridge top and dry spurs
    usurf = np.where((ridge_top > 0.5) & (SL < 12) & (n2 < 0.05), S["chalk_downland"], usurf)
    usurf = np.where(up & (MARSH >= 40), S["peat_bog"], usurf)
    usurf = np.where((H > 150) & (TPI < -1.2) & (SL < 5) & (n3 > 0.0), S["peat_bog"], usurf)
    surf[up] = usurf[up]

    # ---------------------------------------------------------------- 3/4. fields
    log("fields")
    arable = (K.smoothstep(8.5, 5.0, SLs) * K.smoothstep(1.8, 3.5, HAND) * K.smoothstep(90, 30, MARSH)
              * (1 - upland) * K.smoothstep(145, 132, H) * (1 - wych_score) * ~hint_wood)
    # each township lays out its fields on its own axis: strips run with the fall of its land
    frames = []
    for k, p in enumerate(fplaces):
        m = np.hypot(X - p["xy"][0], Y - p["xy"][1]) < 900
        t = np.arctan2(gys[m].mean(), gxs[m].mean()) if m.any() else 0.0
        t += (hash01([k], salt=30)[0] - 0.5) * 0.4
        frames.append((t, p["xy"][0], p["xy"][1]))
    fid, fu, fv, fedge, fth = brick(owner, frames, 170.0, 150.0, 290.0, 31, warp=12.0, split_p=0.35)
    ncell = int(fid.max()) + 1
    cnt = np.bincount(fid.ravel(), minlength=ncell).astype(float)
    fsuit = np.bincount(fid.ravel(), arable.ravel(), ncell) / np.maximum(cnt, 1)
    fdn = np.bincount(fid.ravel(), dn.ravel(), ncell) / np.maximum(cnt, 1)
    fown = np.zeros(ncell, int)
    np.maximum.at(fown, fid.ravel(), owner.ravel())
    frnd = hash01(np.arange(ncell), salt=41)
    is_open = (fsuit > 0.55) & (fdn < 1.0 + 0.2 * (frnd - 0.5)) & (fdn > 0.1)
    open_c = is_open[fid] & (arable > 0.3)
    # great fields: sectors by bearing from the owning settlement (+ a random turn)
    sx = np.bincount(fid.ravel(), X.ravel(), ncell) / np.maximum(cnt, 1)
    sy = np.bincount(fid.ravel(), Y.ravel(), ncell) / np.maximum(cnt, 1)
    ang = np.zeros(ncell)
    for k, p in enumerate(fplaces):
        a = (np.arctan2(sy - p["xy"][1], sx - p["xy"][0]) + hash01([k], salt=42)[0] * 2 * np.pi) % (2 * np.pi)
        ang = np.where(fown == k, a, ang)
    nf = np.array([2 if fplaces[max(o, 0)]["kind"] in ("hamlet", "farm") else 3 for o in fown])
    gfield = np.floor(ang / (2 * np.pi) * nf).astype(int)
    phase = (gfield + (np.maximum(fown, 0) % 3)) % 3      # 0 winter corn, 1 spring corn, 2 fallow
    # strips in a furlong run along one frame axis: the one nearer the fall line (drainage of
    # ridge-and-furrow); on the flat, alternate furlongs lie at right angles to each other
    gxa = np.bincount(fid.ravel(), gxs.ravel(), ncell) / np.maximum(cnt, 1)
    gya = np.bincount(fid.ravel(), gys.ravel(), ncell) / np.maximum(cnt, 1)
    fth_c = np.zeros(ncell)
    np.maximum.at(fth_c, fid.ravel(), fth.ravel())
    gth = np.arctan2(gya, gxa)
    along_u = np.abs(np.cos(gth - fth_c)) > np.abs(np.sin(gth - fth_c))
    flat = np.hypot(gxa, gya) < np.tan(np.radians(1.5))
    along_u = np.where(flat, hash01(np.arange(ncell), salt=43) < 0.5, along_u)
    width = 12.0 + 10.0 * hash01(np.arange(ncell), salt=44)
    au = along_u[fid]
    across = np.where(au, fv, fu)
    along = np.where(au, fu, fv)
    # reversed-S (aratral) curve of the plough team turning at the headland
    across = across + 4.0 * np.sin(along / 60.0 + fid % 7)
    sidx = np.floor(across / width[fid]).astype(np.int64) + 100000
    r = hash01(fid, sidx, salt=45)
    ph = phase[fid]
    crop = np.where(ph == 0, np.where(r < 0.62, S["standing_wheat"], np.where(r < 0.72, S["standing_barley"], S["stubble"])),
           np.where(ph == 1, np.where(r < 0.45, S["standing_barley"], np.where(r < 0.88, S["standing_oats_beans"], S["stubble"])),
                    np.where(r < 0.78, S["fallow"], S["ploughed_field"])))
    # headlands: a grass turning strip at each furlong edge
    headland = fedge < 3.0
    crop = np.where(headland, S["pasture"], crop)

    # closes: hedged enclosures ringing the open fields
    cframes = [(t + 0.12 * (hash01([k], salt=50)[0] - 0.5), x0 + 37, y0 + 53) for k, (t, x0, y0) in enumerate(frames)]
    cid, _, _, cedge, _ = brick(owner, cframes, 95.0, 70.0, 170.0, 51, warp=16.0, split_p=0.4)
    nc = int(cid.max()) + 1
    ccnt = np.bincount(cid.ravel(), minlength=nc).astype(float)
    cdn = np.bincount(cid.ravel(), dn.ravel(), nc) / np.maximum(ccnt, 1)
    csl = np.bincount(cid.ravel(), SL.ravel(), nc) / np.maximum(ccnt, 1)
    cwet = np.bincount(cid.ravel(), wet.ravel(), nc) / np.maximum(ccnt, 1)
    cup = np.bincount(cid.ravel(), upland.ravel(), nc) / np.maximum(ccnt, 1)
    cwy = np.bincount(cid.ravel(), wych_score.ravel(), nc) / np.maximum(ccnt, 1)
    chf = np.bincount(cid.ravel(), hfield.ravel().astype(float), nc) / np.maximum(ccnt, 1)
    cr = hash01(np.arange(nc), salt=52)
    in_ring = (cdn < 1.38 + 0.25 * (cr - 0.5)) & (cup < 0.4) & (cwy < 0.3) & (chf < 0.2) & (cwet < 0.6)
    close_use = np.where(cr < 0.42, S["pasture"], np.where(cr < 0.60, S["short_meadow"],
                np.where(cr < 0.70, S["tall_grass"], np.where(cr < 0.80, S["standing_oats_beans"],
                np.where(cr < 0.88, S["fallow"], S["flower_meadow"])))))
    r2 = hash01(np.arange(nc), salt=53)
    close_use = np.where((csl > 6.5) & (r2 < 0.55), S["coppice"], close_use)
    close_use = np.where((cdn < 0.28) & (r2 > 0.55), S["orchard"], close_use)
    close_use = np.where((cdn < 0.2) & (r2 < 0.3), S["kitchen_garden"], close_use)
    close_c = in_ring[cid] & ~open_c & (SL < 20) & (MARSH < 60)
    surf = np.where(close_c, close_use[cid], surf)
    surf = np.where(open_c, crop, surf)

    # ---------------------------------------------------------------- 5. floodplain meadows
    log("meadows")
    fp = (HAND < 2.3 + 0.6 * n2) & (driv < 500) & ~water & (MARSH < 40)
    mid, _, _, medge, _ = brick(owner, cframes, 60.0, 90.0, 220.0, 61, warp=8.0, split_p=0.2)
    mr = hash01(mid, salt=62)
    near = dn < 1.5
    meadow = np.where(near, np.where(mr < 0.45, S["short_meadow"], np.where(mr < 0.8, S["tall_grass"], S["flower_meadow"])),
                      np.where(mr < 0.55, S["pasture"], np.where(mr < 0.8, S["short_meadow"], S["flower_meadow"])))
    meadow = np.where((HAND < 1.0 + 0.4 * n3) | (mr > 0.9), S["water_meadow"], meadow)
    surf = np.where(fp, meadow, surf)
    sfp = (HANDs < 1.3) & (dstr < 45) & ~water & (MARSH < 40) & ~fp & ~up & (n3 > -0.2)
    surf[sfp] = S["water_meadow"]

    # ---------------------------------------------------------------- 6. hedgerows
    log("hedgerows")
    # furlong-edge hedges: ~35% of furlong boundaries (the rest are open balks/headlands)
    eh = hash01(fid, salt=72)
    fe_hedge = open_c & (fedge < 1.1) & (eh < 0.35)
    # closes: hedged all round, with gateways
    gate = n3 > 0.62
    ce_hedge = close_c & (cedge < 1.2) & ~gate
    # boundary between the open fields / closes and the commons (the head-dyke)
    inf = (open_c | close_c).astype(float)
    ring = (K.blur(inf, 1.2) > 0.25) & (K.blur(inf, 1.2) < 0.75) & ~hfield & (n3 < 0.5)
    # meadow doles are unhedged; a hedge (or ditch) divides meadow from field
    hedge = (fe_hedge | ce_hedge | ring) & ~water & (dwat > 6) & (SL < 22) & ~fp & ~hfield
    surf[hedge] = S["hedgerow"]

    # ---------------------------------------------------------------- 7. woods
    log("woods")
    wood = np.zeros((N, N), np.int32) - 1
    # hanging woods on steep lowland slopes; dingles along gullies
    hang = (SL > 15 + 3 * n2) & (H < 150) & ~ROCK & (SCREE < 30) & ~hfield
    dingle = (FLOW > 150) & (FLOW < 250) & (SL > 6) & (dstr < 70) & ~up
    dingle = K.blur(dingle.astype(float), 2.5) > 0.3
    gullywood = (TPI < -1.5 + 0.8 * n3) & (SL > 9) & (H < 150)
    wood_any = (hang | dingle | gullywood) & ~open_c & (n2 > -0.45)
    wood_any = K.blur(wood_any.astype(float), 3) > 0.45
    wtype = np.where(n3 > 0.2, S["dense_forest"], S["open_forest"])
    wtype = np.where((n2 > 0.35) & (SL > 10), S["bramble_thicket"], wtype)
    wood = np.where(wood_any, wtype, wood)
    # Wychwood
    wy = np.where(wych_core & (n3 > -0.35), S["dense_forest"], S["open_forest"])
    wood = np.where(wychwood, wy, wood)
    wood = np.where(wych_tail & ~open_c, S["open_forest"], wood)
    # woods the settlements pass placed lumber sites on (woodland_hints)
    hw_ = hint_wood & (n3 > -0.55)
    wood = np.where(hw_ & (wood < 0), np.where(n2 > -0.1, S["dense_forest"], S["open_forest"]), wood)
    # wood-pasture groves on the lowland commons
    grove = (n1 > 0.42) & (n3 > 0.15) & ~open_c & ~close_c & ~fp & ~up & (MARSH < 40) & ~hfield
    wood = np.where(grove & (wood < 0), S["open_forest"], wood)
    # deadfall (storm-throw) in Wychwood
    df = np.hypot((X - 1215) / 1.4, Y - 1760) + 45 * n3 + 30 * n2 < 70
    wood = np.where(df & wychwood, S["deadfall_clearing"], wood)
    # Hanger Knoll
    hk = dist_to(FEAT["Hanger Knoll"]) + 90 * n2 + 50 * n3 - 4 * (H - K.blur(H, 60)) < 210
    wood = np.where(hk, np.where(n3 > -0.2, S["dense_forest"], S["open_forest"]), wood)
    # Crake Gill: wooded gully from the mere to the river
    cg = (np.abs(X - 1870) < 160) & (Y > 2350) & (Y < 3120) & ((SL > 10) | (dstr < 25)) & (dstr < 90)
    wood = np.where(cg, S["dense_forest"], wood)
    # Tor Knap: scrubbed steep flanks
    tk = dist_to(FEAT["Tor Knap"])
    wood = np.where((tk < 190) & (SL > 18), np.where(n3 > 0, S["bramble_thicket"], S["gorse_scrub"]), wood)
    # upland pine & birch on thin soils
    pine = up & (SL > 7) & (SL < 28) & (H > 118) & (H < 170) & (n1 > 0.12) & (n2 > -0.1) & ~ROCK & (SCREE < 20)
    wood = np.where(pine, S["pine_forest"], wood)
    # coppices near settlements on poorer slopes
    cop = (dn > 0.75) & (dn < 1.5) & (SL > 5) & (n1 > 0.3) & (n2 > 0.0) & ~up & ~open_c
    wood = np.where(cop & (wood < 0), S["coppice"], wood)
    # keep the open plains and the town cores clear
    wood = np.where(hfield & (wood != S["open_forest"]), -1, wood)
    wood = np.where(dcore < 1.3, -1, wood)
    # wood-edge scrub fringe (bramble/blackthorn mantle) on commons side
    wm = wood >= 0
    fringe = dilate(wm, 2) & ~wm & ~open_c & ~close_c & (n3 > 0.15)
    surf[fringe] = S["bramble_thicket"]
    surf = np.where(wm, wood, surf)

    # ---------------------------------------------------------------- 8. wet ground
    log("marsh")
    mm = MARSH >= 40
    msurf = np.full((N, N), S["marsh"], np.int32)
    msurf = np.where((MARSH >= 150) & (driv > 140), S["peat_bog"], msurf)
    msurf = np.where((MARSH >= 90) & ((driv < 160) | (dwat < 30)) & (n3 > -0.3), S["reed_bed_fen"], msurf)
    msurf = np.where((MARSH < 110) & (n2 > 0.15), S["alder_carr"], msurf)
    msurf = np.where((MARSH < 70) & (n3 > 0.35), S["water_meadow"], msurf)
    surf = np.where(mm & ~water, msurf, surf)
    # hoof-poached mud at wet gateways / trough spots on commons
    mudp = (wet > 0.5) & (n3 > 0.62) & ~mm & (surf == S["pasture"])
    surf[mudp] = S["mud"]

    # ---------------------------------------------------------------- 9. rock
    log("rock")
    surf[(SCREE >= 12) & (SCREE < 45)] = S["boulder_field"]
    surf[SCREE >= 45] = S["scree"]
    surf[(SL > 33) & ~water] = S["rock_slab"]
    lp = up & (H > 165) & (SL < 12) & (n3 > 0.3) & (dilate(ROCK | (SCREE > 20), 25))
    surf[lp] = S["limestone_pavement"]
    bf_b = up & (n3 > 0.5) & (n2 < -0.1) & (SL < 20) & (H > 140)
    surf[bf_b] = S["boulder_field"]
    surf[ROCK] = S["cliff_rock"]
    # a stone quarry cut into the limestone edge above Rookham road / Blackfell foot
    q = np.hypot((X - 1560) / 1.6, Y - 3330) + 18 * n3 < 38
    surf[q & ~water] = S["quarry_floor"]
    # Tor Knap summit ruin
    surf[tk < 24 + 6 * n3] = S["ruins_rubble"]

    # ---------------------------------------------------------------- 10. river banks
    log("banks")
    rfrac = K.blur(river.astype(float), 10)
    bank = ~water & (driv < 3.2 * C) & (HAND < 1.2)
    inner = rfrac > 0.33                      # convex (inner) bank of a bend: point bar
    surf[bank & inner & (n3 > -0.4)] = S["riverbank_shingle"]
    surf[bank & ~inner & (driv < 1.5 * C) & (n3 > 0.2)] = S["mud"]
    # gravel approaches to the fords
    for f in ("Hob's Ford", "Stane Ford"):
        near_f = (dist_to(FEAT[f]) + 20 * n3 < 55) & ~water & (HAND < 1.2) & (driv < 22)
        surf[near_f] = S["riverbank_shingle"]
    # mere shore: reeds on the inflow side, shingle elsewhere
    mshore = ~water & (dwat < 2.2 * C) & dilate(mere, 3)
    surf[mshore & (n3 > 0.0)] = S["reed_bed_fen"]
    surf[mshore & (n3 <= 0.0) & (n2 > 0)] = S["riverbank_shingle"]

    # ---------------------------------------------------------------- 11. water
    surf[river & (WD > 0.75)] = S["deep_water"]
    surf[river & (WD <= 0.75)] = S["shallow_ford"]
    surf[mere & (WD > 0.8)] = S["deep_water"]
    surf[mere & (WD <= 0.8)] = S["reed_bed_fen"]
    surf[beck] = S["stream_bed"]

    # ---------------------------------------------------------------- 12. settlements & roads
    log("settlements")
    if not SET["present"]:
        for p in fplaces:
            rc = CORE[p["kind"]]
            d = dist_to(p["xy"]) + 0.25 * rc * noise(90, 3, 81)
            core = (d < rc) & ~water
            tofts = hash01(np.floor(X / 18).astype(int), np.floor(Y / 30).astype(int), salt=82)
            surf[core] = np.where(tofts[core] < 0.25, S["orchard"], S["kitchen_garden"])
            surf[(dist_to(p["xy"]) < rc * 0.28) & ~water] = S["village_street"]
    # reserved footprints: cleared and painted with their surface (tofts, crofts, greens, yards, sites)
    for r in SET["reserved"]:
        m = poly_mask(r["poly"])
        key = r.get("surface")
        if key in S:
            surf[m & ~water] = S[key]
        else:
            bad = m & np.isin(surf, [S[k] for k in CLEARED])
            surf[bad] = S["short_meadow"]
    road_mask = np.zeros((N, N), bool)
    road_hedge = np.zeros((N, N), bool)
    RS = {"highway": "dirt_track", "track": "dirt_track", "causeway": "dirt_track", "hollow_way": "hollow_way",
          "village_street": "village_street", "path": "short_meadow", "street": "village_street"}
    for rd in roads:
        pts = np.array(rd["pts"], float)
        if len(pts) < 2:
            continue
        pad = rd["width"] / 2 + 14
        i0, i1 = max(0, int((pts[:, 0].min() - pad) / C)), min(N, int((pts[:, 0].max() + pad) / C) + 2)
        j0, j1 = max(0, int((pts[:, 1].min() - pad) / C)), min(N, int((pts[:, 1].max() + pad) / C) + 2)
        if i0 >= i1 or j0 >= j1:
            continue
        d, _, _, _ = K.polyline_field(X[j0:j1, i0:i1], Y[j0:j1, i0:i1], pts)
        hw = max(rd["width"] / 2, C * 0.55)
        key = RS.get(rd["kind"], "dirt_track")
        sub = surf[j0:j1, i0:i1]
        wsub = water[j0:j1, i0:i1] & (WD[j0:j1, i0:i1] > 0.75)       # fords keep their shallow_ford
        m = (d < hw) & ~wsub & ~water[j0:j1, i0:i1]
        sub[m] = S[key]
        road_mask[j0:j1, i0:i1] |= (d < hw + 1.0) & ~wsub
        if rd["kind"] in ("highway", "track", "hollow_way"):
            # hedged lanes through the farmland: a hedge a couple of metres off each verge
            road_hedge[j0:j1, i0:i1] |= (d > hw + 2.0) & (d < hw + 2.0 + C * 1.1)
    farmed = np.isin(surf, [S[k] for k in ("standing_wheat", "standing_barley", "standing_oats_beans", "stubble",
                                           "fallow", "ploughed_field", "pasture", "short_meadow", "tall_grass",
                                           "flower_meadow", "orchard", "coppice")])
    lane_h = road_hedge & ~road_mask & ~reserved & farmed & (dn < 1.5) & ~hfield & (n3 < 0.55) & ~fp
    surf[lane_h] = S["hedgerow"]
    novegetation = road_mask | reserved

    # ================================================================ canopy
    log("canopy")
    canopy = np.zeros((N, N))
    cn = 1 + 0.12 * noise(40, 3, 91)
    ch = {"dense_forest": 22, "open_forest": 19, "pine_forest": 17, "alder_carr": 12, "coppice": 5.5,
          "hedgerow": 3.5, "orchard": 5.5, "bramble_thicket": 2.2, "gorse_scrub": 1.8, "reed_bed_fen": 2.6,
          "deadfall_clearing": 1.2}
    for k, v in ch.items():
        m = surf == S[k]
        canopy[m] = v * cn[m]
    # open forest is gappy: glades in the canopy
    canopy[(surf == S["open_forest"]) & (n3 < -0.45)] = 0
    # woodland edge: canopy thins over the outer 1-2 cells
    woodc = np.isin(surf, [S["dense_forest"], S["open_forest"], S["pine_forest"], S["alder_carr"]])
    edge = woodc & ~(K.local_min(woodc.astype(float), 1) > 0.5)
    canopy[edge] *= 0.8

    # ================================================================ vegetation instances
    log("vegetation")
    inst = sample_vegetation(surf, canopy, SL, driv, river, dstr, n2, n3, novegetation, fp, dn, H)
    # stamp individual trees outside woods into the canopy (field & hedgerow standards, riverside alders)
    for a, x, y, sc in inst["standalone"]:
        i, j = int(round(x / C)), int(round(y / C))
        h = {"oak": 14, "alder": 11, "birch": 11, "pine": 13, "dead": 9, "fruit": 5, "willow": 9}.get(a, 0) * sc
        if h <= 0:
            continue
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                if 0 <= i + di < N and 0 <= j + dj < N and (di * di + dj * dj <= 1 or h > 12):
                    canopy[j + dj, i + di] = max(canopy[j + dj, i + di], h * (1.0 if di == dj == 0 else 0.85))

    # ================================================================ write
    used = [k for k in TKEYS if (surf == S[k]).any()]
    remap = np.zeros(len(TKEYS), np.uint8)
    for n_, k in enumerate(used):
        remap[S[k]] = n_
    out = remap[surf]
    out.astype(np.uint8).tofile(os.path.join(D, "surface.u8"))
    np.clip(np.round(canopy), 0, 255).astype(np.uint8).tofile(os.path.join(D, "canopy.u8"))
    cov = {k: round(100.0 * float((surf == S[k]).mean()), 2) for k in used}
    cov = dict(sorted(cov.items(), key=lambda kv: -kv[1]))
    counts = {}
    for d_ in inst["list"]:
        counts[d_["asset"]] = counts.get(d_["asset"], 0) + 1
    veg = {
        "version": 1,
        "coords": "world metres, x east, y north, SW origin; rot = radians about +z (counter-clockwise from +x); "
                  "scale = uniform multiplier on the asset's authored size. Sample the ground height at (x,y).",
        "assets": {
            "oak_a": "assets/glb/oak_a.glb", "oak_b": "assets/glb/oak_b.glb", "oak_c": "assets/glb/oak_c.glb",
            "oak_stump": "assets/glb/oak_stump.glb",
            "pine": "Scots pine (TODO asset)", "birch": "silver birch (TODO asset)", "alder": "alder (TODO asset)",
            "willow": "pollard willow (TODO asset)", "dead_tree": "standing dead/stag-headed tree (TODO asset)",
            "fruit_tree": "orchard apple/pear (TODO asset)", "bush": "hazel/blackthorn/gorse bush (TODO asset)",
            "hedge_shrub": "hawthorn/hazel hedge clump ~2.5 m (TODO asset)",
            "log": "fallen trunk (TODO asset)",
        },
        "counts": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "instances": inst["list"],
    }
    with open(os.path.join(D, "vegetation.json"), "w") as f:
        json.dump(veg, f, separators=(",", ":"))
    meta = json.load(open(os.path.join(D, "meta.json")))
    meta["surfaceKeys"] = used
    meta["layers"]["surface.u8"] = "uint8 surface id (index into surfaceKeys), south-first rows, res x res"
    meta["layers"]["canopy.u8"] = "uint8 canopy / tall-vegetation height in metres above ground, south-first rows"
    meta["layers"]["vegetation.json"] = "tree & shrub instances {asset,x,y,rot,scale} in world metres"
    meta["landuse"] = {"generator": "tools/map/landuse_vale.py", "seed": SEED, "season": "late summer (harvest)",
                       "coverage_pct": cov, "vegetation_instances": len(inst["list"]),
                       "settlements_used": [p["name"] for p in places], "roads_used": len(roads)}
    with open(os.path.join(D, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    log("coverage %:", ", ".join(f"{k} {v}" for k, v in cov.items()))
    log("instances:", len(inst["list"]), counts)
    overview(surf, canopy, inst["list"], places, roads, cov)
    log("done")


# ============================================================================ vegetation
def sample_vegetation(surf, canopy, SL, driv, river, dstr, n2, n3, novegetation, fp, dn, H):
    rng = rng_for(101)
    clump = 0.55 + 0.9 * K.smoothstep(-0.5, 0.6, noise(55, 3, 102))   # 0.55 .. 1.45
    dens = np.zeros((N, N))                                            # stems per hectare
    table = {"dense_forest": 200, "open_forest": 95, "pine_forest": 150, "alder_carr": 105, "coppice": 70,
             "deadfall_clearing": 30, "orchard": 95, "bramble_thicket": 45, "gorse_scrub": 45,
             "heath_heather": 1.5, "moorland": 0.4, "bracken": 2.5, "pasture": 1.2, "flower_meadow": 0.8,
             "chalk_downland": 0.4, "tall_grass": 0.3, "short_meadow": 0.35, "water_meadow": 1.0,
             "kitchen_garden": 12, "marsh": 3.0, "reed_bed_fen": 0.5, "boulder_field": 1.0}
    for k, v in table.items():
        dens[surf == S[k]] = v
    dens = dens * np.where(np.isin(surf, [S["orchard"], S["kitchen_garden"]]), 1.0, clump)
    p = dens * CELL_HA
    # riverside alders & willows: fringe along the river and becks
    bankz = (driv > 0) & (driv < 3 * C) & ~river & (surf != S["deep_water"])
    p = np.where(bankz & (n3 > -0.1), np.maximum(p, 0.22), p)
    bz = (dstr > 0) & (dstr < 2.5 * C) & (surf != S["stream_bed"]) & (surf != S["hedgerow"])
    p = np.where(bz & (n2 > -0.1), np.maximum(p, 0.10), p)
    # hedgerow shrubs ~ every 6 m of hedge, oak standards ~ every 45 m
    hmask = surf == S["hedgerow"]
    p = np.where(hmask, 0.42, p)
    water = np.isin(surf, [S["deep_water"], S["shallow_ford"], S["stream_bed"]])
    p[water] = 0
    p[novegetation] = 0
    u = rng.random((N, N))
    sel = u < p
    jx, jy = np.nonzero(sel.T)                                         # jx = i, jy = j
    ci, cj = jx, jy
    x = (ci + rng.uniform(-0.5, 0.5, len(ci))) * C
    y = (cj + rng.uniform(-0.5, 0.5, len(cj))) * C
    x = np.clip(x, 0.5, SIZE - 0.5)
    y = np.clip(y, 0.5, SIZE - 0.5)
    # orchards: snap to rows (9 m grid)
    s = surf[cj, ci]
    orc = s == S["orchard"]
    x[orc] = np.round(x[orc] / 9.0) * 9.0 + rng.uniform(-0.6, 0.6, orc.sum())
    y[orc] = np.round(y[orc] / 9.0) * 9.0 + rng.uniform(-0.6, 0.6, orc.sum())
    r = rng.random(len(ci))
    r2 = rng.random(len(ci))
    near_w = driv[cj, ci] < 3 * C
    near_s = dstr[cj, ci] < 2.5 * C
    edge_like = canopy[cj, ci] < 16
    assets = np.empty(len(ci), dtype=object)
    scale = 0.85 + 0.35 * rng.random(len(ci))
    oak = np.array(["oak_a", "oak_b", "oak_c"], dtype=object)[np.minimum((r2 * 3).astype(int), 2)]

    def put(m, a):
        assets[m & (assets == None)] = a if isinstance(a, str) else a[m & (assets == None)]  # noqa: E711

    def is_(k):
        return s == S[k]

    put(is_("hedgerow") & (r < 0.13), oak)
    put(is_("hedgerow") & (r < 0.16), "birch")
    put(is_("hedgerow"), "hedge_shrub")
    put((near_w | near_s) & ~is_("hedgerow") & ~is_("dense_forest") & ~is_("open_forest"),
        np.where(r < 0.72, "alder", "willow").astype(object))
    put(is_("dense_forest") & (r < 0.80), oak)
    put(is_("dense_forest") & (r < 0.88), "birch")
    put(is_("dense_forest") & (r < 0.925), "alder")
    put(is_("dense_forest") & (r < 0.93), "dead_tree")
    put(is_("dense_forest"), "bush")
    put(is_("open_forest") & (r < 0.72), oak)
    put(is_("open_forest") & (r < 0.90), "birch")
    put(is_("open_forest") & (r < 0.95), "bush")
    put(is_("open_forest") & (r < 0.995), oak)
    put(is_("open_forest"), "dead_tree")
    put(is_("pine_forest") & (r < 0.84), "pine")
    put(is_("pine_forest") & (r < 0.97), "birch")
    put(is_("pine_forest") & (r < 0.995), "pine")
    put(is_("pine_forest"), "dead_tree")
    put(is_("alder_carr") & (r < 0.62), "alder")
    put(is_("alder_carr") & (r < 0.80), "willow")
    put(is_("alder_carr") & (r < 0.92), "birch")
    put(is_("alder_carr") & (r < 0.99), "alder")
    put(is_("alder_carr"), "dead_tree")
    put(is_("coppice") & (r < 0.14), oak)                              # standards over the underwood
    put(is_("coppice"), "bush")
    put(is_("deadfall_clearing") & (r < 0.45), "log")
    put(is_("deadfall_clearing") & (r < 0.75), "oak_stump")
    put(is_("deadfall_clearing") & (r < 0.9), "dead_tree")
    put(is_("deadfall_clearing"), "birch")
    put(is_("orchard"), "fruit_tree")
    put(is_("kitchen_garden") & (r < 0.5), "fruit_tree")
    put(is_("kitchen_garden"), "bush")
    put(is_("bramble_thicket") | is_("gorse_scrub"), "bush")
    put(is_("marsh") | is_("reed_bed_fen"), np.where(r < 0.6, "willow", "alder").astype(object))
    put((is_("heath_heather") | is_("moorland") | is_("boulder_field")) & (r < 0.55), "birch")
    put(is_("heath_heather") | is_("moorland") | is_("boulder_field"), np.where(r < 0.8, "pine", "bush").astype(object))
    put(is_("bracken") & (r < 0.4), "birch")
    put(is_("bracken") & (r < 0.7), "bush")
    put(is_("bracken"), oak)
    # field & common trees: big isolated oaks, the odd dead one
    put(r < 0.01, "dead_tree")
    put(r < 0.25, "bush")
    put(np.ones(len(ci), bool), oak)
    # scale by context
    lone = ~np.isin(s, [S[k] for k in ("dense_forest", "open_forest", "pine_forest", "alder_carr", "coppice",
                                        "deadfall_clearing", "bramble_thicket", "gorse_scrub")])
    isoak = np.isin(assets, ["oak_a", "oak_b", "oak_c"])
    scale = np.where(lone & isoak & ~is_("hedgerow"), 1.05 + 0.3 * rng.random(len(ci)), scale)   # open-grown giants
    scale = np.where(is_("coppice") & (assets == "bush"), 0.9 + 0.4 * rng.random(len(ci)), scale)
    scale = np.where((assets == "hedge_shrub"), 0.75 + 0.45 * rng.random(len(ci)), scale)
    scale = np.where(np.isin(s, [S["pine_forest"]]) & (H[cj, ci] > 160), scale * 0.75, scale)       # stunted on the tops
    rot = rng.uniform(0, 2 * np.pi, len(ci))
    out = [{"asset": str(a), "x": round(float(xx), 1), "y": round(float(yy), 1), "rot": round(float(rr), 2),
            "scale": round(float(sc), 2)} for a, xx, yy, rr, sc in zip(assets, x, y, rot, scale)]
    kind = {"oak_a": "oak", "oak_b": "oak", "oak_c": "oak", "alder": "alder", "birch": "birch", "pine": "pine",
            "dead_tree": "dead", "fruit_tree": "fruit", "willow": "willow"}
    standalone = [(kind[a], xx, yy, sc) for a, xx, yy, sc, lo in zip(assets, x, y, scale, lone)
                  if lo and a in kind]
    return {"list": out, "standalone": standalone}


# ============================================================================ overview
def overview(surf, canopy, inst, places, roads, cov):
    log("overview png")
    Sx = 2
    pal = np.zeros((len(TKEYS), 3))
    for k, i in S.items():
        pal[i] = TCOL[k]
    # a little lift so the dark forest greens separate from hedges
    col = pal[surf]
    hs = 0.55 * hillshade(H) + 0.25 * hillshade(H, 225, 40) + 0.2 * hillshade(H, 0, 70)
    shade = 0.5 + 0.75 * hs
    img = col * shade[..., None]
    wd = WD > 0.02
    wc = np.array((95, 125, 150)) * (1 - np.clip(WD / 6, 0, 1))[..., None] + np.array((45, 75, 110)) * np.clip(WD / 6, 0, 1)[..., None]
    img[wd] = wc[wd]
    img = img[::-1]                                      # north-up
    img = np.repeat(np.repeat(img, Sx, 0), Sx, 1)
    Hh = img.shape[0]
    # tree dots
    dcol = {"oak_a": (28, 36, 16), "oak_b": (28, 36, 16), "oak_c": (28, 36, 16), "pine": (20, 30, 22),
            "birch": (80, 92, 50), "alder": (30, 44, 30), "willow": (70, 84, 60), "dead_tree": (70, 55, 40),
            "fruit_tree": (60, 80, 30), "bush": (40, 50, 22), "hedge_shrub": (34, 44, 20), "oak_stump": (90, 70, 50),
            "log": (90, 70, 50)}
    for t in inst:
        px = int(t["x"] / C * Sx)
        py = int((SIZE - t["y"]) / C * Sx)
        if 0 <= px < img.shape[1] - 1 and 0 <= py < Hh - 1:
            c = dcol.get(t["asset"], (30, 30, 20))
            if t["asset"] in ("oak_a", "oak_b", "oak_c", "pine", "alder") and t["scale"] > 1.0:
                img[py:py + 2, px:px + 2] = c
            else:
                img[py, px] = c
    # grid + labels
    for k in range(1, 8):
        v = int(k * 500 / C * Sx)
        img[v, :] = img[v, :] * 0.8 + 40 * 0.2
        img[:, v] = img[:, v] * 0.8 + 40 * 0.2
        K.draw_text(img, f"{k * 500}", v + 3, 4, (30, 30, 30), 2)
        K.draw_text(img, f"{4000 - k * 500}", 4, v + 3, (30, 30, 30), 2)
    for f in META["features"]:
        if f["type"] in ("town_site",):
            continue
        i = int(f["xy_m"][0] / C * Sx)
        j = int((SIZE - f["xy_m"][1]) / C * Sx)
        K.draw_text(img, f["name"].split(" (")[0], i + 8, j - 6, (25, 20, 15), 2)
    for p in places:
        if p["kind"] == "site" and any(np.hypot(p["xy"][0] - f["xy_m"][0], p["xy"][1] - f["xy_m"][1]) < 120
                                       for f in META["features"]):
            continue
        i = int(p["xy"][0] / C * Sx)
        j = int((SIZE - p["xy"][1]) / C * Sx)
        img[j - 4:j + 5, i - 4:i + 5] = (250, 245, 230)
        img[j - 3:j + 4, i - 3:i + 4] = (120, 30, 30)
        K.draw_text(img, p["name"], i + 10, j - 7, (110, 20, 20), 3 if p["kind"] == "town" else 2)
    K.draw_text(img, "VALE OF HARROW - LAND USE (LATE SUMMER)  N UP  500 M GRID", 20, Hh - 26, (20, 20, 20), 2)
    # legend panel
    LW = 470
    panel = np.full((Hh, LW, 3), 236.0)
    y = 16
    K.draw_text(panel, "SURFACES  % OF MAP", 14, y, (20, 20, 20), 2)
    y += 26
    for k, v in cov.items():
        if y > Hh - 30:
            break
        panel[y:y + 16, 14:44] = TCOL[k]
        K.draw_text(panel, f"{k.replace('_', ' ')}  {v:.1f}", 54, y + 1, (20, 20, 20), 2)
        y += 22
    y += 12
    K.draw_text(panel, f"TREES/SHRUBS {len(inst)}", 14, y, (20, 20, 20), 2)
    img = np.concatenate([img, panel], 1)
    K.write_png(os.path.join(D, "landuse_overview.png"), np.clip(img, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    main()
