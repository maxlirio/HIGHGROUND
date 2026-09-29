"""mapkit: dependency-free (numpy only) helpers for the HIGHGROUND map pipeline.

PNG writing, blurs, value/fbm noise, polyline distance fields, bitmap font.
Runs under system python3 (numpy) or Blender's bundled python.
"""
import struct
import zlib

import numpy as np


# ----------------------------------------------------------------------------- PNG
def write_png(path, arr):
    """uint8 (H,W) grey, uint8 (H,W,3) RGB, uint8 (H,W,4) RGBA, or uint16 (H,W) grey."""
    a = np.ascontiguousarray(arr)
    if a.dtype == np.uint16:
        h, w = a.shape
        ctype, depth, raw = 0, 16, a.astype(">u2").tobytes()
        stride = w * 2
    else:
        a = a.astype(np.uint8)
        if a.ndim == 2:
            ctype, ch = 0, 1
        else:
            ch = a.shape[2]
            ctype = {3: 2, 4: 6}[ch]
        h, w = a.shape[:2]
        depth, raw, stride = 8, a.tobytes(), w * ch
    rows = b"".join(b"\x00" + raw[y * stride:(y + 1) * stride] for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, ctype, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(rows, 6)))
        f.write(chunk(b"IEND", b""))


# ----------------------------------------------------------------------------- filters
def _box1d(a, r, axis):
    if r < 1:
        return a
    a = np.moveaxis(a, axis, 0)
    p = np.concatenate([np.repeat(a[:1], r + 1, 0), a, np.repeat(a[-1:], r, 0)], 0)
    c = np.cumsum(p, 0, dtype=np.float64)
    out = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
    return np.moveaxis(out, 0, axis)


def blur(a, sigma):
    """Approximate gaussian blur (3 box passes), sigma in pixels."""
    if sigma <= 0.3:
        return a.astype(np.float64)
    r = max(1, int(round(np.sqrt(12 * sigma * sigma / 3 + 1) / 2)))
    out = a.astype(np.float64)
    for _ in range(3):
        out = _box1d(out, r, 0)
        out = _box1d(out, r, 1)
    return out


def local_min(a, r):
    """Min filter over a (2r+1)^2 square window (separable, via shifts)."""
    out = a.copy()
    for ax in (0, 1):
        src = out.copy()
        for s in range(1, r + 1):
            out = np.minimum(out, shift(src, s, ax))
            out = np.minimum(out, shift(src, -s, ax))
    return out


def local_max(a, r):
    return -local_min(-a, r)


def shift(a, s, axis):
    """Shift with edge clamping: out[i] = a[i - s]."""
    n = a.shape[axis]
    idx = np.clip(np.arange(n) - s, 0, n - 1)
    return np.take(a, idx, axis=axis)


def sample_bilinear(a, fx, fy):
    """Sample a[row=fy, col=fx] with bilinear interpolation, clamped."""
    h, w = a.shape
    fx = np.clip(fx, 0, w - 1.0001)
    fy = np.clip(fy, 0, h - 1.0001)
    x0 = fx.astype(np.int64)
    y0 = fy.astype(np.int64)
    u = fx - x0
    v = fy - y0
    return ((a[y0, x0] * (1 - u) + a[y0, x0 + 1] * u) * (1 - v)
            + (a[y0 + 1, x0] * (1 - u) + a[y0 + 1, x0 + 1] * u) * v)


def upscale(a, k):
    h, w = a.shape[:2]
    ys = np.linspace(0, h - 1, h * k)
    xs = np.linspace(0, w - 1, w * k)
    FX, FY = np.meshgrid(xs, ys)
    if a.ndim == 2:
        return sample_bilinear(a, FX, FY)
    return np.stack([sample_bilinear(a[..., c], FX, FY) for c in range(a.shape[2])], -1)


# ----------------------------------------------------------------------------- noise
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def value_noise(X, Y, cell, rng):
    """Smooth value noise in [-1,1] sampled at world coords X,Y (same units as cell)."""
    gx = int(np.ceil((X.max() - X.min()) / cell)) + 4
    gy = int(np.ceil((Y.max() - Y.min()) / cell)) + 4
    grid = rng.uniform(-1, 1, (gy, gx))
    fx = (X - X.min()) / cell + 1
    fy = (Y - Y.min()) / cell + 1
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    u = fx - x0
    v = fy - y0
    u = u * u * u * (u * (u * 6 - 15) + 10)
    v = v * v * v * (v * (v * 6 - 15) + 10)
    a = grid[y0, x0]
    b = grid[y0, x0 + 1]
    c = grid[y0 + 1, x0]
    d = grid[y0 + 1, x0 + 1]
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v


def fbm(X, Y, cell, octaves, rng, gain=0.5, lac=2.0, ridged=False):
    tot = np.zeros_like(X)
    amp, norm, c = 1.0, 0.0, cell
    for _ in range(octaves):
        n = value_noise(X, Y, c, rng)
        if ridged:
            n = 1 - 2 * np.abs(n)
        tot += amp * n
        norm += amp
        amp *= gain
        c /= lac
    return tot / norm


