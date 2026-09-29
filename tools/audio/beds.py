"""Composite one-shots and looped 'density' beds. The game never plays a thousand clashes: where hundreds of
men fight it plays a bed made here from hundreds of our own one-shots, scattered in time, distance and pan,
then reverberated in the vale IR and looped seamlessly.

Per docs/battle-feel-research.md §7: the SURGE (first contact, charges) is a wall of metal and shouting; the
long GRIND goes quiet of voices — blows, grunts, breathing, groans and scraping only."""
import numpy as np
from dsp import SR, secs, lp, hp, bp, fade, place, pan_mono, distance_colour, convolve, make_loop, pink, brown, smooth_random
import sfx_combat as C
import sfx_missile as M
import sfx_horse as H
import sfx_siege as G
import sfx_signal as SG
import voice as V


def scatter(rng, out, gen, rate, dur, dist=(3, 40), gain=1.0, pan=0.9):
    t = rng.exponential(1 / rate)
    while t < dur:
        d = rng.uniform(*dist)
        x = distance_colour(gen(rng), d) * gain
        place(out, pan_mono(x, rng.uniform(-pan, pan)), secs(t))
        t += rng.exponential(1 / rate)


def _finish(rng, out, ir, L, X, wet):
    y = convolve(out, ir, wet=wet, dry=1.0)[:len(out)]
    return make_loop(y, X)


# ------------------------------------------------------------------ composite one-shots
def cavalry_impact(rng):
    """Horsemen hitting a line: lances in flinders, shields staved, bodies and horses going down."""
    dur = 3.0
    out = np.zeros((secs(dur), 2))
    for _ in range(rng.integers(4, 8)):
        t = abs(rng.normal(0, 0.18))
        p = rng.uniform(-0.8, 0.8)
        place(out, pan_mono(G.crack(rng, rng.uniform(0.8, 1.4)) * 0.9, p), secs(t))
        place(out, pan_mono(C.shield_bash(rng) * 1.2, p), secs(t + 0.01))
    for _ in range(rng.integers(3, 6)):
        place(out, pan_mono(C.body_hit(rng) * 1.2, rng.uniform(-0.8, 0.8)), secs(abs(rng.normal(0.05, 0.2))))
        place(out, pan_mono(C.sword_clash(rng) * 0.4, rng.uniform(-0.8, 0.8)), secs(abs(rng.normal(0.2, 0.3))))
    for _ in range(rng.integers(6, 12)):
        place(out, pan_mono(H.hoof(rng, 1.3), rng.uniform(-0.8, 0.8)), secs(rng.uniform(-0.3, 0.4) + 0.3))
    if rng.uniform() < 0.7:
        place(out, pan_mono(H.horse_scream(rng) * 0.5, rng.uniform(-0.6, 0.6)), secs(rng.uniform(0.1, 0.5)))
    place(out, pan_mono(V.cry(rng) * 0.35, rng.uniform(-0.6, 0.6)), secs(rng.uniform(0.2, 0.6)))
    k = np.arange(len(out)) / SR
    out += (lp(brown(rng, len(out)), 100) * np.exp(-k / 0.5) * 0.6)[:, None]
    return fade(out, 0.0005, 0.3)


def warcry(rng, team="blue"):
    """A body of men raising their cry: blue 'Saint Geor-ge!' shape (e-e-o-o), red 'Mont-joie!' (o-o-a-e)."""
    vow = ("e", "e", "o", "o") if team == "blue" else ("o", "o", "a", "e")
    out = V.crowd(rng, 28, 2.6, "cheer", onset=0.3, vowels=vow)
    return fade(out, 0.005, 0.3)


def rout_cry(rng):
    return fade(V.crowd(rng, 16, 3.0, "panic", onset=1.0), 0.005, 0.3)


def horns_massed(rng):
    """Scots-style horn bouts (Froissart, 1388): many horns great and small, blown all at once, ragged."""
    dur = 7.0
    out = np.zeros((secs(dur), 2))
    for _ in range(rng.integers(12, 20)):
        inst = rng.choice(["blue", "red"])
        P = SG.HORNS[inst]
        old = P["f0"]
        P["f0"] = old * rng.uniform(0.75, 1.45)  # great and small
        notes = [(int(rng.choice([2, 3])), rng.uniform(1.2, 3.5))]
        if rng.uniform() < 0.5:
            notes.append((int(rng.choice([3, 4])), rng.uniform(0.6, 2.0)))
        y = SG.call(rng, inst, notes)
        P["f0"] = old
        d = rng.uniform(20, 200)
        place(out, pan_mono(distance_colour(y, d) * 8, rng.uniform(-0.9, 0.9)), secs(rng.uniform(0, 1.5)))
    return fade(out, 0.01, 0.5)


