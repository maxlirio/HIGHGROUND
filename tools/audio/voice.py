"""Formant voice synthesis: a glottal source (Rosenberg-style flow pulses, differentiated for lip radiation,
with jitter, shimmer, aspiration and vocal-fry) through a cascade of time-varying formant resonators.
Enough to make grunts, battle cries, death screams, shouted orders and — summed by the dozen with scattered
onsets and pitches — a crowd. No words: soldiers' shouts are vowels and plosive-ish onsets."""
import numpy as np
from scipy import signal
from dsp import SR, secs, lp, hp, bp, smooth_random, fade

# male vowel formants (Hz) and bandwidths, loud/shouted voice (F1 raised as in shouting)
VOWELS = {
    "a": ([780, 1250, 2550, 3500, 4500], [90, 110, 160, 250, 300]),
    "o": ([560, 900, 2450, 3400, 4400], [80, 100, 150, 250, 300]),
    "u": ([370, 800, 2300, 3300, 4300], [70, 90, 140, 250, 300]),
    "e": ([560, 1750, 2500, 3500, 4500], [80, 110, 160, 250, 300]),
    "i": ([320, 2200, 2950, 3600, 4600], [60, 100, 160, 250, 300]),
    "@": ([600, 1350, 2450, 3400, 4400], [90, 110, 160, 250, 300]),   # schwa
    "ae": ([740, 1600, 2500, 3500, 4500], [90, 110, 160, 250, 300]),
    "horse": ([650, 1300, 2600, 3900, 5000], [120, 160, 220, 300, 400]),
}


def glottal(rng, f0, oq=0.6, sharp=0.35, jitter=0.012, shimmer=0.08, breath=0.12, fry=None):
    """f0: per-sample array. Returns (derivative-of-flow source, flow) arrays."""
    n = len(f0)
    # jitter: slow random wobble + per-sample tiny noise on the phase increment
    jit = 1 + jitter * (smooth_random(rng, n, 30, -1, 1))
    inc = f0 * jit / SR
    ph = np.cumsum(inc)
    cyc = np.floor(ph)
    p = ph - cyc
    Tp, Tn = oq * (1 - sharp), oq * sharp
    flow = np.where(p < Tp, 0.5 * (1 - np.cos(np.pi * p / Tp)),
                    np.where(p < Tp + Tn, np.cos(0.5 * np.pi * (p - Tp) / Tn), 0.0))
    # shimmer: per-cycle amplitude variation
    ncyc = int(cyc[-1]) + 2
    amp = 1 + shimmer * rng.standard_normal(ncyc)
    flow *= amp[cyc.astype(int)]
    if fry is not None:  # vocal fry / creak: irregular, some cycles strongly damped (per-sample weight 0..1)
        drop = rng.uniform(0, 1, ncyc) < 0.35
        flow *= 1 - fry * drop[cyc.astype(int)] * 0.8
    src = np.diff(flow, prepend=0) * SR / np.maximum(f0, 50) * 0.15
    # aspiration: noise gated by the open phase
    asp = hp(rng.standard_normal(n), 400) * (0.3 + flow) * breath
    return src + asp, flow


def formant_track(vseq, n, times=None):
    """vseq: list of vowel names (or (freqs,bws)); linearly morphs between them over n samples."""
    V = [VOWELS[v] if isinstance(v, str) else v for v in vseq]
    k = len(V)
    if times is None:
        times = np.linspace(0, 1, k)
    F = np.array([v[0] for v in V], float)
    B = np.array([v[1] for v in V], float)
    return times, F, B


def vocal_tract(x, vseq, times=None, scale=1.0, block=48):
    """Cascade formant filter with per-block interpolation of formants. scale>1 = smaller tract (higher)."""
    n = len(x)
    ts, F, B = formant_track(vseq, n, times)
    F = F * scale
    y = x.copy()
    for k in range(F.shape[1]):
        zi = np.zeros(2)
        out = np.zeros(n)
        for i in range(0, n, block):
            u = i / n
            f = np.interp(u, ts, F[:, k])
            bw = np.interp(u, ts, B[:, k])
            if f >= SR * 0.45:
                out[i:i + block] = y[i:i + block]
                continue
            r = np.exp(-np.pi * bw / SR)
            th = 2 * np.pi * f / SR
            a = [1, -2 * r * np.cos(th), r * r]
            g = 1 - 2 * r * np.cos(th) + r * r  # unity DC gain per stage (cascade formant synth)
            out[i:i + block], zi = signal.lfilter([g], a, y[i:i + block], zi=zi)
        y = out
    return y


