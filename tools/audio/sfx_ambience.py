"""The vale: wind over grass, birds, and the working sounds of a village.

 * wind is band-limited turbulence whose level and brightness follow slow gusts; over grass there is a
   rustle band (2-8 kHz), in the ear a low rumble, and occasionally a faint whistle through a hedge or eaves.
 * birdsong is FM whistles: a skylark is a long rapid warble at 2-6 kHz, a blackbird a slower fluty phrase at
   1.5-3 kHz with glides, a chaffinch an accelerating trill ending in a flourish, the cuckoo a falling minor
   third ~ 700 -> 590 Hz, a crow a harsh noisy 'caw' with formants.
 * an anvil is a stiff steel block with a few strong, long-ringing partials; a church bell's partials sit near
   hum 0.5, prime 1, tierce 1.2, quint 1.5, nominal 2 (the minor third is what makes it sound like a bell).
"""
import numpy as np
from dsp import (SR, secs, lp, hp, bp, modal, click, env_exp, fade, place, pan_mono, smooth_random, pink, brown,
                 sweep_bp, peq)
from voice import voice, glottal, vocal_tract


def wind(rng, dur):
    n = secs(dur)
    out = np.zeros((n, 2))
    gust = smooth_random(rng, n, 0.25, 0.25, 1.0) ** 1.6
    for ch in range(2):
        g = gust * smooth_random(rng, n, 0.8, 0.8, 1.1)
        body = lp(brown(rng, n), 350, 2) * g * 0.8
        rust = bp(pink(rng, n), 1800, 7000) * (g ** 2) * smooth_random(rng, n, 6, 0.5, 1) * 0.12
        mid = bp(pink(rng, n), 350, 1500) * g * 0.18
        out[:, ch] = body + rust + mid
    whistle_c = smooth_random(rng, n, 0.4, 520, 880)
    wh = sweep_bp(rng.standard_normal(n), lambda t: whistle_c[min(n - 1, secs(t))], 28) * (np.clip(gust - 0.55, 0, 1) ** 1.5) * 0.25
    out[:, 0] += wh * 0.8
    out[:, 1] += wh * 0.5
    return out


def _chirp(rng, f_fn, dur, harm=0.08, am=None):
    n = secs(dur)
    t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(f_fn(t)) / SR
    y = np.sin(ph) + harm * np.sin(2 * ph)
    env = np.sin(np.pi * np.arange(n) / n) ** 0.8
    if am is not None:
        env *= am(t)
    return y * env


def skylark(rng):
    dur = rng.uniform(2.5, 4.0)
    y = np.zeros(secs(dur))
    t = 0
    while t < dur - 0.1:
        d = rng.uniform(0.03, 0.09)
        f0, f1 = rng.uniform(2200, 5500), rng.uniform(2200, 6000)
        tr = rng.uniform(20, 60)
        seg = _chirp(rng, lambda x: f0 + (f1 - f0) * x / d + 250 * np.sin(2 * np.pi * tr * x), d)
        place(y, seg * rng.uniform(0.4, 1), secs(t))
        t += d + rng.uniform(0.0, 0.03)
    return fade(y, 0.01, 0.05)


def blackbird(rng):
    y = np.zeros(secs(2.5))
    t = 0
    for i in range(rng.integers(3, 6)):
        d = rng.uniform(0.12, 0.35)
        a, b = rng.uniform(1400, 2600), rng.uniform(1400, 3000)
        vib = rng.uniform(0, 30)
        seg = _chirp(rng, lambda x: a + (b - a) * (x / d) ** 0.7 + vib * 4 * np.sin(2 * np.pi * 25 * x), d, 0.15)
        place(y, seg * rng.uniform(0.5, 1), secs(t))
        t += d + rng.uniform(0.03, 0.12)
    # a thin twittering end
    for i in range(rng.integers(3, 8)):
        d = 0.03
        f = rng.uniform(4000, 7000)
        place(y, _chirp(rng, lambda x: f - 8000 * x, d) * 0.3, secs(t))
        t += 0.04
    return fade(y, 0.01, 0.05)


def chaffinch(rng):
    y = np.zeros(secs(2.6))
    t = 0
    gap = 0.12
    f = rng.uniform(4500, 5500)
    for i in range(rng.integers(8, 13)):
        d = 0.05
        place(y, _chirp(rng, lambda x: f - 1800 * x / d, d) * (0.5 + 0.05 * i), secs(t))
        t += gap
        gap *= 0.9
        f *= 0.985
    d = 0.35  # flourish
    place(y, _chirp(rng, lambda x: 3000 + 2500 * np.sin(np.pi * x / d) - 1500 * x / d, d, 0.2), secs(t + 0.02))
    return fade(y, 0.01, 0.05)


def cuckoo(rng):
    f = rng.uniform(680, 740)
    y = np.zeros(secs(1.3))
    for f_, t_, d in ((f, 0.0, 0.2), (f * 0.84, 0.32, 0.32)):
        place(y, _chirp(rng, lambda x: f_ * (1 - 0.03 * x / d), d, 0.03), secs(t_))
    return fade(lp(y, 3000), 0.01, 0.1)


