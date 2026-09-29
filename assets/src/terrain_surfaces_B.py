"""Terrain surfaces, catalogue B: WET / MINERAL / HARD / FROZEN / BUILT / WATER.  (terrain agent B)

  blender -b -P assets/src/terrain_surfaces_B.py -- [name ...] [--list]
  (no names = all).  tools/terrain_make_B.sh runs them in parallel.
  Board:  blender -b -P tools/terrain_board.py -- --family B-mineral --out assets/booth/terrain_board_B.png

Every surface is a numpy generator on the shared periodic toolkit in _terrain_tex.py, so all
tile seamlessly (spectral noise, wrapped Worley, wrap-around stamping). Height in metres,
colours sRGB. The tile holds the 0.01-4 m structure; drift above that belongs to the splat
shader's world-space macro tint (see macro_hint in each json).
"""
import sys, os, math, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import _terrain_tex as T

R = T.RES
SURFACES = {}
YY, XX = np.mgrid[0:R, 0:R].astype(np.float32)


def surface(tile_m, notes=""):
    def deco(fn):
        SURFACES[fn.__name__] = (fn, tile_m, notes)
        return fn
    return deco


def ppm(tile):
    return R / tile


def mix(a, b, t):
    """T.mix that also accepts a single (3,) colour for a or b."""
    t = np.asarray(t, np.float32)
    if t.ndim == 2 and (np.ndim(a) >= 1 and np.shape(a)[-1] == 3 or np.ndim(b) >= 1 and np.shape(b)[-1] == 3):
        t = t[..., None]
    return a + (b - a) * t


# ================================================================= building blocks
def worley_xy(x, y, nx, ny, rg, jitter=1.0, vec=False):
    """Periodic Worley on coordinates already in CELL units (x in [0,nx), y in [0,ny)),
    so the caller can domain-warp / stretch them. Returns F1, F2, cell id."""
    pts = (rg.random((ny, nx, 2)) - 0.5) * jitter + 0.5
    ids = rg.permutation(nx * ny).reshape(ny, nx)
    x = np.mod(x, nx); y = np.mod(y, ny)
    ci = np.floor(x).astype(int); cj = np.floor(y).astype(int)
    f1 = np.full(x.shape, 9.0, np.float32); f2 = f1.copy(); cid = np.zeros(x.shape, np.int32)
    vx = np.zeros(x.shape, np.float32); vy = vx.copy()
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ni = ci + di; nj = cj + dj
            p = pts[nj % ny, ni % nx]
            dx = ni + p[..., 0] - x; dy = nj + p[..., 1] - y
            d = np.sqrt(dx * dx + dy * dy)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, ids[nj % ny, ni % nx], cid)
            if vec:
                vx = np.where(closer, dx, vx); vy = np.where(closer, dy, vy)
            f1 = np.where(closer, d, f1)
    if vec:
        return f1, f2, cid, vx, vy
    return f1, f2, cid


def cells(rg, nx, ny, jitter=1.0, warp_px=0.0, warp_k=(2, 8), stretch=None, vec=False):
    """Worley over the whole tile, optional periodic domain warp (pixels)."""
    x = XX.copy(); y = YY.copy()
    if warp_px:
        x = x + warp_px * T.band(R, rg, *warp_k); y = y + warp_px * T.band(R, rg, *warp_k)
    return worley_xy(x / R * nx, y / R * ny, nx, ny, rg, jitter, vec)


def rand_per_cell(cid, rg, n=None):
    n = int(cid.max()) + 1 if n is None else n
    v = rg.random(n).astype(np.float32)
    return v[cid]


def stone_sprite(rg, r_px, h_m, col, facets=7, flat=0.35, elong=1.0, round_=0.0, speck=0.10, rough=0.8,
                 col2=None, lichen=None):
    """Angular (faceted) or rounded stone seen from above. r_px radius, h_m height.
    round_=0 -> faceted pyramid-with-flat-top; 1 -> smooth dome pebble."""
    S = int(r_px * 2 * max(elong, 1) + 4)
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2 + 0.5
    a = rg.uniform(0, math.pi)
    u = (x * math.cos(a) + y * math.sin(a)) / elong; v = -x * math.sin(a) + y * math.cos(a)
    # faceted: min over random planes
    angs = np.sort(rg.uniform(0, 2 * math.pi, facets))
    Hf = np.full((S, S), 9.0, np.float32)
    for t in angs:
        d = r_px * rg.uniform(0.75, 1.1)
        Hf = np.minimum(Hf, (d - (u * math.cos(t) + v * math.sin(t))) / (d * (1 - flat)))
    Hf = np.clip(Hf, -1, 1)
    rr = np.sqrt(u * u + v * v) / r_px
    Hd = np.sqrt(np.clip(1 - rr * rr, 0, 1)) * 1.0 - (rr >= 1)
    Hn = Hf * (1 - round_) + Hd * round_
    m = Hn > 0
    g = T.blur(rg.standard_normal((S, S)).astype(np.float32), max(r_px * 0.15, 0.6))
    g /= g.std() + 1e-6
    H = np.where(m, h_m * (np.clip(Hn, 0, None) ** (0.6 if round_ > 0.5 else 1.0)) * (1 + 0.04 * g), -1e9).astype(np.float32)
    base = (T.hexc(col) if isinstance(col, str) else np.asarray(col, np.float32)) * (1 + rg.normal(0, 0.015, 3)).astype(np.float32)
    C = np.broadcast_to(base, (S, S, 3)).copy()
    if col2 is not None:  # veining / banding
        c2 = T.hexc(col2) if isinstance(col2, str) else np.asarray(col2, np.float32)
        band_ = T.smoothstep(0.6, 1.2, np.sin(u * rg.uniform(0.2, 0.6) + g * 0.8) + 0.2 * g)
        C = C + (c2 - C) * band_[..., None] * 0.7
    fine = rg.standard_normal((S, S)).astype(np.float32)
    C = C * (1 + speck * (0.6 * fine + 0.6 * g))[..., None]
    C = C * (0.86 + 0.14 * np.clip(Hn, 0, 1))[..., None]
    if lichen is not None:
        lc, amt = lichen
        lm = (T.blur(rg.standard_normal((S, S)).astype(np.float32), max(r_px * 0.12, 0.6)) * 3 > (1.4 - amt * 2)) & (Hn > 0.3)
        C[lm] = T.hexc(lc) * (1 + rg.normal(0, 0.05, (int(lm.sum()), 3)))
    Rg = np.full((S, S), rough, np.float32) + 0.05 * g
    return dict(h=H, col=C.astype(np.float32), rough=Rg, a=m.astype(np.float32))


def scatter(st, rg, lib, n, density=None, zfield=None, tint=None, zjit=0.0, jit=0.05, pts=None, sink=0.0):
    if pts is None:
        pts = T.scatter_points(rg, R, n, density)
    for x, y in pts:
        xi, yi = int(x) % R, int(y) % R
        z = (zfield[yi, xi] if zfield is not None else 0.0) - sink + (rg.normal(0, zjit) if zjit else 0.0)
        tn = tint[yi, xi] if tint is not None else np.ones(3, np.float32)
        tn = tn * (1 + rg.normal(0, jit * 0.2, 3)).astype(np.float32) * (1 + rg.normal(0, jit * 1.4))  # chroma jitter small: grey stone goes pastel otherwise
        st.stamp(lib[rg.integers(len(lib))], x, y, z=float(z), tint=tn)
    return pts


def stroke(sp, x0, y0, x1, y1, w0, w1, h0, h1, c0, c1, rough=0.75):
    H = sp["h"]; S = H.shape[0]
    pad = max(w0, w1) + 2
    xa, xb = int(max(0, min(x0, x1) - pad)), int(min(S, max(x0, x1) + pad + 1))
    ya, yb = int(max(0, min(y0, y1) - pad)), int(min(S, max(y0, y1) + pad + 1))
    if xa >= xb or ya >= yb:
        return
    y, x = np.mgrid[ya:yb, xa:xb].astype(np.float32)
    d, t = T._seg_dist(x, y, x0, y0, x1, y1)
    w = (w0 + (w1 - w0) * t) * 0.5
    hh = h0 + (h1 - h0) * t
    m = (d < w + 0.3) & (hh > H[ya:yb, xa:xb])
    if not m.any():
        return
    c0 = np.asarray(T.hexc(c0) if isinstance(c0, str) else c0, np.float32)
    c1 = np.asarray(T.hexc(c1) if isinstance(c1, str) else c1, np.float32)
    col = c0 + (c1 - c0) * t[..., None]
    col = col * (1.06 - 0.16 * (d / np.maximum(w, 0.5)))[..., None]
    H[ya:yb, xa:xb][m] = hh[m]
    sp["col"][ya:yb, xa:xb][m] = col[m]
    sp["rough"][ya:yb, xa:xb][m] = rough
    sp["a"][ya:yb, xa:xb][m] = 1


def empty_sprite(S):
    return dict(h=np.full((S, S), -1e9, np.float32), col=np.zeros((S, S, 3), np.float32),
                rough=np.zeros((S, S), np.float32), a=np.zeros((S, S), np.float32))


def stick(rg, L_px, w_px, h_m, c0, c1, rough=0.8, bend=0.15):
    S = int(L_px + w_px + 6)
    sp = empty_sprite(S)
    a = rg.uniform(0, 2 * math.pi); c = S / 2
    ax, ay = c - math.cos(a) * L_px / 2, c - math.sin(a) * L_px / 2
    mx, my = c + rg.normal(0, bend * L_px * 0.3), c + rg.normal(0, bend * L_px * 0.3)
    bx, by = c + math.cos(a) * L_px / 2, c + math.sin(a) * L_px / 2
    stroke(sp, ax, ay, mx, my, w_px, w_px * 0.9, h_m, h_m * 1.1, c0, c1, rough)
    stroke(sp, mx, my, bx, by, w_px * 0.9, w_px * 0.7, h_m * 1.1, h_m, c1, c0, rough)
    return sp


def blade_lib(rg, n, S, **kw):
    return [T.blade_tuft(rg, S, **kw) for _ in range(n)]


def mound(rg, S, radius, height, cols, edge=0.35, rough=0.8, flat=0.0, stops=None):
    """Ragged domed clump (moss cushion, sedge base, lump)."""
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2 + 0.5
    r = np.sqrt(x * x + y * y) / radius
    th = np.arctan2(y, x)
    g = T.blur(rg.standard_normal((S, S)).astype(np.float32), max(radius * 0.08, 0.8)); g /= g.std() + 1e-6
    g2 = T.blur(rg.standard_normal((S, S)).astype(np.float32), max(radius * 0.05, 0.5)); g2 /= g2.std() + 1e-6
    rr = r * (1 + edge * 0.35 * (np.sin(3 * th + rg.uniform(0, 6)) * 0.5 + 0.5 * np.sin(7 * th + rg.uniform(0, 6)))) + edge * 0.12 * g
    m = rr < 1
    dome = np.sqrt(np.clip(1 - rr * rr, 0, 1)) * (1 - flat) + flat * (rr < 1)
    hh = height * dome * (1 + 0.25 * g2) + height * 0.08 * g
    t = T.norm01(0.6 * g2 + 0.4 * g + 0.6 * dome)
    col = T.ramp(t, list(cols), stops) * (0.75 + 0.25 * dome)[..., None]
    return dict(h=np.where(m, hh, -1e9).astype(np.float32), col=col.astype(np.float32),
                rough=np.full((S, S), rough, np.float32), a=m.astype(np.float32))


