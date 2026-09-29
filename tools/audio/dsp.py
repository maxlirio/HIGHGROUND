"""Core DSP for HIGHGROUND's offline sound synthesis (numpy + scipy only; every sample is made here).

Conventions: mono signals are 1-D float64 arrays, stereo are (n, 2); SR = 48 kHz; all randomness comes from
an explicit numpy Generator so every render is reproducible from its seed.
"""
import numpy as np
from scipy import signal

SR = 48000


def secs(n):
    return int(round(n * SR))


def t_axis(dur):
    return np.arange(secs(dur)) / SR


# ------------------------------------------------------------------ noise
def white(rng, n):
    return rng.standard_normal(n)


def coloured(rng, n, slope_db_oct):
    """Noise with a spectral slope (dB/octave): -3 = pink, -6 = brown, +3 = blue."""
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    X *= (f / 1000.0) ** (slope_db_oct / 6.0206)
    y = np.fft.irfft(X, n)
    return y / (np.std(y) + 1e-12)


def pink(rng, n):
    return coloured(rng, n, -3)


def brown(rng, n):
    return coloured(rng, n, -6)


# ------------------------------------------------------------------ filters
def _sos(kind, f, order=2, q=None):
    nyq = SR / 2
    if kind in ("lp", "hp"):
        return signal.butter(order, min(f, nyq * 0.98) / nyq, "low" if kind == "lp" else "high", output="sos")
    lo, hi = f
    return signal.butter(order, [max(lo, 5) / nyq, min(hi, nyq * 0.98) / nyq], "band", output="sos")


def lp(x, f, order=2):
    return signal.sosfilt(_sos("lp", f, order), x, axis=0)


def hp(x, f, order=2):
    return signal.sosfilt(_sos("hp", f, order), x, axis=0)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos("bp", (lo, hi), order), x, axis=0)


