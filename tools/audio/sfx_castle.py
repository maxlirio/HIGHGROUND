"""Castles and sieges (docs/siege-audio.md): the trebuchet's whole throw, the stone in the air and what it hits
(masonry, earth, men), masonry cracking, a tower coming down, gates and the portcullis, ladders, the belfry,
mines, what the defenders drop from the hoardings, men on the wall-walk, the rooms of the keep and the gate
passage (impulse responses), the besiegers' camp, and the assault's trumpets.

Physical sketches behind the synthesis:
 * masonry is a stiff, heavy, highly damped body: a strike is a very short broadband crack (the stone face
   spalling), a low 'boom' of the wall's mass (35-70 Hz, the pitch falling as the contact softens), and then the
   SCATTER — fragments flying off and bouncing: each chip is a small hard modal body (1.5-7 kHz) that hits the
   ground and bounces with intervals shrinking by the restitution (~0.4-0.6), plus grit and dust hiss.
 * earth takes a stone like a drum with no skin: a thud (30-60 Hz) with no ring, clods thrown up that come
   down as dull lowpassed thuds, no bright modes.
 * iron (the portcullis, its chain, the pawl) is lightly damped: modes that ring for 0.2-1 s and are
   inharmonic (a grid of bars, not a bell); a chain running out is a dense rattle whose rate follows its speed.
 * anything heard THROUGH ground (a mine) keeps only what the earth passes: below ~300-500 Hz.
 * a sling opening at the top of the throw is a rope whip: a fast zip (a band sweeping down) ending in a snap.
"""
import numpy as np
from dsp import (SR, secs, lp, hp, bp, modal, click, env_exp, fade, place, pan_mono, smooth_random, sweep_bp, sweep_lp,
                 brown, pink, peq, distance_colour, convolve, make_loop)
import sfx_siege as G
import sfx_combat as C
import sfx_horse as H
import sfx_signal as SG
import sfx_ambience as A
import voice as V


def _imp(n, w=0.003, rng=None):
    ex = np.zeros(n)
    m = max(2, secs(w))
    ex[:m] = (rng.standard_normal(m) if rng is not None else 1.0) * np.hanning(2 * m)[m:]
    return ex


def U(x):
    """Peak-normalise a borrowed generator's output (the other sfx modules each have their own scale)."""
    x = np.asarray(x, float)
    return x / (np.max(np.abs(x)) + 1e-12)


def R(x):
    """RMS-normalise (for sustained parts: brass, drums)."""
    x = np.asarray(x, float)
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-12)


def creak(*a): return U(fade(G.creak(*a), 0.02, 0.18))  # (a gentler end than the stock creak's 50 ms)
def crack(*a): return U(G.crack(*a))
def splinter(*a): return U(G.splinter(*a))
def rubble(*a): return U(G.rubble(*a))
def ignite(*a): return U(G.fire_ignite(*a))
def fire_loop(*a): return U(G.fire_loop(*a))
def mail(*a): return U(C.mail_rattle(*a))
def plate(*a): return U(C.plate_hit(*a))
def anvil(*a): return U(A.anvil(*a))
def dog(*a): return U(A.dog(*a))
def whinny(*a): return U(H.whinny(*a))
def snort(*a): return U(H.snort(*a))
def shout(*a): return U(V.shout(*a))
def kit(*a): return U(C.kit_jingle(*a))


def nm(ex, freqs, taus, amps):
    """A modal bank normalised to unit peak: the gains written below are then the parts' relative peaks."""
    y = modal(ex, freqs, taus, amps)
    return y / (np.max(np.abs(y)) + 1e-12)


def _thump(rng, n, f0, tau, drop=1.0, dtau=0.02):
    k = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(f0 * (1 + drop * np.exp(-k / dtau))) / SR) * np.exp(-k / tau)


# ------------------------------------------------------------------ building blocks
def chip(rng, size=1.0, bounces=None):
    """One fragment of stone: hits, bounces a few times (restitution), each hit a tiny modal clack."""
    m = secs(1.0)
    y = np.zeros(m)
    fr = rng.uniform(1400, 6500, 4) / size ** 0.6
    taus = rng.uniform(0.002, 0.009, 4) * size ** 0.5
    t, g, gap = 0.0, 1.0, rng.uniform(0.08, 0.22) * size ** 0.3
    for _ in range(bounces or int(rng.integers(2, 5))):
        ex = _imp(secs(0.12), 0.0004, rng)
        place(y, nm(ex, fr * rng.uniform(0.97, 1.03), taus, [1, .7, .5, .4]) * g, secs(t))
        place(y, lp(rng.standard_normal(secs(0.02)), 1800, 1) * env_exp(secs(0.02), 0.003) * 0.25 * g, secs(t))
        t += gap
        gap *= rng.uniform(0.4, 0.6)
        g *= rng.uniform(0.35, 0.6)
    return y


def clod(rng, size=1.0):
    """A lump of earth landing: a dull thud, a crumble, no ring."""
    n = secs(0.25)
    k = np.arange(n) / SR
    y = lp(rng.standard_normal(n), rng.uniform(250, 600) / size ** 0.3, 2) * np.exp(-k / (0.012 * size ** 0.5))
    y += bp(rng.standard_normal(n), 900, 3000) * np.exp(-k / 0.02) * 0.12 * np.clip(k / 0.004, 0, 1)
    return y


def fragments(rng, n, dur, t0=0.05, rate_tau=0.5, size=(0.5, 1.6), gain=1.0):
    """The scatter: n chips landing over dur (mostly early — they are thrown, then fall), plus grit."""
    y = np.zeros(secs(dur + 1.0))
    for _ in range(n):
        t = t0 + min(dur, rng.exponential(rate_tau) + rng.uniform(0.15, 0.5))  # flight time before the first hit
        place(y, chip(rng, rng.uniform(*size)) * rng.uniform(0.15, 1.0) * gain, secs(t))
    return y


def grit(rng, dur, tau, level=1.0):
    """Sand and grit sliding and trickling: dense tiny grains (bandpassed crackle), decaying."""
    n = secs(dur)
    k = np.arange(n) / SR
    x = rng.standard_normal(n) * (rng.uniform(size=n) < 0.05)  # sparse grains
    y = bp(x, 1800, 7000) * 0.9 + bp(pink(rng, n), 500, 3000) * 0.08
    return y * np.exp(-k / tau) * smooth_random(rng, n, 5, 0.4, 1.0) * level


