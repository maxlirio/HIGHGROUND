"""HIGHGROUND terrain-texture pipeline: seamless tileable surface sets (albedo, normal, rough, height).

Every terrain surface is ONE tile covering `tile_m` x `tile_m` real metres, baked at 1024^2
(or `res`). Everything this module generates is PERIODIC BY CONSTRUCTION, so the tile wraps
with no seam: spectral (FFT) noise, wrapped Worley cells, wrap-around sprite stamping, and
(for node materials) a torus-mapped 4D coordinate. `save_set()` measures the seam numerically
and `preview_tiled()` renders an n x n tiled plane for a visual check.

Run inside Blender (numpy is bundled):  blender -b -P assets/src/<your_script>.py

OUTPUTS  assets/terrain/<name>_albedo.png  8-bit RGB, sRGB
         assets/terrain/<name>_normal.png  8-bit RGB, linear, OpenGL (+Y up) tangent space = three.js default
         assets/terrain/<name>_rough.png   8-bit grey, linear
         assets/terrain/<name>_height.png  16-bit grey, linear, 0..1 maps to 0..height_range_m (see json)
         assets/terrain/<name>.json        tile_m, avg colour, height range, seam score, notes

--- PATH A: numpy (recommended; full control, fast) ---------------------------------------
    import sys, os; sys.path.insert(0, os.path.dirname(__file__))
    import _terrain_tex as T
    R = 1024; rng = T.rng(7)
    h   = 0.02 * T.fbm(R, rng, k_lo=2, k_hi=200, beta=1.8)          # metres, zero-mean fbm
    col = T.ramp(T.norm01(T.band(R, rng, 1, 6)), ["#5a4632", "#6e5a40"])   # sRGB floats HxWx3
    col = col * T.cavity(h, 6)[..., None]                            # bake contact darkening
    T.save_set("bare_earth", col, h, rough=0.9, tile_m=4.0, notes="...",
               extra={"displace_m": 0.0})   # >0 only for real ground relief (furrows, ruts)
    T.preview_tiled("bare_earth")        # -> assets/booth/terrain_<name>_3x3.png ; READ IT

  Arrays are (row, col) with row 0 = TOP of the image; x = col, y = row. Height is in METRES;
  the normal map is derived from it physically (pixel pitch = tile_m / res), times normal_boost.
  Building blocks: band/fbm (FFT noise), worley (cells), warp/sample (wrapped domain warp),
  Stamper (wrap-around z-buffer sprite scatter for tufts, leaves, stones, needles),
  splat_add (wrap-around additive kernels: footprints, ruts, pocks),
  blade_tuft/leaf/blob sprites, ramp/hexc colour helpers, cavity (AO from height), blur.

--- PATH B: Blender node material -----------------------------------------------------------
    def build(nt):                        # nt = node tree of a fresh material
        u, w = T.torus_coord(nt)          # 4D seamless coordinate (feed Noise/Voronoi in 4D mode)
        n = T.noise4d(nt, u, w, scale=8, detail=6)       # ~scale features across the tile
        ... your nodes ...
        return {"albedo": col_socket, "rough": r_socket, "height": h_socket_in_metres}
    alb, h, r = T.bake_nodes(build, res=1024)            # numpy, albedo already sRGB
    T.save_set("my_surface", alb, h, rough=r, tile_m=4.0)

  Only 4D Noise / 4D Voronoi (and anything driven by them) are seamless. Wave/Brick/Magic
  and 2D/3D noise fed by plain UVs are NOT. Integer-period sin() of UV.x/UV.y is also fine.
"""
import os, json, math, zlib, struct
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "assets", "terrain")
BOOTH_DIR = os.path.join(ROOT, "assets", "booth")
RES = 1024


def rng(seed):
    return np.random.default_rng(seed)


# ============================================================== PNG io (no bpy needed)
def _png_chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, arr, bits=8):
    """arr: HxW or HxWx3 float in 0..1 (row 0 = top). bits 8 or 16."""
    a = np.clip(np.asarray(arr, dtype=np.float64), 0, 1)
    h, w = a.shape[:2]
    ch = 1 if a.ndim == 2 else a.shape[2]
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    if bits == 16:
        q = np.round(a * 65535).astype(">u2")
    else:
        q = np.round(a * 255).astype(np.uint8)
    q = q.reshape(h, w * ch)
    raw = b"".join(b"\x00" + q[i].tobytes() for i in range(h))
    data = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, bits, ctype, 0, 0, 0))
    data += _png_chunk(b"IDAT", zlib.compress(raw, 6)) + _png_chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