def peq(x, f, gain_db, q=1.0):
    """RBJ peaking EQ."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f / SR
    al = np.sin(w0) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w0), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w0), 1 - al / A]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def shelf(x, f, gain_db, high=True):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f / SR
    al = np.sin(w0) / 2 * np.sqrt(2)
    c = np.cos(w0)
    sA = 2 * np.sqrt(A) * al
    if high:
        b = [A * ((A + 1) + (A - 1) * c + sA), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sA)]
        a = [(A + 1) - (A - 1) * c + sA, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sA]
    else:
        b = [A * ((A + 1) - (A - 1) * c + sA), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sA)]
        a = [(A + 1) + (A - 1) * c + sA, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sA]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def resonator(x, f, tau):
    """Two-pole resonator (a single vibrating mode) driven by x: centre f Hz, 1/e decay time tau s."""
    r = np.exp(-1.0 / (tau * SR))
    th = 2 * np.pi * f / SR
    a = [1, -2 * r * np.cos(th), r * r]
    b = [np.sin(th)]  # impulse-normalised: a unit strike leaves every mode ringing at amplitude ~1
    return signal.lfilter(b, a, x)


def modal(x, freqs, taus, amps):
    """Bank of modes excited by x (the physical way: excitation shapes which modes speak)."""
    y = np.zeros(len(x))
    for f, tau, a in zip(freqs, taus, amps):
        if f >= SR * 0.47:
            continue
        y += a * resonator(x, f, tau)
    return y


def tv_filter(x, coef_fn, block=64):
    """Time-varying IIR: coef_fn(t_seconds) -> (b, a) per block, state carried across blocks."""
    y = np.zeros_like(x)
    zi = None
    for i in range(0, len(x), block):
        b, a = coef_fn(i / SR)
        if zi is None:
            zi = np.zeros(max(len(a), len(b)) - 1)
        y[i:i + block], zi = signal.lfilter(b, a, x[i:i + block], zi=zi)
    return y


def svf_bp_coefs(f, q):
    w0 = 2 * np.pi * min(f, SR * 0.45) / SR
    al = np.sin(w0) / (2 * q)
    b = np.array([al, 0, -al])
    a = np.array([1 + al, -2 * np.cos(w0), 1 - al])
    return b / a[0], a / a[0]


def svf_lp_coefs(f, q=0.707):
    w0 = 2 * np.pi * min(f, SR * 0.45) / SR
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    b = np.array([(1 - c) / 2, 1 - c, (1 - c) / 2])
    a = np.array([1 + al, -2 * c, 1 - al])
    return b / a[0], a / a[0]


def sweep_bp(x, f_fn, q):
    return tv_filter(x, lambda t: svf_bp_coefs(f_fn(t), q))


def sweep_lp(x, f_fn, q=0.707):
    return tv_filter(x, lambda t: svf_lp_coefs(f_fn(t), q))


# ------------------------------------------------------------------ envelopes
def env_exp(n, tau, attack=0.0):
    t = np.arange(n) / SR
    e = np.exp(-t / tau)
    if attack > 0:
        e *= np.clip(t / attack, 0, 1)
    return e


def env_adsr(n, a, d, s, r, hold=None):
    t = np.arange(n) / SR
    T = n / SR
    hold = T - r if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    return e * (1 - rel) ** 2


def smooth_random(rng, n, rate_hz, lo=0.0, hi=1.0):
    """Slowly wandering control signal (cubic-interpolated random points)."""
    k = max(4, int(n / SR * rate_hz) + 4)
    pts = rng.uniform(lo, hi, k)
    xs = np.linspace(0, n, k)
    from scipy.interpolate import CubicSpline
    return np.clip(CubicSpline(xs, pts)(np.arange(n)), min(lo, hi), max(lo, hi))


def fade(x, fin=0.002, fout=0.01):
    x = x.copy()
    a, b = secs(fin), secs(fout)
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None] if x.ndim == 2 else np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None] if x.ndim == 2 else np.linspace(1, 0, b)
    return x


def place(buf, x, at, gain=1.0):
    """Mix x into buf starting at sample index `at` (mono into mono, mono into stereo with pan tuple, stereo)."""
    if at >= len(buf):
        return
    n = min(len(x), len(buf) - at)
    if n <= 0:
        return
    buf[at:at + n] += gain * x[:n]


def pan_mono(x, pan):
    """Equal-power pan, pan in [-1, 1] -> (n, 2)."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def distance_colour(x, d):
    """Air absorption + ground effect for a source d metres away (for pre-mixed beds)."""
    fc = float(np.clip(20000 * np.exp(-d / 120.0), 900, 20000))
    y = lp(x, fc, 1) if fc < 19000 else x
    return y / (1 + d / 8.0)


# ------------------------------------------------------------------ synthesis building blocks
def click(rng, dur=0.002, bright=8000):
    n = max(8, secs(dur))
    x = rng.standard_normal(n) * np.exp(-np.arange(n) / (n / 4))
    return lp(x, bright, 2)


def karplus(rng, f0, dur, damp=0.996, bright=0.5, excite=None):
    """Plucked string (Karplus-Strong with a one-zero loss filter and fractional delay by allpass)."""
    n = secs(dur)
    L = SR / f0
    N = int(L)
    frac = L - N
    c = (1 - frac) / (1 + frac)
    buf = (rng.uniform(-1, 1, N) if excite is None else np.resize(excite, N)).astype(float)
    buf = lp(buf, 1500 + 12000 * bright, 1)
    y = np.zeros(n)
    idx = 0
    prev_in = 0.0
    prev_out = 0.0
    for i in range(n):
        s = buf[idx]
        y[i] = s
        nxt = buf[(idx + 1) % N]
        v = damp * (bright * s + (1 - bright) * 0.5 * (s + nxt))
        ap = c * v + prev_in - c * prev_out  # allpass for the fractional part of the period
        prev_in, prev_out = v, ap
        buf[idx] = ap
        idx = (idx + 1) % N
    return y


def glide_sine(f_fn, dur, phase=0.0):
    t = t_axis(dur)
    f = f_fn(t)
    ph = phase + 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph)