def rumble(rng, dur, attack, tau, fc=90, level=1.0):
    n = secs(dur)
    k = np.arange(n) / SR
    env = np.clip(k / max(attack, 1e-3), 0, 1) ** 2 * np.exp(-np.clip(k - attack, 0, None) / tau)
    return lp(brown(rng, n), fc, 2) * env * smooth_random(rng, n, 3, 0.6, 1.0) * level


def muffle(x, fc=380):
    """Heard through earth or through a thick wall: a steep low-pass (~48 dB/oct above fc)."""
    return lp(lp(x, fc, 4), fc * 1.15, 4)


def stone_step(rng, soft=1.0):
    """A boot on stone flags: a hard, short heel click with a gritty scuff and the leather slap of the sole."""
    n = secs(0.2)
    k = np.arange(n) / SR
    ex = _imp(n, 0.0006, rng)
    y = nm(ex, rng.uniform(900, 4200, 5), rng.uniform(0.002, 0.006, 5), [1, .7, .5, .4, .3]) * 0.8
    y += lp(rng.standard_normal(n), 700, 2) * np.exp(-k / 0.01) * 0.9  # the heel's weight
    sc = bp(rng.standard_normal(n), 2500, 9000) * np.exp(-((k - 0.05) / 0.025) ** 2) * 0.12 * soft  # grit under the sole
    return fade(y + sc, 0.0005, 0.03)


def chain_run(rng, dur, rate0, rate1, bright=1.0):
    """A chain paying out (or wound in): link clinks at a rate that goes rate0 -> rate1."""
    y = np.zeros(secs(dur + 0.2))
    t = 0.0
    while t < dur:
        r = rate0 + (rate1 - rate0) * t / dur
        ex = np.zeros(secs(0.05))
        ex[0] = 1
        place(y, nm(ex, rng.uniform(1600, 6500, 3) * bright, rng.uniform(0.006, 0.02, 3), [1, .6, .4]) * rng.uniform(0.3, 1), secs(t))
        t += rng.exponential(1 / r)
    return y


def iron_clang(rng, big=1.0):
    """An iron-shod grid or strap struck hard: inharmonic, ringing bars."""
    n = secs(2.0)
    ex = _imp(n, 0.002, rng)
    fr = np.sort(rng.uniform(180, 2600, 16)) / big ** 0.3
    y = nm(ex, fr, rng.uniform(0.08, 0.5, 16) * big ** 0.5, rng.uniform(0.3, 1.0, 16))
    return y


def metal_groan(rng, dur, pitch=1.0):
    """Iron bending under load: stick-slip on metal (a creak with ringing, higher modes)."""
    n = secs(dur)
    y = np.zeros(n)
    rate = smooth_random(rng, n, 2, 40, 160)
    ph = np.cumsum(rate / SR)
    idx = np.nonzero(np.diff(np.floor(ph)) > 0)[0]
    env = np.sin(np.pi * np.arange(n) / n) ** 0.5
    y[idx] = env[idx] * rng.uniform(0.5, 1.0, len(idx))
    fr = rng.uniform(300, 2600, 10) * pitch
    return hp(nm(y, fr, rng.uniform(0.03, 0.15, 10), rng.uniform(0.3, 1, 10)), 150)


# ------------------------------------------------------------------ the trebuchet and its stone
def trebuchet(rng):
    """The whole throw, timed to the renderer's arm (js/render/engines.js: 1.1 s from cocked to release):
    the trigger knocked out; the counterweight dropping, the frame and axle groaning; the beam and sling sweeping
    (a deep rising whoosh); the sling opening at the top — a rope whip that ends in a snap; the counterweight box
    bottoming out with a thud that shakes the timbers; the arm swinging back, creaking, settling."""
    dur = 5.0
    n = secs(dur)
    y = np.zeros(n)
    # trigger: a mallet on the release pin — wood knock and the iron hook springing
    ex = _imp(secs(0.4), 0.001, rng)
    place(y, nm(ex, rng.uniform(250, 900, 6), rng.uniform(0.01, 0.04, 6), rng.uniform(.5, 1, 6)) * 0.9, 0)
    place(y, nm(ex, rng.uniform(1500, 4200, 4), rng.uniform(0.05, 0.15, 4), [1, .7, .5, .4]) * 0.35, secs(0.012))
    # counterweight falling: the frame groans (low stick-slip), the axle squeals, the ropes take the strain
    place(y, creak(rng, 1.1, 0.4) * 1.1, secs(0.05))
    place(y, creak(rng, 0.8, 0.9) * 0.35, secs(0.2))
    # the beam and sling sweeping: a big low whoosh swelling toward the release (the tip is doing ~40 m/s)
    sw = secs(1.15)
    kk = np.arange(sw) / SR
    env = (kk / 1.15) ** 2.2 * np.clip((1.15 - kk) / 0.08, 0, 1)
    wh = sweep_bp(rng.standard_normal(sw), lambda t: 140 + 900 * (t / 1.15) ** 2, 1.1) * env * 2.2
    wh += sweep_bp(rng.standard_normal(sw), lambda t: 500 + 2200 * (t / 1.15) ** 2, 2.0) * env * 0.5  # the sling's rope
    place(y, wh, secs(0.0))
    # the sling opens: a whip — a fast zip down and a snap
    zn = secs(0.07)
    zip_ = sweep_bp(rng.standard_normal(zn), lambda t: 5000 - 3500 * t / 0.07, 3.0) * np.linspace(0.3, 1, zn) * 1.2
    place(y, zip_, secs(1.03))
    snap = np.zeros(secs(0.1))
    place(snap, hp(click(rng, 0.0015, 12000), 1500) * 4.0, 0)
    snap += nm(_imp(secs(0.1), 0.0005, rng), rng.uniform(1800, 4500, 3), [0.004, 0.006, 0.003], [1, .6, .5]) * 1.0
    place(y, snap, secs(1.1))
    # counterweight box bottoms out / the arm hits its stop: the thud through the whole frame
    m = secs(2.0)
    th = _thump(rng, m, rng.uniform(38, 50), 0.22, 1.0, 0.02) * 2.6
    th += nm(_imp(m, 0.006, rng), rng.uniform(60, 450, 14), rng.uniform(0.05, 0.25, 14), rng.uniform(.4, 1, 14)) * 2.4
    th += lp(rng.standard_normal(m), 900, 2) * env_exp(m, 0.025) * 1.0
    place(y, th, secs(1.18))
    place(y, rubble(rng, 0.9, 90, 2.2) * 0.35, secs(1.2))  # the stones in the box shifting
    # the arm swings back and forth (a slow pendulum), creaking on each pass
    for i, t in enumerate((1.7, 2.45, 3.25)):
        place(y, creak(rng, 0.6, 0.45) * (0.8 * 0.6 ** i), secs(t))
    return fade(y, 0.0003, 0.4)