def drift_tint(rg, amt_l=0.08, amt_w=0.06, k=(1, 5), k2=(5, 14), amt2=0.04):
    l = amt_l * T.band(R, rg, *k, beta=1.0) + amt2 * T.band(R, rg, *k2)
    w = amt_w * T.band(R, rg, *k, beta=1.0)
    return np.stack([(1 + l) * (1 + 0.9 * w), (1 + l) * (1 + 0.25 * w), (1 + l) * (1 - 1.1 * w)], -1).astype(np.float32)


def wet(col, amt):
    """Darken + saturate towards the wet look. amt HxW 0..1."""
    lum = col.mean(-1, keepdims=True)
    w = np.clip(lum + (col - lum) * 1.35, 0, 1) * 0.58
    return mix(col, w, amt)


def speckle(rg, col, amt=0.05, k=(150, 512)):
    return col * (1 + amt * T.band(R, rg, *k))[..., None]


def footprints(rg, h, n, P, depth=0.03, kind="mixed", pts=None, angs=None):
    """Additive boot/hoof prints (negative height) with raised rims. returns (h, mask of prints)."""
    msk = np.zeros_like(h)
    for i in range(n):
        x, y = (rg.random(2) * R) if pts is None else pts[i]
        a = rg.uniform(0, 2 * math.pi) if angs is None else angs[i]
        hoof = kind == "hoof" or (kind == "mixed" and rg.random() < 0.45)
        rr = (0.05 if hoof else 0.05) * P
        S = int((0.16 if hoof else 0.34) * P) + 3
        yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2
        u = xx * math.cos(a) + yy * math.sin(a); v = -xx * math.sin(a) + yy * math.cos(a)
        if not hoof:
            d = np.sqrt((u / (rr * 2.4)) ** 2 + (v / rr) ** 2)
        else:
            d = np.sqrt((u / rr) ** 2 + (v / (rr * 0.95)) ** 2)
            d = np.where((np.abs(v) < rr * 0.12) & (u > 0), 1.2, d)
        dd = depth * rg.uniform(0.5, 1.0)
        k = -dd * np.clip(1 - d ** 4, 0, 1) + dd * 0.35 * np.exp(-((d - 1.1) / 0.18) ** 2)
        T.splat_add(h, k.astype(np.float32), x, y)
        T.splat_add(msk, np.clip(1 - d ** 4, 0, 1).astype(np.float32), x, y, op="max")
    return h, msk


def standing_water(col, h, rough, level_pct, water_col, depth_m=0.05, rng=None, clear=0.35):
    """Fill everything below the level_pct height percentile with a flat water surface.
    Albedo under water = bed darkened + tinted by depth. Returns col, h, rough, water mask."""
    lvl = np.percentile(h, level_pct)
    d = np.clip(lvl - h, 0, None)
    m = d > 0
    dep = np.clip(d / depth_m, 0, 1)
    wc = T.hexc(water_col)
    bed = wet(col, np.ones(h.shape, np.float32))
    under = mix(bed * clear + wc * (1 - clear), wc, dep ** 0.6)
    edge = T.smoothstep(0, 0.004, d)  # thin wet meniscus fades in
    col = mix(wet(col, T.smoothstep(-0.01, 0.0, h - lvl) * 0 + (1 - T.smoothstep(0.0, 0.012, h - lvl))), under, edge)
    rough = np.where(m, 0.04 + 0.06 * (1 - edge), rough * (1 - 0.5 * (1 - T.smoothstep(0.0, 0.012, h - lvl))))
    h = np.maximum(h, lvl)
    return col, h.astype(np.float32), rough.astype(np.float32), m


def finalize(col, h, rough, cav_r=4, cav_lo=0.6, cav_strength=None):
    col = col * T.cavity(h, cav_r, strength=cav_strength, lo=cav_lo)[..., None]
    return col, h, rough


# ================================================================= MUD / CLAY / PEAT
@surface(4.0, "Churned mud: boot+hoof prints, wheel-slewed lumps, brown-water puddles in the hollows (roughness ~0.05 there). Wettest, slowest ground.")
def mud(rg, tile):
    P = ppm(tile)
    h = 0.035 * T.fbm(R, rg, 1, 40, 2.3) + 0.006 * T.band(R, rg, 40, 200, 1.0) + 0.0015 * T.band(R, rg, 200, 500)
    # slewed ridges (wheels / sliding feet): anisotropic ridges, warped
    rid = T.band(R, rg, 6, 30, 1.0, aniso=(0.25, 1.0))
    h = h + 0.012 * np.abs(rid) * T.smoothstep(-0.3, 0.8, T.band(R, rg, 1, 4))
    h, fm = footprints(rg, h.astype(np.float32), int(70 * tile * tile), P, depth=0.045)
    t = T.norm01(0.6 * T.band(R, rg, 1, 6) + 0.4 * T.fbm(R, rg, 8, 300))
    col = T.ramp(t, ["#3f3224", "#4d3d2c", "#5c4a36", "#6a5641"])
    dryness = T.smoothstep(0.35, 0.85, T.norm01(h - T.blur(h, 40)) + 0.25 * T.band(R, rg, 1, 5)) * 0.8
    col = wet(col, 0.75 - dryness)
    col = col * drift_tint(rg, 0.06, 0.04)
    rough = 0.55 + 0.35 * dryness + 0.05 * T.band(R, rg, 20, 200)
    st = T.Stamper(R, 40, h, col, rough)
    clods = [T.blob(rg, int(0.09 * P), rg.uniform(0.012, 0.035) * P, rg.uniform(0.008, 0.02), c, lumpy=0.6, shade=0.35, rough=0.6)
             for c in ("#4a3a2a", "#3c2f22", "#5a4834") for _ in range(6)]
    scatter(st, rg, clods, int(30 * tile * tile), zfield=h, sink=0.004)
    straw = [stick(rg, rg.uniform(0.05, 0.14) * P, 1.2, 0.002, "#8a7a4c", "#6f6038", rough=0.7) for _ in range(10)]
    scatter(st, rg, straw, int(12 * tile * tile), zfield=h)
    h, col, rough = st.result()
    col, h, rough = finalize(col, h, rough, 4, 0.6)
    col, h, rough, wm = standing_water(col, h, rough, 12, "#5e5444", depth_m=0.03, clear=0.2)
    return (col, h, rough), {}


@surface(4.0, "Exposed clay: ochre-grey desiccation-crack polygons (two orders), plates curled at the rims, a few damp dark patches and embedded pebbles. Slick when wet.")
def clay_heavy(rg, tile):
    P = ppm(tile)
    f1, f2, cid = cells(rg, 10, 10, 1.0, warp_px=10, warp_k=(4, 20))
    g1, g2, cid2 = cells(rg, 26, 26, 1.0, warp_px=5, warp_k=(10, 40))
    e1 = f2 - f1; e2 = g2 - g1
    crack1 = 1 - T.smoothstep(0.0, 0.035, e1)
    crack2 = (1 - T.smoothstep(0.0, 0.04, e2)) * T.smoothstep(-0.2, 0.6, T.band(R, rg, 2, 8))
    crack = np.maximum(crack1, crack2 * 0.75)
    plate = rand_per_cell(cid, rg)
    h = 0.008 * T.fbm(R, rg, 1, 30, 2.0) + 0.0012 * T.band(R, rg, 60, 400)
    h = h + 0.004 * T.smoothstep(0.0, 0.25, e1) * 0 + 0.003 * np.exp(-e1 / 0.08) * (1 - crack1)  # curl-up rims
    h = h + 0.002 * (plate - 0.5)
    h = h - 0.02 * crack1 - 0.01 * crack2
    t = T.norm01(0.5 * T.band(R, rg, 1, 5) + 0.3 * plate + 0.3 * T.fbm(R, rg, 20, 400))
    col = T.ramp(t, ["#7d6446", "#957652", "#a88a60", "#b09a74"])
    col = mix(col, T.hexc("#8f8a7c"), 0.35 * T.smoothstep(0.2, 1.0, T.band(R, rg, 1, 4)))  # grey gley clay patches
    col = col * (1 - 0.55 * crack)[..., None]
    damp = T.smoothstep(0.5, 1.4, T.band(R, rg, 1, 5))
    col = wet(col, damp * 0.6)
    col = speckle(rg, col, 0.04)
    rough = 0.82 - 0.35 * damp
    st = T.Stamper(R, 20, h, col, rough)
    peb = [stone_sprite(rg, rg.uniform(0.006, 0.02) * P, 0.006, c, round_=0.8, rough=0.6)
           for c in ("#8a8276", "#6e675c", "#a39a88") for _ in range(6)]
    scatter(st, rg, peb, int(8 * tile * tile), zfield=h, sink=0.004)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.65), {}


@surface(4.0, "Wet riverbank mud: glossy grey-brown silt, current ripples and drainage rills, half-buried pebbles, bird tracks, thin water sheen in the lows.")
def riverbank_mud(rg, tile):
    P = ppm(tile)
    wv = T.band(R, rg, 1, 4)
    phase = 2 * math.pi * (YY / R * 36) + 3.0 * T.band(R, rg, 1, 5) + 0.8 * T.band(R, rg, 4, 12)
    rip = np.sin(phase) ** 3 * 0.5 + np.sin(phase) * 0.5  # asymmetric current ripple
    rip = rip * (0.35 + 0.65 * T.smoothstep(-0.6, 0.4, wv))
    rills = np.abs(T.band(R, rg, 3, 14, 1.0, aniso=(1.0, 0.3)))
    h = 0.02 * T.fbm(R, rg, 1, 20, 2.3) + 0.004 * rip + 0.0008 * T.band(R, rg, 100, 500)
    h = h - 0.012 * (1 - T.smoothstep(0.0, 0.25, rills)) * T.smoothstep(-0.4, 0.4, T.band(R, rg, 1, 4))
    # bird tracks: little 3-toed prints
    for _ in range(int(10 * tile * tile)):
        x, y = rg.random(2) * R; a = rg.uniform(0, 2 * math.pi)
        S = int(0.08 * P) + 3; k = np.zeros((S, S), np.float32)
        yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2
        for da in (-0.6, 0, 0.6):
            ux, uy = math.cos(a + da), math.sin(a + da)
            d, t = T._seg_dist(xx, yy, 0, 0, ux * S * 0.42, uy * S * 0.42)
            k = np.minimum(k, -0.003 * (d < 1.1))
        T.splat_add(h, k, x, y)
    t = T.norm01(0.6 * T.band(R, rg, 1, 6) + 0.4 * T.fbm(R, rg, 10, 300))
    col = T.ramp(t, ["#5e5647", "#6b604f", "#776b58", "#847a67"])
    col = mix(col, T.hexc("#6a5a45"), 0.15 * T.smoothstep(0, 1, T.band(R, rg, 1, 4)))
    col = col * (1 + 0.08 * rip)[..., None]
    wt = 0.7 + 0.2 * T.smoothstep(0.3, -0.4, T.norm01(h) * 2 - 1)
    col = wet(col, wt * 0.8)
    rough = 0.45 - 0.2 * wt + 0.05 * T.band(R, rg, 30, 300)
    st = T.Stamper(R, 30, h, col, rough)
    peb = [stone_sprite(rg, rg.uniform(0.008, 0.03) * P, rg.uniform(0.006, 0.015), c, round_=0.85, rough=0.35, speck=0.08)
           for c in ("#7a7568", "#5d5a52", "#8e8574", "#6b5e4c") for _ in range(8)]
    scatter(st, rg, peb, int(18 * tile * tile), density=T.smoothstep(-0.5, 1.0, T.band(R, rg, 2, 7)), zfield=h, sink=0.006)
    twig = [stick(rg, rg.uniform(0.06, 0.2) * P, rg.uniform(1.5, 3), 0.004, "#4a3c2c", "#5e4c36", rough=0.5) for _ in range(6)]
    scatter(st, rg, twig, int(1.5 * tile * tile), zfield=h)
    h, col, rough = st.result()
    col, h, rough = finalize(col, h, rough, 4, 0.65)
    col, h, rough, _ = standing_water(col, h, rough, 8, "#5c5444", depth_m=0.02, clear=0.45)
    return (col, h, rough), {}


