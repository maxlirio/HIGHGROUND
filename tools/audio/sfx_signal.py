"""Horns, trumpets and drums — the battlefield's signals and the optional cues.

 * natural horns and trumpets play only the harmonic series of one tube; an animal horn is short and conical
   (mellow, strong 2nd-4th harmonics), the buisine is a long straight trumpet (bright, plays up to the 8th).
   Brass brightness rises with loudness (non-linear steepening in the bore), so each harmonic's amplitude
   goes as level^(1 + b·(k-1)); notes start with a lip 'scoop' from below and a little blare.
 * nakers are small paired kettledrums: kettle modes near 1 : 1.5 : 1.98 : 2.44 : 2.94. The big war drum is
   an open membrane (Bessel ratios 1, 1.59, 2.14, 2.30, 2.65, 2.92 …) whose pitch sags as the head relaxes.
"""
import numpy as np
from dsp import SR, secs, lp, hp, bp, modal, click, env_exp, fade, place, pan_mono, smooth_random, peq, pink

HORNS = {
    # f0 (Hz) of the tube, harmonic rolloff, brightness growth, bell formant
    "blue": dict(f0=116.0, roll=1.7, grow=0.45, bell=(1000, 5.0), noise=0.05),
    "red": dict(f0=97.0, roll=1.55, grow=0.5, bell=(820, 6.0), noise=0.06),
    "buisine": dict(f0=87.3, roll=1.0, grow=0.6, bell=(1600, 4.0), noise=0.03),
}