def stone_fly(rng):
    """A 50-100 kg stone coming in: a deep, tumbling whoosh growing as it nears, pitch sagging (Doppler), cut
    off at the moment it lands. Scheduled so its end meets the impact."""
    dur = rng.uniform(1.3, 1.6)
    n = secs(dur)
    k = np.arange(n) / SR
    u = k / dur
    tumble = 1 + 0.55 * np.sin(2 * np.pi * np.cumsum(np.full(n, rng.uniform(2.5, 5.0))) / SR)
    env = (0.05 + 0.95 * u ** 3) * tumble
    f0, f1 = rng.uniform(650, 850), rng.uniform(260, 360)
    y = sweep_bp(rng.standard_normal(n), lambda t: f0 + (f1 - f0) * (t / dur) ** 1.5, 1.4) * env * 1.6
    y += sweep_lp(rng.standard_normal(n), lambda t: 200 + 500 * (t / dur) ** 2) * env * 0.9  # the air it pushes
    y += bp(rng.standard_normal(n), 2000, 6000) * env ** 2 * 0.06
    y = fade(y, 0.2, 0.006)
    return y


# ------------------------------------------------------------------ what the stone strikes
def stone_masonry(rng, big=True):
    """A stone on a wall: the face spalls (a crack), the wall's mass booms, fragments scatter and bounce, grit
    and dust run down for seconds."""
    dur = 4.0
    n = secs(dur)
    k = np.arange(n) / SR
    s = 1.0 if big else 0.6
    y = np.zeros(n)
    cr = hp(rng.standard_normal(secs(0.025)) * env_exp(secs(0.025), 0.003), 1000) * 2.0
    place(cr, hp(click(rng, 0.0008, 16000), 2000) * 1.5, 0)
    place(y, cr, 0)
    y += _thump(rng, n, rng.uniform(36, 55) / s ** 0.2, 0.28 * s, 1.2, 0.015) * 2.4 * s
    y += nm(_imp(n, 0.003, rng), rng.uniform(70, 700, 16), rng.uniform(0.03, 0.14, 16), rng.uniform(.4, 1, 16)) * 1.8
    y += lp(rng.standard_normal(n), 1500, 2) * np.exp(-k / 0.05) * 1.4  # the shatter's body
    place(y, fragments(rng, int(rng.integers(26, 40) * s), 1.6, 0.03, 0.35, (0.4, 1.8), 0.9), 0)
    place(y, rubble(rng, 2.0, 260, 1.4) * 0.35, secs(0.25))
    y += grit(rng, dur, 0.5, 0.2)
    y += bp(pink(rng, n), 250, 2500) * np.exp(-k / 0.3) * 0.15  # dust
    return fade(y, 0.0002, 0.3)


def stone_earth(rng, big=True):
    """A stone into turf: a deep dead thud (no ring), earth and clods thrown up and falling back."""
    dur = 3.0
    n = secs(dur)
    k = np.arange(n) / SR
    s = 1.0 if big else 0.6
    y = _thump(rng, n, rng.uniform(30, 44) / s ** 0.3, 0.16 * s, 1.6, 0.025) * 3.0
    y += lp(rng.standard_normal(n), 700, 2) * np.exp(-k / 0.05) * 2.0
    y += bp(rng.standard_normal(n), 800, 4000) * np.exp(-k / 0.02) * 0.4  # turf tearing
    for _ in range(int(rng.integers(20, 34) * s)):
        place(y, clod(rng, rng.uniform(0.5, 1.8)) * rng.uniform(0.2, 1.0) * 0.9, secs(rng.uniform(0.35, 1.3)))
    place(y, fragments(rng, int(rng.integers(3, 7)), 0.8, 0.3, 0.3, (0.6, 1.2), 0.4), 0)  # a few pebbles
    y += lp(brown(rng, n), 110) * np.exp(-k / 0.5) * 0.35
    return fade(y, 0.0003, 0.3)


def stone_men(rng):
    """A stone through a file of men: shields staved, the dull blow into bodies, bone, mail and helmets thrown,
    the stone ploughing on into the ground."""
    dur = 2.6
    n = secs(dur)
    y = np.zeros(n)
    place(y, crack(rng, rng.uniform(0.9, 1.3)) * 1.0, 0)  # a shield
    for i in range(int(rng.integers(2, 4))):
        t = i * rng.uniform(0.03, 0.07)
        b = secs(0.3)
        kk = np.arange(b) / SR
        body = lp(rng.standard_normal(b), rng.uniform(300, 500), 2) * np.exp(-kk / 0.035) * 2.2
        body += _thump(rng, b, rng.uniform(70, 110), 0.05, 0.6, 0.01) * 1.2
        place(y, body, secs(t))
        if rng.uniform() < 0.7:  # bone
            place(y, nm(_imp(secs(0.08), 0.0004, rng), rng.uniform(900, 2600, 3), [0.004, 0.006, 0.003], [1, .6, .5]) * 0.6, secs(t + 0.004))
        place(y, (mail(rng, 0.25, 260) if rng.uniform() < 0.6 else plate(rng)) * 0.5, secs(t + 0.02))
    place(y, stone_earth(rng, False) * 0.6, secs(0.12))
    return fade(y, 0.0003, 0.3)