# ============================================================== colour helpers (sRGB floats)
def hexc(h):
    if not isinstance(h, str):
        return np.asarray(h, dtype=np.float32)
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def cjit(rg, amt):
    """Colour jitter multiplier: mostly LUMINANCE, only a little hue (per-channel jitter makes rainbow noise)."""
    return ((1 + rg.normal(0, amt)) * (1 + rg.normal(0, amt * 0.25, 3))).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float32), 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def ramp(t, colours, stops=None):
    """Map t (HxW in 0..1) through a list of hex colours -> HxWx3 sRGB."""
    cs = np.stack([hexc(c) if isinstance(c, str) else np.asarray(c, np.float32) for c in colours])
    n = len(cs)
    stops = np.linspace(0, 1, n) if stops is None else np.asarray(stops, np.float32)
    t = np.clip(t, 0, 1)
    out = np.empty(t.shape + (3,), np.float32)
    for k in range(3):
        out[..., k] = np.interp(t, stops, cs[:, k])
    return out


def mix(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 2 and np.ndim(a) == 3 or t.ndim == 2 and np.ndim(b) == 3:
        t = t[..., None]
    return a + (b - a) * t


def norm01(x, lo_pct=0.5, hi_pct=99.5):
    lo, hi = np.percentile(x, [lo_pct, hi_pct])
    return np.clip((x - lo) / max(hi - lo, 1e-9), 0, 1).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


# ============================================================== periodic noise
def _kgrid(res):
    k = np.fft.fftfreq(res) * res  # integer cycles per tile
    kx, ky = np.meshgrid(k, k)
    return np.sqrt(kx * kx + ky * ky)


_KCACHE = {}


def band(res, rg, k_lo, k_hi, beta=0.0, aniso=None):
    """Isotropic periodic noise with energy only between k_lo..k_hi cycles per TILE.
    beta: spectral slope (amplitude ~ k^-beta/2). aniso=(sx, sy) stretches: sx>1 means
    features elongated along x. Returns zero-mean, unit-std float32 HxW."""
    if aniso:
        k = np.fft.fftfreq(res) * res
        kx, ky = np.meshgrid(k, k)
        kk = np.sqrt((kx * aniso[0]) ** 2 + (ky * aniso[1]) ** 2)
    else:
        kk = _KCACHE.get(res)
        if kk is None:
            kk = _KCACHE[res] = _kgrid(res)
    w = rg.standard_normal((res, res)).astype(np.float32)
    F = np.fft.fft2(w)
    amp = np.where((kk >= k_lo) & (kk <= k_hi), 1.0, 0.0)
    # soft edges on the band so there's no ringing
    amp = amp * 1.0
    soft = np.clip((kk - k_lo * 0.7) / max(k_lo * 0.3, 1e-6), 0, 1) * np.clip((k_hi * 1.3 - kk) / (k_hi * 0.3), 0, 1)
    amp = np.maximum(amp, soft) * np.where(kk > 0, np.maximum(kk, 1e-6) ** (-beta / 2), 0)
    out = np.real(np.fft.ifft2(F * amp)).astype(np.float32)
    s = out.std()
    return out / (s if s > 0 else 1)


def fbm(res, rg, k_lo=2, k_hi=256, beta=2.0, aniso=None):
    """Fractal (1/f^beta) periodic noise, zero-mean unit-std."""
    return band(res, rg, k_lo, k_hi, beta, aniso)


def ridged(res, rg, k_lo, k_hi, beta=1.5):
    return 1 - np.abs(band(res, rg, k_lo, k_hi, beta)) / 2.5


def worley(res, n, rg, jitter=1.0):
    """Periodic Worley with n x n cells. Returns (F1, F2, cell_id) with distances in CELL units."""
    pts = (rg.random((n, n, 2)) - 0.5) * jitter + 0.5  # point offset within cell
    ids = rg.permutation(n * n).reshape(n, n)
    y, x = np.mgrid[0:res, 0:res].astype(np.float32) * (n / res)
    ci = np.floor(x).astype(int); cj = np.floor(y).astype(int)
    f1 = np.full((res, res), 9.0, np.float32); f2 = f1.copy(); cid = np.zeros((res, res), np.int32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ni = ci + di; nj = cj + dj
            p = pts[nj % n, ni % n]
            dx = ni + p[..., 0] - x; dy = nj + p[..., 1] - y
            d = np.sqrt(dx * dx + dy * dy)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, ids[nj % n, ni % n], cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def sample(field, x, y):
    """Bilinear sample with wrap. x=col, y=row in pixel units (arrays)."""
    H, W = field.shape[:2]
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = (x - x0).astype(np.float32); fy = (y - y0).astype(np.float32)
    x0 %= W; y0 %= H; x1 = (x0 + 1) % W; y1 = (y0 + 1) % H
    if field.ndim == 3:
        fx = fx[..., None]; fy = fy[..., None]
    a = field[y0, x0]; b = field[y0, x1]; c = field[y1, x0]; d = field[y1, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def warp(field, dx, dy):
    """Domain-warp a periodic field by displacement fields (pixels). Result stays periodic
    as long as dx, dy are periodic."""
    H, W = field.shape[:2]
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    return sample(field, x + dx, y + dy)


def blur(a, r):
    """Periodic Gaussian blur, sigma r pixels (FFT)."""
    if r <= 0:
        return a
    H, W = a.shape[:2]
    kx = np.fft.fftfreq(W)[None, :]; ky = np.fft.fftfreq(H)[:, None]
    g = np.exp(-2 * (math.pi * r) ** 2 * (kx * kx + ky * ky))
    if a.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])], -1).astype(np.float32)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)