@surface(8.0, "Peat bog: black-brown peat, sphagnum hummocks (green/rust/ochre), cotton-grass tufts, heather sprigs, dark peaty bog pools (~15%). Impassable-ish for horse and wagon.")
def peat_bog(rg, tile):
    P = ppm(tile)
    hum = T.fbm(R, rg, 2, 16, 2.0)
    h = 0.08 * hum + 0.01 * T.band(R, rg, 16, 80, 1.0) + 0.002 * T.band(R, rg, 80, 400)
    t = T.norm01(0.5 * T.band(R, rg, 1, 5) + 0.5 * T.fbm(R, rg, 6, 200))
    peat = T.ramp(t, ["#2f241b", "#3a2d21", "#46372a"])
    peat = wet(peat, np.full(h.shape, 0.4, np.float32))
    rough = np.full(h.shape, 0.6, np.float32)
    st = T.Stamper(R, 70, h, peat, rough)
    mossA = [mound(rg, int(0.28 * P), 0.1 * P, 0.03, ("#5c6a2a", "#7b8a3a", "#98a04c"), edge=0.5, rough=0.7, flat=0.5) for _ in range(5)]
    mossR = [mound(rg, int(0.28 * P), 0.1 * P, 0.03, ("#6a3a2a", "#8a4a32", "#a8603c"), edge=0.5, rough=0.7, flat=0.5) for _ in range(4)]
    mossY = [mound(rg, int(0.28 * P), 0.1 * P, 0.03, ("#7a7034", "#9c8e48", "#b4a462"), edge=0.5, rough=0.7, flat=0.5) for _ in range(4)]
    hi = T.smoothstep(-0.3, 0.8, hum)
    zone = T.band(R, rg, 1, 4)
    scatter(st, rg, mossA, int(90 * tile * tile / 8), density=hi * T.smoothstep(-0.8, 0.5, zone), zfield=h, sink=0.02)
    scatter(st, rg, mossR, int(60 * tile * tile / 8), density=hi * T.smoothstep(0.8, -0.5, zone), zfield=h, sink=0.02)
    scatter(st, rg, mossY, int(40 * tile * tile / 8), density=hi, zfield=h, sink=0.02)
    heather = [mound(rg, int(0.22 * P), 0.08 * P, 0.12, ("#2e2a22", "#4a3a3a", "#5e4a4e"), edge=0.8, rough=0.85) for _ in range(6)]
    scatter(st, rg, heather, int(25 * tile * tile / 8), density=T.smoothstep(0.2, 1.2, hum), zfield=h, sink=0.02)
    sedge = blade_lib(rg, 8, int(0.3 * P), n_blades=26, blade_len=0.13 * P, blade_w=1.8, height_m=0.2,
                      col_base="#4a4a28", col_tip="#8a8448", dead_frac=0.45, col_dead="#a8945c", curl=0.25)
    scatter(st, rg, sedge, int(60 * tile * tile / 8), density=T.smoothstep(-0.6, 0.6, hum), zfield=h)
    cotton = [T.blob(rg, int(0.04 * P) + 3, 0.012 * P, 0.02, "#e4e2d8", rough=0.9, lumpy=0.5, shade=0.2) for _ in range(5)]
    pts = scatter(st, rg, cotton, int(40 * tile * tile / 8), density=T.smoothstep(0.2, 1.0, zone) * hi, zfield=h + 0.22)
    h, col, rough = st.result()
    col = col * drift_tint(rg, 0.07, 0.06)
    col, h, rough = finalize(col, h, rough, 5, 0.55)
    col, h, rough, _ = standing_water(col, h, rough, 15, "#2e2820", depth_m=0.06, clear=0.2)
    return (col, h, rough), {}


@surface(8.0, "Marsh: sedge/rush tussocks (0.3-0.7 m clumps) standing in shallow still water (~35% of the area), muddy margins, floating duckweed rafts.")
def marsh(rg, tile):
    P = ppm(tile)
    low = T.fbm(R, rg, 1, 10, 2.0)
    h = 0.06 * low + 0.006 * T.band(R, rg, 10, 100, 1.0) + 0.0015 * T.band(R, rg, 100, 400)
    t = T.norm01(T.band(R, rg, 1, 6) + 0.5 * T.fbm(R, rg, 10, 300))
    mud = wet(T.ramp(t, ["#3a3226", "#4a3f2e", "#58503a"]), np.full(h.shape, 0.5, np.float32))
    rough = np.full(h.shape, 0.55, np.float32)
    st = T.Stamper(R, 90, h, mud, rough)
    # low grass/moss cover on the higher ground
    under = blade_lib(rg, 8, int(0.16 * P), n_blades=14, blade_len=0.07 * P, blade_w=1.4, height_m=0.05,
                      col_base="#3e4a24", col_tip="#6a7438", dead_frac=0.3, col_dead="#8a8050")
    scatter(st, rg, under, int(500 * tile * tile / 8), density=T.smoothstep(-0.4, 0.4, low), zfield=h)
    tus = []
    for i in range(10):
        S = int(0.8 * P)
        base = mound(rg, S, rg.uniform(0.18, 0.32) * P, 0.12, ("#3a3a22", "#4e4a2c", "#5a5a30"), edge=0.4, rough=0.8)
        bl = T.blade_tuft(rg, S, n_blades=110, blade_len=0.36 * P, blade_w=2.2, height_m=0.55, col_base="#44502a",
                          col_tip="#8e9050", dead_frac=0.35, col_dead="#b0a068", curl=0.35, spread=1.0)
        m = bl["h"] > base["h"]
        for k in ("h", "rough"):
            base[k] = np.where(m, bl[k], base[k])
        base["col"] = np.where(m[..., None], bl["col"], base["col"])
        base["a"] = np.maximum(base["a"], bl["a"])
        tus.append(base)
    scatter(st, rg, tus, int(5 * tile * tile / 1.6), density=T.smoothstep(-0.9, 0.6, low), zfield=h, sink=0.02)
    h, col, rough = st.result()
    col = col * drift_tint(rg, 0.07, 0.07)
    col, h, rough = finalize(col, h, rough, 6, 0.55)
    col, h, rough, wm = standing_water(col, h, rough, 40, "#44483e", depth_m=0.08, clear=0.3)
    # duckweed rafts floating on the water
    dw = T.smoothstep(0.6, 1.2, T.band(R, rg, 3, 14) + 0.5 * T.band(R, rg, 30, 120)) * wm
    col = mix(col, T.hexc("#6e7e34") * (1 + 0.1 * T.band(R, rg, 100, 400))[..., None], dw)
    rough = np.where(dw > 0.5, 0.5, rough)
    return (col, h, rough), {}


@surface(6.0, "Reed bed / fen: dense Phragmites seen from above - upright buff-green leaves, purple-brown plumes, dead winter stems, glints of water in gaps. Heavy concealment.")
def reed_bed_fen(rg, tile):
    P = ppm(tile)
    h0 = 0.02 * T.fbm(R, rg, 1, 20, 2.0)
    wbase = wet(T.ramp(T.norm01(T.band(R, rg, 2, 20)), ["#2c2a20", "#3a3526"]), np.ones(h0.shape, np.float32))
    st = T.Stamper(R, 90, h0, wbase, np.full(h0.shape, 0.08, np.float32))
    dens = T.smoothstep(-1.2, 0.2, T.band(R, rg, 1, 6))
    season = T.band(R, rg, 1, 4)
    leaves = [T.blade_tuft(rg, int(0.5 * P), n_blades=9, blade_len=0.24 * P, blade_w=3.2, height_m=0.5, col_base="#5a6030",
                           col_tip="#9a9458", dead_frac=0.4, col_dead="#b8a474", curl=0.15, spread=1.0) for _ in range(10)]
    dead = [T.blade_tuft(rg, int(0.5 * P), n_blades=7, blade_len=0.24 * P, blade_w=2.6, height_m=0.4, col_base="#8a7a52",
                         col_tip="#c0ae80", dead_frac=0.7, col_dead="#b4a274", curl=0.2) for _ in range(8)]
    scatter(st, rg, leaves, int(1800 * tile * tile / 36), density=dens * T.smoothstep(-1, 0.6, season), zfield=h0, zjit=0.06)
    scatter(st, rg, dead, int(900 * tile * tile / 36), density=dens * T.smoothstep(1, -0.6, season), zfield=h0, zjit=0.06)
    # plumes: feathery elongated heads
    plumes = []
    for _ in range(10):
        S = int(0.24 * P); sp = empty_sprite(S)
        a = rg.uniform(0, 2 * math.pi); c = S / 2
        for j in range(14):
            aa = a + rg.normal(0, 0.35); L = rg.uniform(0.3, 0.5) * S
            stroke(sp, c, c, c + math.cos(aa) * L, c + math.sin(aa) * L, 2.2, 0.8, 0.62, 0.58,
                   T.hexc("#6a4e44") * rg.uniform(0.85, 1.15), T.hexc("#a08a6c") * rg.uniform(0.85, 1.1), rough=0.9)
        plumes.append(sp)
    scatter(st, rg, plumes, int(300 * tile * tile / 36), density=dens, zfield=h0, zjit=0.04)
    h, col, rough = st.result()
    col = col * drift_tint(rg, 0.07, 0.07)
    return finalize(col, h, rough, 5, 0.45), {}


# ================================================================= SHINGLE / GRAVEL / SAND
def pebble_bed(rg, tile, n_per_m2, r_range_m, cols, round_=0.85, flat_h=0.45, fill=("#6b6356", "#807664"),
               rough=0.55, speck=0.08, sort_k=(1, 5), elong=(1.0, 1.6), sink=0.3, angular_frac=0.0, tint_j=0.01):
    P = ppm(tile)
    h = 0.01 * T.fbm(R, rg, 1, 30, 2.0)
    fillc = T.ramp(T.norm01(T.band(R, rg, 20, 300)), list(fill))
    st = T.Stamper(R, int(r_range_m[1] * P * 1.7) + 6, h, fillc, np.full(h.shape, 0.8, np.float32))
    lib = []
    rmin, rmax = r_range_m
    # log-uniform sizes, colours from list with weights
    for i in range(90):
        r = math.exp(rg.uniform(math.log(rmin), math.log(rmax))) * P
        c = cols[rg.integers(len(cols))]
        ang = rg.random() < angular_frac
        lib.append((r, stone_sprite(rg, r, r / P * flat_h * rg.uniform(0.7, 1.2), c, facets=rg.integers(5, 9),
                                    round_=0.1 if ang else round_, elong=rg.uniform(*elong), rough=rough,
                                    speck=speck, flat=0.3 if ang else 0.2,
                                    col2=(cols[rg.integers(len(cols))] if rg.random() < 0.2 else None))))
    # sorting field: big-stone patches vs fine patches
    sort_ = T.norm01(T.band(R, rg, *sort_k) + 0.5 * T.band(R, rg, sort_k[1], sort_k[1] * 4))
    n = int(n_per_m2 * tile * tile)
    pts = rg.random((n, 2)) * R
    big = sorted(range(len(lib)), key=lambda i: lib[i][0])
    for x, y in pts:
        s = sort_[int(y) % R, int(x) % R]
        # pick a size index biased by sorting
        k = int(np.clip(rg.normal(0.2 + s * 0.5, 0.33), 0, 0.999) * len(lib))
        r, sp = lib[big[k]]
        z = h[int(y) % R, int(x) % R] - sink * r / P * flat_h + rg.normal(0, 0.003)
        st.stamp(sp, x, y, z=z, tint=(1 + rg.normal(0, tint_j, 3)) * (1 + rg.normal(0, 0.08)))
    return st, h, sort_