def windlass(rng):
    """A crossbowman spanning with a windlass/cranequin: ratchet pawl clicks and a creaking cord."""
    dur = rng.uniform(1.2, 2.0)
    n = secs(dur + 0.2)
    y = np.zeros(n)
    t = 0
    rate = rng.uniform(14, 22)
    from dsp import modal
    while t < dur:
        ex = np.zeros(secs(0.05))
        ex[0] = 1
        place(y, modal(ex, rng.uniform(2500, 6000, 3), rng.uniform(0.004, 0.012, 3), [1, .6, .4]) * rng.uniform(0.5, 1), secs(t))
        t += 1 / rate * rng.uniform(0.85, 1.15)
    place(y, G.creak(rng, dur, 1.4) * 0.4, 0)
    return fade(y, 0.001, 0.05)


# ------------------------------------------------------------------ beds (stereo loops)
def din_surge(rng, ir, L=22.0, X=1.5):
    D = L + X
    out = np.zeros((secs(D), 2))
    scatter(rng, out, C.sword_clash, 12, D, (3, 45), 1.0)
    scatter(rng, out, C.sword_shield, 7, D, (3, 45), 1.2)
    scatter(rng, out, C.shield_bash, 3, D, (3, 45), 1.0)
    scatter(rng, out, C.body_hit, 3, D, (3, 35), 1.0)
    scatter(rng, out, C.plate_hit, 2, D, (3, 45), 0.7)
    scatter(rng, out, C.shaft_clack, 3, D, (3, 45), 0.8)
    scatter(rng, out, lambda r: C.mail_rattle(r), 3, D, (3, 30), 0.5)
    scatter(rng, out, V.grunt, 3, D, (3, 30), 0.9)
    scatter(rng, out, V.cry, 0.7, D, (5, 50), 0.8)
    scatter(rng, out, V.shout, 2.2, D, (5, 60), 0.9)
    out += V.crowd(rng, 50, D, "roar") * 0.5
    return _finish(rng, out, ir, L, X, 0.35)


def din_grind(rng, ir, L=22.0, X=1.5):
    D = L + X
    out = np.zeros((secs(D), 2))
    scatter(rng, out, C.sword_clash, 7, D, (3, 45), 0.9)
    scatter(rng, out, C.sword_shield, 8, D, (3, 45), 1.2)   # 'many a dint'
    scatter(rng, out, C.shield_bash, 4, D, (3, 40), 1.1)
    scatter(rng, out, C.body_hit, 4, D, (3, 35), 1.1)
    scatter(rng, out, C.shaft_clack, 2, D, (3, 45), 0.8)
    scatter(rng, out, lambda r: C.mail_rattle(r), 4, D, (3, 30), 0.6)
    scatter(rng, out, V.grunt, 5, D, (3, 30), 1.0)
    scatter(rng, out, V.groan, 0.5, D, (5, 40), 0.7)
    scatter(rng, out, lambda r: V.breath_noise(r, r.uniform(0.3, 0.6), "a", ((0, 0), (0.3, 1), (1, 0))), 4, D, (2, 12), 0.5)
    scatter(rng, out, lambda r: G.creak(r, r.uniform(0.2, 0.4), 2.5) * 0.3, 1.5, D, (3, 20), 0.5)  # leather and harness
    return _finish(rng, out, ir, L, X, 0.3)


def roar(rng, ir, L=22.0, X=1.5):
    """The battle heard from far off: a roar of voices and a haze of metal."""
    D = L + X
    out = np.zeros((secs(D), 2))
    out += V.crowd(rng, 110, D, "roar", spread=1.0) * 0.8
    scatter(rng, out, C.sword_clash, 20, D, (150, 350), 5.0)
    scatter(rng, out, C.sword_shield, 12, D, (150, 350), 5.0)
    out = lp(out, 2600, 2)
    return _finish(rng, out, ir, L, X, 0.6)


