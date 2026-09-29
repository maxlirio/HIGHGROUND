"""Siege and destruction: timber creak and splinter, stone on turf and stone on masonry, the trebuchet's whole
throw, the mangonel's slam, the ram, gates, towers, ladders, burning and collapsing buildings.

 * wood creak is stick-slip friction: a train of tiny slips (20-120 per second, wandering) exciting the
   timber's resonances (200-1500 Hz).
 * wood breaking is a burst of micro-fractures (a crackle over 20-80 ms) on top of a resonant 'crack'.
 * a 100 kg stone landing on turf is felt more than heard: a 30-60 Hz thump with a falling pitch, then earth
   and pebbles raining back. On masonry it is a sharp crack, a boom, and rubble cascading for seconds.
"""
import numpy as np
from dsp import (SR, secs, lp, hp, bp, modal, click, env_exp, fade, place, pan_mono, smooth_random, sweep_bp,
                 brown, pink, peq)


def creak(rng, dur=None, pitch=1.0):
    dur = dur or rng.uniform(0.4, 1.2)
    n = secs(dur)
    y = np.zeros(n)
    rate = smooth_random(rng, n, 3, 25, 110) * pitch
    ph = np.cumsum(rate / SR)
    idx = np.nonzero(np.diff(np.floor(ph)) > 0)[0]
    env = np.sin(np.pi * np.arange(n) / n) ** 0.6
    for i in idx:
        y[i] += env[i] * rng.uniform(0.5, 1.0)
    fr = rng.uniform(220, 1500, 8) * pitch
    out = modal(y, fr, rng.uniform(0.004, 0.02, 8), rng.uniform(0.4, 1, 8))
    return fade(hp(out, 120), 0.01, 0.05)


def crack(rng, size=1.0):
    """Timber splitting: fracture crackle + resonant crack."""
    n = secs(0.6 + 0.4 * size)
    y = np.zeros(n)
    t, T = 0.0, rng.uniform(0.02, 0.08) * size
    while t < T:
        place(y, click(rng, 0.0005, 12000) * rng.uniform(0.2, 1), secs(t))
        t += rng.exponential(0.0015)
    y = hp(y, 800) * 1.2
    ex = np.zeros(n)
    ex[:secs(0.002)] = rng.standard_normal(secs(0.002))
    y += modal(ex, rng.uniform(150, 1800, 12) / size ** 0.3, rng.uniform(0.01, 0.06, 12), rng.uniform(0.4, 1, 12)) * 1.8
    k = np.arange(n) / SR
    y += lp(rng.standard_normal(n), 400, 2) * np.exp(-k / (0.03 * size)) * 0.8 * size
    return fade(y, 0.0003, 0.1)


def splinter(rng):
    y = crack(rng, rng.uniform(0.7, 1.2))
    for _ in range(rng.integers(2, 6)):  # bits falling
        ex = np.zeros(secs(0.1))
        ex[0] = 1
        place(y, modal(ex, rng.uniform(400, 2500, 4), rng.uniform(0.01, 0.03, 4), [1, .7, .5, .3]) * rng.uniform(0.1, 0.35),
              secs(rng.uniform(0.15, 0.5)))
    return y


def rubble(rng, dur, rate0=200, size=1.0):
    """Stones/earth raining down: grains with a decaying rate."""
    n = secs(dur + 0.2)
    y = np.zeros(n)
    t = 0.0
    while t < dur:
        rate = rate0 * np.exp(-t / (dur * 0.35)) + 3
        m = secs(0.05)
        ex = np.zeros(m)
        ex[0] = 1
        fr = rng.uniform(300, 4000, 3) / size ** 0.5
        g = modal(ex, fr, rng.uniform(0.003, 0.015, 3), [1, .6, .4])
        g += lp(rng.standard_normal(m), 900, 1) * env_exp(m, 0.006) * 0.4
        place(y, g * rng.uniform(0.1, 1) * np.exp(-t / dur), secs(t))
        t += rng.exponential(1 / rate)
    return y