def crow(rng):
    y = np.zeros(secs(2.2))
    t = 0
    for i in range(rng.integers(1, 4)):
        d = rng.uniform(0.28, 0.45)
        n = secs(d)
        f0 = np.linspace(rng.uniform(450, 600), rng.uniform(350, 450), n)
        src, _ = glottal(rng, f0, oq=0.5, sharp=0.2, jitter=0.08, shimmer=0.4, breath=0.6)
        c = vocal_tract(src, [([900, 1600, 2800, 3800, 4500], [250, 300, 400, 500, 600])], scale=1.0) * np.hanning(n) ** 0.5
        place(y, c, secs(t))
        t += d + rng.uniform(0.12, 0.25)
    return fade(hp(y, 300), 0.005, 0.05)


def anvil(rng):
    """A smith at work: a pattern of hammer blows ('ting, ting-ting')."""
    y = np.zeros(secs(3.0))
    fr = np.array([1120, 2510, 3380, 4630, 6100]) * rng.uniform(0.9, 1.1)
    taus = np.array([1.2, 0.8, 0.6, 0.35, 0.2])
    t = 0
    for k in range(rng.integers(3, 6)):
        ex = np.zeros(secs(1.6))
        w = secs(0.0008)
        ex[:w] = 1
        hit = modal(ex, fr * rng.uniform(0.995, 1.005), taus * (0.5 if k % 2 else 1), [1, .7, .5, .35, .25])
        hit += lp(rng.standard_normal(len(ex)) * env_exp(len(ex), 0.004), 2500) * 0.5  # hammer on hot iron: a dull thud
        place(y, hit * (0.5 if k % 2 else 1), secs(t))
        t += 0.35 if k % 2 == 0 else 0.5
    return fade(y, 0.0005, 0.3)


def axe(rng):
    """Woodcutter: a chop into green timber, sometimes followed by a split."""
    y = np.zeros(secs(0.8))
    ex = np.zeros(secs(0.5))
    ex[:secs(0.002)] = rng.standard_normal(secs(0.002))
    chop = modal(ex, rng.uniform(180, 1100, 10), rng.uniform(0.01, 0.05, 10), rng.uniform(.4, 1, 10)) * 2
    chop += lp(rng.standard_normal(len(ex)) * env_exp(len(ex), 0.01), 1500) * 0.6
    place(y, chop, 0)
    return fade(hp(y, 80), 0.0005, 0.1)


def dog(rng):
    """A farm dog barking two or three times."""
    y = np.zeros(secs(2.0))
    t = 0
    f = rng.uniform(380, 520)
    for i in range(rng.integers(2, 4)):
        d = rng.uniform(0.12, 0.2)
        v = voice(rng, d, [(0, f * 0.9), (0.2, f * 1.15), (1, f * 0.7)], [([700, 1500, 2600, 3600, 4600], [150, 200, 250, 300, 400])],
                  amp_pts=[(0, 0), (0.1, 1), (0.5, 0.6), (1, 0)], oq=0.45, sharp=0.2, breath=0.35, jitter=0.05, shimmer=0.3, rough=0.3)
        place(y, v, secs(t))
        t += d + rng.uniform(0.12, 0.3)
    return fade(hp(y, 150), 0.002, 0.05)


def bell(rng):
    """Parish bell tolling once: hum, prime, tierce, quint, nominal + upper partials."""
    f = rng.uniform(420, 520)
    ratios = np.array([0.5, 1.0, 1.183, 1.506, 2.0, 2.51, 2.66, 3.01, 4.1])
    taus = np.array([6.0, 3.5, 3.0, 2.0, 2.0, 1.1, 1.0, 0.7, 0.4])
    amps = np.array([0.6, 0.8, 0.9, 0.4, 1.0, 0.4, 0.35, 0.3, 0.2])
    n = secs(6.0)
    ex = np.zeros(n)
    ex[:secs(0.002)] = 1
    y = modal(ex, f * ratios * rng.uniform(0.998, 1.002, len(ratios)), taus, amps)
    # warble: each partial of a real bell is a close doublet
    y += modal(ex, f * ratios * 1.0025, taus, amps * 0.4)
    return fade(y, 0.0005, 1.0)


def cow(rng):
    d = rng.uniform(1.2, 2.0)
    f = rng.uniform(110, 150)
    y = voice(rng, d, [(0, f * 0.8), (0.2, f * 1.1), (0.8, f), (1, f * 0.7)], ["u", "o", "o"], amp_pts=[(0, 0), (0.15, 1), (0.8, 0.8), (1, 0)],
              oq=0.6, sharp=0.35, breath=0.2, jitter=0.02, shimmer=0.1, scale=0.75)
    return fade(y, 0.02, 0.1)


def sheep(rng):
    d = rng.uniform(0.6, 0.9)
    f = rng.uniform(260, 360)
    y = voice(rng, d, [(0, f), (1, f * 0.95)], ["ae", "e"], amp_pts=[(0, 0), (0.1, 1), (0.8, 0.8), (1, 0)], oq=0.5, sharp=0.3,
              breath=0.25, jitter=0.03, shimmer=0.2, vib=(7, 0.06))
    y *= 0.7 + 0.3 * np.sin(2 * np.pi * 7 * np.arange(len(y)) / SR)  # the bleat's tremolo
    return fade(y, 0.01, 0.05)
