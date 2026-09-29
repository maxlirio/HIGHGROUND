"""HIGHGROUND castle kit — shared TILEABLE material library (numpy; no Blender needed).

    tools/heavy.sh python3 assets/src/castle/castle_tex.py [name ...]

Why a shared tiling library instead of _lib.finish()'s per-object baked atlas: a castle is thousands of m²
of masonry that the camera walks right up to (wall-walks, tower floors, the keep's storeys). A per-piece
2048 atlas gives ~35 px/m on the keep; a 6 m tiling set at 2048 gives 341 px/m everywhere, and ONE set is
shared by every piece (downloaded once, one GPU texture). Large-scale variation (grime at the foot, soot,
lichen, damp, AO) is carried per vertex in COLOR_0 by the piece scripts, so the tiling never reads as tiling.

Every map is periodic by construction (_terrain_tex FFT noise, circular block layouts), so it wraps without a
seam. Writes assets/tex/castle/<mat>_{albedo,normal,rough}.jpg + <mat>.json (tile_m, avg colour).
Image orientation: row 0 = TOP = +V (up the wall / up the roof slope). Normals OpenGL +Y (glTF/three.js).
"""
import sys, os, json, math, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import _terrain_tex as T

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "assets", "tex", "castle")
TMP = os.path.join("/tmp", "hg_castle_tex")


def save(name, alb, h, rough, tile_m, boost=1.0, notes="", rough_res=None):
    os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
    res = h.shape[0]
    alb = np.clip(alb, 30 / 255, 240 / 255).astype(np.float32)
    rough = np.clip(np.broadcast_to(np.asarray(rough, np.float32), (res, res)), 0.05, 1.0)
    nrm = T.height_to_normal(h.astype(np.float32), tile_m, boost)
    maps = {"albedo": alb, "normal": nrm, "rough": np.repeat(rough[..., None], 3, -1)}
    for k, a in maps.items():
        png = os.path.join(TMP, f"{name}_{k}.png")
        T.write_png(png, a, 8)
        jpg = os.path.join(OUT, f"{name}_{k}.jpg")
        q = "93" if k == "normal" else "90"
        cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", q]
        if k == "rough" and rough_res:
            cmd += ["-z", str(rough_res), str(rough_res)]
        subprocess.run(cmd + [png, "--out", jpg], check=True, capture_output=True)
    avg = alb.reshape(-1, 3).mean(0)
    meta = dict(name=name, tile_m=tile_m, res=res, avg_srgb="#%02x%02x%02x" % tuple(int(round(c * 255)) for c in avg),
                rough_mean=round(float(rough.mean()), 3), relief_m=round(float(h.max() - h.min()), 4),
                seam=round(T.seam_score(alb), 3), notes=notes)
    json.dump(meta, open(os.path.join(OUT, name + ".json"), "w"), indent=1)
    print(f"HG_CTEX {name} tile={tile_m}m avg={meta['avg_srgb']} relief={meta['relief_m']} seam={meta['seam']}")


