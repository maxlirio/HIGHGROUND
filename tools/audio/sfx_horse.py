"""Horses: hooves on turf, the four-beat gallop and two-beat trot, harness, breathing, whinny and snort.

 * a hoof on turf is mostly ground: a low thump (~50-120 Hz) from ~500 kg landing, a dull knock of the hoof
   wall (~1-2 kHz) and a spray of turf/dirt; shod hooves on firm ground add a click.
 * the gallop is a four-beat gait (hind-L, hind-R, fore-L, fore-R, then a moment of suspension) at ~2.0-2.4
   strides/s; the trot is two-beat (diagonal pairs, slightly flammed) at ~1.3-1.6 strides/s. At the canter
   and gallop a horse breathes once per stride — the snorting exhalation locked to the hoofbeats.
 * a whinny starts high (~800-1100 Hz), pulses (~10-14 Hz) as it descends, and ends in a low nasal nicker.
"""
import numpy as np
from dsp import SR, secs, lp, hp, bp, modal, click, env_exp, fade, place, pan_mono, smooth_random
from voice import voice, vocal_tract, glottal


def hoof(rng, weight=1.0, firm=0.3):
    n = secs(0.3)
    k = np.arange(n) / SR
    f = rng.uniform(55, 95) * (1 + 0.8 * np.exp(-k / 0.01))
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-k / rng.uniform(0.03, 0.05)) * 1.6 * weight
    body = lp(rng.standard_normal(n), rng.uniform(300, 600), 2) * np.exp(-k / 0.02) * 1.1
    ex = np.zeros(n)
    ex[0] = 1
    knock = modal(ex, rng.uniform(700, 2200, 4), rng.uniform(0.006, 0.015, 4), [1, .7, .5, .4]) * 0.5
    turf = bp(rng.standard_normal(n), 1500, 7000) * np.exp(-k / 0.035) * np.clip(k / 0.008, 0, 1) * 0.22
    y = thump + body + knock + turf
    if rng.uniform() < firm:
        place(y, click(rng, 0.001, 9000) * 0.6, 0)
    return fade(y, 0.0005, 0.05)


def exhale(rng, dur=0.18):
    n = secs(dur)
    x = rng.standard_normal(n)
    y = bp(x, 250, 1400, 2) * np.hanning(n) ** 0.7
    flutter = 1 + 0.5 * np.sin(2 * np.pi * rng.uniform(25, 40) * np.arange(n) / SR)  # nostril flutter
    return y * flutter * 0.5


def harness(rng, dur):
    """Bits, buckles, stirrups: sparse little metallic ticks."""
    n = secs(dur)
    y = np.zeros(n)
    t = 0
    while t < dur:
        ex = np.zeros(secs(0.08))
        ex[0] = 1
        y_ = modal(ex, rng.uniform(1500, 6000, 3), rng.uniform(0.01, 0.05, 3), [1, .6, .4])
        place(y, y_ * rng.uniform(0.05, 0.2), secs(t))
        t += rng.exponential(0.12)
    return y


def gait(rng, dur, pace="gallop", weight=1.0, stride=None, breath=True):
    """One horse, mono, for dur seconds."""
    n = secs(dur)
    y = np.zeros(n)
    if pace == "gallop":
        stride = stride or rng.uniform(2.0, 2.4)
        beats = [0.0, 0.11, 0.23, 0.31]
    elif pace == "canter":
        stride = stride or rng.uniform(1.6, 1.9)
        beats = [0.0, 0.2, 0.21, 0.38]
    else:  # trot
        stride = stride or rng.uniform(1.3, 1.6)
        beats = [0.0, 0.012, 0.5, 0.51]
    T = 1 / stride
    t = rng.uniform(0, T)
    while t < dur:
        for b in beats:
            tt = t + b * T + rng.normal(0, 0.006)
            if 0 <= tt < dur:
                place(y, hoof(rng, weight * rng.uniform(0.7, 1.1)), secs(tt))
        if breath and pace != "trot":
            place(y, exhale(rng, 0.16 * T / 0.45) * 0.6, secs(t + 0.32 * T))
        t += T * rng.uniform(0.97, 1.03)
    y += harness(rng, dur) * (1.0 if pace != "trot" else 0.6)
    return y