def stone_ground(rng, big=True):
    dur = 3.0
    n = secs(dur)
    k = np.arange(n) / SR
    f = (rng.uniform(32, 48) if big else rng.uniform(50, 70)) * (1 + 1.5 * np.exp(-k / 0.03))
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-k / (0.18 if big else 0.1)) * 2.5
    crash = lp(rng.standard_normal(n), 1400, 2) * np.exp(-k / 0.06) * 1.6
    crack_ = hp(click(rng, 0.003, 8000), 500) * 2
    y = boom + crash
    place(y, crack_, 0)
    place(y, rubble(rng, 1.4, 150, 1.0) * 0.5, secs(0.08))  # clods and stones falling back
    y += lp(brown(rng, n), 120) * np.exp(-k / 0.5) * 0.25  # ground shudder
    return fade(y, 0.0003, 0.3)


def stone_wall(rng, big=True):
    dur = 3.6
    n = secs(dur)
    k = np.arange(n) / SR
    ex = np.zeros(n)
    ex[:secs(0.003)] = rng.standard_normal(secs(0.003))
    ring = modal(ex, rng.uniform(80, 900, 14), rng.uniform(0.02, 0.12, 14), rng.uniform(0.4, 1, 14)) * 2.0  # masonry mass
    boom = np.sin(2 * np.pi * np.cumsum(rng.uniform(40, 60) * (1 + np.exp(-k / 0.02))) / SR) * np.exp(-k / 0.25) * 2.0
    crack_ = hp(rng.standard_normal(secs(0.02)) * env_exp(secs(0.02), 0.004), 1200) * 3
    y = ring + boom
    place(y, crack_, 0)
    place(y, rubble(rng, 2.6, 350, 1.3) * 0.9, secs(0.05))
    y += bp(pink(rng, n), 300, 3000) * np.exp(-k / 0.35) * 0.35  # dust and grit hiss
    return fade(y, 0.0003, 0.3)


def wall_collapse(rng):
    dur = 6.5
    n = secs(dur)
    k = np.arange(n) / SR
    y = np.zeros(n)
    place(y, stone_wall(rng) * 1.2, 0)
    for _ in range(rng.integers(5, 9)):
        place(y, stone_ground(rng, big=rng.uniform() < 0.5) * rng.uniform(0.4, 0.9), secs(rng.uniform(0.3, 2.8)))
    place(y, rubble(rng, 4.5, 700, 1.6) * 1.4, secs(0.2))
    y += lp(brown(rng, n), 150) * np.clip(k / 0.3, 0, 1) * np.exp(-k / 2.0) * 0.9
    return fade(y, 0.0003, 0.6)


def trebuchet(rng):
    """The whole throw (~3.5 s): pin knocked out, counterweight drops and the frame groans, the arm and sling
    sweep (a deep rope-and-beam whoosh), the arm is checked with a great thump that shakes the timbers."""
    dur = 4.2
    n = secs(dur)
    y = np.zeros(n)
    ex = np.zeros(secs(0.3))
    ex[0] = 1
    pin = modal(ex, rng.uniform(900, 3500, 5), rng.uniform(0.01, 0.05, 5), [1, .8, .6, .5, .4]) + \
        modal(ex, rng.uniform(200, 600, 4), rng.uniform(0.02, 0.05, 4), [1, .8, .6, .5])
    place(y, pin * 0.8, 0)
    place(y, creak(rng, 1.2, 0.6) * 1.3, secs(0.05))  # counterweight begins to fall
    place(y, creak(rng, 0.9, 0.45) * 1.0, secs(0.4))
    # swing whoosh: 0.25 s .. 1.3 s, low and big
    sw = secs(1.1)
    kk = np.arange(sw) / SR
    env = np.sin(np.pi * kk / (sw / SR)) ** 2
    wh = sweep_bp(rng.standard_normal(sw), lambda t: 180 + 700 * np.sin(np.pi * t / 1.1), 1.2) * env * 1.4
    place(y, wh, secs(0.25))
    # counterweight box lands / arm hits the stop
    k = np.arange(secs(1.8)) / SR
    thump = np.sin(2 * np.pi * np.cumsum(rng.uniform(40, 55) * (1 + np.exp(-k / 0.02))) / SR) * np.exp(-k / 0.2) * 2.4
    thump += modal(np.pad(ex, (0, len(k) - len(ex))), rng.uniform(70, 500, 12), rng.uniform(0.04, 0.2, 12), rng.uniform(.4, 1, 12)) * 2.2
    place(y, thump, secs(1.2))
    place(y, creak(rng, 1.4, 0.5) * 0.9, secs(1.35))  # frame rocking afterwards
    place(y, rubble(rng, 1.0, 80, 2.0) * 0.3, secs(1.25))  # the box's stones shifting
    return fade(y, 0.0003, 0.3)