@surface(3.0, "Riverbank shingle: rounded, flattened, well-sorted river pebbles 1-9 cm in mixed lithologies (grey greywacke, buff sandstone, dark slate, white quartz), patches of finer gravel.")
def riverbank_shingle(rg, tile):
    cols = ["#8a877e", "#7a766c", "#9d9484", "#6a665e", "#b3a88f", "#5a5852", "#a08c70", "#c9c3b4", "#7d7263"]
    st, h, _ = pebble_bed(rg, tile, 900, (0.008, 0.045), cols, round_=0.9, flat_h=0.45, rough=0.5, elong=(1.0, 1.7))
    hh, col, rough = st.result()
    col = col * drift_tint(rg, 0.05, 0.04, k=(1, 4))
    return finalize(col, hh, rough, 3, 0.45), {}


@surface(3.0, "Gravel: packed sub-angular gravel 0.5-3 cm in sandy fines, road-metal/terrace gravel; fine patches and coarser lags.")
def gravel(rg, tile):
    cols = ["#8b8173", "#7c7466", "#9a8d78", "#6e685e", "#a39580", "#857a69", "#b0a48e"]
    st, h, _ = pebble_bed(rg, tile, 2600, (0.004, 0.018), cols, round_=0.35, flat_h=0.5, rough=0.8,
                          fill=("#7a6e5a", "#8f836c"), angular_frac=0.5, elong=(1.0, 1.4), sink=0.4)
    hh, col, rough = st.result()
    col = col * drift_tint(rg, 0.05, 0.04, k=(1, 4))
    return finalize(col, hh, rough, 2, 0.5), {}


def sand_base(rg, tile, cols, ripple_wl_m=0.09, ripple_amp=0.006, ripple_mask=0.4, relief=0.02):
    P = ppm(tile)
    n = round(tile / ripple_wl_m)
    phase = 2 * math.pi * (YY / R * n + 0.08 * XX / R * 0) + 2.2 * T.band(R, rg, 1, 6) + 0.6 * T.band(R, rg, 6, 20)
    s = np.sin(phase)
    rip = (s + 0.35 * np.sin(2 * phase)) * 0.5  # asymmetric wind ripple
    mask = T.smoothstep(-ripple_mask, ripple_mask + 0.3, T.band(R, rg, 1, 5)) if ripple_mask else 1.0
    h = relief * T.fbm(R, rg, 1, 12, 2.2) + ripple_amp * rip * mask + 0.0006 * T.band(R, rg, 150, 512)
    t = T.norm01(0.6 * T.band(R, rg, 1, 6) + 0.3 * T.fbm(R, rg, 8, 200))
    col = T.ramp(t, list(cols))
    col = col * (1 + 0.05 * rip * mask)[..., None]  # lee-side shading in the albedo is fine in sand (heavy-mineral lag)
    # heavy-mineral / shell grit
    grains = (rg.random((R, R)) < 0.02).astype(np.float32)
    col = col * (1 - 0.25 * grains * (rg.random((R, R)) < 0.6))[..., None] + 0.08 * grains[..., None] * (rg.random((R, R)) >= 0.6)[..., None]
    col = speckle(rg, col, 0.05, (200, 512))
    return h.astype(np.float32), col, rip * mask


@surface(4.0, "Dry sand: fine wind ripples (~9 cm) in patches, heavy-mineral grit, a few pebbles and shell bits. Soft footing.")
def sand(rg, tile):
    P = ppm(tile)
    h, col, rip = sand_base(rg, tile, ["#b49c74", "#c2aa80", "#ccb68e", "#d6c29c"], 0.09, 0.005)
    rough = 0.9 + 0.04 * T.band(R, rg, 10, 100)
    st = T.Stamper(R, 20, h, col, rough)
    bits = [stone_sprite(rg, rg.uniform(0.005, 0.015) * P, 0.004, c, round_=0.8, rough=0.7)
            for c in ("#8a8070", "#e0d8c4", "#6e6658", "#c8b89a") for _ in range(4)]
    scatter(st, rg, bits, int(6 * tile * tile), zfield=h, sink=0.002)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.8), {}


@surface(8.0, "Coastal dunes: large sinuous wind-ripple field over dune swell, marram-grass clumps on the crests, bare slip faces. Tile the swell with the terrain mesh; this holds ripples + grass.")
def dunes(rg, tile):
    P = ppm(tile)
    n = round(tile / 0.16)
    swell = T.fbm(R, rg, 1, 4, 2.0)
    phase = 2 * math.pi * (YY / R * n) + 5.0 * T.band(R, rg, 1, 4) + 1.2 * T.band(R, rg, 4, 16)
    fr = np.mod(phase / (2 * math.pi), 1.0)
    saw = np.where(fr < 0.75, fr / 0.75, (1 - fr) / 0.25)  # gentle stoss, steep lee
    rip = T.blur(saw - 0.5, 1.2) * T.smoothstep(-1.0, 0.6, T.band(R, rg, 1, 3))
    h = 0.12 * swell + 0.02 * rip + 0.0008 * T.band(R, rg, 150, 512)
    t = T.norm01(0.6 * T.band(R, rg, 1, 5) + 0.3 * T.fbm(R, rg, 8, 200) + 0.3 * swell)
    col = T.ramp(t, ["#b8a47c", "#c8b48c", "#d4c29c", "#dccca8"])
    col = col * (1 + 0.10 * rip)[..., None]
    col = speckle(rg, col, 0.05, (200, 512))
    rough = np.full(h.shape, 0.92, np.float32)
    st = T.Stamper(R, 70, h, col, rough)
    marram = blade_lib(rg, 10, int(0.5 * P), n_blades=40, blade_len=0.24 * P, blade_w=1.6, height_m=0.5,
                       col_base="#7a7e5a", col_tip="#b4b286", dead_frac=0.5, col_dead="#c0b088", curl=0.2,
                       lean=(1, 0.3))
    scatter(st, rg, marram, int(40 * tile * tile / 64), density=T.smoothstep(0.1, 1.2, swell + 0.4 * T.band(R, rg, 3, 10)), zfield=h, sink=0.02)
    h, col, rough = st.result()
    return finalize(col, h, rough, 5, 0.65), {}


@surface(6.0, "Beach (foreshore): damp compacted sand with backwash swash-marks, strand-line of dark wrack (seaweed), shells and pebbles, glossy wet film in runnels.")
def beach_wet(rg, tile):
    P = ppm(tile)
    h, col, rip = sand_base(rg, tile, ["#9a8a6c", "#a8987a", "#b4a484", "#c0b090"], 0.06, 0.003, ripple_mask=0.9, relief=0.015)
    # swash lines: thin wavy lines of slightly coarser, darker grit
    ph = 2 * math.pi * (YY / R * 5) + 3 * T.band(R, rg, 1, 6)
    swash = np.exp(-((np.mod(ph, 2 * math.pi) - math.pi) / 0.07) ** 2) * T.smoothstep(-0.5, 0.5, T.band(R, rg, 1, 4))
    col = col * (1 - 0.07 * swash)[..., None]
    runnel = T.smoothstep(0.4, 1.3, -T.band(R, rg, 1, 5, 1.0, aniso=(2.5, 1.0)))
    h = h - 0.01 * runnel
    col = wet(col, 0.35 + 0.25 * runnel)
    rough = 0.72 - 0.5 * runnel
    st = T.Stamper(R, 40, h, col, rough)
    wrack = [stick(rg, rg.uniform(0.05, 0.25) * P, rg.uniform(2, 5), 0.006, "#3a3a24", "#4e4a2c", rough=0.3, bend=0.4)
             for _ in range(14)]
    strand = T.smoothstep(0.9, 1.8, T.band(R, rg, 2, 8, 1.0, aniso=(3.0, 1.0)))
    scatter(st, rg, wrack, int(40 * tile * tile / 6), density=strand * 0.9 + 0.02, zfield=h)
    shells = [stone_sprite(rg, rg.uniform(0.006, 0.02) * P, 0.004, c, round_=0.7, rough=0.5, col2="#a09a90")
              for c in ("#e6e0d2", "#d8d0c0", "#bcb4a6", "#3c3c44") for _ in range(4)]
    scatter(st, rg, shells, int(10 * tile * tile), density=0.3 + strand * 0.7, zfield=h, sink=0.002)
    peb = [stone_sprite(rg, rg.uniform(0.01, 0.035) * P, 0.012, c, round_=0.9, rough=0.35)
           for c in ("#7e7a70", "#5e5c56", "#9a9080") for _ in range(4)]
    scatter(st, rg, peb, int(1.2 * tile * tile), zfield=h, sink=0.005)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.7), {}


# ================================================================= CHALK / ROCK / STONE
@surface(6.0, "Chalk downland: thin short sheep-grazed turf with white chalk showing through in scars, rabbit scrapes and sheep-tracks; black flint nodules with white cortex.")
def chalk_downland(rg, tile):
    P = ppm(tile)
    h = 0.02 * T.fbm(R, rg, 1, 20, 2.0) + 0.002 * T.band(R, rg, 40, 300)
    bare = 0.85 * T.smoothstep(0.9, 1.6, T.band(R, rg, 1, 6) + 0.35 * T.band(R, rg, 6, 24) + 0.12 * T.band(R, rg, 24, 80))
    # sheep tracks: thin contour-ish paths
    trk = np.exp(-(T.band(R, rg, 1, 3, 1.0, aniso=(0.35, 1.0)) / 0.06) ** 2)
    bare = np.maximum(bare, 0.7 * trk)
    h = h - 0.02 * bare
    chalk = T.ramp(T.norm01(T.band(R, rg, 10, 200)), ["#b8b2a0", "#cfc9b8", "#dcd8cc"])
    soil = T.ramp(T.norm01(T.band(R, rg, 10, 200)), ["#6a5c46", "#7c6c52"])
    ground = mix(soil, chalk, T.smoothstep(0.3, 0.8, bare))
    rough = np.full(h.shape, 0.9, np.float32)
    st = T.Stamper(R, 30, h, ground, rough)
    turf = blade_lib(rg, 14, int(0.1 * P), n_blades=14, blade_len=0.045 * P, blade_w=1.3, height_m=0.03,
                     col_base="#4a5a2a", col_tip="#7a8446", dead_frac=0.2, col_dead="#a09a68", curl=0.4)
    tint = drift_tint(rg, 0.06, 0.05, k=(1, 6))
    scatter(st, rg, turf, int(2600 * tile * tile / 6), density=np.clip(1 - bare * 1.3, 0, 1) ** 1.5, zfield=h, tint=tint)
    herbs = [T.blob(rg, int(0.03 * P) + 3, 0.008 * P, 0.035, c, rough=0.7, lumpy=0.4) for c in ("#c8b43c", "#8a5aa0", "#e0dcc8", "#4e6a30") for _ in range(3)]
    scatter(st, rg, herbs, int(30 * tile * tile), density=np.clip(1 - bare * 2, 0, 1), zfield=h)
    flints = []
    for _ in range(10):
        sp = stone_sprite(rg, rg.uniform(0.012, 0.04) * P, 0.015, "#3a3a3e", facets=6, round_=0.5, rough=0.35, speck=0.05)
        m = sp["a"] > 0
        edge = (T.blur(m.astype(np.float32), 1.2) < 0.9) & m
        sp["col"][edge] = T.hexc("#d8d4c4")
        flints.append(sp)
    scatter(st, rg, flints, int(3 * tile * tile), density=0.2 + bare, zfield=h, sink=0.004)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.6), {}


