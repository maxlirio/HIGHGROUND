"""Missiles: longbow and crossbow releases, arrows in flight and arrows arriving.

 * a longbow's release is dominated by the string: after the arrow leaves, the braced string slaps to rest and
   rings briefly (~90-180 Hz fundamental, very heavily damped by the limbs) — the 'thwack'. The limbs add a
   woody knock, the fletchings a short hiss.
 * a crossbow is higher, harder and louder: a short steel/horn prod with a thick cord, the click of the nut,
   and a 'thunk' of the stock.
 * an arrow in flight is broadband turbulent noise from the fletching and shaft, band-limited to ~1.5-7 kHz,
   swelling and Doppler-sweeping as it passes; arrows from a volley overhead are a rushing hiss ('the sky
   went dark and whistled').
"""
import numpy as np
from dsp import SR, secs, lp, hp, bp, modal, karplus, click, env_exp, fade, place, sweep_bp, peq


def bow_release(rng):
    f0 = rng.uniform(95, 170)
    s = karplus(rng, f0, 0.3, damp=rng.uniform(0.96, 0.98), bright=rng.uniform(0.2, 0.4))
    n = len(s)
    k = np.arange(n) / SR
    s *= np.exp(-k / rng.uniform(0.025, 0.045))  # the limbs choke the string almost at once
    # limb knock (yew): short wooden modes
    ex = np.zeros(n)
    ex[0] = 1
    limb = modal(ex, rng.uniform(250, 1100, 6), rng.uniform(0.01, 0.03, 6), rng.uniform(0.3, 1, 6)) * 0.6
    slap = click(rng, 0.0015, 6000) * 1.8  # string on the bracer / arrow nock leaving
    hiss = bp(rng.standard_normal(n), 2500, 8000) * np.exp(-k / 0.03) * np.clip(k / 0.004, 0, 1) * 0.12
    y = s * 1.2 + limb + hiss
    place(y, slap, 0)
    return fade(hp(y, 60), 0.0005, 0.05)


def crossbow_release(rng, big=False):
    f0 = rng.uniform(180, 300) * (0.55 if big else 1)
    s = karplus(rng, f0, 0.3, damp=0.97, bright=0.7)
    n = len(s) + secs(0.2)
    y = np.zeros(n)
    k = np.arange(len(s)) / SR
    place(y, s * np.exp(-k / 0.05) * 1.1, secs(0.012))
    ex = np.zeros(secs(0.2))
    ex[0] = 1
    nut = modal(ex, rng.uniform(2500, 6500, 5), rng.uniform(0.008, 0.025, 5), [1, .8, .6, .5, .4]) * 0.7  # the nut releasing
    stock = modal(ex, rng.uniform(120, 700, 6), rng.uniform(0.02, 0.06, 6), rng.uniform(0.4, 1, 6)) * (2.2 if big else 1.4)
    place(y, nut, 0)
    place(y, stock, secs(0.01))
    place(y, click(rng, 0.002, 9000) * 2.0, secs(0.011))
    if big:  # springald: two arms slapping their stops
        for dt in (0.03, 0.036):
            place(y, modal(ex, rng.uniform(80, 400, 6), rng.uniform(0.04, 0.1, 6), rng.uniform(0.5, 1, 6)) * 1.6, secs(dt))
    return fade(hp(y, 45), 0.0005, 0.05)


def arrow_whoosh(rng, dur=None):
    """Arrow passing close by: Doppler-swept band noise with a flutter from the fletchings."""
    dur = dur or rng.uniform(0.35, 0.6)
    n = secs(dur)
    u = np.linspace(-1, 1, n)
    tc = rng.uniform(-0.2, 0.2)
    shape = 1 / (1 + ((u - tc) / 0.22) ** 2)
    f_hi, f_lo = rng.uniform(4500, 6500), rng.uniform(1800, 2800)
    fc = lambda t: f_lo + (f_hi - f_lo) / (1 + np.exp(((t / dur) * 2 - 1 - tc) * 9))
    x = rng.standard_normal(n)
    y = sweep_bp(x, fc, 1.6) * shape
    flutter = 1 + 0.35 * np.sin(2 * np.pi * rng.uniform(60, 140) * np.arange(n) / SR)
    y = y * flutter + hp(rng.standard_normal(n), 6000) * shape * 0.08
    return fade(y, 0.01, 0.05)