def cavity(h, r=6, strength=None, lo=0.55):
    """Ambient-occlusion-like darkening (1 = open, <1 = crevice) from a height map in metres.
    r in pixels. Scaled by local relief so it works at any height range."""
    d = blur(h, r) - h
    s = strength if strength is not None else 1.0 / max(np.percentile(np.abs(d), 98), 1e-6)
    return np.clip(1 - np.clip(d * s, 0, None) * (1 - lo), lo, 1).astype(np.float32)


def periodic_line_dist(v, period):
    """Distance (same units) from v to the nearest multiple of period."""
    m = np.mod(v, period)
    return np.minimum(m, period - m)


# ============================================================== sprites + wrap-around stamping
class Stamper:
    """Z-buffer scatter: each stamp's pixels win where they are HIGHER than what's there.
    Order independent, so wrap-folding at the end is exact -> seamless.
      st = Stamper(res, pad=64, base_h=h0, base_col=c0, base_rough=r0)
      st.stamp(sprite, cx, cy, z=0.0, tint=(1,1,1))
      h, col, rough = st.result()
    sprite = dict(h=HxW metres (-inf/nan outside), col=HxWx3 sRGB, rough=HxW, a=HxW mask 0/1)."""

    def __init__(self, res, pad, base_h, base_col, base_rough):
        self.res, self.p = res, pad
        P = res + 2 * pad
        self.h = np.full((P, P), -1e9, np.float32)
        self.c = np.zeros((P, P, 3), np.float32)
        self.r = np.zeros((P, P), np.float32)
        self.base = (np.asarray(base_h, np.float32), np.asarray(base_col, np.float32),
                     np.broadcast_to(np.asarray(base_rough, np.float32), (res, res)))

    def stamp(self, sp, cx, cy, z=0.0, tint=None, rough_add=0.0):
        sh, sw = sp["h"].shape
        x0 = int(round(cx)) % self.res + self.p - sw // 2
        y0 = int(round(cy)) % self.res + self.p - sh // 2
        if x0 < 0 or y0 < 0 or x0 + sw > self.h.shape[1] or y0 + sh > self.h.shape[0]:
            return
        H = self.h[y0:y0 + sh, x0:x0 + sw]
        nh = sp["h"] + z
        m = (sp["a"] > 0.5) & (nh > H)
        if not m.any():
            return
        H[m] = nh[m]
        col = sp["col"] if tint is None else sp["col"] * np.asarray(tint, np.float32)
        self.c[y0:y0 + sh, x0:x0 + sw][m] = col[m]
        self.r[y0:y0 + sh, x0:x0 + sw][m] = sp["rough"][m] + rough_add

    def _fold(self, a, choose):
        p, R = self.p, self.res
        out_a = [x[p:p + R, p:p + R].copy() for x in a]
        # the eight wrap regions: fold each padded strip onto the opposite side
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                ys = slice(0, p) if dy < 0 else (slice(p + R, p + R + p) if dy > 0 else slice(p, p + R))
                xs = slice(0, p) if dx < 0 else (slice(p + R, p + R + p) if dx > 0 else slice(p, p + R))
                ty = slice(R - p, R) if dy < 0 else (slice(0, p) if dy > 0 else slice(0, R))
                tx = slice(R - p, R) if dx < 0 else (slice(0, p) if dx > 0 else slice(0, R))
                src = [x[ys, xs] for x in a]
                m = src[0] > out_a[0][ty, tx]
                for o, s in zip(out_a, src):
                    o[ty, tx][m] = s[m]
        return out_a

    def result(self):
        h, c, r = self._fold([self.h, self.c, self.r], None)
        bh, bc, br = self.base
        m = h > bh
        H = np.where(m, h, bh)
        C = np.where(m[..., None], c, bc)
        Rr = np.where(m, r, br)
        return H.astype(np.float32), C.astype(np.float32), Rr.astype(np.float32)