# ----------------------------------------------------------------------------- geometry
def catmull(pts, per_seg=24):
    """Densify a polyline with a Catmull-Rom spline (passes through the points)."""
    p = np.asarray(pts, float)
    p = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for t in np.linspace(0, 1, per_seg, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(p[-2])
    return np.array(out)


def polyline_field(X, Y, pts, maxd=None):
    """Distance from each (X,Y) to polyline pts, arc-length param t of the nearest
    point, and signed side (+1 left of travel direction, -1 right).
    With maxd (only for the regular, unwarped grid: X[0,:] ascending, Y[:,0] descending)
    each segment is evaluated only inside its bbox grown by maxd; cells farther than that
    get d = 1e6, t = 0."""
    pts = np.asarray(pts, float)
    seg_len = np.hypot(*(pts[1:] - pts[:-1]).T)
    cum = np.concatenate([[0], np.cumsum(seg_len)])
    best = np.full(X.shape, np.inf)
    tt = np.zeros(X.shape)
    side = np.ones(X.shape)
    if maxd is not None:
        xs = X[0, :]
        ys = Y[:, 0]
        cell = xs[1] - xs[0]
        top = ys[0]
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        if L2 == 0:
            continue
        if maxd is not None:
            c0 = max(0, int((min(ax, bx) - maxd - xs[0]) / cell))
            c1 = min(len(xs), int((max(ax, bx) + maxd - xs[0]) / cell) + 2)
            r0 = max(0, int((top - max(ay, by) - maxd) / cell))
            r1 = min(len(ys), int((top - min(ay, by) + maxd) / cell) + 2)
            if c0 >= c1 or r0 >= r1:
                continue
            win = (slice(r0, r1), slice(c0, c1))
        else:
            win = (slice(None), slice(None))
        Xw, Yw = X[win], Y[win]
        s = np.clip(((Xw - ax) * dx + (Yw - ay) * dy) / L2, 0, 1)
        d = np.hypot(ax + s * dx - Xw, ay + s * dy - Yw)
        m = d < best[win]
        best[win] = np.where(m, d, best[win])
        tt[win] = np.where(m, cum[i] + s * np.sqrt(L2), tt[win])
        cr = dx * (Yw - ay) - dy * (Xw - ax)
        side[win] = np.where(m, np.where(cr >= 0, 1.0, -1.0), side[win])
    best[~np.isfinite(best)] = 1e6
    return best, tt, side, cum[-1]


# ----------------------------------------------------------------------------- font
_GLYPHS = {
    "A": "01110 10001 10001 11111 10001 10001 10001", "B": "11110 10001 10001 11110 10001 10001 11110",
    "C": "01110 10001 10000 10000 10000 10001 01110", "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111", "F": "11111 10000 10000 11110 10000 10000 10000",
    "G": "01110 10001 10000 10111 10001 10001 01111", "H": "10001 10001 10001 11111 10001 10001 10001",
    "I": "01110 00100 00100 00100 00100 00100 01110", "J": "00111 00010 00010 00010 00010 10010 01100",
    "K": "10001 10010 10100 11000 10100 10010 10001", "L": "10000 10000 10000 10000 10000 10000 11111",
    "M": "10001 11011 10101 10101 10001 10001 10001", "N": "10001 11001 10101 10011 10001 10001 10001",
    "O": "01110 10001 10001 10001 10001 10001 01110", "P": "11110 10001 10001 11110 10000 10000 10000",
    "Q": "01110 10001 10001 10001 10101 10010 01101", "R": "11110 10001 10001 11110 10100 10010 10001",
    "S": "01111 10000 10000 01110 00001 00001 11110", "T": "11111 00100 00100 00100 00100 00100 00100",
    "U": "10001 10001 10001 10001 10001 10001 01110", "V": "10001 10001 10001 10001 10001 01010 00100",
    "W": "10001 10001 10001 10101 10101 10101 01010", "X": "10001 10001 01010 00100 01010 10001 10001",
    "Y": "10001 10001 01010 00100 00100 00100 00100", "Z": "11111 00001 00010 00100 01000 10000 11111",
    "0": "01110 10011 10101 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
    "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11110 00001 00001 01110 00001 00001 11110",
    "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
    "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
    " ": "00000 00000 00000 00000 00000 00000 00000", "-": "00000 00000 00000 11111 00000 00000 00000",
    ".": "00000 00000 00000 00000 00000 01100 01100", "'": "00100 00100 01000 00000 00000 00000 00000",
    "(": "00010 00100 01000 01000 01000 00100 00010", ")": "01000 00100 00010 00010 00010 00100 01000",
    "/": "00001 00010 00010 00100 01000 01000 10000", ",": "00000 00000 00000 00000 01100 00100 01000",
    ":": "00000 01100 01100 00000 01100 01100 00000", "+": "00000 00100 00100 11111 00100 00100 00000",
}
_GL = {k: np.array([[c == "1" for c in row] for row in v.split()], bool) for k, v in _GLYPHS.items()}


def text_mask(s, scale=2):
    s = s.upper()
    cols = []
    for ch in s:
        g = _GL.get(ch, _GL[" "])
        cols.append(g)
        cols.append(np.zeros((7, 1), bool))
    m = np.hstack(cols) if cols else np.zeros((7, 1), bool)
    return np.kron(m, np.ones((scale, scale), bool))


def draw_text(img, s, x, y, color, scale=2, halo=(245, 240, 225)):
    """Draw text with a light halo onto an RGB float/uint8 image; (x,y) = top-left px."""
    m = text_mask(s, scale)
    h, w = m.shape
    H, W = img.shape[:2]
    x = int(np.clip(x, 2, W - w - 2))
    y = int(np.clip(y, 2, H - h - 2))
    hm = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            hm |= np.roll(np.roll(m, dy, 0), dx, 1)
    pad = np.zeros((h + 4, w + 4), bool)
    pad[2:-2, 2:-2] = hm
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            pad[2 + dy:h + 2 + dy, 2 + dx:w + 2 + dx] |= m
    reg = img[y - 2:y + h + 2, x - 2:x + w + 2]
    reg[pad] = reg[pad] * 0.25 + np.array(halo) * 0.75
    img[y:y + h, x:x + w][m] = color
    return w, h