def shaft_wobble(rng, n):
    ex = np.zeros(n)
    ex[0] = 1
    return modal(ex, rng.uniform(180, 420, 2), rng.uniform(0.04, 0.09, 2), [1, 0.5]) * 0.3


def arrow_ground(rng):
    n = secs(0.35)
    k = np.arange(n) / SR
    y = lp(rng.standard_normal(n), rng.uniform(500, 1100), 2) * np.exp(-k / 0.012) * 1.4
    y += bp(rng.standard_normal(n), 1500, 5000) * np.exp(-k / 0.02) * 0.2  # turf
    y += shaft_wobble(rng, n)
    return fade(y, 0.0005, 0.05)


def arrow_shield(rng):
    n = secs(0.4)
    ex = np.zeros(n)
    ex[:secs(0.001)] = 1
    y = modal(ex, rng.uniform(280, 1600, 10), rng.uniform(0.01, 0.035, 10), rng.uniform(0.4, 1, 10)) * 1.6
    place(y, click(rng, 0.001, 9000) * 1.5, 0)
    y += shaft_wobble(rng, n) * 1.5
    return fade(hp(y, 100), 0.0005, 0.05)


def arrow_armour(rng):
    """Bodkin on plate / helm: a bright tink, sometimes the glancing whine of a deflection."""
    n = secs(0.5)
    ex = np.zeros(n)
    ex[0] = 1
    fr = rng.uniform(1800, 8500, 9)
    y = modal(ex, fr, rng.uniform(0.02, 0.12, 9), rng.uniform(0.3, 1, 9))
    place(y, click(rng, 0.0008, 14000), 0)
    if rng.uniform() < 0.5:
        g = arrow_whoosh(rng, 0.25) * 0.35
        place(y, g, secs(0.005))
    return fade(hp(y, 300), 0.0003, 0.05)


def arrow_flesh(rng):
    n = secs(0.25)
    k = np.arange(n) / SR
    y = lp(rng.standard_normal(n), 900, 2) * np.exp(-k / 0.018) * 1.3
    y += bp(rng.standard_normal(n), 2000, 6000) * np.exp(-k / 0.01) * 0.3
    return fade(y, 0.0005, 0.04)


def volley_release(rng, n_bows=None, crossbow=False):
    """A company loosing together (stereo): twenty to forty strings over under a second, then the rush of
    the shafts climbing away."""
    n_bows = n_bows or rng.integers(22, 40)
    dur = 2.4
    N = secs(dur)
    out = np.zeros((N, 2))
    from dsp import pan_mono
    spread = rng.uniform(0.5, 1.1)
    for _ in range(n_bows):
        t = abs(rng.normal(0, 0.22)) * spread
        d = rng.uniform(2, 45)
        s = crossbow_release(rng) if crossbow else bow_release(rng)
        s = lp(s, float(np.clip(16000 * np.exp(-d / 70), 2500, 16000)), 1) / (1 + d / 12)
        place(out, pan_mono(s, rng.uniform(-0.9, 0.9)), secs(t))
    # the flight away: a rising-then-fading broadband rush
    k = np.arange(N) / SR
    env = np.clip((k - 0.05) / 0.35, 0, 1) * np.exp(-np.clip(k - 0.4, 0, None) / 0.5)
    for ch in range(2):
        rush = sweep_bp(rng.standard_normal(N), lambda t: 5200 - 2400 * min(1, t / 1.6), 0.9) * env * 0.35
        out[:, ch] += rush
    return fade(out, 0.0005, 0.2)