# ------------------------------------------------------------------ masonry failing
def masonry_crack(rng):
    """A module going to 'cracked': the stone groans, a split runs through the core (a long, low crack), small
    fractures crackle along it, mortar and grit trickle out."""
    dur = 3.2
    n = secs(dur)
    k = np.arange(n) / SR
    y = np.zeros(n)
    # the groan: grinding of stone on stone (slow stick-slip into low, heavy modes)
    gr = np.zeros(secs(1.4))
    gk = np.arange(len(gr)) / SR
    rate = smooth_random(rng, len(gr), 3, 15, 60)
    idx = np.nonzero(np.diff(np.floor(np.cumsum(rate / SR))) > 0)[0]
    gr[idx] = rng.uniform(0.4, 1.0, len(idx)) * np.sin(np.pi * gk[idx] / 1.4)
    place(y, nm(gr, rng.uniform(60, 400, 10), rng.uniform(0.02, 0.08, 10), rng.uniform(.4, 1, 10)) * 1.3, 0)
    place(y, lp(brown(rng, secs(1.4)), 160) * np.sin(np.pi * gk / 1.4) * 0.5, 0)
    # the split
    t0 = rng.uniform(0.7, 1.0)
    m = secs(1.5)
    sp = hp(rng.standard_normal(secs(0.04)) * env_exp(secs(0.04), 0.006), 700) * 1.1
    sp2 = nm(_imp(m, 0.004, rng), rng.uniform(50, 500, 12), rng.uniform(0.05, 0.2, 12), rng.uniform(.4, 1, 12)) * 1.6
    sp2 += _thump(rng, m, rng.uniform(40, 60), 0.2, 0.8, 0.02) * 1.2
    place(y, sp, secs(t0))
    place(y, sp2, secs(t0))
    # fractures running along it
    t = t0 + 0.02
    while t < t0 + rng.uniform(0.25, 0.5):
        place(y, hp(click(rng, 0.0006, 9000), 1200) * rng.uniform(0.2, 0.8), secs(t))
        t += rng.exponential(0.012)
    place(y, fragments(rng, int(rng.integers(5, 10)), 0.8, t0 + 0.2, 0.4, (0.4, 0.9), 0.5), 0)
    y += grit(rng, dur, 1.2, 0.25) * np.clip((k - t0) / 0.05, 0, 1)
    return fade(y, 0.002, 0.3)


def tower_collapse(rng):
    """A tower (or a mined section) coming down: groans and cracks as it goes, the mass falling (a rolling
    thunder of stone), a great ground-shaking thud, masonry breaking up for seconds, rubble sliding, dust."""
    dur = 11.0
    n = secs(dur)
    k = np.arange(n) / SR
    y = np.zeros(n)
    place(y, masonry_crack(rng) * 0.9, 0)
    place(y, masonry_crack(rng) * 0.7, secs(rng.uniform(0.8, 1.3)))
    T = rng.uniform(2.0, 2.4)  # the fall begins
    y += rumble(rng, dur, 0.8, 3.0, 70, 1.4) * (k > T - 0.6)
    y += rumble(rng, dur, 1.2, 2.2, 220, 0.6) * (k > T - 0.3)
    m = secs(3.0)
    main = _thump(rng, m, rng.uniform(28, 36), 0.5, 1.0, 0.04) * 3.2
    main += lp(rng.standard_normal(m), 600, 2) * env_exp(m, 0.25) * 2.0
    place(y, main, secs(T + 0.9))
    for _ in range(int(rng.integers(10, 16))):
        place(y, stone_masonry(rng, rng.uniform() < 0.5) * rng.uniform(0.3, 0.8), secs(T + rng.uniform(0.0, 2.6)))
    for _ in range(int(rng.integers(6, 10))):
        place(y, stone_earth(rng, rng.uniform() < 0.4) * rng.uniform(0.3, 0.7), secs(T + 0.6 + rng.uniform(0, 2.0)))
    place(y, rubble(rng, 6.0, 900, 1.8) * 1.2, secs(T + 0.8))
    y += grit(rng, dur, 3.0, 0.5) * np.clip((k - T - 1) / 0.5, 0, 1)
    y += bp(pink(rng, n), 200, 2000) * np.clip((k - T) / 0.8, 0, 1) * np.exp(-np.clip(k - T - 1.5, 0, None) / 2.5) * 0.3
    return fade(y, 0.002, 1.0)


# ------------------------------------------------------------------ gates and the portcullis
def ram_oak(rng):
    """The ram's boom on an iron-bound oak gate: the head strikes (iron on iron straps), the leaves boom and
    shudder on their bar, the bar and hinges groan, dust and splinters drop."""
    dur = 2.8
    n = secs(dur)
    k = np.arange(n) / SR
    ex = _imp(n, 0.007, rng)
    y = nm(ex, rng.uniform(40, 260, 18), rng.uniform(0.08, 0.3, 18), rng.uniform(.4, 1, 18)) * 3.0
    y += _thump(rng, n, rng.uniform(40, 52), 0.35, 0.7, 0.03) * 2.6
    y += nm(_imp(n, 0.001, rng), rng.uniform(700, 3500, 6), rng.uniform(0.03, 0.15, 6), [1, .8, .6, .5, .4, .3]) * 0.5
    y += lp(rng.standard_normal(n), 1100, 2) * np.exp(-k / 0.03) * 1.2
    place(y, creak(rng, 0.9, 0.4) * 0.6, secs(0.2))  # the bar and the hinges
    place(y, rubble(rng, 0.9, 70, 2.2) * 0.25, secs(0.1))  # dust and grit from the arch
    if rng.uniform() < 0.5:
        place(y, splinter(rng) * 0.5, secs(0.01))
    return fade(y, 0.0003, 0.3)


def leaves_break(rng):
    """The gate leaves giving way: the oak splits in long cracks, iron straps tear, a leaf crashes in off its
    hinges, planks and bolts clatter."""
    dur = 4.8
    n = secs(dur)
    y = np.zeros(n)
    place(y, ram_oak(rng) * 0.7, 0)
    t = 0.05
    for _ in range(int(rng.integers(5, 9))):
        place(y, crack(rng, rng.uniform(1.2, 2.0)) * rng.uniform(1.0, 1.7), secs(t))
        t += rng.uniform(0.03, 0.18)
    place(y, metal_groan(rng, 0.6, 1.2) * 0.5, secs(0.25))  # a strap tearing
    place(y, iron_clang(rng, 0.5) * 0.35, secs(0.6))
    m = secs(2.0)  # the leaf lands
    slam = nm(_imp(m, 0.006, rng), rng.uniform(60, 600, 14), rng.uniform(0.03, 0.12, 14), rng.uniform(.4, 1, 14)) * 2.4
    slam += _thump(rng, m, 45, 0.18, 1.0, 0.02) * 2.0
    place(y, slam, secs(rng.uniform(1.3, 1.6)))
    for _ in range(int(rng.integers(4, 8))):
        e = _imp(secs(0.25), 0.001, rng)
        place(y, nm(e, rng.uniform(250, 1500, 5), rng.uniform(0.01, 0.05, 5), rng.uniform(.4, 1, 5)) * rng.uniform(0.2, 0.6), secs(rng.uniform(1.5, 2.6)))
    return fade(y, 0.0003, 0.4)