def voice(rng, dur, f0_pts, vseq, vtimes=None, amp_pts=None, oq=0.55, sharp=0.3, breath=0.12, jitter=0.012,
          shimmer=0.08, rough=0.0, fry_tail=0.0, scale=1.0, vib=(0, 0), block=48):
    """One vocalisation. f0_pts / amp_pts: lists of (time_frac, value) breakpoints."""
    n = secs(dur)
    u = np.linspace(0, 1, n)
    f0 = np.interp(u, [p[0] for p in f0_pts], [p[1] for p in f0_pts])
    if vib[0]:
        f0 *= 1 + vib[1] * np.sin(2 * np.pi * vib[0] * np.arange(n) / SR + rng.uniform(0, 6))
    fry = None
    if fry_tail > 0:
        fry = np.clip((u - (1 - fry_tail)) / fry_tail, 0, 1)
        f0 = f0 * (1 - 0.5 * fry)
    src, flow = glottal(rng, f0, oq=oq, sharp=sharp, jitter=jitter, shimmer=shimmer, breath=breath, fry=fry)
    if rough > 0:  # period-doubling / subharmonic roughness of a strained scream
        sub, _ = glottal(rng, f0 * 0.5, oq=oq, sharp=sharp, jitter=jitter * 2, shimmer=shimmer, breath=0)
        src = src + rough * sub * smooth_random(rng, n, 8, 0.2, 1)
    y = vocal_tract(src, vseq, vtimes, scale, block)
    if amp_pts is not None:
        y *= np.interp(u, [p[0] for p in amp_pts], [p[1] for p in amp_pts])
    y = hp(y, 70, 2)
    return fade(y, 0.004, 0.03)


def breath_noise(rng, dur, vowel="a", amp_pts=((0, 0), (0.2, 1), (1, 0))):
    """Unvoiced exhalation/pant through the vocal tract."""
    n = secs(dur)
    x = rng.standard_normal(n) * 0.3
    y = vocal_tract(x, [vowel])
    u = np.linspace(0, 1, n)
    y *= np.interp(u, [p[0] for p in amp_pts], [p[1] for p in amp_pts])
    return hp(y, 200)


# ------------------------------------------------------------------ human vocalisations
def grunt(rng):
    """Effort grunt of a man delivering or taking a blow: short, low, pressed, fry at the end."""
    d = rng.uniform(0.18, 0.38)
    f = rng.uniform(95, 150)
    v = rng.choice(["@", "u", "a", "o"])
    y = voice(rng, d, [(0, f * 1.15), (0.25, f * 1.25), (1, f * 0.8)], [v, v], amp_pts=[(0, 0), (0.08, 1), (0.6, 0.7), (1, 0)],
              oq=0.45, sharp=0.2, breath=0.25, jitter=0.03, shimmer=0.15, fry_tail=0.4)
    pre = breath_noise(rng, 0.05, v, ((0, 0), (0.5, 0.5), (1, 0.2)))  # the glottal catch before it
    out = np.concatenate([pre * 0.3, y])
    return out


def cry(rng, pain=1.0):
    """Wounded cry / death scream: higher, strained, falling pitch, rough, breathy end."""
    d = rng.uniform(0.6, 1.3)
    f = rng.uniform(190, 330) * (0.8 + 0.4 * pain)
    v1, v2 = rng.choice(["a", "ae", "e"]), rng.choice(["o", "@", "a"])
    y = voice(rng, d, [(0, f * 0.8), (0.12, f * 1.15), (0.5, f), (1, f * 0.55)], [v1, v1, v2], [0, 0.5, 1],
              amp_pts=[(0, 0), (0.06, 1), (0.55, 0.8), (1, 0)], oq=0.5, sharp=0.18, breath=0.2, jitter=0.03,
              shimmer=0.12, rough=0.35 * pain, vib=(rng.uniform(5, 8), 0.03))
    return y