def brass_note(rng, inst, harm, dur, level=1.0, scoop=True):
    P = HORNS[inst]
    f = P["f0"] * harm
    n = secs(dur)
    k = np.arange(n) / SR
    att = rng.uniform(0.035, 0.07)
    rel = 0.09
    env = np.clip(k / att, 0, 1) ** 1.5
    env *= 1 + 0.25 * np.exp(-((k - att) / 0.04) ** 2)  # blare on the attack
    env *= np.clip((dur - k) / rel, 0, 1)
    env *= 1 + 0.04 * smooth_random(rng, n, 6, -1, 1)
    env *= level
    cents = (-70 * np.exp(-k / 0.05) if scoop else 0) + 6 * smooth_random(rng, n, 3, -1, 1)
    fi = f * 2 ** (cents / 1200)
    ph = 2 * np.pi * np.cumsum(fi) / SR
    y = np.zeros(n)
    K = int(min(24, 9000 // f))
    for h in range(1, K + 1):
        a = h ** -P["roll"] * np.power(np.clip(env, 1e-4, None), 1 + P["grow"] * (h - 1))
        y += a * np.sin(h * ph + rng.uniform(0, 6))
    br = bp(pink(rng, n), f * 0.8, min(f * 8, 12000)) * env * P["noise"]
    y = peq(y + br, P["bell"][0], P["bell"][1], 1.0)
    return lp(y, 7000 if inst == "buisine" else 4200, 2)  # a horn's mouth radiates little above a few kHz


def call(rng, inst, notes, gap=0.05):
    """notes: list of (harmonic, dur) ; harmonic 0 = rest."""
    parts = []
    for h, d in notes:
        if h == 0:
            parts.append(np.zeros(secs(d)))
        else:
            parts.append(brass_note(rng, inst, h, d, level=rng.uniform(0.9, 1.0)))
            parts.append(np.zeros(secs(gap)))
    y = np.concatenate(parts + [np.zeros(secs(0.3))])
    return fade(hp(y, 60), 0.001, 0.2)


CALLS = {
    "advance": [(3, 0.5), (0, 0.06), (4, 1.3)],
    "charge": [(3, 0.15), (3, 0.15), (4, 0.2), (0, 0.08), (3, 0.15), (3, 0.15), (4, 0.2), (0, 0.08), (4, 1.1)],
    "hold": [(3, 1.9)],
    "retire": [(4, 0.7), (3, 0.7), (2, 1.3)],
    "rally": [(3, 0.3), (4, 0.3), (3, 0.3), (4, 1.0)],
}


def horn_call(rng, which, team="blue"):
    return call(rng, team, CALLS[which])


# ------------------------------------------------------------------ drums
def naker(rng, f0=190.0, level=1.0):
    n = secs(1.0)
    ex = np.zeros(n)
    w = secs(0.0015)
    ex[:w] = np.hanning(2 * w)[w:] * level
    ratios = np.array([1, 1.5, 1.98, 2.44, 2.94, 3.42])
    fr = f0 * ratios * rng.uniform(0.99, 1.01, len(ratios))
    y = modal(ex, fr, [0.22, 0.16, 0.12, 0.08, 0.06, 0.04], [1, .7, .5, .35, .25, .2])
    y += modal(ex, [f0 * 0.62], [0.03], [1.5])  # the thud of the (0,1) mode, choked by the kettle
    place(y, hp(click(rng, 0.002, 7000), 500) * 0.8 * level, 0)
    return fade(hp(y, 60), 0.0003, 0.1)


def war_drum(rng, f0=72.0, level=1.0, snare=False):
    n = secs(1.6)
    k = np.arange(n) / SR
    sag = 1 + 0.06 * np.exp(-k / 0.05)
    ratios = [1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50]
    y = np.zeros(n)
    for i, r in enumerate(ratios):
        tau = 0.45 / (1 + i * 0.6)
        y += (1 / (1 + i * 0.7)) * np.sin(2 * np.pi * np.cumsum(f0 * r * sag) / SR + rng.uniform(0, 6)) * np.exp(-k / tau)
    y *= level
    y += lp(rng.standard_normal(n), 900, 2) * np.exp(-k / 0.02) * 0.9 * level
    if snare:
        y += bp(rng.standard_normal(n), 2000, 7000) * np.exp(-k / 0.08) * 0.2 * level
    return fade(hp(y, 35), 0.0005, 0.2)


def _mix(parts, dur):
    out = np.zeros((secs(dur), 2))
    for x, t, g, p in parts:
        place(out, pan_mono(x, p) * g, secs(t))
    return out


def cue_battle(rng):
    parts = []
    t = 0.0
    for i in range(8):  # slow, then quickening war drum
        parts.append((war_drum(rng, 70, 0.8 + 0.03 * i), t, 1.0, -0.2))
        t += 0.75 - 0.05 * i
    # nakers roll crescendo underneath
    tt = 2.0
    while tt < t + 0.6:
        lvl = 0.25 + 0.75 * (tt - 2) / (t - 1.4)
        parts.append((naker(rng, 196 if int(tt * 12) % 2 else 262, lvl), tt, 0.55, 0.35 if int(tt * 12) % 2 else 0.5))
        tt += 1 / 12
    parts.append((war_drum(rng, 68, 1.2), t + 0.6, 1.2, 0))
    parts.append((horn_call(rng, "advance", "blue"), t + 0.7, 0.9, 0.1))
    return _mix(parts, t + 4.0)


def cue_charge(rng):
    parts = []
    tt = 0
    while tt < 1.4:
        parts.append((naker(rng, 196 if int(tt * 16) % 2 else 262, 0.4 + 0.5 * tt / 1.4), tt, 0.6, 0.3))
        tt += 1 / 16
    for t in (1.45, 1.75):
        parts.append((war_drum(rng, 72, 1.1), t, 1.1, -0.1))
    parts.append((horn_call(rng, "charge", "blue"), 1.5, 0.9, 0.0))
    return _mix(parts, 6.0)


def cue_rout(rng):
    parts = []
    for i, t in enumerate((0.0, 1.1, 2.2)):
        parts.append((war_drum(rng, 64, 0.9 - 0.15 * i), t, 1.0, 0))
    parts.append((call(rng, "red", CALLS["retire"]), 0.4, 0.8, -0.2))
    return _mix(parts, 5.5)


def cue_victory(rng):
    parts = []
    fan = [(4, 0.22), (5, 0.22), (6, 0.22), (8, 0.9), (0, 0.1), (6, 0.25), (8, 1.6)]
    for p, dt in ((-0.35, 0.0), (0.35, 0.012)):
        parts.append((call(rng, "buisine", fan, gap=0.03), dt, 0.7, p))
    t = 0
    for beat in (0, 0.22, 0.44, 0.66, 1.56, 1.9, 2.2):
        parts.append((naker(rng, 262 if beat % 0.44 else 196, 0.8), beat, 0.5, 0.2))
    for beat in (0.66, 2.2):
        parts.append((war_drum(rng, 72, 1.1), beat, 1.0, 0))
    return _mix(parts, 6.5)


def cue_defeat(rng):
    parts = [(call(rng, "red", [(3, 1.2), (2, 2.6)]), 0.2, 1.0, 0), (war_drum(rng, 58, 1.0), 0.0, 1.0, 0), (war_drum(rng, 56, 0.8), 1.4, 1.0, 0)]
    return _mix(parts, 6.0)