def portcullis_drop(rng):
    """The pawl knocked free: the chain runs out over the drum (a rattle that races), the grid drops in its
    grooves and slams into the sill — iron-shod oak on stone: a clang and a boom — and the slack chain settles."""
    dur = 3.8
    n = secs(dur)
    y = np.zeros(n)
    e = _imp(secs(0.3), 0.0008, rng)
    place(y, nm(e, rng.uniform(1200, 4000, 4), rng.uniform(0.02, 0.08, 4), [1, .7, .5, .4]) * 0.7, 0)  # the pawl
    fall = rng.uniform(0.75, 0.95)
    place(y, chain_run(rng, fall, 25, 110) * 0.55, secs(0.03))
    k = np.arange(secs(fall)) / SR
    groove = bp(rng.standard_normal(len(k)), 400, 2500) * (k / fall) ** 1.5 * 0.35  # the grid scraping in its grooves
    place(y, groove, secs(0.05))
    place(y, lp(brown(rng, len(k)), 120) * (k / fall) * 0.4, secs(0.05))  # the drum spinning
    T = fall + 0.05
    place(y, iron_clang(rng, 1.4) * 1.3, secs(T))
    m = secs(2.0)
    place(y, _thump(rng, m, rng.uniform(50, 62), 0.2, 1.0, 0.015) * 2.6, secs(T))
    place(y, nm(_imp(m, 0.004, rng), rng.uniform(70, 450, 10), rng.uniform(0.04, 0.12, 10), rng.uniform(.4, 1, 10)) * 1.8, secs(T))
    place(y, rubble(rng, 0.6, 80, 2.0) * 0.3, secs(T + 0.02))
    place(y, chain_run(rng, 0.5, 60, 8) * 0.35, secs(T + 0.05))  # slack chain
    return fade(y, 0.0003, 0.4)


def portcullis_raise(rng):
    """Wound up by the windlass: the pawl clacking over the ratchet, the drum and the timbers creaking, chain
    links climbing onto the drum."""
    dur = 4.0
    n = secs(dur)
    y = np.zeros(n)
    t, rate = 0.0, rng.uniform(3.5, 5.0)
    while t < dur - 0.3:
        e = np.zeros(secs(0.08))
        e[0] = 1
        place(y, nm(e, rng.uniform(1000, 3800, 4), rng.uniform(0.01, 0.04, 4), [1, .7, .5, .4]) * rng.uniform(0.6, 1.0), secs(t))
        place(y, nm(e, rng.uniform(150, 450, 3), rng.uniform(0.02, 0.05, 3), [1, .7, .5]) * 0.5, secs(t))
        t += 1 / rate * rng.uniform(0.9, 1.15)
    place(y, chain_run(rng, dur - 0.3, 9, 9, 0.8) * 0.3, 0)
    for tt in np.arange(0.1, dur - 0.8, 0.9):
        place(y, creak(rng, 0.7, 0.55) * 0.5, secs(tt + rng.uniform(0, 0.3)))
    return fade(y, 0.01, 0.2)


def portcullis_break(rng):
    """The grid battered through: iron bending, bars snapping, the wreck crashing into the passage."""
    dur = 3.6
    n = secs(dur)
    y = np.zeros(n)
    place(y, ram_oak(rng) * 0.7, 0)
    place(y, metal_groan(rng, 1.0, 1.0) * 0.8, secs(0.2))
    for _ in range(int(rng.integers(3, 6))):
        place(y, iron_clang(rng, 0.4) * rng.uniform(0.3, 0.6), secs(rng.uniform(0.4, 1.3)))
    place(y, iron_clang(rng, 1.5) * 1.0, secs(1.5))
    place(y, _thump(rng, secs(1.5), 48, 0.18, 1, 0.02) * 1.8, secs(1.5))
    place(y, chain_run(rng, 0.7, 50, 10) * 0.35, secs(1.55))
    return fade(y, 0.0003, 0.4)


# ------------------------------------------------------------------ ladders and the belfry
def ladder_push(rng):
    """A ladder forked off the wall: its head grinding along the stone, a creak as it stands upright, the rush of
    it going over, then the crash — rungs clattering, maybe a pole snapping."""
    dur = 3.2
    n = secs(dur)
    y = np.zeros(n)
    g = secs(0.5)
    gk = np.arange(g) / SR
    place(y, bp(rng.standard_normal(g), 400, 3500) * np.sin(np.pi * gk / 0.5) * smooth_random(rng, g, 30, 0.3, 1) * 0.6, 0)
    place(y, creak(rng, 0.5, 0.8) * 0.7, secs(0.35))
    f = secs(1.0)
    fk = np.arange(f) / SR
    place(y, sweep_bp(rng.standard_normal(f), lambda t: 900 - 500 * t, 1.2) * (fk / 1.0) ** 2 * 0.7, secs(0.6))
    T = 1.6
    for i in range(int(rng.integers(5, 9))):
        e = _imp(secs(0.3), 0.0015, rng)
        place(y, nm(e, rng.uniform(220, 1300, 7), rng.uniform(0.015, 0.05, 7), rng.uniform(.4, 1, 7)) * (1.2 if i == 0 else rng.uniform(0.3, 0.8)), secs(T + (0 if i == 0 else rng.uniform(0.02, 0.5))))
    place(y, _thump(rng, secs(0.6), 70, 0.08, 0.5, 0.02) * 1.2, secs(T))
    if rng.uniform() < 0.5:
        place(y, crack(rng, 1.1) * 0.8, secs(T + 0.03))
    return fade(y, 0.002, 0.3)