def arrow_storm(rng, ir, L=16.0, X=1.5):
    """'Thick as snow': shafts hissing overhead and pattering down like hail on turf, shields and plate."""
    D = L + X
    out = np.zeros((secs(D), 2))
    scatter(rng, out, M.arrow_whoosh, 22, D, (4, 30), 0.9)
    scatter(rng, out, M.arrow_ground, 30, D, (3, 40), 1.0)
    scatter(rng, out, M.arrow_shield, 7, D, (3, 40), 1.0)
    scatter(rng, out, M.arrow_armour, 3, D, (3, 40), 0.6)
    scatter(rng, out, M.arrow_flesh, 1.5, D, (3, 30), 0.7)
    n = len(out)
    for ch in range(2):  # the collective hiss of the cloud
        out[:, ch] += bp(pink(rng, n), 2000, 7000) * smooth_random(rng, n, 1.5, 0.4, 1.0) * 0.06
    return _finish(rng, out, ir, L, X, 0.3)


def march(rng, ir, L=16.0, X=1.5):
    """A column on the march: ~60 men out of step on turf, kit jingling, harness creak."""
    D = L + X
    out = np.zeros((secs(D), 2))
    for _ in range(60):
        rate = rng.uniform(1.7, 2.0)
        t = rng.uniform(0, 1 / rate)
        d = rng.uniform(3, 45)
        p = rng.uniform(-0.9, 0.9)
        while t < D:
            x = C.footstep(rng)
            place(out, pan_mono(distance_colour(x, d), p), secs(t))
            if rng.uniform() < 0.12:
                place(out, pan_mono(distance_colour(C.kit_jingle(rng), d) * 0.8, p), secs(t + 0.02))
            t += 1 / rate * rng.uniform(0.95, 1.05)
    return _finish(rng, out, ir, L, X, 0.25)


def cavalry(rng, ir, pace="gallop", L=12.0, X=1.5):
    D = L + X
    out = np.zeros((secs(D), 2))
    for _ in range(22):
        d = rng.uniform(3, 40)
        g = H.gait(rng, D, pace, weight=rng.uniform(0.8, 1.2))
        place(out, pan_mono(distance_colour(g, d), rng.uniform(-0.9, 0.9)), 0)
    n = len(out)
    out += (lp(brown(rng, n), 110) * (0.5 if pace == "gallop" else 0.2))[:, None]  # ground rumble
    if pace == "gallop":
        scatter(rng, out, H.snort, 0.6, D, (4, 30), 0.5)
    return _finish(rng, out, ir, L, X, 0.25)


def rout(rng, ir, L=16.0, X=1.5):
    D = L + X
    out = np.zeros((secs(D), 2))
    out += V.crowd(rng, 30, D, "panic") * 1.0
    for _ in range(25):  # running men: fast, uneven steps
        rate = rng.uniform(2.8, 3.4)
        t = rng.uniform(0, 1)
        d = rng.uniform(4, 40)
        p = rng.uniform(-0.9, 0.9)
        while t < D:
            place(out, pan_mono(distance_colour(C.footstep(rng) * 1.3, d), p), secs(t))
            t += 1 / rate * rng.uniform(0.85, 1.15)
    scatter(rng, out, lambda r: C.mail_rattle(r), 3, D, (4, 30), 0.4)
    return _finish(rng, out, ir, L, X, 0.35)


def fire_bed(rng, ir, L=16.0, X=1.5):
    D = L + X
    out = G.fire_loop(rng, D)
    return _finish(rng, out, ir, L, X, 0.15)


def wind_bed(rng, ir, L=40.0, X=3.0):
    from sfx_ambience import wind
    return make_loop(wind(rng, L + X), X)


def aftermath(rng, ir, L=24.0, X=2.0):
    """When the noise stops: the wounded moaning, a horse, crows."""
    from sfx_ambience import crow
    D = L + X
    out = np.zeros((secs(D), 2))
    scatter(rng, out, V.groan, 0.9, D, (5, 60), 1.0)
    scatter(rng, out, lambda r: V.cry(r, 0.4) * 0.5, 0.15, D, (20, 80), 1.0)
    scatter(rng, out, crow, 0.12, D, (20, 90), 1.0)
    scatter(rng, out, H.snort, 0.1, D, (10, 60), 0.8)
    return _finish(rng, out, ir, L, X, 0.4)