# ------------------------------------------------------------------ reverb (our own impulse responses)
def make_ir(rng, dur=2.6, rt_low=1.5, rt_high=0.45, predelay=0.012, echoes=((0.34, 0.16), (0.61, 0.09)), density_ms=0.35):
    """Stereo outdoor IR for a green vale: ground reflection, a scatter of early reflections from trees and
    buildings, a frequency-dependent diffuse tail (highs die quicker in open air) and a couple of slap echoes
    off the hillsides."""
    n = secs(dur)
    ir = np.zeros((n, 2))
    # diffuse tail: sum of octave bands each with its own decay
    bands = [(40, 180), (180, 500), (500, 1400), (1400, 4000), (4000, 12000)]
    t = np.arange(n) / SR
    for k, (lo, hi) in enumerate(bands):
        rt = rt_low * (rt_high / rt_low) ** (k / (len(bands) - 1))
        dec = np.exp(-6.91 * t / rt)
        for ch in range(2):
            nz = bp(rng.standard_normal(n), lo, hi, 2)
            ir[:, ch] += nz * dec
    # build-up: diffuse field grows over the first ~60 ms (outdoors it never gets dense)
    ir *= (1 - np.exp(-t / 0.035))[:, None]
    ir *= 0.18
    # early reflections
    pd = secs(predelay)
    ir[:pd] = 0
    ir[0, :] += 1.0  # direct (the convolver is used as a send, direct gets removed below)
    for _ in range(26):
        tt = rng.uniform(0.004, 0.14)
        g = rng.uniform(0.08, 0.35) * np.exp(-tt / 0.08)
        i = secs(tt)
        ch = rng.integers(0, 2)
        ir[i, ch] += g * rng.choice([-1, 1])
        ir[min(n - 1, i + rng.integers(3, 40)), 1 - ch] += g * 0.6
    for tt, g in echoes:  # hillside slaps: dull, a little smeared
        e = np.zeros(secs(0.05))
        e[0] = 1
        e = lp(np.convolve(e, np.exp(-np.arange(200) / 40.0))[:len(e)], 1400, 2)
        for ch, off in ((0, 0), (1, secs(rng.uniform(0.002, 0.012)))):
            place(ir[:, ch], e * g * 3, secs(tt) + off)
    ir[0, :] = 0  # wet only
    ir = fade(ir, 0.0, 0.3)
    # unit energy per channel: a convolution with this IR neither boosts nor cuts the power of what goes in,
    # so 'wet' is a true send level (the runtime ConvolverNode re-normalises the same way after decoding)
    return ir / np.sqrt(np.mean(np.sum(ir ** 2, axis=0)))


def convolve(x, ir, wet=0.3, dry=1.0):
    """x mono or stereo, ir stereo -> stereo."""
    if x.ndim == 1:
        x2 = np.stack([x, x], 1)
    else:
        x2 = x
    n = len(x2) + len(ir) - 1
    out = np.zeros((n, 2))
    for ch in range(2):
        out[:, ch] = signal.fftconvolve(x2[:, ch], ir[:, ch])
    out *= wet
    out[:len(x2)] += dry * x2
    return out


# ------------------------------------------------------------------ loudness (ITU-R BS.1770) and mastering
def _kweight(x):
    # stage 1: high shelf (+4 dB ~1.5 kHz), stage 2: RLB high-pass ~38 Hz  (BS.1770 coefficients, re-derived for SR)
    y = shelf(x, 1681.97, 4.0, high=True)
    return hp(y, 38.1, 2)


def loudness(x, gate=True):
    """Integrated loudness in LUFS (mono or stereo)."""
    x2 = x[:, None] if x.ndim == 1 else x
    k = _kweight(x2)
    blk, hop = secs(0.4), secs(0.1)
    if len(k) < blk:
        k = np.pad(k, ((0, blk - len(k)), (0, 0)))
    ms = np.array([np.sum(np.mean(k[i:i + blk] ** 2, axis=0)) for i in range(0, len(k) - blk + 1, hop)])
    L = -0.691 + 10 * np.log10(ms + 1e-20)
    if not gate:
        return float(-0.691 + 10 * np.log10(np.mean(ms) + 1e-20))
    g = ms[L > -70]
    if not len(g):
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(g)) - 10
    g2 = ms[(L > -70) & (L > rel)]
    return float(-0.691 + 10 * np.log10(np.mean(g2) + 1e-20))