def belfry_loop(rng, ir, L=10.0, X=1.2):
    """A siege tower being pushed: the great frame racking and groaning, solid wheels grinding on their axles and
    rumbling over the ground, hides flapping, planks knocking."""
    from beds import _finish
    D = L + X
    n = secs(D)
    out = np.zeros((n, 2))
    k = np.arange(n) / SR
    # wheels: rumble with bumps (stones, ruts) and an axle squeal
    rum = lp(brown(rng, n), 90, 2) * smooth_random(rng, n, 2, 0.6, 1.0) * 1.2
    for _ in range(int(D * 1.5)):
        t = rng.uniform(0, D)
        place(rum, _thump(rng, secs(0.4), rng.uniform(45, 70), 0.06, 0.5, 0.02) * rng.uniform(0.3, 0.9), secs(t))
    out += np.stack([rum, rum], 1)
    for _ in range(int(D * 0.9)):
        c = creak(rng, rng.uniform(0.6, 1.6), rng.uniform(0.3, 0.6)) * rng.uniform(0.5, 1.0)
        place(out, pan_mono(c, rng.uniform(-0.6, 0.6)), secs(rng.uniform(0, D - 0.5)))
    for _ in range(int(D * 0.35)):
        c = creak(rng, rng.uniform(0.4, 0.9), rng.uniform(1.1, 1.6)) * rng.uniform(0.15, 0.35)  # axle squeal
        place(out, pan_mono(c, rng.uniform(-0.4, 0.4)), secs(rng.uniform(0, D - 0.5)))
    for _ in range(int(D * 1.2)):
        e = _imp(secs(0.2), 0.001, rng)
        place(out, pan_mono(nm(e, rng.uniform(200, 1100, 5), rng.uniform(0.01, 0.04, 5), rng.uniform(.4, 1, 5)) * rng.uniform(0.1, 0.35), rng.uniform(-0.8, 0.8)), secs(rng.uniform(0, D)))
    for ch in range(2):  # hides flapping on the frame
        out[:, ch] += bp(pink(rng, n), 150, 900) * smooth_random(rng, n, 6, 0, 1) ** 3 * 0.12
    return _finish(rng, out, ir, L, X, 0.25)


# ------------------------------------------------------------------ mines
def mine_fire(rng):
    """The props in the gallery fired, heard through earth: a muffled whump of pitch and fat catching, then the
    fire roaring low in the ground."""
    dur = 5.0
    n = secs(dur)
    k = np.arange(n) / SR
    y = np.zeros(n)
    place(y, ignite(rng) * 2.5, 0)
    fl = fire_loop(rng, dur, 1.4)[:, 0]
    y += fl * np.clip(k / 0.6, 0, 1) * np.exp(-np.clip(k - 2.5, 0, None) / 1.2) * 1.2
    y += lp(brown(rng, n), 80) * np.clip(k / 0.5, 0, 1) * np.exp(-k / 2.5) * 0.8
    return fade(muffle(y, 420), 0.01, 0.6)


def mine_collapse(rng):
    """The props burnt through: the gallery gives, timbers snapping in the ground, the earth dropping — a deep,
    felt thud and rumble that runs under the feet (the wall's own fall is played on top by wall/tower collapse)."""
    dur = 6.0
    n = secs(dur)
    k = np.arange(n) / SR
    y = np.zeros(n)
    for _ in range(int(rng.integers(4, 7))):
        place(y, crack(rng, rng.uniform(1.5, 2.2)) * rng.uniform(0.6, 1.0), secs(rng.uniform(0, 0.5)))
    m = secs(3.0)
    place(y, _thump(rng, m, rng.uniform(26, 34), 0.6, 0.8, 0.05) * 3.0, secs(0.45))
    y += rumble(rng, dur, 0.6, 1.8, 60, 2.0) * (k > 0.3)
    place(y, rubble(rng, 3.0, 400, 2.5) * 0.9, secs(0.6))
    return fade(muffle(y, 300), 0.002, 0.6)


def mining_loop(rng, ir, L=10.0, X=1.0):
    """Miners at the face, heard from above or from a listening post: muffled pick blows (two or three men out
    of time), a shovel's scrape, a basket dumped, a prop knocked in. Everything through the earth."""
    D = L + X
    n = secs(D)
    y = np.zeros(n)
    for _ in range(3):
        t, rate = rng.uniform(0, 1), rng.uniform(0.6, 1.1)
        while t < D:
            if rng.uniform() < 0.8:
                e = _imp(secs(0.2), 0.0008, rng)
                pick = nm(e, rng.uniform(300, 2200, 4), rng.uniform(0.005, 0.02, 4), [1, .6, .5, .4]) * 0.6
                pick += lp(rng.standard_normal(secs(0.2)), 400, 2) * env_exp(secs(0.2), 0.02) * 1.2
                place(y, pick * rng.uniform(0.5, 1.0), secs(t))
                if rng.uniform() < 0.4:
                    place(y, clod(rng, 0.8) * 0.4, secs(t + rng.uniform(0.1, 0.3)))
            t += 1 / rate * rng.uniform(0.8, 1.3)
    for _ in range(int(D * 0.25)):  # shovel scrapes
        s = secs(rng.uniform(0.4, 0.8))
        place(y, bp(rng.standard_normal(s), 300, 2500) * np.hanning(s) * 0.4, secs(rng.uniform(0, D - 1)))
    for _ in range(int(D * 0.1)):  # a prop knocked home
        for j in range(3):
            e = _imp(secs(0.3), 0.001, rng)
            place(y, nm(e, rng.uniform(150, 700, 5), rng.uniform(0.02, 0.06, 5), rng.uniform(.4, 1, 5)) * 0.7, secs(rng.uniform(0, D - 2) + j * 0.5))
    y = muffle(y, rng.uniform(380, 460)) * 2.0
    y += lp(brown(rng, n), 70) * 0.05
    return make_loop(np.stack([y, y * 0.96], 1), X)


# ------------------------------------------------------------------ from the hoardings
def drop_stone(rng):
    """A stone dropped from the hoarding or a murder hole on the men below: a heavy dull blow (helmet, shield or
    shoulders), a crack, the stone rolling off."""
    dur = 1.5
    n = secs(dur)
    k = np.arange(n) / SR
    y = lp(rng.standard_normal(n), rng.uniform(500, 900), 2) * np.exp(-k / 0.03) * 2.0
    y += _thump(rng, n, rng.uniform(70, 100), 0.07, 0.6, 0.01) * 1.6
    r = rng.uniform()
    if r < 0.4:
        place(y, plate(rng) * 0.9, 0)  # a helmet
    elif r < 0.75:
        place(y, crack(rng, 0.8) * 0.7, 0)  # a shield
    place(y, nm(_imp(secs(0.1), 0.0005, rng), rng.uniform(1000, 3500, 3), [0.004, 0.007, 0.004], [1, .6, .4]) * 0.5, secs(0.003))
    place(y, fragments(rng, int(rng.integers(1, 3)), 0.3, 0.2, 0.2, (1.0, 1.6), 0.5), 0)  # the stone bouncing off
    return fade(y, 0.0003, 0.2)


