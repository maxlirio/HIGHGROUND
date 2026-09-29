"""Procedural hair texture for mane/tail/forelock cards (numpy, no bpy).

The texture lives in the top strip of the horse atlas (v in [BODY_V, 1]); it is split into 4 tiles
across u (styles): 0 mane main lock, 1 mane thin/short lock, 2 short upright crest, 3 tail.
Strands run along v: root at the top of the strip (v=1), tips toward v=BODY_V.
Returns float arrays (H, W): luminance (sRGB 0..1) and alpha coverage.
"""
import numpy as np


def hair_strip(W, H, shaggy, seed=3):
    rng = np.random.default_rng(seed)
    lum = np.zeros((H, W), np.float32)
    cov = np.zeros((H, W), np.float32)
    tiles = 4
    tw = W // tiles
    for tile in range(tiles):
        x0 = tile * tw
        n_locks = [16, 12, 16, 16][tile]
        dens = [60, 50, 45, 70][tile]
        for lock in range(n_locks):
            cx = x0 + (lock + 0.5 + rng.uniform(-0.3, 0.3)) * tw / n_locks
            lock_len = 1.0
            lock_w = tw / n_locks * rng.uniform(0.7, 1.3)
            wave_a = rng.uniform(0.5, 3.0) * (1 + 2 * shaggy)
            wave_f = rng.uniform(2, 6)
            ph = rng.uniform(0, 6.28)
            drift = rng.uniform(-0.25, 0.25) * lock_w
            base_l = rng.uniform(0.42, 0.62)
            for s in range(dens):
                off = rng.normal(0, lock_w * 0.28)
                ln = lock_len * rng.uniform(0.85, 1.0)
                l = base_l + rng.normal(0, 0.08)
                rows = int(ln * H)
                if rows < 3: continue
                t = np.arange(rows) / H                    # 0 at root
                xs = cx + off + drift * (t / lock_len) ** 1.5 + wave_a * np.sin(t * wave_f * 6.28 + ph) \
                    + rng.normal(0, 0.4 * shaggy, rows).cumsum() * 0.15
                # strands converge a little at the tip (locks taper)
                xs = cx + (xs - cx) * (1 - 0.45 * (t / max(ln, 1e-3)) ** 2)
                yy = H - 1 - np.arange(rows)
                width = 0.9 + 0.5 * rng.random()
                for dx in (-1, 0, 1):
                    xi = np.floor(xs).astype(int) + dx
                    wgt = np.clip(1.0 - np.abs(xs - (xi + 0.5)) / width, 0, 1)
                    ok = (xi >= x0) & (xi < x0 + tw)
                    tipfade = np.clip((rows - np.arange(rows)) / 6.0, 0, 1)
                    w = wgt * tipfade
                    shade = l * (0.85 + 0.15 * np.cos(t * 40 + s)) * (0.8 + 0.2 * np.minimum(t * 12, 1))
                    lum[yy[ok], xi[ok]] = np.maximum(lum[yy[ok], xi[ok]], (shade * w)[ok])
                    cov[yy[ok], xi[ok]] = np.minimum(1.0, cov[yy[ok], xi[ok]] + w[ok] * 0.6)
    # lum where covered: normalise brightness by coverage so thin tips aren't black
    L = np.where(cov > 0.05, lum / np.maximum(cov, 0.35), 0.3)
    # locks are opaque ribbons: gaps between strands read as darker hair underneath, not holes
    L = np.where(cov > 0.05, L, 0.35)
    L = 0.70 * L / max(float(L.mean()), 1e-3)          # centre on NEUTRAL (sRGB 0.70)
    L = np.clip(L, 0.25, 0.95)
    # clip-ready alpha: coverage pushed through a soft threshold
    A = np.clip((cov - 0.25) * 2.2, 0, 1)
    # pad the colour into transparent texels so mip filtering doesn't bleed black
    return L, A
