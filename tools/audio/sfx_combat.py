"""Close-combat one-shots by modal synthesis: blade on blade, blade on shield, plate and mail, blunt blows on
bodies, spear shafts, and the footfalls and kit jingle of men on turf.

Physics notes (details in the module docstrings under tools/audio/):
 * a sword is a free-free bar: bending modes at ratios (beta_n)^2 = 1, 2.76, 5.40, 8.93, 13.34, 19.9 … on a
   fundamental of a few hundred Hz; the audible 'ring' of a clash is the 2-8 kHz cluster, and since both blades
   are held, the low modes are damped by the hands (short) while the high ones ring on.
 * a limewood shield is a heavily damped plate: a dull 'thock' of modes 150-900 Hz dying in tens of ms; the
   iron boss (if struck) adds a short clank.
 * mail is thousands of rings: a hit is a shower of tiny, very short metallic grains.
"""
import numpy as np
from dsp import SR, secs, lp, hp, bp, modal, click, env_exp, fade, peq, place

BAR = np.array([1.0, 2.756, 5.404, 8.933, 13.345, 18.638, 24.81, 31.87])


def blade_modes(rng, f0, n_extra=10, t0=0.45, hand=0.15):
    fr = list(f0 * BAR * rng.uniform(0.985, 1.015, len(BAR)))
    # in-plane / torsional / edge modes: an inharmonic cluster where the ear hears 'steel'
    fr += list(rng.uniform(2200, 9500, n_extra))
    fr = np.array(fr)
    taus = t0 * (fr / 1500.0) ** -0.55 * rng.uniform(0.6, 1.4, len(fr))
    taus = np.where(fr < 1200, taus * hand, taus)  # the grip kills the low bending modes
    taus = np.clip(taus, 0.01, 1.2)
    amps = rng.uniform(0.3, 1.0, len(fr)) * np.minimum(1.0, (fr / 2000.0) ** 1.2)  # a light strike hardly moves the low modes
    return fr, taus, amps


def excitation(rng, n, width_ms=1.0, scrape=0.0):
    x = np.zeros(n)
    w = max(4, secs(width_ms / 1000))
    x[:w] = rng.standard_normal(w) * np.hanning(w * 2)[w:]
    x[0] += 1.5
    if scrape > 0:  # edge sliding along edge: stick-slip bursts
        L = secs(scrape)
        st = secs(0.004)
        k = np.arange(L)
        burst = rng.standard_normal(L) * (np.sin(2 * np.pi * rng.uniform(40, 110) * k / SR) > rng.uniform(-0.2, 0.5))
        burst *= np.exp(-k / (L * 0.5)) * 0.35
        x[st:st + L] += hp(burst, 1500)[:len(x) - st]
    return x


def sword_clash(rng, heavy=False):
    dur = 1.6
    n = secs(dur)
    scrape = rng.uniform(0.06, 0.22) if rng.uniform() < 0.45 else 0.0
    e = excitation(rng, n, rng.uniform(0.3, 1.2), scrape)
    y = np.zeros(n)
    for b in range(2):  # both blades ring
        f0 = rng.uniform(170, 340) * (0.85 if heavy else 1)
        fr, taus, amps = blade_modes(rng, f0, t0=rng.uniform(0.25, 0.6))
        y += modal(e * rng.uniform(0.6, 1.0), fr, taus, amps)
    # the impact itself: a broadband crack and a body 'chock' of the arm/hilt
    c = click(rng, 0.0015, 12000) * 2.5
    thump = lp(rng.standard_normal(secs(0.05)) * env_exp(secs(0.05), 0.012), 400) * 2.0
    place(y, c, 0)
    place(y, thump, 0)
    y = hp(y, 120)
    y = peq(y, rng.uniform(2800, 4200), 3.0, 1.2)
    return fade(y, 0.0005, 0.2)


def sword_shield(rng):
    n = secs(0.9)
    e = excitation(rng, n, rng.uniform(2.0, 4.0))
    fr = rng.uniform(140, 950, 14)
    taus = rng.uniform(0.012, 0.05, 14)
    wood = modal(e, fr, taus, rng.uniform(0.5, 1, 14)) * 1.8
    body = lp(rng.standard_normal(secs(0.12)) * env_exp(secs(0.12), 0.02), 700) * 1.2
    y = wood.copy()
    place(y, body, 0)
    # the blade rings a little after hitting wood
    fr, taus, amps = blade_modes(rng, rng.uniform(180, 320), t0=0.18)
    y += 0.35 * modal(e, fr, taus * 0.6, amps)
    if rng.uniform() < 0.35:  # caught the iron boss
        fr = rng.uniform(900, 4200, 8)
        y += 0.8 * modal(e, fr, rng.uniform(0.03, 0.12, 8), rng.uniform(0.4, 1, 8))
    place(y, hp(click(rng, 0.003, 5000), 300) * 1.5, 0)
    return fade(hp(y, 70), 0.0005, 0.15)