# ------------------------------------------------------------------ circular block layout
def coursed(res, tile_m, rg, course_h, block_l, stagger=True):
    """Coursed blocks filling the tile periodically. Returns dict of per-pixel fields:
    bid (int), ex/ey (px distance to the nearest vertical / horizontal joint), u/v (0..1 within block),
    bw/bh (block size px), course (int)."""
    px = tile_m / res
    hs = []
    while sum(hs) < tile_m:
        hs.append(rg.uniform(*course_h))
    hs = np.array(hs) * tile_m / sum(hs)
    yb = np.round(np.concatenate([[0], np.cumsum(hs)]) / px).astype(int); yb[-1] = res
    bid = np.zeros((res, res), np.int32); ex = np.zeros((res, res), np.float32); ey = ex.copy()
    U = ex.copy(); V = ex.copy(); BW = ex.copy(); BH = ex.copy(); CO = bid.copy()
    xs = np.arange(res)
    nid = 0
    for k in range(len(yb) - 1):
        y0, y1 = yb[k], yb[k + 1]
        ls = []
        while sum(ls) < tile_m:
            ls.append(rg.uniform(*block_l))
        ls = np.array(ls) * tile_m / sum(ls)
        xb = np.round(np.concatenate([[0], np.cumsum(ls)]) / px).astype(int); xb[-1] = res
        off = rg.integers(0, res)
        xl = (xs - off) % res
        j = np.searchsorted(xb, xl, side="right") - 1
        left = xl - xb[j]; right = xb[j + 1] - xl
        w = (xb[j + 1] - xb[j]).astype(np.float32)
        rows = np.arange(y0, y1)
        top = (rows - y0)[:, None].astype(np.float32); bot = (y1 - rows)[:, None].astype(np.float32)
        bid[y0:y1] = (nid + j)[None, :]
        ex[y0:y1] = np.minimum(left, right)[None, :]
        ey[y0:y1] = np.minimum(top, bot)
        U[y0:y1] = (left / w)[None, :]
        V[y0:y1] = top / (y1 - y0)
        BW[y0:y1] = w[None, :]; BH[y0:y1] = (y1 - y0)
        CO[y0:y1] = k
        nid += len(ls)
    return dict(bid=bid, ex=ex, ey=ey, u=U, v=V, bw=BW, bh=BH, course=CO, n=nid)


def per_block(rg, n, fn):
    return np.array([fn(i) for i in range(n)], np.float32)


def palette_pick(rg, n, pal):
    cols = np.stack([T.hexc(c) for c, _ in pal]); w = np.array([p for _, p in pal], float); w /= w.sum()
    idx = rg.choice(len(pal), size=n, p=w)
    out = cols[idx] * (1 + rg.normal(0, 0.07, (n, 1))) * (1 + rg.normal(0, 0.006, (n, 3)))
    return out.astype(np.float32)