def drop_sand(rng):
    """Heated sand and lime poured down: the rush of it through the air, a hiss as it lands on mail and skin,
    grains rattling off armour."""
    dur = 2.4
    n = secs(dur)
    k = np.arange(n) / SR
    env = np.clip(k / 0.25, 0, 1) * np.exp(-np.clip(k - 0.9, 0, None) / 0.45)
    pour = bp(pink(rng, n), 500, 4500) * env * 0.9 + lp(pink(rng, n), 400, 2) * env * 0.4  # the mass of it falling
    grains = bp(rng.standard_normal(n) * (rng.uniform(size=n) < 0.02), 1200, 6000) * env * 0.7
    sizzle = bp(rng.standard_normal(n), 3000, 9000) * smooth_random(rng, n, 25, 0, 1) ** 2 * np.clip((k - 0.3) / 0.2, 0, 1) * np.exp(-np.clip(k - 0.6, 0, None) / 0.8) * 0.12
    y = pour + grains + sizzle
    place(y, mail(rng, 0.5, 400) * 0.4, secs(0.35))
    return fade(y, 0.02, 0.3)


# ------------------------------------------------------------------ men on the walls
def wallwalk_loop(rng, ir, L=12.0, X=1.2):
    """Men moving along a wall-walk: boots on stone flags out of step, mail and scabbards, a spear-butt knocked on
    the stone; the flags and the parapet give every step a hard, close slap."""
    from beds import _finish
    D = L + X
    out = np.zeros((secs(D), 2))
    for _ in range(18):
        rate = rng.uniform(1.6, 2.1)
        t = rng.uniform(0, 1 / rate)
        d = rng.uniform(2, 25)
        p = rng.uniform(-0.9, 0.9)
        on = rng.uniform() < 0.8
        while t < D:
            if on:
                s = stone_step(rng) * rng.uniform(0.6, 1.0)
                s2 = np.zeros(len(s) + secs(0.03))
                place(s2, s, 0)
                place(s2, lp(s, 3000, 1) * 0.35, secs(rng.uniform(0.008, 0.02)))  # the parapet answering
                place(out, pan_mono(distance_colour(lp(s2, 6500, 1), d), p), secs(t))
                if rng.uniform() < 0.15:
                    place(out, pan_mono(distance_colour(kit(rng), d) * 0.8, p), secs(t + 0.02))
            t += 1 / rate * rng.uniform(0.95, 1.05)
            if rng.uniform() < 0.03:
                on = not on  # he stops, he goes on
    for _ in range(int(D * 0.3)):  # spear butts
        e = _imp(secs(0.2), 0.0008, rng)
        place(out, pan_mono(distance_colour(nm(e, rng.uniform(600, 3000, 4), rng.uniform(0.004, 0.012, 4), [1, .6, .5, .4]) * 0.6, rng.uniform(3, 20)), rng.uniform(-0.8, 0.8)), secs(rng.uniform(0, D)))
    return _finish(rng, out, ir, L, X, 0.15)


# ------------------------------------------------------------------ rooms: the keep's hall, the gate passage
def _room_ir(rng, dur, rts, predelay, er, flutter=None):
    """Stereo IR of a stone room: dense early reflections from near walls, frequency-dependent diffuse tail
    (stone keeps its highs longer than open air), optional flutter echo between parallel walls."""
    n = secs(dur)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    bands = [(60, 250), (250, 700), (700, 2000), (2000, 5000), (5000, 14000)]
    for (lo, hi), rt, g in zip(bands, rts, (1.0, 1.0, 0.75, 0.45, 0.2)):  # stone and air take the top off
        dec = np.exp(-6.91 * t / rt)
        for ch in range(2):
            ir[:, ch] += bp(rng.standard_normal(n), lo, hi, 2) * dec * g
    ir *= (1 - np.exp(-t / 0.012))[:, None] * 0.25
    ir[:secs(predelay)] = 0
    for _ in range(er):
        tt = rng.uniform(predelay, 0.08)
        g = rng.uniform(0.2, 0.6) * np.exp(-tt / 0.05)
        i = secs(tt)
        ch = rng.integers(0, 2)
        ir[i, ch] += g * rng.choice([-1, 1])
        ir[min(n - 1, i + rng.integers(2, 30)), 1 - ch] += g * 0.7
    ir[:, 0] = lp(ir[:, 0], 9000, 2)
    ir[:, 1] = lp(ir[:, 1], 9000, 2)
    if flutter:
        per, g0, tau = flutter
        tt, g = per, g0
        while tt < dur * 0.7:
            for ch, off in ((0, 0), (1, secs(rng.uniform(0.0005, 0.003)))):
                j = secs(tt) + off
                if j < n:
                    ir[j, ch] += g * rng.choice([-1, 1]) * rng.uniform(0.8, 1.0)
            tt += per * rng.uniform(0.98, 1.02)
            g = g0 * np.exp(-tt / tau)
    ir = fade(ir, 0.0, 0.2)
    return ir / np.sqrt(np.mean(np.sum(ir ** 2, axis=0)))


def ir_hall(rng):
    """The keep's hall/storeys: ~10 x 14 m, 6-8 m high, stone walls, timber floor above: RT ~1.6 s low, ~0.8 s
    high."""
    return _room_ir(rng, 2.4, [1.7, 1.5, 1.3, 1.0, 0.7], 0.006, 40)


def ir_passage(rng):
    """A vaulted gate passage ~4 m wide and ~12 m long: a flutter echo between the side walls (~23 ms), the vault
    and the far mouth answering, a short bright tail."""
    return _room_ir(rng, 1.8, [1.2, 1.1, 1.0, 0.8, 0.55], 0.004, 24, flutter=(0.024, 0.35, 0.25))


# ------------------------------------------------------------------ the camp while days pass
def hammering(rng, n_blows=None, f=1.0):
    """A carpenter's mallet or a hammer on timber and pegs: a burst of blows."""
    y = np.zeros(secs(6))
    t = 0.0
    for _ in range(n_blows or int(rng.integers(4, 11))):
        e = _imp(secs(0.3), 0.001, rng)
        b = nm(e, rng.uniform(250, 1600, 6) * f, rng.uniform(0.01, 0.05, 6), rng.uniform(.4, 1, 6))
        b += lp(rng.standard_normal(secs(0.3)), 500, 2) * env_exp(secs(0.3), 0.01) * 0.6
        place(y, b * rng.uniform(0.7, 1.0), secs(t))
        t += rng.uniform(0.42, 0.62)
    return y[:secs(t + 0.4)]