def shout(rng, kind=None):
    """A shouted order / battle shout, two or three syllables: 'HA-yah!', 'HOLD!', 'a-VANT!' shapes."""
    pats = [
        ([("a", 0.22, 1.0), ("a", 0.38, 1.12)], "hup"),
        ([("o", 0.55, 1.0)], "hold"),
        ([("@", 0.14, 0.95), ("a", 0.5, 1.1)], "avant"),
        ([("e", 0.18, 1.0), ("o", 0.18, 1.05), ("a", 0.42, 1.15)], "three"),
        ([("u", 0.25, 1.0), ("a", 0.45, 1.2)], "hurrah"),
        ([("a", 0.16, 1.1), ("a", 0.16, 1.1), ("a", 0.32, 1.0)], "rally"),
    ]
    sy, _ = pats[rng.integers(len(pats))] if kind is None else pats[kind]
    f = rng.uniform(150, 215)
    parts = []
    for i, (v, d, fm) in enumerate(sy):
        d *= rng.uniform(0.85, 1.2)
        y = voice(rng, d, [(0, f * fm * 0.9), (0.2, f * fm * 1.06), (1, f * fm * 0.86)], [v, v],
                  amp_pts=[(0, 0), (0.07, 1), (0.7, 0.85), (1, 0)], oq=0.5, sharp=0.2, breath=0.14, jitter=0.02, shimmer=0.1,
                  rough=0.08)
        h = breath_noise(rng, 0.05, v, ((0, 0), (0.3, 1), (1, 0.4))) * 0.5  # aspirated onset ('h')
        parts.append(np.concatenate([h, y, np.zeros(secs(rng.uniform(0.02, 0.07)))]))
    return np.concatenate(parts)


def crowd(rng, n_voices, dur, style="cheer", spread=1.0, onset=0.35, vowels=("u", "u", "a", "a")):
    """Many men at once (stereo): cheer = rising 'hoo-RAH', roar = sustained shout, panic = scattered screams,
    murmur = low continuous shouting chatter (for beds)."""
    N = secs(dur)
    out = np.zeros((N, 2))
    from dsp import pan_mono, place
    for _ in range(n_voices):
        pan = rng.uniform(-1, 1) * spread
        dist = rng.uniform(2, 40)
        if style == "cheer":
            d = rng.uniform(0.9, 1.6)
            f = rng.uniform(120, 230)
            y = voice(rng, d, [(0, f * 0.8), (0.3, f), (0.55, f * 1.25), (1, f * 1.05)], list(vowels), [0, 0.3, 0.45, 1], block=128,
                      amp_pts=[(0, 0), (0.1, 0.6), (0.4, 0.7), (0.5, 1), (0.85, 0.8), (1, 0)], oq=0.5, sharp=0.2, breath=0.16,
                      jitter=0.025, shimmer=0.12, rough=0.1, vib=(rng.uniform(4, 7), 0.02))
            at = rng.uniform(0, onset)
        elif style == "roar":
            d = rng.uniform(1.0, min(4.0, dur * 0.9))
            f = rng.uniform(120, 240)
            v = rng.choice(["a", "o", "ae", "e"])
            y = voice(rng, d, [(0, f * 0.9), (0.15, f * 1.1), (1, f * rng.uniform(0.7, 1.0))], [v, rng.choice(["a", "o"])], block=256,
                      amp_pts=[(0, 0), (0.1, 1), (0.8, 0.8), (1, 0)], oq=0.5, sharp=0.2, breath=0.18, jitter=0.03, shimmer=0.12,
                      rough=0.15)
            at = rng.uniform(0, max(0.01, dur - d))
        elif style == "panic":
            y = cry(rng, rng.uniform(0.6, 1.0)) if rng.uniform() < 0.7 else shout(rng)
            at = rng.uniform(0, max(0.01, dur - len(y) / SR))
        else:  # murmur: short shouts everywhere
            y = shout(rng) if rng.uniform() < 0.6 else grunt(rng)
            at = rng.uniform(0, max(0.01, dur - len(y) / SR))
        y = lp(y, float(np.clip(16000 * np.exp(-dist / 60), 1800, 16000)), 1) / (1 + dist / 10)
        place(out, pan_mono(y, pan), secs(at))
    return out


def groan(rng):
    """A wounded man on the ground: low, long, breathy, broken by creak."""
    d = rng.uniform(1.0, 2.2)
    f = rng.uniform(85, 125)
    v = rng.choice(["o", "u", "@"])
    return voice(rng, d, [(0, f), (0.3, f * 1.12), (1, f * 0.8)], [v, v], amp_pts=[(0, 0), (0.2, 0.9), (0.6, 1), (1, 0)],
                 oq=0.6, sharp=0.35, breath=0.4, jitter=0.04, shimmer=0.2, fry_tail=0.5)