def _seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / max(vx * vx + vy * vy, 1e-9), 0, 1)
    dx = px - (ax + t * vx); dy = py - (ay + t * vy)
    return np.sqrt(dx * dx + dy * dy), t


def blade_tuft(rg, size_px, n_blades, blade_len, blade_w, height_m, col_base, col_tip,
               spread=1.0, curl=0.3, col_jit=0.06, dead_frac=0.0, col_dead="#a99a6a", rough=(0.75, 0.9),
               lean=None):
    """A grass tuft seen from above: blades radiating from the centre, each a tapered strip.
    size_px sprite size; blade_len/blade_w in pixels; height_m tallest blade height.
    lean=(dx,dy) biases blade direction (wind-laid grass)."""
    S = size_px
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    c = S / 2
    H = np.full((S, S), -1e9, np.float32); C = np.zeros((S, S, 3), np.float32)
    Rg = np.zeros((S, S), np.float32)
    cb, ct, cd = hexc(col_base), hexc(col_tip), hexc(col_dead)
    for _ in range(n_blades):
        ang = rg.uniform(0, 2 * math.pi)
        if lean is not None:
            ang = math.atan2(lean[1], lean[0]) + rg.normal(0, 0.8)
        L = blade_len * rg.uniform(0.5, 1.0)
        r0 = rg.uniform(0, 0.15) * blade_len * spread
        ax, ay = c + math.cos(ang) * r0, c + math.sin(ang) * r0
        # blade as 3 segments with curl
        pts = [(ax, ay)]
        a2 = ang
        for s in range(3):
            a2 += rg.normal(0, curl)
            px, py = pts[-1]
            pts.append((px + math.cos(a2) * L / 3 * spread, py + math.sin(a2) * L / 3 * spread))
        dead = rg.random() < dead_frac
        jit = cjit(rg, col_jit)
        hb = height_m * rg.uniform(0.55, 1.0)
        for s in range(3):
            d, t = _seg_dist(x, y, *pts[s], *pts[s + 1])
            tt = (s + t) / 3.0
            w = blade_w * (1 - 0.8 * tt) * 0.5 + 0.35
            m = d < w
            # height: blades rise from the root then arch over -> peak ~40% along
            hh = hb * (0.35 + 0.65 * np.sin(np.clip(tt, 0, 1) * math.pi * 0.85 + 0.15)) - d * 0.0005
            hh = hh * (1 - 0.15 * tt)
            upd = m & (hh > H)
            if not upd.any():
                continue
            col = (cb + (ct - cb) * tt[..., None]) if not dead else (cd * (0.8 + 0.25 * tt[..., None]))
            col = col * jit
            # blade midrib: slightly lighter centre line reads as a lit blade
            col = col * (1.0 + 0.10 * (1 - np.clip(d / max(w.max() if np.ndim(w) else w, 1e-3), 0, 1)))[..., None]
            H[upd] = hh[upd]; C[upd] = col[upd]
            Rg[upd] = rg.uniform(*rough) + (0.08 if dead else 0)
    a = (H > -1e8).astype(np.float32)
    return dict(h=H, col=C, rough=Rg, a=a)