def mangonel(rng):
    """Traction/torsion mangonel: a crack of rope and a violent slam of the arm against its padded beam."""
    dur = 2.2
    n = secs(dur)
    y = np.zeros(n)
    place(y, creak(rng, 0.3, 0.9) * 0.7, 0)
    k = np.arange(secs(1.5)) / SR
    ex = np.zeros(len(k))
    ex[:secs(0.004)] = rng.standard_normal(secs(0.004))
    slam = modal(ex, rng.uniform(60, 700, 14), rng.uniform(0.03, 0.14, 14), rng.uniform(.4, 1, 14)) * 3.0
    slam += np.sin(2 * np.pi * np.cumsum(rng.uniform(55, 75) * (1 + np.exp(-k / 0.015))) / SR) * np.exp(-k / 0.12) * 2.0
    wh = sweep_bp(rng.standard_normal(secs(0.35)), lambda t: 300 + 1500 * t / 0.35, 1.0) * np.hanning(secs(0.35)) * 0.8
    place(y, wh, secs(0.1))
    place(y, slam, secs(0.4))
    place(y, crack(rng, 0.8) * 0.5, secs(0.4))
    return fade(y, 0.0003, 0.2)


def ram_hit(rng):
    """Iron-shod ram on an oak gate: a deep boom through the timbers, iron clank, groan and dust."""
    dur = 2.4
    n = secs(dur)
    k = np.arange(n) / SR
    ex = np.zeros(n)
    ex[:secs(0.006)] = rng.standard_normal(secs(0.006))
    gate = modal(ex, rng.uniform(45, 320, 16), rng.uniform(0.06, 0.25, 16), rng.uniform(.4, 1, 16)) * 3.0
    iron = modal(ex, rng.uniform(600, 3000, 6), rng.uniform(0.02, 0.1, 6), [1, .8, .6, .5, .4, .3]) * 0.5
    boom = np.sin(2 * np.pi * np.cumsum(rng.uniform(42, 58) * (1 + 0.6 * np.exp(-k / 0.03))) / SR) * np.exp(-k / 0.3) * 2.0
    y = gate + iron + boom
    place(y, creak(rng, 0.8, 0.5) * 0.5, secs(0.25))
    place(y, rubble(rng, 0.8, 60, 2.2) * 0.25, secs(0.05))
    if rng.uniform() < 0.4:
        place(y, crack(rng, 1.3) * 0.7, 0)
    return fade(y, 0.0003, 0.3)


def gate_break(rng):
    dur = 4.0
    n = secs(dur)
    y = np.zeros(n)
    place(y, ram_hit(rng) * 1.0, 0)
    for i in range(rng.integers(4, 7)):
        place(y, crack(rng, rng.uniform(1.0, 1.8)) * rng.uniform(0.6, 1.0), secs(0.05 + i * rng.uniform(0.04, 0.15)))
    place(y, creak(rng, 1.2, 0.4) * 1.2, secs(0.4))
    place(y, stone_ground(rng, False) * 0.6, secs(1.2))  # the leaf crashes down
    return fade(y, 0.0003, 0.4)


def tower_dock(rng):
    """Siege tower's drawbridge slams onto the wall-walk; chains rattle."""
    dur = 2.5
    n = secs(dur)
    y = np.zeros(n)
    place(y, creak(rng, 0.9, 0.5), 0)
    k = np.arange(secs(1.4)) / SR
    ex = np.zeros(len(k))
    ex[:secs(0.005)] = rng.standard_normal(secs(0.005))
    slam = modal(ex, rng.uniform(70, 800, 12), rng.uniform(0.03, 0.15, 12), rng.uniform(.4, 1, 12)) * 2.5
    place(y, slam, secs(0.8))
    ch = np.zeros(secs(0.9))
    t = 0
    while t < 0.8:
        e2 = np.zeros(secs(0.06))
        e2[0] = 1
        place(ch, modal(e2, rng.uniform(1200, 5000, 3), rng.uniform(0.01, 0.04, 3), [1, .6, .4]) * rng.uniform(0.2, 0.6) * np.exp(-t / 0.4), secs(t))
        t += rng.exponential(0.025)
    place(y, ch, secs(0.75))
    return fade(y, 0.0003, 0.2)