def worley2(res, nx, ny, rg, jx=0.9, jy=0.9, sx=1.0, sy=1.0):
    """Periodic anisotropic Worley: nx x ny cells; distances in metres given cell size (sx, sy)."""
    pts = np.stack([(rg.random((ny, nx)) - 0.5) * jx + 0.5, (rg.random((ny, nx)) - 0.5) * jy + 0.5], -1)
    ids = rg.permutation(nx * ny).reshape(ny, nx)
    y, x = np.mgrid[0:res, 0:res].astype(np.float32)
    x *= nx / res; y *= ny / res
    ci = np.floor(x).astype(int); cj = np.floor(y).astype(int)
    f1 = np.full((res, res), 99.0, np.float32); f2 = f1.copy(); cid = np.zeros((res, res), np.int32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ni = ci + di; nj = cj + dj
            p = pts[nj % ny, ni % nx]
            dx = (ni + p[..., 0] - x) * sx; dy = (nj + p[..., 1] - y) * sy
            d = np.sqrt(dx * dx + dy * dy)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, ids[nj % ny, ni % nx], cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def lichen(res, rg, density, k=(40, 160)):
    """Sparse rosette mask 0..1 (periodic)."""
    m = T.band(res, rg, 2, 8, 1.0)
    spots = T.band(res, rg, *k, beta=0.5)
    s = T.smoothstep(2.2 - density, 2.9 - density, spots + 0.5 * m)
    return T.blur(s, 0.8)


# ------------------------------------------------------------------ materials
def ashlar(res=2048, tile=6.0, seed=11):
    """Squared, coursed limestone ashlar with lime mortar — the castle's facing stone."""
    rg = T.rng(seed); px = tile / res
    L = coursed(res, tile, rg, (0.27, 0.46), (0.42, 1.25))
    n = L["n"]; bid = L["bid"]
    # irregular, weathered arrises
    wob = T.band(res, rg, 20, 160, 1.4) * 1.6 + T.band(res, rg, 160, 700, 0.3) * 0.35
    e = np.minimum(L["ex"], L["ey"]) + wob
    joint = 1.8 + T.band(res, rg, 8, 40, 1.0) * 0.5                   # half joint width, px (~1 cm joints)
    rnd = per_block(rg, n, lambda i: rg.uniform(3.0, 11.0))[bid]      # arris rounding radius, px
    plate = T.smoothstep(joint, joint + rnd, e)
    # chipped arrises: noise gouges near edges only
    chip = T.smoothstep(1.5, 2.3, T.band(res, rg, 40, 220, 0.8)) * (1 - T.smoothstep(joint, joint + 26, e))
    proud = per_block(rg, n, lambda i: rg.uniform(0.004, 0.014))[bid]
    tilt_u = per_block(rg, n, lambda i: rg.normal(0, 0.003))[bid]; tilt_v = per_block(rg, n, lambda i: rg.normal(0, 0.003))[bid]
    u, v = L["u"], L["v"]
    pillow = (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
    # boasted tooling: fine diagonal striations, angle per block, on ~60% of blocks
    y, x = np.mgrid[0:res, 0:res].astype(np.float32) * px
    ang = per_block(rg, n, lambda i: rg.uniform(0.6, 1.2) * (1 if rg.random() < 0.5 else -1))[bid]
    tool_on = per_block(rg, n, lambda i: 1.0 if rg.random() < 0.6 else 0.25)[bid]
    tool = np.sin((x * np.cos(ang) + y * np.sin(ang)) * (2 * math.pi / 0.009)) * 0.00035 * tool_on
    pit = T.band(res, rg, 200, 900, 0.4); pits = np.clip(pit - 1.6, 0, None) * 0.0012
    fine = T.fbm(res, rg, 20, 900, 1.6) * 0.0011
    stone_h = proud + pillow * 0.0045 + tilt_u * (u - 0.5) + tilt_v * (v - 0.5) + fine + tool - pits
    mortar_h = -0.011 + T.band(res, rg, 300, 1000, 0.2) * 0.0006
    h = mortar_h + (stone_h - mortar_h) * plate - chip * 0.006 * plate
    # colour: limestone varies mostly in VALUE; hue drifts only a little warm/cool per block
    n_ = n
    val = per_block(rg, n_, lambda i: rg.normal(0, 0.075))
    warm = per_block(rg, n_, lambda i: rg.normal(0, 0.45))
    base = T.hexc("#b5a990")[None, :] * (1 + val[:, None])
    base = T.mix(base, base * T.hexc("#c0a886") / T.hexc("#b2a891"), np.clip(warm, 0, 1)[:, None] * 0.35)
    base = T.mix(base, base * T.hexc("#aba697") / T.hexc("#b2a891"), np.clip(-warm, 0, 1)[:, None] * 0.45)
    odd = per_block(rg, n_, lambda i: rg.random())
    base[odd < 0.05] *= T.hexc("#8e887c") / T.hexc("#b2a891")      # a darker replacement stone
    base[(odd > 0.05) & (odd < 0.09)] *= (T.hexc("#b59c77") / T.hexc("#b2a891") + 1) / 2   # a sandier one
    col = base[bid]
    grain = T.band(res, rg, 350, 1000, 0.2)[..., None] * 0.035
    bed = T.band(res, rg, 6, 120, 1.4, aniso=(10, 1))[..., None] * 0.02
    blot = T.smoothstep(0.4, 1.6, T.band(res, rg, 5, 40, 1.6) + T.band(res, rg, 40, 300, 0.6) * 0.3)[..., None]
    col = col * (1 + grain + bed) * (1 - blot * 0.07)
    speck = T.smoothstep(2.3, 3.0, T.band(res, rg, 400, 1000, 0.0))[..., None]
    col = col * (1 - speck * 0.35)
    # dirt settles on the upper face of the joint below (lower edge of a block); arrises weather paler
    col *= (1 - 0.06 * T.smoothstep(0.7, 1.0, v))[..., None]
    col *= (1 + 0.02 * (1 - T.smoothstep(joint, joint + 8, e)))[..., None]
    mcol = T.hexc("#b3aa95") * (1 + T.band(res, rg, 200, 900, 0.3)[..., None] * 0.05) * (1 + T.band(res, rg, 4, 30, 1)[..., None] * 0.04)
    col = T.mix(mcol, col, plate[..., None])
    li = lichen(res, rg, 0.25)
    col = T.mix(col, T.hexc("#8f9380"), (li * 0.6)[..., None])
    li2 = lichen(res, rg, -0.2, k=(80, 260))
    col = T.mix(col, T.hexc("#b39a5c"), (li2 * 0.45)[..., None])
    h = h + (li + li2) * 0.0005
    col *= T.cavity(h, 3, lo=0.74)[..., None]
    rough = 0.8 + T.band(res, rg, 20, 200, 1)[...] * 0.04 + (1 - plate) * 0.12 - li * 0.05
    save("ashlar", col, h, rough, tile, boost=0.8, notes="coursed limestone ashlar, 27-46 cm courses, lime mortar", rough_res=1024)


def rubble(res=2048, tile=6.0, seed=23):
    """Roughly coursed rubble (split fieldstone and quarry waste, roughly squared) in thick lime mortar —
    interior faces, bailey buildings, the exposed core in breaches."""
    rg = T.rng(seed); px = tile / res
    L = coursed(res, tile, rg, (0.17, 0.4), (0.25, 0.8))
    n = L["n"]; bid = L["bid"]
    u, v = L["u"], L["v"]
    p = per_block(rg, n, lambda i: rg.uniform(2.2, 4.5))[bid]
    sx = per_block(rg, n, lambda i: rg.uniform(0.93, 1.02))[bid]; sy = per_block(rg, n, lambda i: rg.uniform(0.88, 1.0))[bid]
    ox = per_block(rg, n, lambda i: rg.normal(0, 0.04))[bid]; oy = per_block(rg, n, lambda i: rg.normal(0, 0.05))[bid]
    wob = T.band(res, rg, 12, 90, 1.5) * 0.045
    r = (np.abs((2 * u - 1 - ox) / sx) ** p + np.abs((2 * v - 1 - oy) / sy) ** p) ** (1 / p) + wob
    plate = T.smoothstep(0.99, 0.86, r)
    proud = per_block(rg, n, lambda i: rg.uniform(0.008, 0.03))[bid]
    face = T.fbm(res, rg, 12, 700, 1.7) * 0.003
    h = -0.016 + T.band(res, rg, 300, 1000, 0.2) * 0.0008 + (proud * np.sqrt(np.clip(1 - r, 0, 1)) + face + 0.016) * plate
    val = per_block(rg, n, lambda i: rg.normal(0, 0.1)); warm = per_block(rg, n, lambda i: rg.normal(0, 0.5))
    b0 = T.hexc("#a29984")
    base = b0[None, :] * (1 + val[:, None])
    base = T.mix(base, base * T.hexc("#ad9676") / b0, np.clip(warm, 0, 1)[:, None] * 0.7)
    base = T.mix(base, base * T.hexc("#8f8d88") / b0, np.clip(-warm, 0, 1)[:, None] * 0.7)
    col = base[bid] * (1 + T.band(res, rg, 300, 1000, 0.2)[..., None] * 0.04 + T.band(res, rg, 20, 200, 1)[..., None] * 0.04)
    mcol = T.hexc("#bbb19b") * (1 + T.band(res, rg, 300, 1000, 0.3)[..., None] * 0.06) * (1 + T.band(res, rg, 3, 20, 1)[..., None] * 0.05)
    col = T.mix(mcol, col, plate[..., None])
    li = lichen(res, rg, 0.2)
    col = T.mix(col, T.hexc("#8d917e"), (li * 0.55)[..., None])
    col *= T.cavity(h, 4, lo=0.7)[..., None]
    rough = 0.86 + (1 - plate) * 0.08
    save("rubble", col, h, rough, tile, notes="coursed rubble, thick lime mortar", rough_res=1024)


def paving(res=1024, tile=4.0, seed=31):
    """Worn sandstone/limestone flags: wall-walks, tower tops, floors."""
    rg = T.rng(seed); px = tile / res
    L = coursed(res, tile, rg, (0.45, 0.8), (0.5, 1.1))
    n = L["n"]; bid = L["bid"]
    e = np.minimum(L["ex"], L["ey"]) + T.band(res, rg, 20, 160, 1.2) * 1.8
    plate = T.smoothstep(1.2, 1.2 + per_block(rg, n, lambda i: rg.uniform(3, 9))[bid], e)
    tilt = (per_block(rg, n, lambda i: rg.normal(0, 0.004))[bid] * (L["u"] - 0.5)
            + per_block(rg, n, lambda i: rg.normal(0, 0.004))[bid] * (L["v"] - 0.5))
    wear = T.band(res, rg, 2, 10, 1.5) * 0.002
    h = -0.008 + (0.008 + tilt + wear + T.fbm(res, rg, 20, 500, 1.8) * 0.0012) * plate
    pal = [("#9a9384", 4), ("#8e887b", 3), ("#a0977f", 2), ("#a7a08f", 1.5), ("#838076", 1)]
    col = palette_pick(rg, n, pal)[bid] * (1 + T.band(res, rg, 8, 80, 1)[..., None] * 0.05)
    col = T.mix(T.hexc("#6d6254"), col, plate[..., None])      # dirt-filled joints
    col *= T.cavity(h, 3, lo=0.7)[..., None]
    rough = 0.72 + (1 - plate) * 0.2 + T.band(res, rg, 4, 30, 1) * 0.04
    save("paving", col, h, rough, tile, notes="worn flagstones")


def _grain(res, rg, along_x=True, rings=90.0):
    """Wood grain field (periodic): long streaks along x, ring figure warped by noise."""
    a = (40, 1) if along_x else (1, 40)
    streak = T.band(res, rg, 2, 400, 1.0, aniso=a)
    y, x = np.mgrid[0:res, 0:res].astype(np.float32) / res
    w = T.band(res, rg, 1, 6, 2.0, aniso=(6, 1) if along_x else (1, 6)) * 0.06
    coord = (y if along_x else x) + w
    ring = np.sin(coord * rings * 2 * math.pi)
    return streak, ring


def planks(res=1024, tile=2.0, seed=41):
    """Adzed oak boards running along U: floors, doors, hoarding walls."""
    rg = T.rng(seed); px = tile / res
    L = coursed(res, tile, rg, (0.17, 0.3), (0.9, 2.2))          # "courses" = boards, "blocks" = lengths
    n = L["n"]; bid = L["bid"]
    streak, ring = _grain(res, rg, True, 70)
    gap = T.smoothstep(0.8, 2.2, L["ey"]) * T.smoothstep(0.6, 1.8, L["ex"])
    cup = (1 - (2 * L["v"] - 1) ** 2) * 0.0015
    adze = T.band(res, rg, 20, 80, 1.0, aniso=(1, 3)) * 0.0005
    h = -0.004 + (0.004 + cup + adze + streak * 0.0003 + ring * 0.00015) * gap
    pal = [("#6f5a41", 3), ("#7d6a52", 3), ("#655340", 2), ("#857765", 2), ("#5c4a37", 1)]
    base = palette_pick(rg, n, pal)[bid]
    col = base * (1 + streak[..., None] * 0.07 + ring[..., None] * 0.035 + T.band(res, rg, 4, 30, 1)[..., None] * 0.05)
    col = T.mix(T.hexc("#2e2720"), col, gap[..., None])
    # treenails / nails near board ends
    col *= T.cavity(h, 2, lo=0.7)[..., None]
    rough = 0.82 + (1 - gap) * 0.1 + streak * 0.02
    save("planks", col, h, rough, tile, notes="oak boards along U, 17-30 cm wide")


def timber(res=1024, tile=2.0, seed=43):
    """Hewn oak for beams, posts, hoarding frames (grain along U). Drying checks."""
    rg = T.rng(seed)
    streak, ring = _grain(res, rg, True, 55)
    checks = T.smoothstep(0.93, 1.0, np.abs(T.band(res, rg, 1, 30, 1.2, aniso=(30, 1))) / 3.0)
    hew = T.band(res, rg, 3, 20, 1.5, aniso=(1, 2)) * 0.002
    h = streak * 0.0004 + ring * 0.0002 + hew - checks * 0.004
    col = T.hexc("#6d573e") * (1 + streak[..., None] * 0.08 + ring[..., None] * 0.03 + T.band(res, rg, 2, 12, 1)[..., None] * 0.07)
    grey = T.smoothstep(-1.0, 2.0, T.band(res, rg, 1, 6, 1.0, aniso=(8, 1)))
    col = T.mix(col, T.hexc("#7f7668") * (1 + streak[..., None] * 0.05), (grey * 0.3)[..., None])
    col = T.mix(col, T.hexc("#2f2820"), (checks * 0.8)[..., None])
    rough = 0.84 + checks * 0.1
    save("timber", col, h, rough, tile, notes="hewn oak, grain along U")


def slate(res=1024, tile=4.0, seed=51):
    """Diminishing-free coursed slate (V = up the slope)."""
    rg = T.rng(seed)
    L = coursed(res, tile, rg, (0.15, 0.19), (0.18, 0.34))
    n = L["n"]; bid = L["bid"]
    # thickness: each slate's lower (downslope) edge stands proud. Image row increases DOWN the slope.
    t = L["v"]                                            # 0 at top of course, 1 at the tail (lower edge)
    edge = T.smoothstep(0.4, 2.0, L["ex"])
    h = t * 0.009 + per_block(rg, n, lambda i: rg.normal(0, 0.0015))[bid] + T.fbm(res, rg, 20, 400, 1.5) * 0.0006
    h = h * (0.55 + 0.45 * edge)
    pal = [("#4f5359", 4), ("#484b50", 3), ("#55555a", 2), ("#525049", 0.6), ("#5a5e62", 2)]
    col = palette_pick(rg, n, pal)[bid] * (1 + T.band(res, rg, 10, 120, 1)[..., None] * 0.05)
    li = lichen(res, rg, 0.2)
    col = T.mix(col, T.hexc("#9a9b8c"), (li * 0.55)[..., None])
    col *= T.cavity(h, 2, lo=0.55)[..., None]
    rough = 0.6 + T.band(res, rg, 10, 60, 1) * 0.05 + li * 0.2
    save("slate", col, h, rough, tile, boost=1.2, notes="slate courses ~17 cm exposure; V up-slope")


def shingle(res=1024, tile=4.0, seed=53):
    """Split-oak shingles, silvered, with moss (V = up the slope)."""
    rg = T.rng(seed)
    L = coursed(res, tile, rg, (0.12, 0.15), (0.1, 0.22))
    n = L["n"]; bid = L["bid"]
    edge = T.smoothstep(0.4, 2.2, L["ex"])
    streak, _ = _grain(res, rg, False, 10)
    h = (L["v"] * 0.012 + per_block(rg, n, lambda i: rg.normal(0, 0.002))[bid] + streak * 0.0005) * (0.5 + 0.5 * edge)
    pal = [("#8a8173", 4), ("#7a7266", 3), ("#958b7a", 2), ("#6d6456", 1.5)]
    col = palette_pick(rg, n, pal)[bid] * (1 + streak[..., None] * 0.06)
    moss = T.smoothstep(0.6, 1.8, T.band(res, rg, 3, 20, 1.2) + T.band(res, rg, 40, 200, 0.5) * 0.5)
    col = T.mix(col, T.hexc("#5e6a36"), (moss * 0.55 * L["v"])[..., None])
    col *= T.cavity(h, 2, lo=0.55)[..., None]
    rough = 0.88
    save("shingle", col, h, rough, tile, boost=1.1, notes="oak shingles ~13 cm exposure; V up-slope")


def lead(res=1024, tile=4.0, seed=61):
    """Cast lead sheet: standing rolls every ~0.65 m (along V), drips every 2 m; pale oxidised grey."""
    rg = T.rng(seed); px = tile / res
    y, x = np.mgrid[0:res, 0:res].astype(np.float32) * px
    pitch = tile / 6
    dx = T.periodic_line_dist(x + T.band(res, rg, 1, 6, 2) * 0.004, pitch)
    roll = np.clip(1 - (dx / 0.035) ** 2, 0, None) ** 0.5 * 0.03
    dy = np.mod(y, tile / 2)
    drip = T.smoothstep(0.0, 0.03, dy) * 0.006
    buckle = T.band(res, rg, 3, 24, 1.8) * 0.0015
    h = roll + drip + buckle
    streak = T.band(res, rg, 2, 200, 1.0, aniso=(1, 30))
    col = T.hexc("#747978") * (1 + streak[..., None] * 0.06 + T.band(res, rg, 2, 12, 1)[..., None] * 0.05)
    col = T.mix(col, T.hexc("#9a9c96"), T.smoothstep(0.8, 2.5, streak)[..., None] * 0.35)
    col *= T.cavity(h, 3, lo=0.7)[..., None]
    rough = 0.58 + streak * 0.04
    save("lead", col, h, rough, tile, notes="lead sheet with rolls along V")


def plaster(res=1024, tile=4.0, seed=71):
    """Lime-washed interior plaster with stains and spalls showing the rubble beneath."""
    rg = T.rng(seed)
    spall = T.smoothstep(2.3, 2.6, T.band(res, rg, 2, 14, 1.4) + T.band(res, rg, 30, 160, 0.8) * 0.25)
    h = T.fbm(res, rg, 4, 500, 1.8) * 0.0015 - spall * 0.006
    col = T.hexc("#d3c8b0") * (1 + T.band(res, rg, 1, 8, 1.5)[..., None] * 0.05 + T.band(res, rg, 40, 400, 0.6)[..., None] * 0.02)
    damp = T.smoothstep(0.5, 2.5, T.band(res, rg, 1, 5, 1.5, aniso=(1, 4)))
    col = T.mix(col, T.hexc("#a39580"), (damp * 0.35)[..., None])
    col = T.mix(col, T.hexc("#8f877a"), (spall * 0.8)[..., None])
    col *= T.cavity(h, 3, lo=0.75)[..., None]
    rough = 0.9
    save("plaster", col, h, rough, tile, notes="lime plaster/limewash")


def iron(res=512, tile=1.0, seed=81):
    rg = T.rng(seed)
    f1, f2, cid = worley2(res, 14, 14, rg, sx=tile / 14, sy=tile / 14)
    dent = -np.clip(1 - f1 / 0.04, 0, 1) ** 2 * 0.0008
    h = dent + T.fbm(res, rg, 20, 250, 1.8) * 0.0002
    rust = T.smoothstep(0.8, 2.2, T.band(res, rg, 3, 30, 1.2) + T.band(res, rg, 60, 200, 0.4) * 0.5)
    col = T.hexc("#3d3c3a") * (1 + T.band(res, rg, 10, 100, 1)[..., None] * 0.08)
    col = T.mix(col, T.hexc("#6a4a33"), (rust * 0.7)[..., None])
    rough = 0.62 + rust * 0.25
    save("iron", col, h, rough, tile, notes="forged iron with rust")


def debris(res=1024, tile=4.0, seed=91):
    """Fallen masonry rubble: broken ashlar and core stones of every size in mortar dust and grit."""
    rg = T.rng(seed)
    h = np.full((res, res), -0.05, np.float32); col = np.zeros((res, res, 3), np.float32) + T.hexc("#6e6556")
    col = col * (1 + T.band(res, rg, 4, 60, 1.2)[..., None] * 0.08)
    b0 = T.hexc("#a89e88")
    for n, hmax in ((9, 0.13), (17, 0.08), (34, 0.045), (70, 0.022)):
        f1, f2, cid = worley2(res, n, n, rg, sx=tile / n, sy=tile / n)
        cell = tile / n
        k = n * n
        size = per_block(rg, k, lambda i: rg.uniform(0.35, 0.8))[cid]
        on = per_block(rg, k, lambda i: 1.0 if rg.random() < 0.6 else 0.0)[cid]
        # angular stones: height from the distance to the cell border (F2-F1) -> faceted, flat-topped
        e = (f2 - f1) / cell
        sh = np.clip(e * 2.2 * size, 0, 1) ** 0.6 * hmax * on + per_block(rg, k, lambda i: rg.uniform(-0.3, 0.3))[cid] * hmax * 0.4
        sh = np.where((e > 0.1) & (on > 0), sh, -1)
        val = per_block(rg, k, lambda i: rg.normal(0, 0.1)); warm = per_block(rg, k, lambda i: rg.normal(0, 0.4))
        sc = b0[None, :] * (1 + val[:, None])
        sc = T.mix(sc, sc * T.hexc("#b09a78") / b0, np.clip(warm, 0, 1)[:, None] * 0.5)
        m = sh > h
        h = np.where(m, sh, h)
        col = np.where(m[..., None], sc[cid] * (1 + T.band(res, rg, 200, 500, 0.3)[..., None] * 0.04), col)
    h = h + T.fbm(res, rg, 40, 500, 1.6) * 0.004
    dust = T.smoothstep(0.4, 1.8, T.band(res, rg, 3, 20, 1.2))
    col = T.mix(col, T.hexc("#9b8f7a"), (dust * 0.25)[..., None])
    col *= T.cavity(h, 3, lo=0.4)[..., None]
    rough = 0.9
    save("debris", col, h, rough, tile, boost=0.8, notes="fallen masonry rubble")


def from_terrain(name, src):
    """Reuse a terrain surface set (same generator family) under the castle library's naming."""
    meta = json.load(open(os.path.join(ROOT, "assets", "terrain", src + ".json")))
    os.makedirs(OUT, exist_ok=True)
    for k in ("albedo", "normal", "rough"):
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "90",
                        os.path.join(ROOT, "assets", "terrain", f"{src}_{k}.png"), "--out",
                        os.path.join(OUT, f"{name}_{k}.jpg")], check=True, capture_output=True)
    json.dump(dict(name=name, tile_m=meta["tile_m"], res=meta["res"], avg_srgb=meta["avg_srgb"],
                   notes=f"copy of terrain set '{src}'"), open(os.path.join(OUT, name + ".json"), "w"), indent=1)
    print("HG_CTEX", name, "from terrain", src)


ALL = dict(ashlar=ashlar, rubble=rubble, paving=paving, planks=planks, timber=timber, slate=slate,
           shingle=shingle, lead=lead, plaster=plaster, iron=iron,
           debris=debris, earth=lambda: from_terrain("earth", "ditch"))

if __name__ == "__main__":
    names = sys.argv[1:] or list(ALL)
    for nm in names:
        ALL[nm]()