def momentary_max(x):
    x2 = x[:, None] if x.ndim == 1 else x
    k = _kweight(x2)
    blk, hop = secs(0.4), secs(0.02)
    if len(k) < blk:
        k = np.pad(k, ((0, blk - len(k)), (0, 0)))
    best = max(np.sum(np.mean(k[i:i + blk] ** 2, axis=0)) for i in range(0, len(k) - blk + 1, hop))
    return float(-0.691 + 10 * np.log10(best + 1e-20))


def true_peak_db(x):
    x2 = x[:, None] if x.ndim == 1 else x
    up = signal.resample_poly(x2, 4, 1, axis=0)
    return float(20 * np.log10(np.max(np.abs(up)) + 1e-20))


def soft_limit(x, ceiling_db=-1.0):
    """Transparent-ish peak control: look-ahead gain computer (5 ms attack, 80 ms release) to the ceiling."""
    c = 10 ** (ceiling_db / 20)
    mono = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    need = np.minimum(1.0, c / np.maximum(mono, 1e-9))
    la = secs(0.005)
    # look-ahead minimum, then smooth release
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(need, size=2 * la + 1, mode="nearest")
    rel = np.exp(-1 / (0.08 * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):  # one pass; ok for our short files
        cur = g[i] if g[i] < cur else rel * cur + (1 - rel) * g[i]
        out[i] = cur
    att = np.exp(-1 / (0.002 * SR))
    out = signal.lfilter([1 - att], [1, -att], out[::-1])[::-1]
    out = np.minimum(out, g * 0 + 1)
    y = x * (out[:, None] if x.ndim == 2 else out)
    pk = np.max(np.abs(y))
    if pk > c:
        y *= c / pk
    return y


def master(x, target, mode="momentary", ceiling_db=-1.0, max_gr_db=6.0):
    """Normalise to a loudness target (LUFS) with true peak under the ceiling. Where the peak is in the way the
    look-ahead limiter shaves up to max_gr_db of it (keeping the attack's punch), then the level is re-set."""
    x = np.nan_to_num(x)
    meas = (lambda y: momentary_max(y)) if mode == "momentary" else (lambda y: loudness(y))
    src = x
    gain_db = target - meas(x)
    for _ in range(4):
        y = src * 10 ** (gain_db / 20)
        tp = true_peak_db(y)
        if tp > ceiling_db:
            over = min(tp - ceiling_db, max_gr_db)
            y = y * 10 ** (-(tp - ceiling_db - over) / 20)  # what the limiter may not take, plain gain does
            y = soft_limit(y, ceiling_db - 0.3)
        short = target - meas(y)
        if abs(short) < 0.3 or tp <= ceiling_db:
            break
        gain_db += min(short, max_gr_db)
    tp = true_peak_db(y)
    if tp > ceiling_db:
        y = y * 10 ** ((ceiling_db - 0.1 - tp) / 20)
    return y


def trim_tail(x, thresh_db=-62):
    """Cut the silent tail (keeps a 20 ms fade)."""
    e = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    th = np.max(e) * 10 ** (thresh_db / 20)
    idx = np.nonzero(e > th)[0]
    end = min(len(x), (idx[-1] if len(idx) else len(x)) + secs(0.02))
    return fade(x[:end], 0, 0.02)


def make_loop(x, xfade):
    """Seamless loop: the overhang beyond the loop length is crossfaded (equal power) into the head.
    x has length L + X; returns length L."""
    X = secs(xfade)
    L = len(x) - X
    y = x[:L].copy()
    th = np.linspace(0, np.pi / 2, X)
    fi, fo = np.sin(th), np.cos(th)
    if x.ndim == 2:
        fi, fo = fi[:, None], fo[:, None]
    y[:X] = x[:X] * fi + x[L:] * fo
    return y
