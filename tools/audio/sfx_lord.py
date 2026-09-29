"""The lord — the player's own man — heard close: his voice (one consistent timbre: a deep, commanding baritone),
his sword or axe cutting the air, couching the lance, bone-breaking blows, and his own horse and armoured
steps as loops that follow him."""
import numpy as np
from dsp import SR, secs, lp, hp, bp, modal, click, env_exp, fade, place, pan_mono, sweep_bp, smooth_random
from voice import voice, breath_noise
import sfx_combat as C
import sfx_horse as H

LORD_F0 = 112.0  # his voice: every take is the same man


def lord_grunt(rng):
    d = rng.uniform(0.22, 0.4)
    f = LORD_F0 * rng.uniform(0.95, 1.1)
    v = rng.choice(["@", "a", "u"])
    y = voice(rng, d, [(0, f * 1.2), (0.25, f * 1.3), (1, f * 0.85)], [v, v], amp_pts=[(0, 0), (0.07, 1), (0.6, 0.7), (1, 0)],
              oq=0.42, sharp=0.18, breath=0.22, jitter=0.025, shimmer=0.12, fry_tail=0.35, scale=0.96)
    return np.concatenate([breath_noise(rng, 0.04, v, ((0, 0), (0.5, 0.6), (1, 0.2))) * 0.3, y])


def lord_cry(rng):
    d = rng.uniform(0.7, 1.1)
    f = LORD_F0 * 1.9
    y = voice(rng, d, [(0, f * 0.8), (0.12, f * 1.1), (0.6, f * 0.9), (1, f * 0.5)], ["a", "a", "o"], [0, 0.5, 1],
              amp_pts=[(0, 0), (0.06, 1), (0.6, 0.8), (1, 0)], oq=0.48, sharp=0.18, breath=0.2, jitter=0.03, shimmer=0.12, rough=0.3,
              scale=0.96, vib=(6, 0.025))
    return y


def lord_shout(rng):
    """Commands: 'Follow me!' / 'Charge!' / 'Hold!' shapes, in his voice, projected (pressed, bright)."""
    pats = [[("o", 0.2, 1.0), ("o", 0.16, 0.95), ("e", 0.3, 1.1)],   # fol-low me
            [("a", 0.5, 1.15)],                                     # CHARGE
            [("o", 0.55, 1.0)],                                     # HOLD
            [("a", 0.18, 1.0), ("i", 0.16, 1.05), ("e", 0.35, 1.12)],  # ral-ly to me
            [("o", 0.18, 1.0), ("a", 0.42, 1.15)]]                  # for-WARD
    sy = pats[rng.integers(len(pats))]
    f = LORD_F0 * 1.55
    parts = []
    for v, d, fm in sy:
        y = voice(rng, d * rng.uniform(0.95, 1.1), [(0, f * fm * 0.9), (0.2, f * fm * 1.05), (1, f * fm * 0.88)], [v, v],
                  amp_pts=[(0, 0), (0.06, 1), (0.75, 0.9), (1, 0)], oq=0.45, sharp=0.17, breath=0.1, jitter=0.015, shimmer=0.08, rough=0.06, scale=0.96)
        parts.append(np.concatenate([breath_noise(rng, 0.04, v, ((0, 0), (0.3, 1), (1, 0.4))) * 0.4, y, np.zeros(secs(0.04))]))
    return np.concatenate(parts)


def swing(rng):
    """A blade or axe cutting the air: a short Doppler-swept 'vvhh' — broadband, peaking as the edge passes."""
    d = rng.uniform(0.22, 0.38)
    n = secs(d)
    u = np.linspace(0, 1, n)
    shape = np.exp(-((u - rng.uniform(0.45, 0.6)) / 0.18) ** 2)
    fc = lambda t: 500 + 2600 * np.exp(-((t / d - 0.55) / 0.2) ** 2)
    y = sweep_bp(rng.standard_normal(n), fc, 2.2) * shape
    y += bp(rng.standard_normal(n), 3000, 9000) * shape ** 2 * 0.15
    return fade(y, 0.01, 0.03)


def couch(rng):
    """Couching the lance: the shaft dropped into the rest (wood on iron), leather creak, mail settling."""
    n = secs(1.0)
    y = np.zeros(n)
    ex = np.zeros(secs(0.3))
    ex[:secs(0.002)] = 1
    place(y, modal(ex, rng.uniform(300, 1500, 8), rng.uniform(0.01, 0.05, 8), rng.uniform(.4, 1, 8)) * 1.2, secs(0.18))
    place(y, modal(ex, rng.uniform(1500, 5000, 4), rng.uniform(0.02, 0.08, 4), [1, .7, .5, .4]) * 0.4, secs(0.185))
    place(y, C.mail_rattle(rng, 0.3, 220) * 0.4, secs(0.1))
    from sfx_siege import creak
    place(y, creak(rng, 0.35, 2.2) * 0.35, 0)
    return fade(y, 0.002, 0.05)


def crunch(rng):
    """A killing blow: bone giving way under steel, a wet body thud."""
    n = secs(0.5)
    y = C.body_hit(rng) * 1.2
    y = np.pad(y, (0, max(0, n - len(y))))[:n]
    t = 0.0
    while t < 0.03:
        place(y, hp(click(rng, 0.0006, 7000), 900) * rng.uniform(0.3, 1.0), secs(0.004 + t))
        t += rng.exponential(0.003)
    place(y, lp(rng.standard_normal(secs(0.06)) * env_exp(secs(0.06), 0.012), 1800) * 0.8, secs(0.002))
    return fade(y, 0.0005, 0.05)


def horse_loop(rng, ir, pace="gallop", L=8.0, X=1.0):
    """His own horse under him: one horse, close, breathing locked to the stride, tack jingling."""
    from beds import _finish
    D = L + X
    g = H.gait(rng, D, pace, weight=1.2)
    g += H.harness(rng, D) * 1.5
    out = pan_mono(g, 0.0) * 1.0
    return _finish(rng, out, ir, L, X, 0.12)


def steps_loop(rng, ir, L=6.0, X=0.8):
    """An armoured man walking: sabatons/boots on turf, mail and plate shifting with each step."""
    from beds import _finish
    D = L + X
    out = np.zeros((secs(D), 2))
    t = 0.0
    rate = 1.85
    while t < D:
        s = C.footstep(rng, 1.3) * 1.4
        place(out, pan_mono(s, rng.uniform(-0.1, 0.1)), secs(t))
        place(out, pan_mono(C.kit_jingle(rng) * 0.9, rng.uniform(-0.2, 0.2)), secs(t + 0.01))
        t += 1 / rate * rng.uniform(0.96, 1.04)
    return _finish(rng, out, ir, L, X, 0.1)