def blob(rg, size_px, radius_px, height_m, col, rough=0.8, lumpy=0.25, elong=1.0, angle=None, col_jit=0.05,
         shade=0.25):
    """A rounded lump (stone, clod, leaf-ish, flower head). Dome height profile."""
    S = size_px
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2 + 0.5
    a = rg.uniform(0, math.pi) if angle is None else angle
    xr = x * math.cos(a) + y * math.sin(a); yr = -x * math.sin(a) + y * math.cos(a)
    th = np.arctan2(yr, xr)
    rr = radius_px * (1 + lumpy * (0.5 * np.sin(3 * th + rg.uniform(0, 6)) + 0.5 * np.sin(5 * th + rg.uniform(0, 6))) * 0.5)
    d = np.sqrt((xr / elong) ** 2 + yr ** 2) / np.maximum(rr, 1e-3)
    m = d < 1
    dome = np.sqrt(np.clip(1 - d * d, 0, 1))
    H = np.where(m, height_m * dome, -1e9).astype(np.float32)
    base = (hexc(col) if isinstance(col, str) else np.asarray(col, np.float32)) * cjit(rg, col_jit)
    C = base[None, None, :] * (1 - shade + shade * dome)[..., None]
    return dict(h=H, col=C.astype(np.float32), rough=np.full((S, S), rough, np.float32), a=m.astype(np.float32))


def leaf(rg, size_px, length_px, width_px, col, height_m=0.004, lobes=0, curl_h=0.006, rough=0.7, vein=True):
    """Flat leaf seen from above (optionally lobed = oak). Slight cupping height."""
    S = size_px
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2 + 0.5
    a = rg.uniform(0, 2 * math.pi)
    u = x * math.cos(a) + y * math.sin(a); v = -x * math.sin(a) + y * math.cos(a)
    t = u / (length_px / 2)  # -1..1 along leaf
    half = width_px / 2 * np.sqrt(np.clip(1 - t * t, 0, 1)) * (1 - 0.25 * t)
    if lobes:
        half = half * (0.72 + 0.28 * np.abs(np.sin((t + 1) * math.pi * lobes / 2)))
    m = (np.abs(v) < half) & (np.abs(t) <= 1)
    base = hexc(col) if isinstance(col, str) else np.asarray(col, np.float32)
    base = base * cjit(rg, 0.07)
    shade = 1 - 0.12 * (np.abs(v) / np.maximum(half, 1e-3))
    if vein:
        shade = shade + 0.10 * (np.abs(v) < 0.6)
    C = base[None, None, :] * shade[..., None]
    cup = curl_h * (np.abs(v) / np.maximum(half, 1e-3)) ** 2 * rg.uniform(0.3, 1) + curl_h * 0.5 * t * t
    H = np.where(m, height_m + cup, -1e9).astype(np.float32)
    return dict(h=H, col=C.astype(np.float32), rough=np.full((S, S), rough, np.float32), a=m.astype(np.float32))


def needle(rg, size_px, length_px, col, width_px=1.1, height_m=0.002, rough=0.65):
    S = size_px
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    a = rg.uniform(0, 2 * math.pi); c = S / 2
    ax, ay = c - math.cos(a) * length_px / 2, c - math.sin(a) * length_px / 2
    bx, by = c + math.cos(a) * length_px / 2, c + math.sin(a) * length_px / 2
    d, t = _seg_dist(x, y, ax, ay, bx, by)
    m = d < width_px * 0.5 + 0.2
    base = (hexc(col) if isinstance(col, str) else np.asarray(col, np.float32)) * cjit(rg, 0.08)
    C = np.broadcast_to(base, (S, S, 3)) * (1 - 0.15 * np.abs(t - 0.5))[..., None]
    H = np.where(m, height_m * (1 + 0.3 * np.sin(t * math.pi)), -1e9).astype(np.float32)
    return dict(h=H, col=C.astype(np.float32), rough=np.full((S, S), rough, np.float32), a=m.astype(np.float32))


def scatter_points(rg, res, n, density=None, min_dist=0.0):
    """n random points (x,y) in pixels; if density (HxW 0..1) is given, rejection-sample by it."""
    if density is None:
        return rg.random((n, 2)) * res
    out = []
    tries = 0
    while len(out) < n and tries < 40:
        cand = rg.random((n * 2, 2)) * res
        d = density[cand[:, 1].astype(int) % res, cand[:, 0].astype(int) % res]
        keep = cand[rg.random(len(cand)) < d]
        out.extend(keep.tolist()); tries += 1
    return np.array(out[:n])


# ============================================================== normal map + save
def height_to_normal(h_m, tile_m, boost=1.0):
    """OpenGL (+Y up) tangent-space normal from a height field in metres. Periodic gradients."""
    px = tile_m / h_m.shape[0]
    dx = (np.roll(h_m, -1, 1) - np.roll(h_m, 1, 1)) / (2 * px) * boost
    dy_rows = (np.roll(h_m, -1, 0) - np.roll(h_m, 1, 0)) / (2 * px) * boost
    # image row increases DOWN, texture +V is UP  ->  dh/dv = -dh/drow
    nx = -dx; ny = dy_rows; nz = np.ones_like(h_m)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