@surface(8.0, "Carboniferous limestone pavement: clints (flat pale blocks ~0.6x1.5 m) cut by deep grykes along one dominant joint set + cross joints; solution pans, rillenkarren, lichen, ferns/grass in the grykes. Terrible footing for horses.")
def limestone_pavement(rg, tile):
    P = ppm(tile)
    f1, f2, cid = cells(rg, 5, 13, 0.55, warp_px=14, warp_k=(2, 10))
    e = f2 - f1
    gryke = 1 - T.smoothstep(0.02, 0.07, e + 0.02 * T.band(R, rg, 20, 80))
    blk = rand_per_cell(cid, rg)
    tilt_x = rand_per_cell(cid, rg) - 0.5; tilt_y = rand_per_cell(cid, rg) - 0.5
    h = 0.03 * blk + 0.02 * (tilt_x * XX / R * 5 % 1 * 0 + tilt_x * np.sin(2 * math.pi * XX / R) + tilt_y * np.cos(2 * math.pi * YY / R))
    h = h + 0.008 * T.fbm(R, rg, 4, 60, 2.0) + 0.0008 * T.band(R, rg, 100, 500)
    # rounded clint edges
    h = h - 0.05 * (1 - T.smoothstep(0.0, 0.16, e))
    # solution pans (kamenitza)
    pans = T.smoothstep(0.9, 1.6, T.band(R, rg, 10, 30))
    h = h - 0.012 * pans
    # rillenkarren: fine parallel flutes
    flut = np.sin(2 * math.pi * XX / R * 180 + 3 * T.band(R, rg, 4, 20)) * T.smoothstep(0.3, 1.2, T.band(R, rg, 3, 12))
    h = h + 0.0012 * flut
    h = np.where(gryke > 0.5, h - 0.35 * gryke, h)
    t = T.norm01(0.5 * T.band(R, rg, 1, 6) + 0.3 * blk + 0.4 * T.fbm(R, rg, 20, 400))
    col = T.ramp(t, ["#8e8a80", "#a39e92", "#b5afa2", "#c2bcae"])
    lich = T.smoothstep(0.7, 1.3, T.band(R, rg, 20, 90) + 0.4 * T.band(R, rg, 90, 300))
    col = mix(col, T.hexc("#d0cec2"), 0.6 * lich)
    blk_l = T.smoothstep(1.1, 1.6, T.band(R, rg, 25, 120))
    col = mix(col, T.hexc("#5a5a54"), 0.35 * blk_l)  # black crustose lichen
    col = mix(col, T.hexc("#6e7458"), 0.5 * pans)  # algae in pans
    col = col * (1 - 0.3 * (1 - T.smoothstep(0.0, 0.12, e)))[..., None]
    col = mix(col, T.hexc("#2a2a26"), gryke)
    rough = 0.82 - 0.4 * pans
    st = T.Stamper(R, 50, h, col, rough)
    fern = blade_lib(rg, 8, int(0.3 * P), n_blades=12, blade_len=0.13 * P, blade_w=3.2, height_m=0.0,
                     col_base="#2e4a22", col_tip="#5a7a36", dead_frac=0.2, col_dead="#7a6a3a", curl=0.15)
    grass = blade_lib(rg, 8, int(0.2 * P), n_blades=20, blade_len=0.08 * P, blade_w=1.4, height_m=0.0,
                      col_base="#3e5226", col_tip="#7a8a46", dead_frac=0.3, col_dead="#9a8e5a", curl=0.4)
    dens = gryke * T.smoothstep(-0.8, 0.6, T.band(R, rg, 2, 8))
    scatter(st, rg, fern + grass, int(240 * tile * tile / 64), density=dens, zfield=h * 0 + h.max() - 0.03, zjit=0.01)
    h2, col, rough = st.result()
    return finalize(col, h2, rough, 4, 0.55), {}


def rock_core(rg, tile, vertical=False):
    """Jointed rock: big joint blocks, each a gently domed slab with its own tilt (so light
    catches block faces), secondary cracks, billowy weathering and fine grain. ~0.6 m relief."""
    if vertical:
        f1, f2, cid, vx, vy = cells(rg, 7, 4, 0.9, warp_px=18, warp_k=(2, 8), vec=True)  # tall joint blocks
    else:
        f1, f2, cid, vx, vy = cells(rg, 5, 5, 0.9, warp_px=9, warp_k=(2, 6), vec=True)
    g1, g2, cid2 = cells(rg, 16, 16, 1.0, warp_px=8, warp_k=(4, 16))
    e1 = f2 - f1; e2 = g2 - g1
    blk = rand_per_cell(cid, rg); ta = rand_per_cell(cid, rg) * 2 * math.pi; ts = rand_per_cell(cid, rg)
    tilt = (np.cos(ta) * vx + np.sin(ta) * vy) * (0.08 + 0.12 * ts)
    dome = 0.10 * T.smoothstep(0.0, 0.35, e1)                         # rounded block shoulders
    bill = np.abs(T.band(R, rg, 3, 16, 1.0))                             # billowy weathering
    h = 0.25 * blk + tilt + dome - 0.05 * bill + 0.08 * T.fbm(R, rg, 1, 4, 2.0)
    h = h + 0.05 * T.ridged(R, rg, 4, 24, 1.2) + 0.018 * T.fbm(R, rg, 16, 120, 1.6) + 0.003 * T.band(R, rg, 120, 500)
    if vertical:
        strata = T.smoothstep(0.7, 1.0, np.sin(2 * math.pi * YY / R * 9 + 1.5 * T.band(R, rg, 1, 5)))
        h = h + 0.03 * strata
    crack1 = 1 - T.smoothstep(0.0, 0.03, e1)
    crack2 = (1 - T.smoothstep(0.0, 0.03, e2)) * T.smoothstep(0.3, 1.2, T.band(R, rg, 2, 6))
    h = h - (0.05 + 0.08 * T.smoothstep(-0.5, 0.8, T.band(R, rg, 2, 10))) * crack1 - 0.02 * crack2
    return h.astype(np.float32), crack1, crack2, blk


def rock_colour(rg, h, crack1, crack2, blk, vertical=False, lichen=True):
    t = T.norm01(0.5 * T.band(R, rg, 1, 6) + 0.3 * blk + 0.3 * T.fbm(R, rg, 20, 400))
    col = T.ramp(t, ["#6a6862", "#7a7872", "#88857e", "#98948a"])
    # granite crystal speckle: pink feldspar, dark biotite, pale quartz
    rr = rg.random((R, R))
    spk = T.blur((rr < 0.08).astype(np.float32), 0.6)
    col = col * (1 - 0.35 * spk)[..., None]
    fel = T.blur(((rr > 0.9) & (rr < 0.95)).astype(np.float32), 0.7)
    col = col + (T.hexc("#a88a7a") - col) * (0.5 * fel)[..., None]
    qz = T.blur((rr > 0.975).astype(np.float32), 0.6)
    col = col + (T.hexc("#c8c4ba") - col) * (0.6 * qz)[..., None]
    # weathered tops paler; sheltered parts darker
    exp = T.norm01(h - T.blur(h, 30))
    col = col * (0.85 + 0.25 * exp)[..., None]
    if vertical:  # water streaks down the face (image rows = down)
        stk = T.band(R, rg, 4, 40, 1.0, aniso=(1.0, 0.08))
        col = col * (1 - 0.18 * T.smoothstep(0.3, 1.5, stk))[..., None]
        col = mix(col, T.hexc("#6a6450"), 0.3 * T.smoothstep(0.8, 1.8, stk))
    if lichen:
        lz = T.smoothstep(0.5, 1.2, T.band(R, rg, 6, 30) + 0.5 * T.band(R, rg, 30, 120)) * T.smoothstep(0.3, 0.7, exp)
        col = mix(col, T.hexc("#a8ac96") * (1 + 0.08 * T.band(R, rg, 80, 300))[..., None], 0.75 * lz)
        ly = T.smoothstep(1.6, 2.2, T.band(R, rg, 6, 24)) * T.smoothstep(0.4, 0.7, exp)
        col = mix(col, T.hexc("#a08650"), 0.55 * ly)
        moss = T.smoothstep(0.2, 0.8, crack1 + 0.6 * crack2) * T.smoothstep(-0.4, 0.6, T.band(R, rg, 2, 8))
        col = mix(col, T.hexc("#4a5428"), 0.75 * moss)
    col = col * (1 - 0.4 * crack1 * (0.6 + 0.4 * T.smoothstep(-0.5, 0.8, T.band(R, rg, 2, 10))) - 0.25 * crack2)[..., None]
    return col


@surface(8.0, "Granite outcrop / cliff top: benched sheet-jointed rock, big joint blocks + secondary cracks, crystal speckle, grey-green + orange lichen, moss in the joints. For steep slopes use cliff_rock triplanar.")
def rock_slab(rg, tile):
    h, c1, c2, blk = rock_core(rg, tile)
    col = rock_colour(rg, h, c1, c2, blk)
    rough = 0.78 + 0.1 * T.band(R, rg, 10, 100)
    return finalize(col, h, rough, 8, 0.7), {}


@surface(8.0, "Vertical cliff rock for TRIPLANAR on steep slopes: image V = world up. Tall joint blocks, horizontal bedding ledges, dark water-streaks running down, sparse lichen, no turf.")
def cliff_rock(rg, tile):
    h, c1, c2, blk = rock_core(rg, tile, vertical=True)
    col = rock_colour(rg, h, c1, c2, blk, vertical=True, lichen=True)
    rough = 0.8 + 0.08 * T.band(R, rg, 10, 100)
    return finalize(col, h, rough, 8, 0.7), {"extra_json": {"projection": "triplanar_side", "v_axis": "world_up"}}


@surface(4.0, "Scree: loose angular frost-shattered stones 3-35 cm, clast-supported, grey with rusty weathering rinds, fines only in the gaps. Horses and formed troops badly disordered.")
def scree(rg, tile):
    P = ppm(tile)
    h = 0.03 * T.fbm(R, rg, 1, 10, 2.0)
    fill = T.ramp(T.norm01(T.band(R, rg, 20, 300)), ["#4e4a44", "#625c54"])
    st = T.Stamper(R, int(0.32 * P) + 4, h, fill, np.full(h.shape, 0.9, np.float32))
    cols = ["#7c7a74", "#84817a", "#74716a", "#8c887e", "#7e776c", "#6a6862"]
    lib = []
    for i in range(80):
        r = math.exp(rg.uniform(math.log(0.015), math.log(0.17))) * P
        lib.append((r, stone_sprite(rg, r, r / P * rg.uniform(0.35, 0.7), cols[rg.integers(len(cols))], facets=rg.integers(4, 7),
                                    round_=0.05, flat=rg.uniform(0.0, 0.35), elong=rg.uniform(1.0, 1.8), rough=0.85, speck=0.12,
                                    lichen=("#a4a890", 0.3) if rg.random() < 0.3 else None)))
    lib.sort(key=lambda t: t[0])
    sortf = T.norm01(T.band(R, rg, 1, 4))
    for i in range(int(620 * tile * tile / 16 * 16)):
        x, y = rg.random(2) * R
        s = sortf[int(y), int(x)]
        k = int(np.clip(rg.beta(1.3, 2.2) * 0.8 + 0.3 * s - 0.1, 0, 0.999) * len(lib))
        r, sp = lib[k]
        st.stamp(sp, x, y, z=h[int(y), int(x)] + rg.normal(0, 0.02) - 0.3 * r / P * 0.5,
                 tint=(1 + rg.normal(0, 0.01, 3)) * (1 + rg.normal(0, 0.08)))
    h, col, rough = st.result()
    col = col * drift_tint(rg, 0.05, 0.03)
    return finalize(col, h, rough, 4, 0.4), {}