def shield_bash(rng):
    """Shield on shield / body into shield wall: a heavy wooden thud."""
    n = secs(0.7)
    e = excitation(rng, n, rng.uniform(5, 9))
    fr = rng.uniform(90, 600, 12)
    y = modal(e, fr, rng.uniform(0.015, 0.06, 12), rng.uniform(0.5, 1, 12)) * 2.2
    y += lp(rng.standard_normal(n) * env_exp(n, 0.03), 500) * 0.8
    return fade(hp(y, 50), 0.0005, 0.12)


def plate_hit(rng):
    n = secs(0.8)
    e = excitation(rng, n, rng.uniform(0.8, 2.0))
    fr = np.concatenate([rng.uniform(600, 2200, 8), rng.uniform(2200, 7000, 10)])
    taus = np.clip(0.3 * (fr / 1500) ** -0.6 * rng.uniform(0.4, 1.2, len(fr)), 0.01, 0.4) * 0.5  # plate on a padded body: damped
    y = modal(e, fr, taus, rng.uniform(0.4, 1, len(fr)))
    thud = lp(rng.standard_normal(secs(0.1)) * env_exp(secs(0.1), 0.02), 500) * 1.5
    place(y, thud, 0)
    return fade(hp(y, 90), 0.0005, 0.12)


def mail_rattle(rng, dur=None, density=None):
    """Mail: a shower of tiny ring-on-ring grains."""
    dur = dur or rng.uniform(0.25, 0.5)
    n = secs(dur + 0.05)
    y = np.zeros(n)
    rate = density or rng.uniform(250, 500)
    t = 0.0
    while t < dur:
        g = np.exp(-t / (dur * 0.35))
        m = secs(0.012)
        ex = np.zeros(m)
        ex[0] = 1
        fr = rng.uniform(3500, 11000, 3)
        grain = modal(ex, fr, rng.uniform(0.002, 0.008, 3), [1, 0.7, 0.5])
        place(y, grain * g * rng.uniform(0.3, 1), secs(t))
        t += rng.exponential(1 / rate)
    return fade(hp(y, 1500) * 3, 0.0005, 0.02)


def body_hit(rng):
    """A blow landing on a padded/mailed body: dull thud + cloth + a little mail."""
    n = secs(0.35)
    k = np.arange(n) / SR
    f = rng.uniform(70, 120) * np.exp(-k / 0.05) + 45
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-k / rng.uniform(0.03, 0.06))
    nz = lp(rng.standard_normal(n), rng.uniform(500, 1100), 2) * np.exp(-k / 0.025)
    cloth = bp(rng.standard_normal(n), 1500, 6000) * np.exp(-k / 0.04) * 0.15
    y = thump * 1.2 + nz + cloth
    if rng.uniform() < 0.5:
        m = mail_rattle(rng, 0.15, 300) * 0.3
        place(y, m, secs(0.004))
    return fade(y, 0.001, 0.05)


def shaft_clack(rng):
    """Ash spear shafts / pole-arms knocking together: bright hollow wooden clack."""
    n = secs(0.5)
    e = excitation(rng, n, rng.uniform(0.5, 1.5))
    fr = np.concatenate([rng.uniform(500, 1400, 4), rng.uniform(1400, 4200, 6)])
    y = modal(e, fr, rng.uniform(0.01, 0.05, len(fr)), rng.uniform(0.4, 1, len(fr))) * 1.5
    return fade(hp(y, 200), 0.0005, 0.08)


def footstep(rng, soft=1.0):
    """A boot on turf: a soft low thud and a grassy crush."""
    n = secs(0.25)
    k = np.arange(n) / SR
    y = lp(rng.standard_normal(n), rng.uniform(250, 500), 2) * np.exp(-k / rng.uniform(0.015, 0.03)) * 1.5
    y += bp(rng.standard_normal(n), 1200, 5000) * np.exp(-k / 0.03) * np.clip(k / 0.01, 0, 1) * 0.25 * soft
    return fade(y, 0.001, 0.05)


def kit_jingle(rng):
    """Scabbard knock + buckle + mail as a man steps."""
    n = secs(0.4)
    y = np.zeros(n)
    if rng.uniform() < 0.7:
        place(y, mail_rattle(rng, rng.uniform(0.08, 0.18), 200) * 0.5, secs(rng.uniform(0, 0.05)))
    if rng.uniform() < 0.5:
        ex = np.zeros(secs(0.1))
        ex[0] = 1
        place(y, modal(ex, rng.uniform(600, 2500, 4), rng.uniform(0.01, 0.03, 4), [1, .6, .5, .4]) * 0.6, secs(rng.uniform(0, 0.1)))
    if rng.uniform() < 0.4:
        ex = np.zeros(secs(0.2))
        ex[0] = 1
        place(y, modal(ex, rng.uniform(1800, 5000, 4), rng.uniform(0.05, 0.15, 4), [1, .6, .5, .4]) * 0.25, secs(rng.uniform(0, 0.1)))
    return y