def seam_score(a):
    """Ratio of the wrap-edge step to the average interior neighbour step (both axes).
    ~1.0 means seamless; >1.5 means a visible seam."""
    a = np.asarray(a, np.float64)
    if a.ndim == 3:
        a = a.mean(-1)
    inner_x = np.abs(np.diff(a, axis=1)).mean(); inner_y = np.abs(np.diff(a, axis=0)).mean()
    edge_x = np.abs(a[:, 0] - a[:, -1]).mean(); edge_y = np.abs(a[0, :] - a[-1, :]).mean()
    return float(max(edge_x / max(inner_x, 1e-12), edge_y / max(inner_y, 1e-12)))


def splat_add(canvas, k, cx, cy, op="add"):
    """Add (or min/max) a small kernel into a periodic canvas centred at (cx, cy) px, wrapping."""
    kh, kw = k.shape[:2]
    H, W = canvas.shape[:2]
    ys = (np.arange(kh) + int(round(cy)) - kh // 2) % H
    xs = (np.arange(kw) + int(round(cx)) - kw // 2) % W
    ix = np.ix_(ys, xs)
    if op == "add":
        canvas[ix] += k
    elif op == "min":
        canvas[ix] = np.minimum(canvas[ix], k)
    else:
        canvas[ix] = np.maximum(canvas[ix], k)


def save_set(name, albedo, height_m, rough, tile_m, notes="", normal_boost=1.0, extra=None, normal_h=None):
    """albedo HxWx3 sRGB floats; height_m HxW metres; rough HxW or scalar (0..1).
    Clamps albedo into the art-bible band (sRGB 30..240) and writes the 4 maps + json."""
    res = height_m.shape[0]
    albedo = np.clip(albedo, 30 / 255, 240 / 255).astype(np.float32)
    rough = np.clip(np.broadcast_to(np.asarray(rough, np.float32), (res, res)), 0.03, 1)
    h = height_m.astype(np.float64)
    h0, h1 = float(h.min()), float(h.max())
    hn = (h - h0) / max(h1 - h0, 1e-9)
    # normal_h: optional alternative height (e.g. slightly blurred) to derive normals from
    nrm = height_to_normal((height_m if normal_h is None else normal_h).astype(np.float32), tile_m, normal_boost)
    p = lambda k: os.path.join(OUT_DIR, f"{name}_{k}.png")
    write_png(p("albedo"), albedo, 8)
    write_png(p("normal"), nrm, 8)
    write_png(p("rough"), rough, 8)
    write_png(p("height"), hn, 16)
    avg = albedo.reshape(-1, 3).mean(0)
    seams = {k: round(seam_score(v), 3) for k, v in (("albedo", albedo), ("height", h), ("rough", rough))}
    meta = dict(name=name, tile_m=tile_m, res=res,
                avg_srgb="#%02x%02x%02x" % tuple(int(round(c * 255)) for c in avg),
                avg_linear=[round(float(c), 4) for c in srgb_to_lin(avg)],
                height_range_m=round(h1 - h0, 4), height_min_m=round(h0, 4),
                rough_mean=round(float(rough.mean()), 3), normal_boost=normal_boost,
                normal="OpenGL +Y (three.js default)", seam_score=seams, notes=notes)
    if extra:
        meta.update(extra)
    with open(os.path.join(OUT_DIR, f"{name}.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"HG_TERRAIN {name} tile={tile_m}m avg={meta['avg_srgb']} relief={meta['height_range_m']}m seams={seams}")
    return meta


# ============================================================== Blender side (bpy imported lazily)
def torus_coord(nt, uv_socket=None, radius=1.0):
    """Return (vector_socket, w_socket) = (R cos2πu, R sin2πu, R cos2πv) , R sin2πv.
    Feed both into a Noise/Voronoi node set to 4D. Noise 'scale' s gives ~s*2πR/… features;
    use noise4d() which converts features-per-tile for you."""
    N, L = nt.nodes, nt.links
    if uv_socket is None:
        tc = N.new("ShaderNodeTexCoord"); uv_socket = tc.outputs["UV"]
    sep = N.new("ShaderNodeSeparateXYZ"); L.new(uv_socket, sep.inputs[0])

    def trig(src, fn):
        m1 = N.new("ShaderNodeMath"); m1.operation = "MULTIPLY"; m1.inputs[1].default_value = 2 * math.pi
        L.new(src, m1.inputs[0])
        m2 = N.new("ShaderNodeMath"); m2.operation = fn; L.new(m1.outputs[0], m2.inputs[0])
        m3 = N.new("ShaderNodeMath"); m3.operation = "MULTIPLY"; m3.inputs[1].default_value = radius
        L.new(m2.outputs[0], m3.inputs[0])
        return m3.outputs[0]
    comb = N.new("ShaderNodeCombineXYZ")
    L.new(trig(sep.outputs["X"], "COSINE"), comb.inputs[0])
    L.new(trig(sep.outputs["X"], "SINE"), comb.inputs[1])
    L.new(trig(sep.outputs["Y"], "COSINE"), comb.inputs[2])
    return comb.outputs[0], trig(sep.outputs["Y"], "SINE")


def noise4d(nt, vec, w, scale=4.0, detail=4.0, roughness=0.5, distortion=0.0, seed_offset=0.0):
    """4D noise node on the torus coordinate; `scale` ≈ features across the tile."""
    N, L = nt.nodes, nt.links
    n = N.new("ShaderNodeTexNoise"); n.noise_dimensions = "4D"
    n.inputs["Scale"].default_value = scale / (2 * math.pi)
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = roughness
    n.inputs["Distortion"].default_value = distortion
    L.new(vec, n.inputs["Vector"])
    if seed_offset:
        a = N.new("ShaderNodeMath"); a.operation = "ADD"; a.inputs[1].default_value = seed_offset
        L.new(w, a.inputs[0]); w = a.outputs[0]
    L.new(w, n.inputs["W"])
    return n


def voronoi4d(nt, vec, w, scale=8.0, feature="F1"):
    N, L = nt.nodes, nt.links
    v = N.new("ShaderNodeTexVoronoi"); v.voronoi_dimensions = "4D"; v.feature = feature
    v.inputs["Scale"].default_value = scale / (2 * math.pi)
    L.new(vec, v.inputs["Vector"]); L.new(w, v.inputs["W"])
    return v


def bake_nodes(build, res=RES, samples=1):
    """Bake a node-built material to numpy. build(node_tree) -> {"albedo","rough","height"} sockets
    (albedo linear colour as in any Blender material; height in metres). Returns
    (albedo_srgb HxWx3, height_m HxW, rough HxW), row 0 = top."""
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = samples
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    ob = bpy.context.object
    m = bpy.data.materials.new("tt_bake"); m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    socks = build(nt)
    ob.data.materials.append(m)
    img = bpy.data.images.new("tt_img", res, res, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = img; nt.nodes.active = tn
    sc.render.bake.margin = 0
    res_out = {}
    for key in ("albedo", "rough", "height"):
        s = socks.get(key)
        if s is None:
            continue
        for l in list(em.inputs["Color"].links):
            nt.links.remove(l)
        nt.links.new(s, em.inputs["Color"])
        em.inputs["Strength"].default_value = 1.0
        bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type="EMIT")
        px = np.empty(res * res * 4, np.float32); img.pixels.foreach_get(px)
        px = px.reshape(res, res, 4)[::-1]  # bpy rows are bottom-up
        res_out[key] = px[..., :3] if key == "albedo" else px[..., 0]
    alb = lin_to_srgb(res_out.get("albedo", np.full((res, res, 3), 0.2, np.float32)))
    return alb, res_out.get("height", np.zeros((res, res), np.float32)), res_out.get("rough", np.full((res, res), 0.85, np.float32))


def _load_img(path, noncolor):
    import bpy
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    return im


def surface_material(name, repeat=3.0, displace=False):
    """A Blender material that tiles the baked set `repeat` times over UV 0..1 (for previews/boards)."""
    import bpy
    m = bpy.data.materials.new("surf_" + name); m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N["Principled BSDF"]
    tc = N.new("ShaderNodeTexCoord"); mp = N.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (repeat, repeat, 1)
    L.new(tc.outputs["UV"], mp.inputs["Vector"])
    f = lambda k: os.path.join(OUT_DIR, f"{name}_{k}.png")
    ta = N.new("ShaderNodeTexImage"); ta.image = _load_img(f("albedo"), False)
    tr = N.new("ShaderNodeTexImage"); tr.image = _load_img(f("rough"), True)
    tn = N.new("ShaderNodeTexImage"); tn.image = _load_img(f("normal"), True)
    for t in (ta, tr, tn):
        t.interpolation = "Cubic"
        L.new(mp.outputs[0], t.inputs["Vector"])
    nm = N.new("ShaderNodeNormalMap")
    L.new(ta.outputs["Color"], b.inputs["Base Color"])
    L.new(tr.outputs["Color"], b.inputs["Roughness"])
    L.new(tn.outputs["Color"], nm.inputs["Color"]); L.new(nm.outputs[0], b.inputs["Normal"])
    b.inputs["Specular IOR Level"].default_value = 0.35
    return m


def add_surface_plane(name, size, location=(0, 0, 0), repeat=3, displace=True, subdiv=8):
    """Plane of `size` metres showing `repeat`x`repeat` tiles of `name`, with real displacement
    from the height map when the relief is significant."""
    import bpy
    meta = json.load(open(os.path.join(OUT_DIR, name + ".json")))
    bpy.ops.mesh.primitive_plane_add(size=size, location=location)
    ob = bpy.context.object; ob.name = "surf_" + name
    ob.data.materials.append(surface_material(name, repeat))
    # Only true GROUND relief is displaced (json "displace_m", e.g. furrows, ruts). Vegetation
    # height (grass, bushes, crops) is for splat height-blending and normals, never geometry.
    rel = meta.get("displace_m", 0.0) * (size / (meta["tile_m"] * repeat))  # proportional to display scale
    if displace and rel > 0.002:
        mod = ob.modifiers.new("sub", "SUBSURF"); mod.subdivision_type = "SIMPLE"
        mod.levels = mod.render_levels = subdiv
        tex = bpy.data.textures.new("dh_" + name, "IMAGE")
        tex.image = _load_img(os.path.join(OUT_DIR, name + "_height.png"), True)
        tex.repeat_x = tex.repeat_y = int(repeat); tex.extension = "REPEAT"
        d = ob.modifiers.new("disp", "DISPLACE"); d.texture = tex; d.texture_coords = "UV"
        d.strength = rel; d.mid_level = 0.5
    return ob, meta


def setup_rig(res_x=1024, res_y=1024, samples=32):
    """Art-bible lighting: warm sun 42° elevation from the SW + soft blue sky, AgX."""
    import bpy
    sc = bpy.context.scene
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 4.0; sun_d.color = (1.0, 0.95, 0.86); sun_d.angle = math.radians(1.5)
    sun = bpy.data.objects.new("sun", sun_d); sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(48), 0, math.radians(-135))
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1); bg.inputs["Strength"].default_value = 0.9
    sc.render.engine = "CYCLES"
    sc.cycles.device = "GPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"; prefs.get_devices()
        for d in prefs.devices:
            d.use = True
    except Exception:
        sc.cycles.device = "CPU"
    sc.cycles.samples = samples; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"
    sc.render.resolution_x = res_x; sc.render.resolution_y = res_y
    return sc


def game_camera(target, dist, lens=50, pitch_deg=55, ortho_scale=None):
    """Eagle camera: looks north (+Y) and down at pitch_deg."""
    import bpy
    from mathutils import Vector
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam); sc.camera = cam
    cd.lens = lens
    if ortho_scale:
        cd.type = "ORTHO"; cd.ortho_scale = ortho_scale
    p = math.radians(pitch_deg)
    t = Vector(target)
    cam.location = t + Vector((0, -math.cos(p), math.sin(p))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    cd.clip_start = 0.05; cd.clip_end = dist * 10
    return cam


def preview_tiled(name, n=3, out=None, res=900, pitch=55, top_down=False):
    """Render an n x n tiled plane of the set under the art-bible rig -> assets/booth/terrain_<name>_3x3.png.
    Seams show as lines/steps at the tile borders: Read the PNG."""
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    meta = json.load(open(os.path.join(OUT_DIR, name + ".json")))
    size = meta["tile_m"] * n
    add_surface_plane(name, size, repeat=n)
    setup_rig(res, res)
    if top_down:
        game_camera((0, 0, 0), size * 3, pitch_deg=89.9, ortho_scale=size)
    else:
        game_camera((0, 0, 0), size * 1.45, lens=50, pitch_deg=pitch)
    out = out or os.path.join(BOOTH_DIR, f"terrain_{name}_{n}x{n}.png")
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("HG_PREVIEW", out)
    return out