@surface(16.0, "Boulder field / clitter: rounded granite boulders 0.4-2.5 m half-sunk in rough acid grassland, lichen-crusted tops, moss at the bases, smaller stones between. Blocks formations; hard cover for skirmishers.")
def boulder_field(rg, tile):
    P = ppm(tile)
    h = 0.08 * T.fbm(R, rg, 1, 20, 2.0)
    t = T.norm01(T.band(R, rg, 2, 12) + 0.5 * T.fbm(R, rg, 12, 300))
    gnd = T.ramp(t, ["#4a4a2a", "#5c5c34", "#6e6a42", "#80784e"])
    st = T.Stamper(R, int(1.9 * P) + 4, h, gnd, np.full(h.shape, 0.88, np.float32))
    grass = blade_lib(rg, 10, int(0.12 * P), n_blades=22, blade_len=0.05 * P, blade_w=1.2, height_m=0.12,
                      col_base="#4a5028", col_tip="#8a8650", dead_frac=0.45, col_dead="#a89868", curl=0.35)
    scatter(st, rg, grass, int(1600 * tile * tile / 256 * 4), zfield=h, tint=drift_tint(rg, 0.1, 0.1))
    small = [stone_sprite(rg, rg.uniform(0.04, 0.18) * P, rg.uniform(0.05, 0.15), c, round_=0.6, rough=0.85,
                          lichen=("#a8ac96", 0.4)) for c in ("#7a7870", "#8a867c", "#6c6a64") for _ in range(6)]
    scatter(st, rg, small, int(40 * tile * tile / 16), zfield=h, sink=0.03)
    bould = []
    for _ in range(12):
        r = rg.uniform(0.25, 1.2) * P
        sp = stone_sprite(rg, r, r / P * rg.uniform(0.5, 0.8), rg.choice(["#7e7c76", "#8a867e", "#74726c"]), facets=7,
                          round_=0.75, elong=rg.uniform(1.0, 1.5), rough=0.8, speck=0.14, lichen=("#a8ac94", 0.6))
        # moss skirt: lower 25% of the dome goes green
        low = (sp["h"] > -1) & (sp["h"] < sp["h"].max() * 0.25)
        sp["col"][low] = sp["col"][low] * 0.5 + T.hexc("#4e5a2a") * 0.5
        bould.append(sp)
    scatter(st, rg, bould, int(22 * tile * tile / 256), zfield=h, sink=0.15)
    h, col, rough = st.result()
    return finalize(col, h, rough, 12, 0.45), {}


# ================================================================= SNOW / ICE / FROZEN
@surface(8.0, "Fresh lying snow: soft wind-sculpted drifts and sastrugi, blue shadows in hollows, a few dead grass heads poking through. Albedo capped at sRGB 240.")
def snow_light(rg, tile):
    P = ppm(tile)
    h = 0.06 * T.fbm(R, rg, 1, 10, 2.4) + 0.0025 * T.band(R, rg, 3, 14, 1.0, aniso=(0.35, 1.0)) + 0.0005 * T.band(R, rg, 60, 400)
    exp = T.norm01(h - T.blur(h, 25))
    col = mix(T.hexc("#c4cdd8"), T.hexc("#eeeef0"), 0.35 + 0.65 * exp)
    col = col * (1 + 0.02 * T.band(R, rg, 2, 10))[..., None]
    glint = (rg.random((R, R)) < 0.004).astype(np.float32)
    rough = 0.72 - 0.25 * glint
    st = T.Stamper(R, 30, h, col, rough)
    heads = blade_lib(rg, 8, int(0.12 * P), n_blades=5, blade_len=0.05 * P, blade_w=1.3, height_m=0.02,
                      col_base="#6a5e40", col_tip="#a09068", dead_frac=0.9, col_dead="#9a8a60", curl=0.5)
    scatter(st, rg, heads, int(12 * tile * tile / 4), density=T.smoothstep(0.4, 1.4, T.band(R, rg, 2, 8)) * (1 - exp), zfield=h)
    h, col, rough = st.result()
    return finalize(col, h, rough, 10, 0.8), {}


@surface(6.0, "Trampled snow: overlapping boot/hoof prints in walking trails, compacted glazed lanes, grey-brown slush and mud churned up in the deepest prints.")
def snow_trampled(rg, tile):
    P = ppm(tile)
    h = 0.04 * T.fbm(R, rg, 1, 10, 2.3) + 0.0008 * T.band(R, rg, 60, 400)
    # trails: random walks of prints
    pts, angs = [], []
    for _ in range(int(14 * tile * tile / 36)):
        x, y = rg.random(2) * R; a = rg.uniform(0, 2 * math.pi)
        for s in range(int(rg.uniform(20, 60))):
            a += rg.normal(0, 0.12)
            side = 0.09 * P * (1 if s % 2 else -1)
            pts.append((x - math.sin(a) * side, y + math.cos(a) * side)); angs.append(a + rg.normal(0, 0.15))
            x += math.cos(a) * 0.36 * P; y += math.sin(a) * 0.36 * P
    n_rand = int(40 * tile * tile)
    pts += [tuple(rg.random(2) * R) for _ in range(n_rand)]; angs += list(rg.uniform(0, 2 * math.pi, n_rand))
    h, fm = footprints(rg, h.astype(np.float32), len(pts), P, depth=0.035, pts=pts, angs=angs)
    h = T.blur(h, 2.5) + 0.004 * T.band(R, rg, 20, 120)  # soft powder edges, spindrift infill
    fmb = T.blur(fm, 12)
    comp = T.smoothstep(0.15, 0.5, fmb)  # well-trodden lanes
    h = h - 0.04 * comp
    exp = T.norm01(h - T.blur(h, 20))
    col = mix(T.hexc("#b8c0ca"), T.hexc("#e8e8ea"), 0.3 + 0.7 * exp)
    dirt = T.smoothstep(0.25, 0.8, fm * (0.4 + 0.6 * comp)) * T.smoothstep(-0.6, 0.8, T.band(R, rg, 2, 10))
    col = mix(col, T.hexc("#8a8276") * (1 + 0.1 * T.band(R, rg, 30, 200))[..., None], 0.55 * comp)
    col = mix(col, T.hexc("#6e665a"), 0.4 * dirt)
    rough = 0.7 - 0.3 * comp - 0.2 * dirt
    return finalize(col, h, rough, 5, 0.7), {}


@surface(4.0, "Frozen ground: iron-hard frozen soil and ruts, white hoar-frost on every exposed crest, frozen puddles (milky ice with white bubble/cracks), frost-killed grass tufts.")
def frozen_ground(rg, tile):
    P = ppm(tile)
    h = 0.025 * T.fbm(R, rg, 1, 40, 2.2) + 0.003 * T.band(R, rg, 40, 200) + 0.001 * T.band(R, rg, 200, 500)
    h, fm = footprints(rg, h.astype(np.float32), int(20 * tile * tile), P, depth=0.03)
    t = T.norm01(0.6 * T.band(R, rg, 1, 6) + 0.4 * T.fbm(R, rg, 8, 300))
    col = T.ramp(t, ["#4a3e30", "#56483a", "#645646"])
    rough = np.full(h.shape, 0.85, np.float32)
    st = T.Stamper(R, 30, h, col, rough)
    tuft = blade_lib(rg, 10, int(0.14 * P), n_blades=16, blade_len=0.06 * P, blade_w=1.4, height_m=0.04,
                     col_base="#6a6448", col_tip="#a8a07e", dead_frac=0.6, col_dead="#b0a47e", curl=0.4)
    scatter(st, rg, tuft, int(70 * tile * tile), density=T.smoothstep(-0.4, 0.8, T.band(R, rg, 2, 8)), zfield=h)
    h, col, rough = st.result()
    exp = T.norm01(h - T.blur(h, 6))
    frost = T.smoothstep(0.45, 0.85, exp + 0.25 * T.band(R, rg, 100, 400)) * (0.6 + 0.4 * T.smoothstep(-0.8, 0.5, T.band(R, rg, 1, 5)))
    col = mix(col, T.hexc("#dcdfe2"), 0.8 * frost)
    col, h, rough = finalize(col, h, rough, 4, 0.6)
    lvl = np.percentile(h, 10)
    ice = h < lvl
    f1, f2, _ = cells(rg, 40, 40, 1.0, warp_px=3)
    cr = 1 - T.smoothstep(0.0, 0.04, f2 - f1)
    bub = T.smoothstep(0.6, 1.4, T.band(R, rg, 30, 120))
    icec = mix(T.hexc("#7e8a92"), T.hexc("#c8d0d6"), np.clip(0.35 * bub + 0.6 * cr + 0.2 * T.smoothstep(0, 0.01, lvl - h) * 0, 0, 1))
    col = np.where(ice[..., None], mix(col * 0.6, icec, 0.8), col)
    rough = np.where(ice, 0.08 + 0.3 * cr, rough * (1 - 0.1 * frost))
    h = np.maximum(h, lvl)
    return (col, h, rough), {}


@surface(16.0, "Lake/river ice: dark clear black ice with white fracture networks and trapped bubble streams, drifted snow patches. Treacherous footing; may break (sim).")
def ice(rg, tile):
    P = ppm(tile)
    f1, f2, _ = cells(rg, 5, 5, 1.0, warp_px=25, warp_k=(2, 10))
    g1, g2, _ = cells(rg, 18, 18, 1.0, warp_px=8, warp_k=(6, 24))
    cr1 = np.exp(-((f2 - f1) / 0.012) ** 2)
    cr2 = np.exp(-((g2 - g1) / 0.02) ** 2) * T.smoothstep(-0.2, 0.8, T.band(R, rg, 2, 8))
    depth = T.norm01(T.band(R, rg, 1, 6) + 0.5 * T.band(R, rg, 6, 30))
    col = T.ramp(depth, ["#283036", "#30393f", "#3e484e", "#505a60"])
    bub = (rg.random((R, R)) < 0.01) * T.smoothstep(0.5, 1.5, T.band(R, rg, 8, 40))
    col = mix(col, T.hexc("#b8c4cc"), np.clip(0.75 * cr1 + 0.4 * cr2 + T.blur(bub.astype(np.float32), 0.8) * 2, 0, 1))
    h = 0.002 * T.fbm(R, rg, 1, 30, 2.0) - 0.0015 * cr1
    rough = 0.05 + 0.25 * np.clip(cr1 + cr2, 0, 1)
    # drifted snow
    sn = T.smoothstep(0.6, 2.0, T.band(R, rg, 1, 6, 1.0, aniso=(0.5, 1.0)) + 0.5 * T.band(R, rg, 6, 30) + 0.25 * T.band(R, rg, 30, 120))
    h = h + 0.015 * sn
    sn = sn * 0.6
    col = mix(col, T.hexc("#a8b0b6") * (1 + 0.05 * T.band(R, rg, 20, 200))[..., None], sn)
    rough = rough * (1 - sn) + 0.7 * sn
    return (col, h.astype(np.float32), rough), {}


