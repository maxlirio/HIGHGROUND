"""Terrain surfaces, catalogue A: VEGETATED / SOFT GROUND.  (terrain agent A)

  blender -b -P assets/src/terrain_surfaces_A.py -- [name ...] [--preview]
  (no names = all).  tools/terrain_make_A.sh runs them in parallel.

Every surface is a numpy generator on the shared periodic toolkit in _terrain_tex.py, so all
of them tile seamlessly. Units: height in metres, tile sizes in metres, colours sRGB.
Scale rule: the tile holds the 0.02-3 m structure (blades, tufts, clods, clover, dry patches,
furrows). Drift above ~3 m must come from the game's macro splat/tint, noted in each json.
"""
import sys, os, math, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import _terrain_tex as T

R = T.RES
SURFACES = {}
# Alternative spellings a sim terrain-type table might use for the same surface.
ALIASES = {"short_meadow": ["meadow", "grass", "meadow_short", "short_grass"], "tall_grass": ["long_grass", "rough_grass", "grass_tall"], "flower_meadow": ["hay_meadow", "wildflower_meadow"], "heath": ["heather", "heathland", "heath_heather"], "moorland": ["moor"], "gorse_scrub": ["scrub", "gorse", "scrubland"], "bracken": ["fern", "ferns"], "grazed_pasture": ["pasture"], "fallow_field": ["fallow"], "ploughed_field": ["ploughed", "plowed_field", "plough", "tilled"], "wheat_field": ["wheat", "standing_wheat", "crops", "cropland"], "barley_field": ["barley"], "stubble_field": ["stubble"], "vineyard": ["vineyard_rows", "vines"], "orchard_grass": ["orchard"], "forest_floor": ["leaf_litter", "forest_floor_oak", "woodland_floor", "deciduous_forest_floor", "forest"], "pine_floor": ["pine_needles", "pine_forest_floor", "conifer_floor"], "moss": ["mossy_ground"], "bramble": ["brambles", "bramble_thicket", "thicket"], "dirt_track": ["track", "dirt_road", "cart_track", "road_dirt"], "churned_ground": ["churned", "trampled", "mud_churned", "trampled_ground"], "bare_earth": ["dirt", "soil", "earth"], "garden_plots": ["gardens", "garden", "vegetable_garden"]}


def surface(tile_m, notes=""):
    def deco(fn):
        SURFACES[fn.__name__] = (fn, tile_m, notes)
        return fn
    return deco


# ================================================================= shared building blocks
def ppm(tile):  # pixels per metre
    return R / tile


def drift_tint(rg, amt_l=0.10, amt_w=0.10, k=(1.5, 6), k2=(6, 16), amt2=0.05):
    """Per-pixel colour multiplier: lightness + warmth drift at two scales. Warm (w>0) goes
    toward straw/ochre, cool (w<0) toward fresh green. Blue is never raised (no violet casts)."""
    l = np.clip(amt_l * T.band(R, rg, *k, beta=0.6) + amt2 * T.band(R, rg, *k2), -0.3, 0.3)
    w = np.clip(amt_w * T.band(R, rg, *k, beta=0.6), -0.3, 0.3)
    wp, wn = np.maximum(w, 0), np.minimum(w, 0)
    m = np.stack([(1 + l) * (1 + 0.9 * wp + 0.8 * wn), (1 + l) * (1 + 0.25 * wp - 0.1 * wn),
                  (1 + l) * (1 - 1.1 * wp + 0.4 * wn)], -1)
    return m.astype(np.float32)


def soil_base(rg, tile, cols=("#4a3a29", "#5a4632", "#6b5a44"), relief=0.012, crumb=0.004, pebbles=0):
    """Bare-soil ground: FBM relief, crumb, colour blotches. returns h, col, rough."""
    h = relief * T.fbm(R, rg, 2, 60, 2.2) + crumb * T.band(R, rg, 60, 400, 0.5)
    t = T.norm01(0.7 * T.band(R, rg, 1, 8, 1.0) + 0.5 * T.fbm(R, rg, 10, 300, 1.2) + 0.3 * T.band(R, rg, 150, 500))
    col = T.ramp(t, list(cols))
    col = col * T.cavity(h, 3)[..., None]
    rough = 0.88 + 0.06 * T.band(R, rg, 3, 30)
    return h.astype(np.float32), col, rough


def tuft_lib(rg, n, S, **kw):
    return [T.blade_tuft(rg, S, **kw) for _ in range(n)]


def scatter(st, rg, lib, n, density=None, zfield=None, tint=None, zjit=0.0, jit=0.05, pts=None):
    if pts is None:
        pts = T.scatter_points(rg, R, n, density)
    for x, y in pts:
        xi, yi = int(x) % R, int(y) % R
        z = (zfield[yi, xi] if zfield is not None else 0.0) + (rg.normal(0, zjit) if zjit else 0.0)
        tn = tint[yi, xi] if tint is not None else np.ones(3, np.float32)
        tn = tn * T.cjit(rg, jit)
        st.stamp(lib[rg.integers(len(lib))], x, y, z=float(z), tint=tn)
    return pts


def noisy_mound(rg, S, radius, height, cols, fine_k=0.35, edge=0.35, stops=None, speck=None, rough=0.8, flat=0.0):
    """A bushy clump (heather, gorse, moss cushion, bramble mass): domed, ragged edge, fine
    colour texture from local noise. radius px, height m."""
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2 + 0.5
    r = np.sqrt(x * x + y * y) / radius
    th = np.arctan2(y, x)
    # ragged outline + interior lumps from small value-noise
    g = rg.standard_normal((S, S)).astype(np.float32)
    g = T.blur(g, max(radius * 0.08, 0.8)); g /= g.std() + 1e-6
    g2 = T.blur(rg.standard_normal((S, S)).astype(np.float32), max(radius * fine_k * 0.15, 0.5)); g2 /= g2.std() + 1e-6
    rr = r * (1 + edge * 0.35 * (np.sin(3 * th + rg.uniform(0, 6)) * 0.5 + 0.5 * np.sin(7 * th + rg.uniform(0, 6)))) + edge * 0.12 * g
    m = rr < 1
    dome = np.sqrt(np.clip(1 - rr * rr, 0, 1)) * (1 - flat) + flat * (rr < 1)
    hh = height * dome * (1 + 0.25 * g2 * (1 - flat * 0.5)) + height * 0.08 * g
    t = T.norm01(0.6 * g2 + 0.4 * g + 0.6 * dome)
    col = T.ramp(t, list(cols), stops)
    if speck is not None:
        sc, frac = speck
        sm = rg.random((S, S)) < frac * dome
        col[sm] = T.hexc(sc) * (1 + rg.normal(0, 0.06, (int(sm.sum()), 3)))
    col = col * (0.72 + 0.28 * dome)[..., None]
    return dict(h=np.where(m, hh, -1e9).astype(np.float32), col=col.astype(np.float32),
                rough=np.full((S, S), rough, np.float32), a=m.astype(np.float32))


def stroke(sp, x0, y0, x1, y1, w0, w1, h0, h1, c0, c1, rough=0.75):
    """Draw a tapered stroke into sprite dict sp with z-buffer."""
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
    c0 = np.asarray(c0, np.float32); c1 = np.asarray(c1, np.float32)
    col = c0 + (c1 - c0) * t[..., None]
    col = col * (1.06 - 0.16 * (d / np.maximum(w, 0.5)))[..., None]
    H[ya:yb, xa:xb][m] = hh[m]
    sp["col"][ya:yb, xa:xb][m] = col[m]
    sp["rough"][ya:yb, xa:xb][m] = rough
    sp["a"][ya:yb, xa:xb][m] = 1


def empty_sprite(S):
    return dict(h=np.full((S, S), -1e9, np.float32), col=np.zeros((S, S, 3), np.float32),
                rough=np.zeros((S, S), np.float32), a=np.zeros((S, S), np.float32))


def paste(dst, src, ox, oy, z=0.0, tint=1.0):
    """Z-buffer paste sprite src into sprite dst at offset (top-left)."""
    sh, sw = src["h"].shape; S = dst["h"].shape[0]
    xa, ya = max(0, ox), max(0, oy); xb, yb = min(S, ox + sw), min(S, oy + sh)
    if xa >= xb or ya >= yb:
        return
    s = (slice(ya - oy, yb - oy), slice(xa - ox, xb - ox)); d = (slice(ya, yb), slice(xa, xb))
    nh = src["h"][s] + z
    m = (src["a"][s] > 0.5) & (nh > dst["h"][d])
    dst["h"][d][m] = nh[m]; dst["col"][d][m] = (src["col"][s] * tint)[m]
    dst["rough"][d][m] = src["rough"][s][m]; dst["a"][d][m] = 1


def clover(rg, S, leaflet_r, col="#4d6b36", height=0.05, flower=None):
    sp = empty_sprite(S)
    a0 = rg.uniform(0, 2 * math.pi)
    for k in range(3):
        a = a0 + k * 2 * math.pi / 3
        b = T.blob(rg, int(leaflet_r * 2.6) + 2, leaflet_r, 0.004, col, rough=0.78, lumpy=0.1, elong=1.15, angle=a, shade=0.2)
        # pale chevron typical of white clover
        yy, xx = np.mgrid[0:b["h"].shape[0], 0:b["h"].shape[0]] - b["h"].shape[0] / 2
        rr = np.sqrt(xx * xx + yy * yy)
        b["col"] = b["col"] * (1 + 0.08 * ((rr > leaflet_r * 0.35) & (rr < leaflet_r * 0.6)))[..., None]
        cx = S / 2 + math.cos(a) * leaflet_r * 0.9; cy = S / 2 + math.sin(a) * leaflet_r * 0.9
        paste(sp, b, int(cx - b["h"].shape[1] / 2), int(cy - b["h"].shape[0] / 2), z=height)
    if flower:
        f = T.blob(rg, int(leaflet_r * 2.4), leaflet_r * 1.0, 0.01, flower, rough=0.7, lumpy=0.3, shade=0.3)
        paste(sp, f, int(S / 2 + rg.normal(0, leaflet_r) - f["h"].shape[1] / 2), int(S / 2 + rg.normal(0, leaflet_r) - f["h"].shape[0] / 2), z=height + 0.03)
    return sp