def whinny(rng):
    d = rng.uniform(1.1, 1.6)
    n = secs(d)
    u = np.linspace(0, 1, n)
    f0 = np.interp(u, [0, 0.08, 0.4, 0.8, 1], np.array([700, 1050, 820, 520, 380]) * rng.uniform(0.85, 1.1))
    puls = rng.uniform(10, 14)
    f0 = f0 * (1 + 0.07 * np.sin(2 * np.pi * puls * np.arange(n) / SR))
    src, _ = glottal(rng, f0, oq=0.55, sharp=0.25, jitter=0.03, shimmer=0.2, breath=0.3)
    y = vocal_tract(src, ["horse", "horse", "u"], [0, 0.6, 1], scale=1.1)
    am = 0.6 + 0.4 * np.sin(2 * np.pi * puls * np.arange(n) / SR) ** 2
    y *= am * np.interp(u, [0, 0.05, 0.7, 1], [0, 1, 0.7, 0])
    # nicker: low nasal pulses at the end
    nk = secs(0.4)
    f1 = np.full(nk, rng.uniform(95, 130))
    s2, _ = glottal(rng, f1, oq=0.4, sharp=0.2, jitter=0.05, shimmer=0.3, breath=0.2)
    s2 = vocal_tract(s2, ["u"], scale=0.8) * (np.sin(2 * np.pi * 9 * np.arange(nk) / SR) > 0) * np.hanning(nk)
    out = np.zeros(n + nk)
    out[:n] += y
    out[n - secs(0.1):n - secs(0.1) + nk] += s2 * 0.6
    return fade(hp(out, 90), 0.005, 0.05)


def snort(rng):
    n = secs(rng.uniform(0.35, 0.6))
    k = np.arange(n) / SR
    x = rng.standard_normal(n)
    y = bp(x, 200, 1600, 2) * (1 + 0.8 * np.sin(2 * np.pi * rng.uniform(28, 45) * k))
    y *= np.exp(-k / (n / SR * 0.35)) * np.clip(k / 0.01, 0, 1)
    return fade(y, 0.002, 0.05)


def horse_scream(rng):
    """A wounded horse: a high, harsh, broken whinny."""
    d = rng.uniform(0.9, 1.4)
    n = secs(d)
    u = np.linspace(0, 1, n)
    f0 = np.interp(u, [0, 0.1, 0.5, 1], np.array([900, 1300, 1000, 500]) * rng.uniform(0.9, 1.1))
    f0 *= 1 + 0.1 * smooth_random(rng, n, 25, -1, 1)
    src, _ = glottal(rng, f0, oq=0.5, sharp=0.15, jitter=0.06, shimmer=0.3, breath=0.4)
    sub, _ = glottal(rng, f0 * 0.5, oq=0.5, sharp=0.2, jitter=0.06, shimmer=0.3, breath=0)
    y = vocal_tract(src + 0.4 * sub, ["horse", "a"], scale=1.15) * np.interp(u, [0, 0.05, 0.7, 1], [0, 1, 0.8, 0])
    return fade(hp(y, 150), 0.003, 0.05)


def charge_by(rng, n_horses=12, dur=6.0):
    """Cavalry thundering past (stereo): a swell of hooves that peaks and recedes."""
    N = secs(dur)
    out = np.zeros((N, 2))
    for _ in range(n_horses):
        g = gait(rng, dur, "gallop", weight=rng.uniform(0.8, 1.2))
        env = np.exp(-((np.arange(N) / SR - dur * rng.uniform(0.4, 0.6)) / (dur * 0.25)) ** 2)
        pan = np.clip(np.linspace(-1, 1, N) * rng.uniform(0.6, 1.0), -1, 1)
        a = (pan + 1) * np.pi / 4
        out[:, 0] += g * env * np.cos(a)
        out[:, 1] += g * env * np.sin(a)
    rumble = lp(rng.standard_normal(N), 90, 2) * np.exp(-((np.arange(N) / SR - dur * 0.5) / (dur * 0.3)) ** 2) * 1.5
    out += rumble[:, None]
    return fade(out, 0.2, 0.4)