# ================================================================= BURNED / RUBBLE / BUILT / DUG
@surface(12.0, "Burned ground: charred black stubble and char, pale grey-white ash drifts, scorched orange-brown soil, charred sticks, unburned straw patches at the margins.")
def burned_ground(rg, tile):
    P = ppm(tile)
    h = 0.015 * T.fbm(R, rg, 1, 30, 2.0) + 0.002 * T.band(R, rg, 40, 300)
    burn = T.norm01(T.band(R, rg, 1, 6) + 0.4 * T.band(R, rg, 6, 24))
    soil = T.ramp(T.norm01(T.band(R, rg, 10, 300)), ["#46382c", "#54402e"])
    char = T.ramp(T.norm01(T.band(R, rg, 10, 300)), ["#211e1c", "#2c2826", "#383330"])
    ash = T.ramp(T.norm01(T.band(R, rg, 20, 300)), ["#6e6a64", "#848078", "#9a968e"])
    col = mix(soil, char, 0.35 + 0.65 * T.smoothstep(0.0, 0.3, burn))
    ashm = T.smoothstep(0.4, 1.6, T.band(R, rg, 1, 4) + 0.3 * T.band(R, rg, 4, 16) + 0.15 * T.band(R, rg, 16, 60)) * T.smoothstep(0.25, 0.5, burn)
    col = mix(col, ash, 0.5 * ashm)
    flecks = T.smoothstep(1.2, 2.2, T.band(R, rg, 40, 200)) * T.smoothstep(0.25, 0.5, burn)
    col = mix(col, T.hexc("#b4b0a8"), 0.5 * flecks)
    h = h + 0.004 * ashm
    rough = 0.85 + 0.1 * ashm
    st = T.Stamper(R, 40, h, col, rough)
    stub = blade_lib(rg, 10, int(0.1 * P), n_blades=12, blade_len=0.03 * P, blade_w=1.3, height_m=0.04,
                     col_base="#262320", col_tip="#403830", dead_frac=0.0, curl=0.2)
    scatter(st, rg, stub, int(900 * tile * tile / 6), density=0.6 * T.smoothstep(0.3, 0.6, burn) * (1 - ashm), zfield=h)
    straw = blade_lib(rg, 8, int(0.14 * P), n_blades=16, blade_len=0.06 * P, blade_w=1.4, height_m=0.08,
                      col_base="#5a4a2c", col_tip="#a8925c", dead_frac=0.6, col_dead="#8a7448", curl=0.3)
    scatter(st, rg, straw, int(15 * tile * tile / 6), density=0.15 * T.smoothstep(0.1, 0.0, burn), zfield=h)
    sticks = [stick(rg, rg.uniform(0.08, 0.4) * P, rg.uniform(2, 6), 0.01, "#1e1c1a", "#34302c", rough=0.7) for _ in range(12)]
    scatter(st, rg, sticks, int(4 * tile * tile), density=T.smoothstep(0.3, 0.6, burn), zfield=h)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.6), {}


@surface(6.0, "Rubble / ruins ground: broken dressed stone, mortar lumps and lime dust, shattered roof tiles, charred timber, weeds pushing through. Cover, bad footing, dig-in easy.")
def ruins_rubble(rg, tile):
    P = ppm(tile)
    h = 0.12 * T.fbm(R, rg, 1, 8, 2.2) + 0.01 * T.band(R, rg, 20, 200)
    t = T.norm01(T.band(R, rg, 2, 20) + 0.5 * T.fbm(R, rg, 20, 300))
    dust = T.ramp(t, ["#6a5e4e", "#847866", "#a09884", "#b8b09c"])
    st = T.Stamper(R, int(0.35 * P), h, dust, np.full(h.shape, 0.92, np.float32))
    stones = []
    for i in range(50):
        r = math.exp(rg.uniform(math.log(0.025), math.log(0.2))) * P
        c = rg.choice(["#a89e88", "#9c9280", "#b09a78", "#8e877a", "#a39684", "#857e72"])
        sp = stone_sprite(rg, r, r / P * rg.uniform(0.6, 1.1), c, facets=rg.integers(5, 8), round_=0.15, flat=rg.uniform(0.2, 0.5),
                          elong=rg.uniform(1.0, 1.6), rough=0.85, speck=0.12)
        if rg.random() < 0.3:  # soot
            sp["col"] = sp["col"] * np.array([0.55, 0.52, 0.5], np.float32)
        stones.append(sp)
    tiles = [stone_sprite(rg, rg.uniform(0.04, 0.1) * P, 0.015, c, facets=4, round_=0.0, flat=0.9, elong=1.4, rough=0.75)
             for c in ("#9a5a3c", "#84492e", "#a86a48") for _ in range(5)]
    mortar = [T.blob(rg, int(0.08 * P), rg.uniform(0.01, 0.03) * P, 0.015, c, lumpy=0.6, rough=0.95)
              for c in ("#d8ccb3", "#c4b89e") for _ in range(4)]
    beams = [stick(rg, rg.uniform(0.3, 0.6) * P, rg.uniform(0.05, 0.12) * P, rg.uniform(0.05, 0.1), "#2a2420", "#3e342c", rough=0.8, bend=0.02)
             for _ in range(6)]
    scatter(st, rg, mortar, int(40 * tile * tile), zfield=h, sink=0.005)
    scatter(st, rg, tiles, int(12 * tile * tile), zfield=h, zjit=0.02)
    scatter(st, rg, stones, int(55 * tile * tile), zfield=h, zjit=0.03, sink=0.02)
    scatter(st, rg, beams, int(0.25 * tile * tile), zfield=h + 0.05)
    weeds = blade_lib(rg, 8, int(0.2 * P), n_blades=18, blade_len=0.08 * P, blade_w=1.8, height_m=0.35,
                      col_base="#3e5224", col_tip="#7a8a40", dead_frac=0.3, col_dead="#9a8a58", curl=0.3)
    scatter(st, rg, weeds, int(4 * tile * tile), zfield=h)
    h, col, rough = st.result()
    return finalize(col, h, rough, 6, 0.45), {}


def cobble_field(rg, tile, n, jitter, cols, joint_col, mud_amt, dome=0.03, joint_w=0.09, stretch=1.0, flat=False):
    P = ppm(tile)
    nx = int(round(n * stretch)); ny = n
    f1, f2, cid = cells(rg, nx, ny, jitter, warp_px=2.0, warp_k=(8, 30))
    e = f2 - f1
    v1 = rand_per_cell(cid, rg); v2 = rand_per_cell(cid, rg); v3 = rand_per_cell(cid, rg)
    body = T.smoothstep(joint_w * 0.4, joint_w * 1.8, e)
    if flat:
        top = dome * (0.15 + 0.1 * v2) + 0.0012 * T.fbm(R, rg, 10, 300, 1.2)
        h = top * T.smoothstep(joint_w * 0.3, joint_w * 1.1, e) + dome * 0.1 * (v1 - 0.5)
    else:
        prof = np.sqrt(np.clip(1 - (f1 / (0.6 + 0.2 * v2)) ** 2, 0, 1))
        h = dome * (0.6 + 0.4 * v2) * prof * body + 0.0008 * T.fbm(R, rg, 20, 300, 1.2)
    h = h + 0.006 * T.fbm(R, rg, 1, 8, 2.0)
    k = (v1 * len(cols)).astype(int) % len(cols)
    palette = np.stack([T.hexc(c) for c in cols])
    sc = palette[k] * (1 + 0.12 * (v3 - 0.5))[..., None]
    sc = sc * (1 + 0.06 * T.band(R, rg, 100, 500))[..., None]
    wear = T.smoothstep(0.4, 1.0, T.norm01(h))
    sc = sc * (0.9 + 0.15 * wear)[..., None]
    jc = T.ramp(T.norm01(T.band(R, rg, 20, 200)), list(joint_col))
    col = mix(jc, sc, body)
    mud = T.smoothstep(0.5, 1.3, T.band(R, rg, 1, 6) + 0.5 * T.band(R, rg, 6, 24)) * mud_amt
    col = mix(col, T.hexc("#4e4030"), mud * (1 - 0.7 * wear))
    rough = 0.9 - 0.25 * wear * body - 0.1 * mud
    return h.astype(np.float32), col, rough, body, e, cid


@surface(4.0, "Cobbled road/street: rounded field cobbles 10-18 cm, packed with dirt and dung in the joints, polished wear on crowns, mud patches, a few missing setts.")
def cobbled_road(rg, tile):
    P = ppm(tile)
    h, col, rough, body, e, cid = cobble_field(rg, tile, 30, 0.9, ["#8a847a", "#7a7266", "#9c9282", "#6e6a62", "#a08868", "#857c6c"],
                                               ("#3e3428", "#54473a"), 0.7, dome=0.05, joint_w=0.12)
    # missing cobbles -> muddy holes
    miss = rand_per_cell(cid, rg) < 0.02
    h = np.where(miss, h * 0.2 - 0.02, h)
    col = np.where(miss[..., None], T.hexc("#3e3226"), col)
    st = T.Stamper(R, 20, h, col, rough)
    weeds = blade_lib(rg, 8, int(0.08 * P), n_blades=8, blade_len=0.03 * P, blade_w=1.2, height_m=0.01,
                      col_base="#3a4a22", col_tip="#6a7a38", dead_frac=0.2, curl=0.4)
    scatter(st, rg, weeds, int(20 * tile * tile), density=(1 - body) * T.smoothstep(0, 1, T.band(R, rg, 2, 6)), zfield=h * 0 + 0.012)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.55), {}


@surface(4.0, "Stone paving (village square / market): irregular laid flagstones 0.4-0.9 m of limestone and sandstone, worn edges, cracks, grass and moss in the joints, grime stains.")
def stone_paving(rg, tile):
    P = ppm(tile)
    h, col, rough, body, e, cid = cobble_field(rg, tile, 6, 0.45, ["#b0a690", "#a49a84", "#b58f63", "#9c9480", "#bcb29c", "#a89078"],
                                               ("#4a4232", "#5a5040"), 0.25, dome=0.05, joint_w=0.035, stretch=1.4, flat=True)
    f1, f2, _ = cells(rg, 22, 22, 1.0, warp_px=6)
    crack = np.exp(-((f2 - f1) / 0.02) ** 2) * T.smoothstep(0.9, 1.6, T.band(R, rg, 4, 14)) * body
    h = h - 0.004 * crack
    col = col * (1 - 0.5 * crack)[..., None]
    stain = T.smoothstep(0.4, 1.5, T.band(R, rg, 4, 30))
    col = col * (1 - 0.18 * stain)[..., None]
    moss = (1 - T.smoothstep(0.0, 0.1, e)) * T.smoothstep(-0.2, 0.8, T.band(R, rg, 2, 10))
    col = mix(col, T.hexc("#4e5a2c"), 0.6 * moss)
    st = T.Stamper(R, 20, h, col, rough)
    weeds = blade_lib(rg, 8, int(0.08 * P), n_blades=9, blade_len=0.035 * P, blade_w=1.2, height_m=0.01,
                      col_base="#3a4a22", col_tip="#6a7a38", dead_frac=0.2, curl=0.4)
    scatter(st, rg, weeds, int(40 * tile * tile), density=(1 - body) * T.smoothstep(-0.3, 1, T.band(R, rg, 2, 6)), zfield=h * 0 + 0.012)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.6), {}