def flower_head(rg, S, r, petal, centre=None, height=0.3):
    sp = T.blob(rg, S, r, 0.01, petal, rough=0.65, lumpy=0.35, shade=0.15, col_jit=0.04)
    sp["h"] = np.where(sp["a"] > 0, sp["h"] + height, -1e9).astype(np.float32)
    if centre:
        c = T.blob(rg, max(3, S // 2), max(r * 0.35, 0.7), 0.012, centre, rough=0.7, lumpy=0.1)
        paste(sp, c, (S - c["h"].shape[1]) // 2, (S - c["h"].shape[0]) // 2, z=height + 0.005)
    return sp


def finalize(col, h, rough, cav_r=4, cav_lo=0.6, cav_strength=None):
    col = col * T.cavity(h, cav_r, strength=cav_strength, lo=cav_lo)[..., None]
    return col, h, rough


# ================================================================= GRASS FAMILY
def grass_engine(rg, tile, *, base_col, tip_col, dry_col="#a89a60", blade_len_m, blade_w_m=0.006, height_m,
                 tufts_per_m2, under_per_m2, dry_amount=0.15, dry_k=(2, 7), clover_amount=0.0,
                 tint_l=0.10, tint_w=0.08, soil=("#3e3122", "#4b3b29", "#5a4833"), under_col=None,
                 lean=None, dead_frac=0.08, curl=0.3, extra=None):
    P = ppm(tile)
    area = tile * tile
    hs, cs, rs = soil_base(rg, tile, soil, relief=0.01)
    tint = drift_tint(rg, tint_l, tint_w)
    # dry patches field
    dry = T.smoothstep(0.35, 0.9, T.norm01(T.band(R, rg, *dry_k, beta=1.0) + 0.35 * T.band(R, rg, 8, 25))) * dry_amount * 2.2
    dry = np.clip(dry, 0, 1)
    S_t = int(blade_len_m * P * 2.2) + 4
    S_u = int(blade_len_m * 0.55 * P * 2.2) + 4
    bl = blade_len_m * P; bw = max(blade_w_m * P, 1.1)
    uc = under_col or base_col
    green = tuft_lib(rg, 28, S_t, n_blades=14, blade_len=bl, blade_w=bw, height_m=height_m,
                     col_base=base_col, col_tip=tip_col, dead_frac=dead_frac, curl=curl, lean=lean)
    drylib = tuft_lib(rg, 16, S_t, n_blades=12, blade_len=bl, blade_w=bw, height_m=height_m * 0.85,
                      col_base="#6d6a3a", col_tip=dry_col, dead_frac=0.5, col_dead=dry_col, curl=curl, lean=lean)
    under = tuft_lib(rg, 24, S_u, n_blades=9, blade_len=bl * 0.55, blade_w=bw, height_m=height_m * 0.4,
                     col_base=T.lin_to_srgb(T.srgb_to_lin(T.hexc(uc)) * 0.6), col_tip=uc, dead_frac=dead_frac * 1.5, curl=curl * 1.3, lean=lean)
    pad = max(S_t, 40)
    st = T.Stamper(R, pad, hs, cs, rs)
    # under-layer, fills gaps
    scatter(st, rg, under, int(under_per_m2 * area), zfield=hs, tint=tint, zjit=0.004)
    # main tufts: split by dryness
    pts = T.scatter_points(rg, R, int(tufts_per_m2 * area))
    d_at = dry[pts[:, 1].astype(int) % R, pts[:, 0].astype(int) % R]
    isdry = rg.random(len(pts)) < d_at
    scatter(st, rg, green, 0, zfield=hs, tint=tint, zjit=height_m * 0.08, pts=pts[~isdry])
    scatter(st, rg, drylib, 0, zfield=hs, tint=tint, zjit=height_m * 0.05, pts=pts[isdry])
    if clover_amount > 0:
        cf = T.smoothstep(0.55, 0.85, T.norm01(T.band(R, rg, 3, 10, 1.0)))
        cl = [clover(rg, int(0.05 * P) + 6, 0.011 * P, "#3d5c32", height=height_m * 0.45,
                     flower=("#d4cfbc" if rg.random() < 0.12 else None)) for _ in range(20)]
        scatter(st, rg, cl, int(clover_amount * 300 * area), density=cf, zfield=hs, tint=tint, zjit=height_m * 0.1)
    if extra:
        extra(st, rg, P, tint, hs)
    h, col, rough = st.result()
    return h, col, rough, dry


@surface(12.0, "Short meadow grass 5-12 cm: dense sward, tufts, clover patches, a few dry spots.")
def short_meadow(rg, tile):
    h, col, rough, _ = grass_engine(rg, tile, base_col="#34441c", tip_col="#6f8238", dry_col="#a39a62",
                                    blade_len_m=0.09, height_m=0.10, tufts_per_m2=260, under_per_m2=520,
                                    dry_amount=0.10, clover_amount=0.8, tint_l=0.07, tint_w=0.06)
    return finalize(col, h, rough, 3, 0.62), {}


@surface(12.0, "Tall rank grass 40-80 cm, wind-laid swathes, seed heads; strong self-shadowing.")
def tall_grass(rg, tile):
    P = ppm(tile)
    def seeds(st, rg, P, tint, hs):
        sl = []
        for _ in range(16):
            sp = empty_sprite(int(0.14 * P) + 4)
            S = sp["h"].shape[0]; a = rg.uniform(0, 2 * math.pi); L = rg.uniform(0.06, 0.11) * P
            c = T.hexc("#a8956a") * T.cjit(rg, 0.07)
            stroke(sp, S / 2 - math.cos(a) * L / 2, S / 2 - math.sin(a) * L / 2, S / 2 + math.cos(a) * L / 2, S / 2 + math.sin(a) * L / 2,
                   2.2, 1.0, 0.72, 0.78, c * 0.85, c, rough=0.9)
            sl.append(sp)
        scatter(st, rg, sl, int(90 * tile * tile), zfield=hs, tint=tint, zjit=0.03)
    lean = (1.0, 0.35)
    h, col, rough, _ = grass_engine(rg, tile, base_col="#2f3d1a", tip_col="#8a8f48", dry_col="#b3a26b",
                                    blade_len_m=0.30, blade_w_m=0.008, height_m=0.65, tufts_per_m2=55, under_per_m2=110,
                                    dry_amount=0.22, tint_l=0.12, tint_w=0.14, dead_frac=0.18, curl=0.22, extra=seeds)
    return finalize(col, h, rough, 6, 0.5), dict(normal_h=T.blur(h, 1.0), normal_boost=0.35)


@surface(12.0, "Hay meadow in flower: buttercup, ox-eye daisy, red clover, knapweed, a little cornflower, in drifts.")
def flower_meadow(rg, tile):
    def flowers(st, rg, P, tint, hs):
        spec = [("#d9b52a", "#b8921c", 0.012, 0.35, 260), ("#e6e0cc", "#d8a82a", 0.020, 0.45, 140),
                ("#b0557a", None, 0.013, 0.30, 120), ("#7d4d8a", None, 0.015, 0.50, 60), ("#4f6fb0", None, 0.012, 0.42, 20)]
        for petal, centre, r_m, hgt, per_m2 in spec:
            lib = [flower_head(rg, int(r_m * P * 2.6) + 4, r_m * P, petal, centre, height=hgt) for _ in range(8)]
            dens = T.smoothstep(0.35, 0.9, T.norm01(T.band(R, rg, 2, 9, 1.0) + 0.4 * T.band(R, rg, 10, 30)))
            scatter(st, rg, lib, int(per_m2 * tile * tile * 0.5), density=dens, zfield=hs, jit=0.04)
    h, col, rough, _ = grass_engine(rg, tile, base_col="#33431d", tip_col="#7c8a40", dry_col="#aea06a",
                                    blade_len_m=0.20, height_m=0.40, tufts_per_m2=110, under_per_m2=260,
                                    dry_amount=0.08, clover_amount=0.6, tint_w=0.10, extra=flowers)
    return finalize(col, h, rough, 4, 0.58), dict(normal_h=T.blur(h, 0.8), normal_boost=0.5)


@surface(16.0, "Grazed pasture: bitten-down sward, rank tufts round old dung, thistles, trodden paths.")
def grazed_pasture(rg, tile):
    P = ppm(tile)
    def extra(st, rg, P, tint, hs):
        rank = tuft_lib(rg, 12, int(0.35 * P), n_blades=22, blade_len=0.16 * P, blade_w=1.4, height_m=0.2,
                        col_base="#2b3a17", col_tip="#5f7030", dead_frac=0.15)
        centres = rg.random((7, 2)) * R
        for cx, cy in centres:
            pat = T.blob(rg, int(0.4 * P), 0.14 * P, 0.03, "#5a4a32", rough=0.5, lumpy=0.3, shade=0.4)
            st.stamp(pat, cx, cy, z=float(hs[int(cy) % R, int(cx) % R]))
            for _ in range(20):
                a = rg.uniform(0, 2 * math.pi); d = rg.uniform(0.2, 0.45) * P
                st.stamp(rank[rg.integers(12)], cx + math.cos(a) * d, cy + math.sin(a) * d, z=float(hs[int(cy) % R, int(cx) % R]),
                         tint=tint[int(cy) % R, int(cx) % R])
        # thistle rosettes
        th = []
        for _ in range(8):
            sp = empty_sprite(int(0.35 * P))
            S = sp["h"].shape[0]; a0 = rg.uniform(0, 6)
            for k in range(9):
                a = a0 + k * 2 * math.pi / 9 + rg.normal(0, 0.1); L = rg.uniform(0.35, 0.47) * S
                c = T.hexc("#56683f") * T.cjit(rg, 0.05)
                stroke(sp, S / 2, S / 2, S / 2 + math.cos(a) * L, S / 2 + math.sin(a) * L, 5, 1.5, 0.14, 0.06, c * 0.9, c * 1.15, 0.6)
            th.append(sp)
        scatter(st, rg, th, int(0.25 * tile * tile), zfield=hs)
    h, col, rough, _ = grass_engine(rg, tile, base_col="#3a4a1e", tip_col="#6d8038", dry_col="#9d9460",
                                    blade_len_m=0.045, height_m=0.045, tufts_per_m2=520, under_per_m2=700,
                                    dry_amount=0.12, clover_amount=1.4, tint_l=0.09, tint_w=0.06, extra=extra)
    # trodden sheep/cattle paths: meandering low bare lines
    yy, xx = np.mgrid[0:R, 0:R].astype(np.float32)
    path = T.periodic_line_dist(xx + 60 * T.band(R, rg, 1, 3) + 0.35 * yy, R) / P
    pm = T.smoothstep(0.25, 0.08, path)
    h = h - 0.03 * pm
    col = T.mix(col, T.ramp(T.norm01(T.fbm(R, rg, 20, 300)), ["#5a4a34", "#6e6045"]), pm * 0.55)
    return finalize(col, h, rough, 3, 0.62), {}


@surface(12.0, "Orchard sward: lush long grass, cow parsley, windfall apples, fallen leaves.")
def orchard_grass(rg, tile):
    def extra(st, rg, P, tint, hs):
        umb = [noisy_mound(rg, int(0.14 * P), 0.06 * P, 0.04, ["#bdb89e", "#d2cdb4"], edge=0.6, rough=0.7) for _ in range(8)]
        for u in umb:
            u["h"] = np.where(u["a"] > 0, u["h"] + 0.55, -1e9).astype(np.float32)
        dens = T.smoothstep(0.5, 0.9, T.norm01(T.band(R, rg, 2, 8)))
        scatter(st, rg, umb, int(2.5 * tile * tile), density=dens, zfield=hs)
        apples = [T.blob(rg, int(0.09 * P), 0.035 * P, 0.07, c, rough=0.45, lumpy=0.05, shade=0.45)
                  for c in ("#8e3b24", "#a8612c", "#9c8a36", "#6b3a22")]
        # windfalls cluster under (off-tile) trees
        dens2 = T.smoothstep(0.55, 0.95, T.norm01(T.band(R, rg, 1, 4)))
        scatter(st, rg, apples, int(1.2 * tile * tile), density=dens2, zfield=hs, jit=0.1)
        lv = [T.leaf(rg, int(0.08 * P), 0.06 * P, 0.035 * P, c, height_m=0.2) for c in ("#8a7a3a", "#6f7a34", "#9a6a34")]
        scatter(st, rg, lv, int(6 * tile * tile), density=dens2, zfield=hs)
    h, col, rough, _ = grass_engine(rg, tile, base_col="#2e3f1b", tip_col="#6c8238", dry_col="#a39a62",
                                    blade_len_m=0.22, height_m=0.35, tufts_per_m2=100, under_per_m2=240,
                                    dry_amount=0.05, clover_amount=0.4, tint_w=0.06, extra=extra)
    return finalize(col, h, rough, 4, 0.55), dict(normal_h=T.blur(h, 0.8), normal_boost=0.5)


# ================================================================= HEATH / MOOR / SCRUB
@surface(12.0, "Heather heath in bloom: dusky purple-brown heather clumps, sandy-peat gaps, wiry grass.")
def heath(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#3a2e24", "#54463a", "#7a6a55"), relief=0.015)
    st = T.Stamper(R, 110, hs, cs, rs)
    tint = drift_tint(rg, 0.1, 0.06)
    wiry = tuft_lib(rg, 16, int(0.2 * P), n_blades=10, blade_len=0.08 * P, blade_w=1.1, height_m=0.12,
                    col_base="#3f4526", col_tip="#8a8a55", dead_frac=0.4, col_dead="#9a8f68")
    scatter(st, rg, wiry, int(180 * tile * tile), zfield=hs, tint=tint)
    bloom = [noisy_mound(rg, int(0.7 * P), rg.uniform(0.16, 0.3) * P, rg.uniform(0.2, 0.35),
                         ["#3a2e2c", "#5a4246", "#7a5660", "#8e6a72"], edge=0.5, speck=("#a47a88", 0.05)) for _ in range(12)]
    green = [noisy_mound(rg, int(0.6 * P), rg.uniform(0.14, 0.26) * P, rg.uniform(0.15, 0.3),
                         ["#2f3322", "#4a4b2f", "#5f5a3a", "#6b5f4a"], edge=0.5) for _ in range(8)]
    dead = [noisy_mound(rg, int(0.6 * P), rg.uniform(0.14, 0.26) * P, rg.uniform(0.12, 0.25),
                        ["#3e3328", "#5c4a3a", "#7a6650"], edge=0.6) for _ in range(6)]
    cover = T.norm01(T.band(R, rg, 2, 8) + 0.5 * T.band(R, rg, 8, 20))
    dens = T.smoothstep(0.15, 0.55, cover)
    pts = T.scatter_points(rg, R, int(26 * tile * tile), dens)
    kind = rg.random(len(pts))
    scatter(st, rg, bloom, 0, zfield=hs, tint=tint, pts=pts[kind < 0.62], jit=0.07)
    scatter(st, rg, green, 0, zfield=hs, tint=tint, pts=pts[(kind >= 0.62) & (kind < 0.88)])
    scatter(st, rg, dead, 0, zfield=hs, tint=tint, pts=pts[kind >= 0.88])
    h, col, rough = st.result()
    return finalize(col, h, rough, 6, 0.5), dict(normal_h=T.blur(h, 0.8), normal_boost=0.5)


@surface(16.0, "Upland moorland: tussocky moor-grass (tawny), rushes, patches of heather and sphagnum, dark peat.")
def moorland(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#2a2119", "#3a2d22", "#4a3b2c"), relief=0.03)
    tint = drift_tint(rg, 0.12, 0.10)
    st = T.Stamper(R, 90, hs, cs, rs)
    tuss = tuft_lib(rg, 20, int(0.5 * P), n_blades=26, blade_len=0.2 * P, blade_w=1.3, height_m=0.4,
                    col_base="#4a4428", col_tip="#a8955e", dead_frac=0.45, col_dead="#b39f70", curl=0.35)
    scatter(st, rg, tuss, int(24 * tile * tile), zfield=hs, tint=tint)
    grass = tuft_lib(rg, 16, int(0.24 * P), n_blades=10, blade_len=0.09 * P, blade_w=1.1, height_m=0.14,
                     col_base="#3c4224", col_tip="#8a8452", dead_frac=0.4, col_dead="#9d8c62")
    scatter(st, rg, grass, int(170 * tile * tile), zfield=hs, tint=tint)
    # rush clumps: dark green spiky
    rush = tuft_lib(rg, 8, int(0.36 * P), n_blades=30, blade_len=0.15 * P, blade_w=1.1, height_m=0.5,
                    col_base="#26331a", col_tip="#4b5a2c", curl=0.08, dead_frac=0.1)
    wet = T.norm01(T.band(R, rg, 1, 5, 1.0))
    scatter(st, rg, rush, int(1.2 * tile * tile), density=T.smoothstep(0.5, 0.9, wet), zfield=hs)
    heather = [noisy_mound(rg, int(0.55 * P), rg.uniform(0.14, 0.24) * P, 0.2,
                           ["#2e2826", "#4a3a3a", "#5e4a4c"], edge=0.5) for _ in range(8)]
    scatter(st, rg, heather, int(5 * tile * tile), density=T.smoothstep(0.55, 0.2, wet), zfield=hs)
    sph = [noisy_mound(rg, int(0.5 * P), rg.uniform(0.12, 0.2) * P, 0.05,
                       ["#6c7a3a", "#8f8e44", "#a37b4a"], edge=0.3, flat=0.6, rough=0.55) for _ in range(6)]
    scatter(st, rg, sph, int(2.5 * tile * tile), density=T.smoothstep(0.6, 0.95, wet), zfield=hs)
    h, col, rough = st.result()
    return finalize(col, h, rough, 6, 0.5), dict(normal_h=T.blur(h, 0.8), normal_boost=0.5)


@surface(12.0, "Gorse scrub: dark spiny gorse bushes speckled yellow, sandy bare ground, rough grass.")
def gorse_scrub(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#5a4a36", "#7a6648", "#8f7a58"), relief=0.02, crumb=0.005)
    tint = drift_tint(rg, 0.1, 0.08)
    st = T.Stamper(R, 160, hs, cs, rs)
    grass = tuft_lib(rg, 16, int(0.26 * P), n_blades=12, blade_len=0.1 * P, blade_w=1.1, height_m=0.2,
                     col_base="#3f4726", col_tip="#8e8c55", dead_frac=0.35, col_dead="#a8996a")
    scatter(st, rg, grass, int(90 * tile * tile), zfield=hs, tint=tint)
    # bushes are built from many small overlapping olive-green domes clustered by a density field,
    # so outlines are soft and organic instead of stamped blobs
    pal = [["#2e3a1e", "#44522a", "#5a6634", "#6e7440"], ["#34401f", "#4c5a2c", "#62703a"], ["#3a4424", "#56602e", "#707a3e"]]
    gorse = []
    for _ in range(18):
        g = noisy_mound(rg, int(0.9 * P), rg.uniform(0.15, 0.38) * P, rg.uniform(0.4, 0.9), pal[rg.integers(3)],
                        edge=0.6, speck=("#e0b83a", rg.uniform(0.08, 0.2)), rough=0.8)
        dm = (rg.random(g["h"].shape) < 0.02) & (g["a"] > 0)
        g["col"][dm] = T.hexc("#7a6a44")  # dead brown spines
        gorse.append(g)
    cover = T.norm01(T.band(R, rg, 2, 7, 0.8) + 0.45 * T.band(R, rg, 7, 20))
    dens = T.smoothstep(0.45, 0.8, cover)
    scatter(st, rg, gorse, int(9 * tile * tile), density=dens, zfield=hs + 0.5 * dens, tint=tint, jit=0.06)
    # bush fringe: young gorse + bramble-ish scrub at the edges
    small = [noisy_mound(rg, int(0.4 * P), rg.uniform(0.07, 0.15) * P, 0.25, pal[rg.integers(3)], edge=0.6,
                         speck=("#d9b43a", 0.03)) for _ in range(10)]
    scatter(st, rg, small, int(6 * tile * tile), density=T.smoothstep(0.3, 0.5, cover) * T.smoothstep(0.7, 0.5, cover), zfield=hs, tint=tint)
    h, col, rough = st.result()
    return finalize(col, h, rough, 6, 0.6), dict(normal_h=T.blur(h, 1.0), normal_boost=0.35)


@surface(10.0, "Bracken stand in summer: overlapping pinnate fronds, a few browning, dark litter below.")
def bracken(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#3a2c1e", "#4d3a28", "#6a5236"), relief=0.01)
    st = T.Stamper(R, 130, hs, cs, rs)
    tint = drift_tint(rg, 0.1, 0.10)
    # old dead fronds on the floor
    def frond(S, L, stem_c, leaf_c, H0, dead=False):
        sp = empty_sprite(S)
        a = rg.uniform(0, 2 * math.pi); c = S / 2
        x0, y0 = c - math.cos(a) * L / 2, c - math.sin(a) * L / 2
        n = 16; px, py = x0, y0; ang = a
        lc = T.hexc(leaf_c) * T.cjit(rg, 0.06)
        for i in range(n):
            t = i / n
            ang += rg.normal(0, 0.04)
            nx, ny = px + math.cos(ang) * L / n, py + math.sin(ang) * L / n
            hh = H0 * (0.6 + 0.4 * math.sin(math.pi * (0.2 + 0.7 * t)))
            stroke(sp, px, py, nx, ny, 1.8, 1.4, hh + 0.01, hh + 0.01, T.hexc(stem_c), T.hexc(stem_c), 0.6)
            pl = L * 0.26 * math.sin(math.pi * (0.12 + 0.88 * t)) ** 0.8 * (1 - 0.3 * t)
            for side in (-1, 1):
                pa = ang + side * (math.pi / 2 - 0.35)
                ex, ey = px + math.cos(pa) * pl, py + math.sin(pa) * pl
                # pinna: a fat tapered strip with pinnule scallops
                stroke(sp, px, py, ex, ey, max(L * 0.055, 2.5), 1.0, hh, hh - 0.06, lc * 0.82, lc * 1.12, 0.65)
                # pinnules = small side strokes, give the fern texture
                m = max(3, int(pl / 3.5))
                for j in range(1, m):
                    tt = j / m; qx, qy = px + (ex - px) * tt, py + (ey - py) * tt
                    ql = max(L * 0.045 * (1 - tt), 1.2)
                    for s2 in (-1, 1):
                        qa = pa + s2 * 1.0
                        stroke(sp, qx, qy, qx + math.cos(qa) * ql, qy + math.sin(qa) * ql, 1.8, 0.8, hh - 0.02 * tt, hh - 0.03 - 0.03 * tt,
                               lc * 0.9, lc * (1.05 + 0.1 * tt), 0.65)
            px, py = nx, ny
        return sp
    L = 0.75 * P
    green = [frond(int(L * 1.25), L * rg.uniform(0.75, 1.0), "#6e7a3c", rg.choice(["#4c6a28", "#56722c", "#4a6224"]), rg.uniform(0.7, 1.0)) for _ in range(12)]
    brown = [frond(int(L * 1.25), L * rg.uniform(0.7, 1.0), "#7a5a34", rg.choice(["#8c6232", "#9a7440", "#7a6a38"]), rg.uniform(0.5, 0.8)) for _ in range(5)]
    floor_ = [frond(int(L * 1.25), L * rg.uniform(0.7, 1.0), "#5a4630", "#6e5236", 0.05) for _ in range(4)]
    scatter(st, rg, floor_, int(4 * tile * tile), zfield=hs)
    pts = T.scatter_points(rg, R, int(9 * tile * tile))
    brownish = T.norm01(T.band(R, rg, 1, 5, 1.0))
    bmask = rg.random(len(pts)) < 0.25 + 0.4 * T.smoothstep(0.6, 1.0, brownish[pts[:, 1].astype(int), pts[:, 0].astype(int)])
    scatter(st, rg, green, 0, zfield=hs, tint=tint, pts=pts[~bmask], zjit=0.08)
    scatter(st, rg, brown, 0, zfield=hs, tint=tint, pts=pts[bmask], zjit=0.08)
    h, col, rough = st.result()
    return finalize(col, h, rough, 5, 0.5), dict(normal_h=T.blur(h, 1.0), normal_boost=0.35)


@surface(10.0, "Bramble thicket: mounded compound leaves, arching purple-red canes, dead leaves, fruit.")
def bramble(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#33271c", "#45362a", "#5a4632"), relief=0.01)
    st = T.Stamper(R, 90, hs, cs, rs)
    tint = drift_tint(rg, 0.1, 0.06)
    # the mound envelope: height field of the thicket, leaves ride on it
    env = 0.9 * T.smoothstep(0.25, 0.75, T.norm01(T.band(R, rg, 2, 6, 1.0) + 0.4 * T.band(R, rg, 6, 14)))
    leaves = []
    for _ in range(24):
        sp = empty_sprite(int(0.2 * P))
        S = sp["h"].shape[0]; a0 = rg.uniform(0, 6)
        c = T.hexc(rg.choice(["#3a5226", "#44592a", "#3d5428", "#51612e"])) * T.cjit(rg, 0.05)
        if rg.random() < 0.1:
            c = T.hexc("#7a3a2a")  # autumn-reddened leaf
        for k in range(rg.choice([3, 5])):
            a = a0 + (k - 1) * 0.9
            lf = T.leaf(rg, int(0.09 * P), 0.07 * P, 0.045 * P, c, height_m=0.02, rough=0.55)
            paste(sp, lf, int(S / 2 + math.cos(a) * 0.03 * P - lf["h"].shape[1] / 2),
                  int(S / 2 + math.sin(a) * 0.03 * P - lf["h"].shape[0] / 2), z=rg.uniform(0, 0.02))
        leaves.append(sp)
    canes = []
    for _ in range(8):
        sp = empty_sprite(int(0.9 * P)); S = sp["h"].shape[0]
        a = rg.uniform(0, 6); L = S * 0.45
        pts = [(S / 2 - math.cos(a) * L, S / 2 - math.sin(a) * L)]
        for i in range(8):
            a += rg.normal(0, 0.15)
            pts.append((pts[-1][0] + math.cos(a) * 2 * L / 8, pts[-1][1] + math.sin(a) * 2 * L / 8))
        for i in range(8):
            t0, t1 = i / 8, (i + 1) / 8
            stroke(sp, *pts[i], *pts[i + 1], 3.0, 3.0, 0.15 * math.sin(math.pi * t0) + 0.05, 0.15 * math.sin(math.pi * t1) + 0.05,
                   T.hexc("#5a2c30"), T.hexc("#7a4038"), 0.5)
        canes.append(sp)
    dead = [T.leaf(rg, int(0.09 * P), 0.07 * P, 0.045 * P, c, height_m=0.01) for c in ("#6a5236", "#7a5e3a", "#5a4630")]
    scatter(st, rg, dead, int(40 * tile * tile), zfield=hs)
    scatter(st, rg, canes, int(1.2 * tile * tile), zfield=hs + env * 0.8)
    dens = T.smoothstep(0.02, 0.2, env)
    scatter(st, rg, leaves, int(150 * tile * tile), density=dens, zfield=hs + env, tint=tint, zjit=0.04)
    berries = [T.blob(rg, int(0.03 * P) + 3, 0.009 * P, 0.02, c, rough=0.3, shade=0.5) for c in ("#2a1c26", "#3a2030", "#7a2a2a")]
    scatter(st, rg, berries, int(8 * tile * tile), density=dens, zfield=hs + env + 0.05)
    h, col, rough = st.result()
    return finalize(col, h, rough, 8, 0.45), dict(normal_h=T.blur(h, 1.0), normal_boost=0.35)


# ================================================================= ARABLE
def furrow_field(rg, tile, n_rows, depth, soil_cols, clods=True, wobble=6.0, weeds=0):
    """Ploughed furrows along +Y (image rows = x... furrows run vertically in the image).
    n_rows must be integer so the tile wraps."""
    P = ppm(tile)
    yy, xx = np.mgrid[0:R, 0:R].astype(np.float32)
    wob = wobble * T.band(R, rg, 1, 3, 1.0)
    u = (xx + wob) * n_rows / R  # furrow coordinate
    ph = u - np.floor(u)
    # asymmetric mouldboard profile: steep turned face, gentle back
    prof = np.where(ph < 0.62, np.sin(ph / 0.62 * math.pi / 2), np.cos((ph - 0.62) / 0.38 * math.pi / 2))
    prof = prof ** 1.3
    # the turned slice breaks into segments along its length
    seg = T.band(R, rg, 8, 40, 1.0, aniso=(1.0, 0.25))
    h = depth * (prof * (0.8 + 0.2 * seg)) + 0.012 * T.fbm(R, rg, 4, 300, 1.8)
    t = T.norm01(0.6 * T.band(R, rg, 1, 6, 1.0) + 0.4 * T.fbm(R, rg, 8, 300, 1.2) + 0.5 * prof)
    col = T.ramp(t, list(soil_cols))
    rough = 0.9 - 0.08 * (1 - prof)
    st = T.Stamper(R, 40, h, col, rough)
    if clods:
        cl = [T.blob(rg, int(0.12 * P), rg.uniform(0.02, 0.05) * P, rg.uniform(0.02, 0.05), rg.choice(soil_cols[1:]),
                     lumpy=0.4, shade=0.35, rough=0.92) for _ in range(20)]
        dens = np.clip(prof, 0.05, 1) ** 2
        scatter(st, rg, cl, int(55 * tile * tile), density=dens, zfield=h - 0.01, jit=0.06)
    if weeds:
        wl = tuft_lib(rg, 10, int(0.12 * P), n_blades=7, blade_len=0.04 * P, blade_w=1.2, height_m=0.05,
                      col_base="#3e4a22", col_tip="#6f7e3a")
        scatter(st, rg, wl, int(weeds * tile * tile), zfield=h)
    h, col, rough = st.result()
    return h, col, rough


@surface(12.0, "Freshly ploughed strip: 33 mouldboard furrows per tile (~36 cm), real 16 cm relief, clods. UV V = furrow direction.")
def ploughed_field(rg, tile):
    h, col, rough = furrow_field(rg, tile, 33, 0.16, ("#3a2c1f", "#4e3b29", "#634c34", "#76603f"))
    return finalize(col, h, rough, 5, 0.5), dict(displace_m=float(h.max() - h.min()))


@surface(16.0, "Fallow field: weedy patchy regrowth over old furrow traces, docks, thistles, bare patches.")
def fallow_field(rg, tile):
    P = ppm(tile)
    h0, c0, r0 = furrow_field(rg, tile, 44, 0.05, ("#4a3a2a", "#5a4632", "#6b5840"), clods=False)
    tint = drift_tint(rg, 0.12, 0.14)
    cover = T.norm01(T.band(R, rg, 2, 8, 1.0) + 0.5 * T.band(R, rg, 8, 24))
    st = T.Stamper(R, 90, h0, c0, r0)
    grass = tuft_lib(rg, 20, int(0.22 * P), n_blades=11, blade_len=0.09 * P, blade_w=1.2, height_m=0.15,
                     col_base="#3a4520", col_tip="#7d8440", dead_frac=0.3, col_dead="#a3935f")
    scatter(st, rg, grass, int(260 * tile * tile), density=T.smoothstep(0.2, 0.6, cover), zfield=h0, tint=tint)
    docks = []
    for _ in range(10):
        sp = empty_sprite(int(0.5 * P)); S = sp["h"].shape[0]; a0 = rg.uniform(0, 6)
        c = T.hexc(rg.choice(["#3a5226", "#4a5a2a", "#5a5a2c"]))
        for k in range(rg.integers(5, 9)):
            lf = T.leaf(rg, int(0.3 * P), rg.uniform(0.14, 0.22) * P, 0.07 * P, c, height_m=0.12, rough=0.55)
            a = a0 + k * 0.8
            paste(sp, lf, int(S / 2 + math.cos(a) * 0.07 * P - lf["h"].shape[1] / 2), int(S / 2 + math.sin(a) * 0.07 * P - lf["h"].shape[0] / 2), z=rg.uniform(0, 0.05))
        docks.append(sp)
    scatter(st, rg, docks, int(1.5 * tile * tile), density=T.smoothstep(0.3, 0.7, cover), zfield=h0, tint=tint)
    fathen = [noisy_mound(rg, int(0.3 * P), rg.uniform(0.07, 0.12) * P, 0.35, ["#3f4f30", "#56664a", "#6e7a5a"], edge=0.6) for _ in range(8)]
    scatter(st, rg, fathen, int(3 * tile * tile), density=cover, zfield=h0, tint=tint)
    h, col, rough = st.result()
    return finalize(col, h, rough, 4, 0.55), dict(normal_h=T.blur(h, 0.8), normal_boost=0.5)


def ear_sprite(rg, L, W, col, height, awn=0.0, lean=None, droop=0.0):
    """Cereal ear seen from above: spikelet-segmented spindle, optional awns."""
    S = int(L * (1 + awn * 1.6)) + 6
    sp = empty_sprite(S)
    a = rg.uniform(0, 2 * math.pi) if lean is None else lean + rg.normal(0, 0.45)
    c = S / 2; ca, sa = math.cos(a), math.sin(a)
    base = T.hexc(col) * T.cjit(rg, 0.06)
    n = 9
    for i in range(n):
        t = (i + 0.5) / n
        px, py = c + ca * (t - 0.5) * L, c + sa * (t - 0.5) * L
        w = W * (0.55 + 0.45 * math.sin(math.pi * (0.15 + 0.8 * t)))
        for side in (-1, 1):
            ox, oy = -sa * side * w * 0.28, ca * side * w * 0.28
            b = T.blob(rg, int(W * 1.6) + 3, w * 0.42, 0.006, base * (0.92 + 0.12 * (side > 0)), rough=0.7, lumpy=0.1, elong=1.5, angle=a, shade=0.35, col_jit=0.03)
            paste(sp, b, int(px + ox - b["h"].shape[1] / 2), int(py + oy - b["h"].shape[0] / 2), z=height - droop * t)
        if awn:
            for side in (-1, 1):
                aa = a + side * 0.25 + rg.normal(0, 0.06)
                stroke(sp, px, py, px + math.cos(aa) * L * awn, py + math.sin(aa) * L * awn, 0.9, 0.6,
                       height + 0.004, height - 0.02, base * 1.05, base * 1.18, 0.75)
    return sp


def cereal(rg, tile, *, ear_col, straw_col, leaf_col, ear_len_m, ear_w_m, awn, ears_per_m2, lodged=0.1,
           weeds=True, lean_amt=0.6, height=1.0, droop=0.0):
    P = ppm(tile)
    # the ground under a standing crop is straw litter + shaded stems, not bare soil
    hs, cs, rs = soil_base(rg, tile, (T.hexc(straw_col) * 0.45, T.hexc(straw_col) * 0.58, T.hexc(straw_col) * 0.7), relief=0.01)
    tint = drift_tint(rg, 0.07, 0.07)
    st = T.Stamper(R, 60, hs, cs, rs)
    # stems + leaves underneath: straw/green blades lower down
    under = tuft_lib(rg, 20, int(0.2 * P), n_blades=8, blade_len=0.1 * P, blade_w=1.3, height_m=height * 0.75,
                     col_base=leaf_col, col_tip=straw_col, dead_frac=0.3, col_dead=straw_col, curl=0.15)
    scatter(st, rg, under, int(ears_per_m2 * 0.4 * tile * tile), zfield=hs, tint=tint, zjit=0.04)
    # wind direction field (periodic) — swirled ear orientation gives the "combed" look
    wind = 0.6 + lean_amt * T.band(R, rg, 1, 3, 1.0)
    lodge = T.smoothstep(0.7, 0.95, T.norm01(T.band(R, rg, 2, 6, 1.0))) * (lodged * 5)
    ears = {}
    nb = 12
    for b in range(nb):
        ang = -math.pi + 2 * math.pi * b / nb
        ears[b] = [ear_sprite(rg, ear_len_m * P * rg.uniform(0.8, 1.1), ear_w_m * P, ear_col, height, awn, lean=ang, droop=droop) for _ in range(5)]
    pts = T.scatter_points(rg, R, int(ears_per_m2 * tile * tile))
    for x, y in pts:
        xi, yi = int(x) % R, int(y) % R
        ang = wind[yi, xi] * 2.0
        if rg.random() < 0.35:
            ang = rg.uniform(-math.pi, math.pi)  # individual stems vary
        b = int(((ang + math.pi) / (2 * math.pi)) * nb) % nb
        lz = lodge[yi, xi]
        z = hs[yi, xi] - lz * 0.6 + rg.normal(0, 0.05)
        tn = tint[yi, xi] * T.cjit(rg, 0.05) * (1 - 0.1 * lz)
        st.stamp(ears[b][rg.integers(5)], x, y, z=float(z) - height * 0.0, tint=tn)
    if weeds:
        pop = [flower_head(rg, int(0.06 * P) + 4, 0.022 * P, "#a8322f", "#2a2020", height=height + 0.05) for _ in range(6)]
        corn = [flower_head(rg, int(0.05 * P) + 4, 0.015 * P, "#4a64a8", None, height=height + 0.03) for _ in range(4)]
        dens = T.smoothstep(0.6, 0.95, T.norm01(T.band(R, rg, 1, 5)))
        scatter(st, rg, pop, int(0.8 * tile * tile), density=dens, zfield=hs)
        scatter(st, rg, corn, int(0.4 * tile * tile), zfield=hs)
    h, col, rough = st.result()
    return h, col, rough


@surface(10.0, "Standing ripe wheat from above: dense golden ears combed by wind, lodged patches, poppies/cornflowers.")
def wheat_field(rg, tile):
    h, col, rough = cereal(rg, tile, ear_col="#cfa95c", straw_col="#b99a55", leaf_col="#9a8a48",
                           ear_len_m=0.085, ear_w_m=0.015, awn=0.0, ears_per_m2=520, lodged=0.12)
    return finalize(col, h, rough, 3, 0.72), dict(normal_h=T.blur(h, 0.8), normal_boost=0.5)


@surface(10.0, "Ripe barley: paler silky ears with long awns, nodding, stronger wind combing.")
def barley_field(rg, tile):
    h, col, rough = cereal(rg, tile, ear_col="#c2b07c", straw_col="#b3a172", leaf_col="#948a58",
                           ear_len_m=0.065, ear_w_m=0.012, awn=0.9, ears_per_m2=480, lodged=0.1, lean_amt=0.4,
                           height=0.8, droop=0.04)
    return finalize(col, h, rough, 3, 0.75), dict(normal_h=T.blur(h, 0.8), normal_boost=0.5)


@surface(12.0, "Sickle-cut stubble: pale straw stalks, fallen straw, soil between, green weed regrowth.")
def stubble_field(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#4d3c2a", "#5e4a34", "#6f5a40"), relief=0.012)
    st = T.Stamper(R, 50, hs, cs, rs)
    tint = drift_tint(rg, 0.08, 0.06)
    stalks = []
    for _ in range(20):
        S = int(0.07 * P) + 4; sp = empty_sprite(S)
        for k in range(rg.integers(3, 7)):  # a cut clump: several stubs
            b = T.blob(rg, 7, rg.uniform(1.4, 2.2), 0.01, T.hexc("#cbb37a") * T.cjit(rg, 0.06), rough=0.8, lumpy=0.0, shade=0.1)
            b["col"][2:5, 2:5] *= 0.55  # hollow stem end
            paste(sp, b, int(S / 2 + rg.normal(0, S * 0.18)) - 3, int(S / 2 + rg.normal(0, S * 0.18)) - 3, z=rg.uniform(0.1, 0.2))
        stalks.append(sp)
    straw = []
    for _ in range(24):
        S = int(0.3 * P); sp = empty_sprite(S); a = rg.uniform(0, 6); L = rg.uniform(0.12, 0.28) * P
        c = T.hexc(rg.choice(["#c9b27a", "#b8a068", "#d4c08c", "#a89060"]))
        stroke(sp, S / 2 - math.cos(a) * L / 2, S / 2 - math.sin(a) * L / 2, S / 2 + math.cos(a) * L / 2, S / 2 + math.sin(a) * L / 2,
               2.0, 1.6, 0.02, 0.025, c * 0.95, c * 1.05, 0.8)
        straw.append(sp)
    scatter(st, rg, straw, int(260 * tile * tile), density=T.norm01(T.band(R, rg, 2, 10)) * 0.8 + 0.2, zfield=hs, tint=tint)
    scatter(st, rg, stalks, int(150 * tile * tile), zfield=hs, tint=tint)
    weeds = tuft_lib(rg, 10, int(0.12 * P), n_blades=8, blade_len=0.05 * P, blade_w=1.3, height_m=0.08, col_base="#34461e", col_tip="#6a803a")
    scatter(st, rg, weeds, int(25 * tile * tile), density=T.smoothstep(0.5, 0.9, T.norm01(T.band(R, rg, 2, 8))), zfield=hs)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.62), {}


@surface(12.0, "Vineyard floor: 6 rows per tile (2 m spacing) of hoed stony soil under the vines, grassy alleys with a trodden line. Vines themselves are 3D. UV V = row direction.")
def vineyard(rg, tile):
    P = ppm(tile)
    yy, xx = np.mgrid[0:R, 0:R].astype(np.float32)
    rows = 6
    u = (xx + 4 * T.band(R, rg, 1, 3)) * rows / R
    d = np.abs(u - np.floor(u) - 0.5) * (tile / rows)  # metres from row centre
    strip = T.smoothstep(0.42, 0.28, d + 0.05 * T.band(R, rg, 10, 60))
    hs, cs, rs = soil_base(rg, tile, ("#6a5238", "#7d6444", "#937a58"), relief=0.012, crumb=0.006)
    hs = hs + 0.05 * strip * (1 - (d / 0.4) ** 2).clip(0, 1)  # slightly ridged under the vines
    st = T.Stamper(R, 60, hs, cs, rs)
    tint = drift_tint(rg, 0.1, 0.12)
    stones = [T.blob(rg, int(0.07 * P) + 3, rg.uniform(0.008, 0.025) * P, 0.02, rg.choice(["#a89c86", "#8f8574", "#b5aa92"]), lumpy=0.3, shade=0.3) for _ in range(20)]
    scatter(st, rg, stones, int(80 * tile * tile), density=0.3 + 0.7 * strip, zfield=hs)
    grass = tuft_lib(rg, 20, int(0.2 * P), n_blades=10, blade_len=0.08 * P, blade_w=1.2, height_m=0.12,
                     col_base="#3d4a22", col_tip="#8a8c4a", dead_frac=0.3, col_dead="#aa9a66")
    alley_centre = np.abs(d - tile / rows / 2)  # trodden middle of alley
    dens = (1 - strip) * (0.35 + 0.65 * T.smoothstep(0.08, 0.3, alley_centre)) * (0.6 + 0.4 * T.norm01(T.band(R, rg, 3, 12)))
    scatter(st, rg, grass, int(260 * tile * tile), density=dens, zfield=hs, tint=tint)
    lv = [T.leaf(rg, int(0.1 * P), 0.08 * P, 0.07 * P, c, height_m=0.01, lobes=3) for c in ("#6f7a34", "#8a7a3a", "#9a5a30")]
    scatter(st, rg, lv, int(6 * tile * tile), density=strip, zfield=hs)
    h, col, rough = st.result()
    return finalize(col, h, rough, 4, 0.58), {}


@surface(16.0, "Cottage garden plots: beds of cabbages, leeks/onions, beans, a dug bed, divided by trodden paths with wattle edging.")
def garden_plots(rg, tile):
    P = ppm(tile)
    yy, xx = np.mgrid[0:R, 0:R].astype(np.float32)
    hs, cs, rs = soil_base(rg, tile, ("#3a2c20", "#4a3828", "#5a4632"), relief=0.01)
    # irregular beds: 3 columns of unequal width, each split into beds at its own rows (period = tile)
    wx = xx + 0.18 * P * T.band(R, rg, 1, 4) + 0.03 * P * T.band(R, rg, 8, 20)
    wy = yy + 0.18 * P * T.band(R, rg, 1, 4) + 0.03 * P * T.band(R, rg, 8, 20)
    xm = np.mod(wx, R) / P; ym = np.mod(wy, R) / P
    # 5 columns of unequal width; each column splits into beds at its own rows
    colb = np.array([0.0, 2.6, 5.9, 8.3, 12.2, tile])
    rowb = [np.array([0, 3.4, 7.5, 11.0, tile]), np.array([0, 2.2, 6.9, 12.5, tile]), np.array([0, 4.4, 9.8, tile]),
            np.array([0, 1.8, 5.5, 8.4, 13.1, tile]), np.array([0, 3.0, 8.9, 12.0, tile])]
    nc = len(colb) - 1
    ci = np.clip(np.searchsorted(colb, xm, side="right") - 1, 0, nc - 1)
    dxe = np.minimum(xm - colb[ci], colb[ci + 1] - xm)
    ri = np.zeros_like(ci); dye = np.zeros_like(xm)
    for c in range(nc):
        rb = rowb[c]; m = ci == c
        r_ = np.clip(np.searchsorted(rb, ym, side="right") - 1, 0, len(rb) - 2)
        ri[m] = r_[m]; dye[m] = np.minimum(ym - rb[r_], rb[r_ + 1] - ym)[m]
    # crop per bed: 0 cabbage, 1 leek/onion, 2 beans, 3 dug, 4 herbs/grass, 5 cabbage-in-rows-across
    crops = {}
    seq = [0, 1, 3, 2, 4, 1, 0, 3, 5, 2, 1, 4, 3, 0, 2, 5, 1, 3, 0, 4]
    k = 0
    for c in range(nc):
        for r_ in range(len(rowb[c]) - 1):
            crops[(c, r_)] = seq[k % len(seq)]; k += 1
    bid = np.zeros_like(ci)
    for (c, r_), kk in crops.items():
        bid[(ci == c) & (ri == r_)] = kk
    edge = np.minimum(dxe, dye)  # m from bed edge
    path = T.smoothstep(0.34, 0.26, edge)
    bed = 1 - path
    hs = hs + 0.07 * T.smoothstep(0.28, 0.45, edge) - 0.02 * path
    pcol = T.ramp(T.norm01(T.fbm(R, rg, 10, 300)), ["#5e4c38", "#76644a", "#8a7658"])
    col = T.mix(cs, pcol, path)
    rough = rs
    # wattle edging at the bed rim: woven rods -> alternating bumps along the edge
    along = np.where(dxe < dye, wy, wx)
    edged = ((ci * 7 + ri * 3) % 3 == 0)  # only some beds have wattle edging; others just a dug lip
    wat = T.smoothstep(0.05, 0.0, np.abs(edge - 0.31)) * (0.6 + 0.4 * (np.sin(along * 1.2) > 0)) * edged
    hs = hs + 0.12 * wat
    col = T.mix(col, T.hexc("#6e5a3e") * (0.8 + 0.3 * T.norm01(T.band(R, rg, 50, 200)))[..., None], wat)
    st = T.Stamper(R, 90, hs, col, rough)
    # bed 0: cabbages in a grid
    cab = [noisy_mound(rg, int(0.5 * P), rg.uniform(0.16, 0.2) * P, 0.25, ["#34503e", "#4a6a54", "#62826a", "#7a947c"], edge=0.3) for _ in range(8)]
    # bed 1: leek/onion rows (blue-green spiky)
    leek = tuft_lib(rg, 10, int(0.2 * P), n_blades=7, blade_len=0.08 * P, blade_w=2.0, height_m=0.35,
                    col_base="#4a6a4c", col_tip="#7a9a82", curl=0.05, dead_frac=0.1, col_dead="#9a9a6a")
    # bed 2: beans (bushy, dark leaves)
    bean = [noisy_mound(rg, int(0.4 * P), 0.14 * P, 0.5, ["#2a3a1a", "#3e5222", "#56682e"], edge=0.6) for _ in range(8)]
    for b, lib, sx_m, sy_m in ((0, cab, 0.45, 0.45), (5, cab, 0.38, 0.6), (1, leek, 0.14, 0.3), (2, bean, 0.3, 0.5)):
        for cy in np.arange(0, R, sy_m * P):
            for cx in np.arange(0, R, sx_m * P):
                jx, jy = cx + rg.normal(0, 0.03 * P), cy + rg.normal(0, 0.03 * P)
                xi, yi = int(jx) % R, int(jy) % R
                if bid[yi, xi] != b or bed[yi, xi] < 0.9 or edge[yi, xi] < 0.45:
                    continue
                if rg.random() < 0.1:
                    continue  # gaps: harvested / failed
                st.stamp(lib[rg.integers(len(lib))], jx, jy, z=float(hs[yi, xi]), tint=T.cjit(rg, 0.08))
    herb = [noisy_mound(rg, int(0.4 * P), rg.uniform(0.1, 0.16) * P, 0.3, pal, edge=0.6)
            for pal in (["#4a5a3a", "#6a7a58", "#8a9a78"], ["#3e5a2a", "#56722e"], ["#5a6a4a", "#7a8a6a", "#9aa088"]) for _ in range(3)]
    scatter(st, rg, herb, int(14 * tile * tile), density=(bid == 4) * T.smoothstep(0.35, 0.5, edge), zfield=hs)
    # bed 3: freshly dug, a few weeds
    wd = tuft_lib(rg, 8, int(0.1 * P), n_blades=6, blade_len=0.04 * P, blade_w=1.3, height_m=0.05, col_base="#3a4a22", col_tip="#6a7e3a")
    scatter(st, rg, wd, int(12 * tile * tile), density=(bid == 3) * bed, zfield=hs)
    # path edges: grass tufts
    eg = tuft_lib(rg, 10, int(0.2 * P), n_blades=9, blade_len=0.07 * P, blade_w=1.2, height_m=0.1, col_base="#3a4a22", col_tip="#7a8a40", dead_frac=0.2)
    # paths are trodden but grassy at the margins and in patches
    pgr = T.smoothstep(0.35, 0.75, T.norm01(T.band(R, rg, 3, 12)))
    scatter(st, rg, eg, int(45 * tile * tile), density=path * np.clip(0.5 * T.smoothstep(0.14, 0.2, edge) + 0.8 * pgr, 0, 1), zfield=hs)
    h, col, rough = st.result()
    return finalize(col, h, rough, 4, 0.55), {}


# ================================================================= WOODLAND FLOORS
@surface(8.0, "Oak woodland floor: layered lobed oak leaves (tan/brown/grey-brown), twigs, acorns, moss flecks, seedlings.")
def forest_floor(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#2a2018", "#3a2c20", "#4a3828"), relief=0.02)
    st = T.Stamper(R, 50, hs, cs, rs)
    tint = drift_tint(rg, 0.12, 0.08, k=(1, 5))
    cols = ["#7a5a36", "#8c6a40", "#6a4e32", "#a07a48", "#5a4632", "#8a7456", "#6e5a44"]
    lib = [T.leaf(rg, int(0.13 * P), rg.uniform(0.07, 0.11) * P, rg.uniform(0.04, 0.055) * P, rg.choice(cols),
                  height_m=0.003, lobes=rg.choice([4, 5]), curl_h=0.008, rough=0.75) for _ in range(40)]
    # layered: each layer lies higher than the last -> z-buffer builds a real litter pile
    for layer in range(5):
        scatter(st, rg, lib, int(110 * tile * tile), zfield=hs + layer * 0.006, tint=tint, zjit=0.002)
    twigs = []
    for _ in range(16):
        S = int(0.3 * P); sp = empty_sprite(S); a = rg.uniform(0, 6); L = rg.uniform(0.08, 0.25) * P
        c = T.hexc(rg.choice(["#4a3a2a", "#5e4a36", "#3a3028"]))
        x0, y0 = S / 2 - math.cos(a) * L / 2, S / 2 - math.sin(a) * L / 2
        stroke(sp, x0, y0, x0 + math.cos(a) * L, y0 + math.sin(a) * L, 3.0, 1.8, 0.04, 0.04, c, c * 1.1, 0.8)
        if rg.random() < 0.6:
            a2 = a + rg.choice([-0.6, 0.6]); m = rg.uniform(0.3, 0.7)
            bx, by = x0 + math.cos(a) * L * m, y0 + math.sin(a) * L * m
            stroke(sp, bx, by, bx + math.cos(a2) * L * 0.4, by + math.sin(a2) * L * 0.4, 1.8, 1.2, 0.04, 0.04, c, c, 0.8)
        twigs.append(sp)
    scatter(st, rg, twigs, int(10 * tile * tile), zfield=hs + 0.02)
    acorn = [T.blob(rg, int(0.03 * P) + 3, 0.008 * P, 0.02, c, elong=1.4, rough=0.5, shade=0.4) for c in ("#6a5a2a", "#7a5a30", "#5a4a28")]
    scatter(st, rg, acorn, int(8 * tile * tile), zfield=hs + 0.025)
    moss = [noisy_mound(rg, int(0.2 * P), rg.uniform(0.04, 0.08) * P, 0.03, ["#3a4a1e", "#56682a", "#6e7a32"], edge=0.6) for _ in range(6)]
    scatter(st, rg, moss, int(3 * tile * tile), density=T.smoothstep(0.6, 0.9, T.norm01(T.band(R, rg, 2, 6))), zfield=hs + 0.02)
    seed = tuft_lib(rg, 6, int(0.12 * P), n_blades=5, blade_len=0.05 * P, blade_w=2.5, height_m=0.08, col_base="#3a5a22", col_tip="#5a7a2e", curl=0.2)
    scatter(st, rg, seed, int(2 * tile * tile), zfield=hs + 0.03)
    h, col, rough = st.result()
    return finalize(col, h, rough, 4, 0.5), dict(normal_h=T.blur(h, 0.6))


@surface(8.0, "Pine forest floor: russet needle carpet, cones, twigs, bilberry and moss patches.")
def pine_floor(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#2e2218", "#3e2e20", "#4e3a28"), relief=0.02)
    st = T.Stamper(R, 60, hs, cs, rs)
    tint = drift_tint(rg, 0.10, 0.08)
    cols = ["#6e5038", "#7a5a40", "#5e4632", "#86684a", "#54432f", "#7e705a"]
    lib = [T.needle(rg, int(0.06 * P) + 4, rg.uniform(0.035, 0.055) * P, rg.choice(cols), width_px=1.2) for _ in range(60)]
    for layer in range(4):
        scatter(st, rg, lib, int(1100 * tile * tile), zfield=hs + layer * 0.0015, tint=tint, zjit=0.0008)
    cones = []
    for _ in range(8):
        c = T.blob(rg, int(0.08 * P) + 4, 0.022 * P, 0.035, "#5a4028", elong=1.9, rough=0.8, shade=0.5)
        # scales
        yy, xx = np.mgrid[0:c["h"].shape[0], 0:c["h"].shape[1]]
        c["col"] *= (0.8 + 0.3 * (np.sin(xx * 1.6) * np.sin(yy * 1.6) > 0))[..., None]
        cones.append(c)
    scatter(st, rg, cones, int(3 * tile * tile), zfield=hs + 0.01)
    bil = [noisy_mound(rg, int(0.35 * P), rg.uniform(0.08, 0.14) * P, 0.2, ["#3a4a24", "#4e5e2c", "#5e6c34"], edge=0.6, speck=("#5a3a48", 0.01)) for _ in range(6)]
    patch = T.smoothstep(0.65, 0.95, T.norm01(T.band(R, rg, 2, 6)))
    scatter(st, rg, bil, int(5 * tile * tile), density=patch, zfield=hs)
    moss = [noisy_mound(rg, int(0.25 * P), rg.uniform(0.05, 0.1) * P, 0.03, ["#3e5020", "#5a6a2a", "#7a7e36"], edge=0.5, flat=0.5) for _ in range(6)]
    scatter(st, rg, moss, int(6 * tile * tile), density=T.smoothstep(0.55, 0.85, T.norm01(T.band(R, rg, 2, 8))), zfield=hs)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.55), dict(normal_h=T.blur(h, 0.6))


@surface(6.0, "Moss carpet: cushion mounds in bright to olive greens, sphagnum, a few leaves and twigs.")
def moss(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#2a2a18", "#3a3a20", "#4a4626"), relief=0.02)
    st = T.Stamper(R, 90, hs, cs, rs)
    tint = drift_tint(rg, 0.14, 0.12, k=(1, 4))
    pal = [["#2e4018", "#4a6222", "#6a7e2e", "#8a943c"], ["#3a4a1a", "#5a6a26", "#7a8036"], ["#56622a", "#7a7a36", "#9a8a46"]]
    lib = [noisy_mound(rg, int(0.36 * P), rg.uniform(0.06, 0.16) * P, rg.uniform(0.02, 0.05), pal[rg.integers(3)],
                       edge=0.45, fine_k=0.15, rough=0.9) for _ in range(24)]
    scatter(st, rg, lib, int(160 * tile * tile), zfield=hs, tint=tint, zjit=0.005)
    lv = [T.leaf(rg, int(0.1 * P), 0.07 * P, 0.04 * P, c, height_m=0.06, lobes=4) for c in ("#6a4e32", "#8a6a40", "#5a4632")]
    scatter(st, rg, lv, int(4 * tile * tile), zfield=hs)
    h, col, rough = st.result()
    return finalize(col, h, rough, 5, 0.55), dict(normal_h=T.blur(h, 0.6))


# ================================================================= WORN GROUND
@surface(8.0, "Bare earth: loamy soil, crumbs, small stones, faint cracking.")
def bare_earth(rg, tile):
    P = ppm(tile)
    hs, cs, rs = soil_base(rg, tile, ("#4a3a28", "#5a4632", "#6e5a42", "#7e6a50"), relief=0.008, crumb=0.004)
    f1, f2, _ = T.worley(R, 18, rg)
    crack = T.smoothstep(0.06, 0.0, f2 - f1) * T.smoothstep(0.3, 0.7, T.norm01(T.band(R, rg, 1, 4)))
    hs = hs - 0.01 * crack
    cs = cs * (1 - 0.35 * crack)[..., None]
    st = T.Stamper(R, 40, hs, cs, rs)
    crumbs = [T.blob(rg, 14, rg.uniform(1.5, 5), rg.uniform(0.003, 0.01), c, lumpy=0.5, shade=0.35, rough=0.9)
              for c in ("#5e4a34", "#6e5a40", "#4e3e2c", "#7a6a52") for _ in range(6)]
    scatter(st, rg, crumbs, int(600 * tile * tile), zfield=hs)
    stones = [T.blob(rg, int(0.08 * P) + 3, rg.uniform(0.006, 0.025) * P, rg.uniform(0.006, 0.02), c, lumpy=0.35, shade=0.3, rough=0.75)
              for c in ("#8a8070", "#9a8e78", "#6e675c", "#a39680") for _ in range(5)]
    scatter(st, rg, stones, int(35 * tile * tile), zfield=hs, jit=0.06)
    h, col, rough = st.result()
    return finalize(col, h, rough, 3, 0.6), dict(displace_m=float(h.max() - h.min()))


def footprints(rg, h, n, P, kind="mixed", depth=0.03):
    """Additive boot/hoof prints (negative height) with raised rims."""
    for _ in range(n):
        x, y = rg.random(2) * R
        a = rg.uniform(0, 2 * math.pi)
        if kind == "hoof" or (kind == "mixed" and rg.random() < 0.5):
            S = int(0.16 * P) + 3; rr = 0.055 * P
        else:
            S = int(0.34 * P) + 3; rr = 0.05 * P
        yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2
        u = xx * math.cos(a) + yy * math.sin(a); v = -xx * math.sin(a) + yy * math.cos(a)
        if S > 0.3 * P:
            d = np.sqrt((u / (rr * 2.4)) ** 2 + (v / rr) ** 2)
        else:
            d = np.sqrt((u / rr) ** 2 + (v / (rr * 0.95)) ** 2)
            d = np.where((np.abs(v) < rr * 0.12) & (u > 0), 1.2, d)  # cloven split
        k = -depth * rg.uniform(0.5, 1.0) * np.clip(1 - d ** 4, 0, 1) + depth * 0.35 * np.exp(-((d - 1.1) / 0.18) ** 2)
        T.splat_add(h, k.astype(np.float32), x, y)
    return h


@surface(10.0, "Trampled/churned ground: hoof and boot prints, puddled wet hollows, clods, crushed grass remnants.")
def churned_ground(rg, tile):
    P = ppm(tile)
    h = 0.03 * T.fbm(R, rg, 2, 60, 2.0) + 0.004 * T.band(R, rg, 60, 400)
    h = footprints(rg, h.astype(np.float32), int(55 * tile * tile), P, depth=0.035)
    wet = T.norm01(T.blur(h, 6) * -1 + 0.3 * T.band(R, rg, 2, 6) * h.std())
    t = T.norm01(0.6 * T.band(R, rg, 1, 6) + 0.4 * T.fbm(R, rg, 10, 300))
    dry = T.ramp(t, ["#4e3e2c", "#5e4a36", "#6e5a44"])
    wetc = T.ramp(t, ["#2e241a", "#382c20", "#44362a"])
    wm = T.smoothstep(0.55, 0.85, wet)
    col = T.mix(dry, wetc, wm)
    rough = 0.9 - 0.55 * T.smoothstep(0.75, 0.95, wet)  # standing water film in the deepest prints
    st = T.Stamper(R, 60, h, col, rough)
    clods = [T.blob(rg, int(0.1 * P), rg.uniform(0.015, 0.04) * P, rg.uniform(0.01, 0.03), c, lumpy=0.5, shade=0.4, rough=0.85)
             for c in ("#5a4632", "#4a3a2a", "#6a5640") for _ in range(6)]
    scatter(st, rg, clods, int(40 * tile * tile), zfield=h)
    crushed = tuft_lib(rg, 12, int(0.2 * P), n_blades=8, blade_len=0.08 * P, blade_w=1.3, height_m=0.02,
                       col_base="#4a4a26", col_tip="#7a7440", dead_frac=0.4, col_dead="#8a7a50", curl=0.5)
    scatter(st, rg, crushed, int(40 * tile * tile), density=T.smoothstep(0.55, 0.85, T.norm01(T.band(R, rg, 2, 6))) * (1 - wm), zfield=h)
    h, col, rough = st.result()
    return finalize(col, h, rough, 4, 0.6), dict(displace_m=float(h.max() - h.min()))


@surface(12.0, "Cart track: two wheel ruts (1.4 m gauge) along V, grassy crown, trodden centre, grass verges, damp rut bottoms. UV V = track direction; the track sits in the middle 4 m of the tile's U.")
def dirt_track(rg, tile):
    P = ppm(tile)
    yy, xx = np.mgrid[0:R, 0:R].astype(np.float32)
    meander = 6 * T.band(R, rg, 1, 2, 1.0, aniso=(1, 0.2))
    xm = (xx + meander - R / 2) / P  # metres from track centreline
    rut = lambda c, w: np.exp(-((xm - c) / w) ** 2)
    ruts = rut(-0.7, 0.13) + rut(0.7, 0.13)
    road = T.smoothstep(1.9, 1.4, np.abs(xm + 0.15 * T.band(R, rg, 3, 12)))
    h = -0.1 * ruts - 0.03 * road + 0.012 * T.fbm(R, rg, 2, 200, 1.8)
    h = h + 0.02 * np.exp(-(xm / 0.3) ** 2)  # crown
    h = footprints(rg, h.astype(np.float32), int(9 * tile * tile), P, kind="hoof", depth=0.025) if True else h
    t = T.norm01(0.6 * T.band(R, rg, 1, 6) + 0.4 * T.fbm(R, rg, 10, 300))
    soilc = T.ramp(t, ["#6a563e", "#7a6448", "#8a7456"])
    damp = T.smoothstep(0.4, 0.9, ruts) * T.smoothstep(0.3, 0.7, T.norm01(T.band(R, rg, 2, 8, aniso=(1, 0.3))))
    soilc = T.mix(soilc, T.ramp(t, ["#3e3022", "#4a3a2a"]), damp * 0.85)
    rough = 0.88 - 0.5 * damp * T.smoothstep(0.7, 1.0, ruts)
    st = T.Stamper(R, 60, h.astype(np.float32), soilc, rough)
    tint = drift_tint(rg, 0.1, 0.08)
    grass = tuft_lib(rg, 20, int(0.24 * P), n_blades=12, blade_len=0.09 * P, blade_w=1.2, height_m=0.14,
                     col_base="#35441e", col_tip="#7a8640", dead_frac=0.15, col_dead="#a59864")
    cover = (1 - road) + road * 0.75 * T.smoothstep(0.45, 0.2, np.abs(xm)) + road * 0.25 * T.smoothstep(1.1, 1.5, np.abs(xm))
    cover = np.clip(cover * (1 - 0.95 * T.smoothstep(0.2, 0.6, ruts)), 0, 1)
    scatter(st, rg, grass, int(300 * tile * tile), density=cover, zfield=h, tint=tint)
    stones = [T.blob(rg, int(0.07 * P) + 3, rg.uniform(0.008, 0.025) * P, 0.015, c, lumpy=0.3, shade=0.3) for c in ("#9a8e78", "#8a8070", "#a8a08a") for _ in range(5)]
    scatter(st, rg, stones, int(10 * tile * tile), density=road, zfield=h)
    h, col, rough = st.result()
    return finalize(col, h, rough, 4, 0.6), dict(displace_m=0.12, normal_boost=0.7)


# ================================================================= main
def build(name):
    fn, tile, notes = SURFACES[name]
    rg = T.rng(abs(hash(name)) % (2 ** 31) if False else sum(map(ord, name)) * 7919)
    t0 = time.time()
    (col, h, rough), kw = fn(rg, tile)
    kw = dict(kw)
    nh = kw.pop("normal_h", None)
    boost = kw.pop("normal_boost", 1.0)
    extra = {"displace_m": kw.pop("displace_m", 0.0), "aliases": ALIASES.get(name, []),"macro_hint": "tile holds <=3 m structure; add world-space macro tint/variation in the splat shader to break repetition",
             "family": "A-vegetated"}
    T.save_set(name, col, h, rough, tile, notes=notes, normal_h=nh, extra=extra, normal_boost=boost)
    print(f"built {name} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--list" in argv:
        print("SURFACES " + " ".join(SURFACES)); sys.exit(0)
    preview = "--preview" in argv
    names = [a for a in argv if not a.startswith("--")] or list(SURFACES)
    for n in names:
        build(n)
        if preview:
            T.preview_tiled(n)