def ladder(rng):
    """A scaling ladder thrown against stone: two or three wooden knocks and a scrape."""
    dur = 1.2
    y = np.zeros(secs(dur))
    t = 0
    for i in range(rng.integers(2, 4)):
        ex = np.zeros(secs(0.2))
        ex[:secs(0.002)] = 1
        place(y, modal(ex, rng.uniform(250, 1400, 8), rng.uniform(0.01, 0.04, 8), rng.uniform(.4, 1, 8)) * (1 - 0.3 * i), secs(t))
        t += rng.uniform(0.08, 0.2)
    sc = bp(rng.standard_normal(secs(0.3)), 800, 4000) * np.hanning(secs(0.3)) * 0.25
    place(y, sc, secs(t))
    return fade(y, 0.0003, 0.1)


def building_collapse(rng):
    dur = 5.0
    n = secs(dur)
    k = np.arange(n) / SR
    y = np.zeros(n)
    place(y, creak(rng, 1.0, 0.45) * 1.2, 0)
    for i in range(rng.integers(6, 10)):
        place(y, crack(rng, rng.uniform(1.0, 2.0)) * rng.uniform(0.5, 1), secs(0.6 + rng.uniform(0, 1.4)))
    kk = np.arange(secs(2.5)) / SR
    crash = lp(rng.standard_normal(len(kk)), 900, 2) * np.exp(-kk / 0.4) * 1.3
    crash += np.sin(2 * np.pi * np.cumsum(45 * (1 + np.exp(-kk / 0.02))) / SR) * np.exp(-kk / 0.3) * 1.6
    place(y, crash, secs(1.1))
    place(y, rubble(rng, 2.5, 250, 1.5) * 0.7, secs(1.2))
    return fade(y, 0.0003, 0.5)


def fire_crackle_layer(rng, dur, intensity=1.0):
    """Crackles and pops of burning timber (mono)."""
    n = secs(dur)
    y = np.zeros(n)
    t = 0.0
    while t < dur:
        big = rng.uniform() < 0.06
        m = secs(0.04 if not big else 0.15)
        ex = np.zeros(m)
        ex[:3] = rng.standard_normal(3)
        g = modal(ex, rng.uniform(800, 6000, 3) if not big else rng.uniform(300, 3000, 5),
                  rng.uniform(0.001, 0.006, 3 if not big else 5), [1] * (3 if not big else 5))
        if big:  # a knot bursting: a small cluster
            for _ in range(rng.integers(2, 6)):
                place(g, click(rng, 0.0005, 10000) * rng.uniform(0.2, 0.6), secs(rng.uniform(0, 0.06)))
        place(y, g * rng.uniform(0.05, 1) * (3 if big else 1), secs(t))
        t += rng.exponential(1 / (35 * intensity))
    return hp(y, 400)


def fire_loop(rng, dur, intensity=1.0):
    """Burning building bed (stereo): roar + flutter + crackle."""
    n = secs(dur)
    out = np.zeros((n, 2))
    flick = smooth_random(rng, n, 4, 0.5, 1.0)
    for ch in range(2):
        roar = lp(brown(rng, n), 280, 2) * flick * 0.9
        flutter = bp(pink(rng, n), 300, 1500) * smooth_random(rng, n, 9, 0.2, 1.0) * 0.25
        hiss = hp(pink(rng, n), 3000) * 0.04
        out[:, ch] = roar + flutter + hiss + fire_crackle_layer(rng, dur, intensity) * 0.9
    return out


def fire_ignite(rng):
    """Whoomp: pitch and tar catching."""
    dur = 1.8
    n = secs(dur)
    k = np.arange(n) / SR
    env = np.clip(k / 0.12, 0, 1) ** 2 * np.exp(-np.clip(k - 0.12, 0, None) / 0.5)
    y = sweep_lp(rng.standard_normal(n), lambda t: 150 + 1800 * min(1, t / 0.15) * np.exp(-max(0, t - 0.15) / 0.5)) * env * 1.5
    y += fire_crackle_layer(rng, dur, 1.5) * np.clip(k / 0.3, 0, 1) * 0.6
    return fade(y, 0.002, 0.3)


def sweep_lp(x, f_fn):
    from dsp import sweep_lp as s
    return s(x, f_fn)