@surface(4.0, "Earthworks / ditch spoil: freshly dug soil with flat spade-cut facets, clods, orange-grey subsoil clay streaks, stones and severed roots. Dig-in terrain for ditches, ramparts, graves.")
def ditch(rg, tile):
    P = ppm(tile)
    f1, f2, cid, vx, vy = cells(rg, 12, 12, 1.0, warp_px=6, vec=True)
    a = rand_per_cell(cid, rg) * 2 * math.pi; s = rand_per_cell(cid, rg)
    # each spade cell: stepped tilted planes (spade facets), in cell-local coords -> seamless
    plane = (np.cos(a) * vx + np.sin(a) * vy) * 2.5 + s * 7
    facet = (np.mod(plane, 1.0) - 0.5) * (0.01 + 0.02 * s)
    facet = facet * T.smoothstep(0.2, 0.9, T.band(R, rg, 1, 5) + 0.5)
    h = 0.05 * T.fbm(R, rg, 1, 20, 2.2) + facet + 0.004 * T.band(R, rg, 40, 300)
    t = T.norm01(0.6 * T.band(R, rg, 1, 6) + 0.4 * T.fbm(R, rg, 8, 300))
    col = T.ramp(t, ["#3e3022", "#4c3b2a", "#5a4632", "#66523c"])
    sub = T.smoothstep(0.6, 1.2, T.band(R, rg, 2, 10, 1.0, aniso=(0.3, 1.0)))
    col = mix(col, T.ramp(T.norm01(T.band(R, rg, 20, 200)), ["#8a6a44", "#9c8060", "#8a8474"]), 0.75 * sub)
    col = wet(col, 0.3 * T.smoothstep(0.2, 1.0, T.band(R, rg, 1, 4)))
    rough = 0.9 - 0.06 * T.band(R, rg, 2, 8)
    st = T.Stamper(R, 40, h, col, rough)
    clods = [T.blob(rg, int(0.14 * P), rg.uniform(0.02, 0.06) * P, rg.uniform(0.015, 0.04), c, lumpy=0.6, shade=0.4, rough=0.9)
             for c in ("#4a3a2a", "#5a4634", "#6a5640", "#8a6c48") for _ in range(6)]
    scatter(st, rg, clods, int(60 * tile * tile), zfield=h, sink=0.005)
    stones = [stone_sprite(rg, rg.uniform(0.01, 0.05) * P, 0.02, c, round_=0.4, rough=0.8)
              for c in ("#8a8276", "#9c9480", "#6e685e") for _ in range(5)]
    scatter(st, rg, stones, int(8 * tile * tile), zfield=h, sink=0.006)
    roots = [stick(rg, rg.uniform(0.05, 0.2) * P, rg.uniform(1.2, 2.5), 0.006, "#b0a080", "#8a7658", rough=0.7, bend=0.5) for _ in range(8)]
    scatter(st, rg, roots, int(2 * tile * tile), zfield=h)
    h, col, rough = st.result()
    return finalize(col, h, rough, 4, 0.55), {}


# ================================================================= WATER
def wave_spectrum(rg, lam_min_m, lam_max_m, tile, wind_deg=30.0, spread=4.0, beta=3.5):
    """Periodic wave height field from integer wavevectors (always seamless)."""
    k = np.fft.fftfreq(R) * R
    kx, ky = np.meshgrid(k, k)
    kk = np.sqrt(kx * kx + ky * ky)
    kmin, kmax = tile / lam_max_m, tile / lam_min_m
    w = math.radians(wind_deg)
    cosang = (kx * math.cos(w) + ky * math.sin(w)) / np.maximum(kk, 1e-6)
    dirf = np.abs(cosang) ** spread + 0.08
    amp = np.where((kk >= kmin) & (kk <= kmax), np.maximum(kk, 1e-6) ** (-beta / 2), 0) * dirf
    F = (rg.standard_normal((R, R)) + 1j * rg.standard_normal((R, R))) * amp
    out = np.real(np.fft.ifft2(F)).astype(np.float32)
    return out / (out.std() + 1e-9)


@surface(16.0, "WATER NORMAL LAYER A (swell/wind waves 0.4-6 m). Use with water_normal_b: scroll A slowly along the flow (0.3-1.0 m/s river, 0.05-0.15 m/s lake) and B faster at ~35 deg to it; sum the normals (whiteout blend). Albedo = deep-body colour; reflections come from the shader.")
def water_normal_a(rg, tile):
    h = 0.06 * wave_spectrum(rg, 0.4, 6.0, tile, 20, 3.0, 3.6)
    col = np.broadcast_to(T.hexc("#2c3e3a"), (R, R, 3)) * (1 + 0.04 * T.band(R, rg, 1, 4))[..., None]
    return (col, h, np.full(h.shape, 0.04, np.float32)), {"extra_json": {
        "water_role": "normal layer A (large)",
        "colour_notes": {"river_clear": "#34463e deep / #5a6a52 shallow over gravel", "lake_deep": "#2a3a3e",
                         "pond_peaty": "#2e2820", "marsh_standing": "#3a3a2a", "flood_muddy": "#6b5a43 opaque (see flood_water)",
                         "absorption_linear_per_m": [0.45, 0.12, 0.09], "roughness": 0.03}}}


@surface(4.0, "WATER NORMAL LAYER B (ripples / cat's-paws 3-40 cm). Scroll faster than A and at an angle; fade its strength with camera distance to avoid shimmer.")
def water_normal_b(rg, tile):
    h = 0.004 * wave_spectrum(rg, 0.03, 0.4, tile, 60, 1.5, 3.0)
    col = np.broadcast_to(T.hexc("#2c3e3a"), (R, R, 3)).astype(np.float32)
    return (col, h, np.full(h.shape, 0.04, np.float32)), {"extra_json": {"water_role": "normal layer B (small)"}}


@surface(6.0, "Shallow ford (~0.2-0.4 m): clear water over a gravel and cobble bed, visible stones tinted green-brown by depth, a few stepping stones breaking the surface with wet dark rims. Height = WATER SURFACE (ripples) except the emergent stones.")
def shallow_ford(rg, tile):
    P = ppm(tile)
    cols = ["#8a8272", "#766e60", "#9a8e78", "#6a665c", "#a8987c", "#5c5a54", "#8c7a60"]
    st, h0, _ = pebble_bed(rg, tile, 260, (0.012, 0.09), cols, round_=0.9, flat_h=0.45, rough=0.4,
                           fill=("#6e6450", "#857860"))
    bh, bcol, _ = st.result()
    depth = 0.2 - (bh - bh.mean()) + 0.06 * T.band(R, rg, 1, 4)
    depth = np.clip(depth, 0.04, 0.5)
    bed = wet(bcol * (1 + 0.1 * T.band(R, rg, 1, 4))[..., None], np.ones(bh.shape, np.float32))
    # caustic-ish light net on the bed
    f1, f2, _ = cells(rg, 14, 14, 1.0, warp_px=10)
    caus = np.exp(-((f2 - f1) / 0.06) ** 2)
    bed = bed * (1 + 0.25 * caus)[..., None]
    wc = T.hexc("#2e4a42")
    att = np.exp(-depth[..., None] * np.array([3.0, 0.9, 1.1], np.float32))
    col = bed * att * 1.15 + wc * (1 - att) * 0.95
    surf = 0.004 * wave_spectrum(rg, 0.05, 0.8, tile, 0, 2.0, 3.0)
    # emergent stepping stones
    st2 = T.Stamper(R, int(0.35 * P), surf, col, np.full(surf.shape, 0.04, np.float32))
    ems = [stone_sprite(rg, rg.uniform(0.12, 0.25) * P, rg.uniform(0.08, 0.14), c, round_=0.8, rough=0.55, lichen=None,
                        elong=rg.uniform(1.0, 1.4)) for c in ("#6e6a62", "#7e786c", "#5e5a52") for _ in range(3)]
    for sp in ems:
        hm = sp["h"] > -1
        rim = hm & (sp["h"] < sp["h"].max() * 0.45)
        sp["col"][rim] = sp["col"][rim] * 0.55
        sp["rough"][rim] = 0.2
    scatter(st2, rg, ems, int(0.12 * tile * tile), zfield=surf - 0.05)
    h, col, rough = st2.result()
    return (col, h, rough), {"extra_json": {"water_role": "ford: albedo pre-bakes the bed seen through water",
                                            "bed_height_note": "use water normal layers on top, alpha ~0.85"}}


@surface(8.0, "Muddy flood water: opaque silt-brown sheet water with foam/scum streaks, drifting twigs and leaves. Colour notes in json; pair with water_normal_a/b for motion.")
def flood_water(rg, tile):
    P = ppm(tile)
    base = T.norm01(T.band(R, rg, 1, 6) + 0.4 * T.band(R, rg, 6, 30))
    col = T.ramp(base, ["#5e4e3a", "#6b5a43", "#786650"])
    foam = T.smoothstep(0.9, 1.6, T.band(R, rg, 2, 16, 1.0, aniso=(3.0, 1.0)) + 0.5 * T.band(R, rg, 16, 80, 1.0, aniso=(3.0, 1.0)))
    col = mix(col, T.hexc("#b0a48c"), 0.7 * foam)
    h = 0.01 * wave_spectrum(rg, 0.1, 3.0, tile, 0, 3.0, 3.4)
    rough = 0.06 + 0.5 * foam
    st = T.Stamper(R, 60, h, col, rough)
    deb = [stick(rg, rg.uniform(0.1, 0.5) * P, rg.uniform(2, 5), 0.01, "#3e3224", "#5a4a34", rough=0.6) for _ in range(8)]
    deb += [T.leaf(rg, int(0.06 * P), 0.04 * P, 0.02 * P, c, height_m=0.01) for c in ("#6a5a2a", "#8a6a34", "#4a4a24") for _ in range(3)]
    scatter(st, rg, deb, int(3 * tile * tile), density=0.2 + foam, zfield=h)
    h, col, rough = st.result()
    return (col, h, rough), {"extra_json": {"water_role": "flood surface albedo (opaque)",
                                            "colour_notes": {"flood_peak": "#6b5a43", "flood_receding": "#7a6a52 with more foam",
                                                             "ditch_standing": "#4e4636", "opacity": "treat as opaque past 0.1 m"}}}


# ================================================================= main
# which js/sim/terrain-types.js ids each texture set serves (first = primary)
SIM = {"mud": ["mud", "battlefield_churn"], "riverbank_mud": ["tidal_mudflat", "stream_bed"], "marsh": ["marsh", "salt_marsh"],
       "shallow_ford": ["shallow_ford", "ford", "stream_bed"], "rock_slab": ["rock_slab", "quarry_floor"],
       "cliff_rock": ["cliff_rock"], "snow_light": ["snow_light", "snow_deep"], "snow_trampled": ["slush", "snow_light"],
       "ice": ["ice", "ice_sheet"], "ditch": ["ditch", "earth_rampart", "earth_bank"], "cobbled_road": ["cobbled_road", "village_street"],
       "water_normal_a": ["deep_water", "moat"], "water_normal_b": ["deep_water", "moat"], "flood_water": ["deep_water"]}

def build(name):
    fn, tile, notes = SURFACES[name]
    rg = T.rng(sum(map(ord, name)) * 104729)
    t0 = time.time()
    (col, h, rough), kw = fn(rg, tile)
    kw = dict(kw)
    nh = kw.pop("normal_h", None)
    extra = {"macro_hint": "tile holds <=4 m structure; add world-space macro tint/variation in the splat shader to break repetition",
             "family": "B-mineral", "sim_terrain": SIM.get(name, [name])}
    extra.update(kw.pop("extra_json", {}))
    T.save_set(name, col, h, rough, tile, notes=notes, normal_h=nh, extra=extra)
    print(f"built {name} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--list" in argv:
        print("SURFACES " + " ".join(SURFACES)); sys.exit(0)
    names = [a for a in argv if not a.startswith("--")] or list(SURFACES)
    for n in names:
        build(n)