def saw(rng, dur=None):
    """A two-man pit saw going through a beam: rasping strokes, pull harder than push."""
    dur = dur or rng.uniform(3, 6)
    n = secs(dur)
    k = np.arange(n) / SR
    f = rng.uniform(1.0, 1.4)
    ph = (k * f) % 1
    stroke = np.where(ph < 0.5, np.sin(np.pi * ph / 0.5), 0.55 * np.sin(np.pi * (ph - 0.5) / 0.5)) ** 1.5
    teeth = (rng.uniform(size=n) < 0.08) * rng.standard_normal(n)
    y = (bp(teeth, 1200, 6000) * 1.5 + bp(rng.standard_normal(n), 700, 3000) * 0.25) * stroke
    y *= 0.7 + 0.3 * np.sin(2 * np.pi * np.cumsum(1500 + 400 * np.sin(2 * np.pi * k * f)) / SR)  # the tooth rate
    return fade(y, 0.05, 0.1)


def talk(rng):
    """A man talking (not shouting): a phrase of 3-8 syllables, low pitch falling across it, vowels changing."""
    ns = int(rng.integers(3, 9))
    f = rng.uniform(95, 140)
    parts = []
    for i in range(ns):
        d = rng.uniform(0.09, 0.22)
        fm = 1.08 - 0.2 * i / ns + rng.uniform(-0.05, 0.08)
        v1, v2 = rng.choice(["a", "e", "o", "u", "@", "ae"]), rng.choice(["a", "e", "o", "@"])
        y = U(V.voice(rng, d, [(0, f * fm), (1, f * fm * rng.uniform(0.92, 1.05))], [v1, v2], amp_pts=[(0, 0), (0.2, 1), (0.8, 0.8), (1, 0)],
                    oq=0.62, sharp=0.35, breath=0.1, jitter=0.012, shimmer=0.07, block=96))
        parts.append(np.concatenate([y, np.zeros(secs(rng.uniform(0.02, 0.09) if i < ns - 1 else 0.05))]))
    return np.concatenate(parts)


def camp_loop(rng, ir, L=24.0, X=2.0):
    """The besiegers' camp in the days between assaults, heard from its edge: carpenters hammering and sawing at
    the engines, a smith at the forge, horses at the lines, men talking, calling, laughing, a dog, a distant
    cart, the smoke of cook-fires — all spread out, most of it far."""
    from beds import _finish
    D = L + X
    out = np.zeros((secs(D), 2))

    def put(x, d, t=None):
        place(out, pan_mono(distance_colour(x, d), rng.uniform(-0.95, 0.95)), secs(rng.uniform(0, D - 1) if t is None else t))
    for _ in range(int(D / 3.5)):
        put(hammering(rng, f=rng.uniform(0.8, 1.2)) * rng.uniform(0.5, 1.0), rng.uniform(30, 160))
    for _ in range(int(D / 9)):
        put(saw(rng) * 0.5, rng.uniform(25, 90))
    for _ in range(int(D / 5)):
        put(anvil(rng) * 0.35, rng.uniform(80, 200))
    for _ in range(int(D / 6)):
        put((whinny(rng) if rng.uniform() < 0.35 else snort(rng)) * 0.4, rng.uniform(40, 150))
    for _ in range(int(D / 7)):
        put(shout(rng) * 0.35, rng.uniform(40, 160))
    for _ in range(int(D / 20)):
        put(dog(rng) * 0.3, rng.uniform(80, 220))
    for _ in range(int(D * 1.6)):  # men talking round the fires and the lines
        put(talk(rng) * rng.uniform(0.3, 0.6), rng.uniform(15, 120))
    for _ in range(int(D / 12)):  # someone laughing (a short run of 'ha')
        put(np.concatenate([U(V.voice(rng, 0.12, [(0, 180), (1, 160)], ["a", "a"], amp_pts=[(0, 0), (0.2, 1), (1, 0)], breath=0.3, block=96))
                            for _ in range(int(rng.integers(3, 6)))]) * 0.4, rng.uniform(30, 120))
    n = secs(D)
    fire = fire_loop(rng, D, 0.6)
    out += lp(fire, 3000, 1) * 0.05  # cook-fires, near-ish
    out += np.stack([lp(brown(rng, n), 300) * 0.02] * 2, 1)
    return _finish(rng, out, ir, L, X, 0.45)


# ------------------------------------------------------------------ the assault's signal
def assault_trumpets(rng):
    """'Trumpets in the camp': three or four buisines in ragged unison sounding the assault (a rising call on
    the 4th-8th harmonics, repeated), nakers rolling under them and the great drum beating."""
    parts = []
    fan = [(4, 0.28), (5, 0.28), (6, 0.5), (0, 0.08), (6, 0.2), (6, 0.2), (8, 1.4), (0, 0.25),
           (6, 0.22), (8, 0.22), (6, 0.22), (8, 1.8)]
    nt = int(rng.integers(3, 5))
    old = SG.HORNS["buisine"]["f0"]
    for i in range(nt):
        SG.HORNS["buisine"]["f0"] = old * rng.uniform(0.985, 1.015)  # not quite in tune with each other
        y = SG.call(rng, "buisine", fan, gap=0.03)
        parts.append((R(y) * 0.25, rng.uniform(0, 0.06) + i * 0.012, rng.uniform(0.75, 1.0), rng.uniform(-0.7, 0.7)))
    SG.HORNS["buisine"]["f0"] = old
    tt = 0.0
    while tt < 6.0:
        lvl = 0.5 + 0.4 * min(1, tt / 3)
        parts.append((U(SG.naker(rng, 196 if int(tt * 12) % 2 else 262, lvl)) * lvl * 0.35, tt, 1.0, 0.3 if int(tt * 12) % 2 else 0.45))
        tt += 1 / 12 * rng.uniform(0.95, 1.05)
    for b in np.arange(0, 6.5, 0.8):
        parts.append((U(SG.war_drum(rng, 70, 1.0)) * 0.7, b, 1.0, -0.15))
    out = np.zeros((secs(8.0), 2))
    for x, t, g, p in parts:
        place(out, pan_mono(x, p) * g, secs(t))
    return fade(out, 0.002, 0.8)
