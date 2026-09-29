"""Inspect rendered siege/castle sounds (status/audio/wav/*.wav from `render.py --wav`): length, sample and true
peak, clipping, loudness, spectral centroid, octave-band balance, DC, and — per sound — the checks that say the
design is there (e.g. a masonry strike must carry energy in the fragments' band after the crack; a mine must have
nothing above ~600 Hz). Writes status/audio/siege_check.json and a spectrogram sheet status/audio/siege_sheet.png.
  python3 tools/audio/check_siege.py [name-prefix ...]
"""
import json, os, sys, glob
import numpy as np
from scipy.io import wavfile
from scipy import signal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import loudness, momentary_max, true_peak_db, bp, lp, hp

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WAV = os.path.join(ROOT, "status", "audio", "wav")
NAMES = ["trebuchet", "stone_fly", "stone_wall", "stone_ground", "stone_men", "masonry_crack", "tower_collapse", "ram", "leaves_break",
         "portcullis_drop", "portcullis_raise", "portcullis_break", "ladder_push", "mine_fire", "mine_collapse", "drop_stone", "drop_sand",
         "hammer", "assault_trumpets", "bed_belfry", "bed_mining", "bed_wallwalk", "bed_camp", "ir_hall", "ir_passage"]


def band_db(x, lo, hi, a=0, b=None):
    s = x[int(a * 48000): None if b is None else int(b * 48000)]
    if len(s) < 256: return -120.0
    y = bp(s, lo, min(hi, 23000), 6)  # steep: a heavy bass must not leak into a high band's reading
    return 10 * np.log10(np.mean(y ** 2) + 1e-20)


def rt60(x):  # Schroeder backward integration, T20 extrapolated
    e = np.cumsum((x ** 2)[::-1])[::-1]; e = 10 * np.log10(e / e[0] + 1e-20)
    i5, i25 = np.argmax(e < -5), np.argmax(e < -25)
    return 3 * (i25 - i5) / 48000 if i25 > i5 else None


# per-sound design checks: (description, fn(mono) -> bool)
CHECKS = {
    "stone_wall": [("fragments audible after the crack (2-7 kHz, 0.3-1.2 s within 30 dB of the first 50 ms)",
                    lambda m: band_db(m, 2000, 7000, 0.3, 1.2) > band_db(m, 2000, 7000, 0, 0.05) - 30),
                   ("mass boom (40-80 Hz) present", lambda m: band_db(m, 35, 90) > band_db(m, 35, 20000) - 15)],
    "stone_ground": [("thud-dominated: 30-120 Hz within 6 dB of the whole", lambda m: band_db(m, 30, 120) > band_db(m, 30, 20000) - 6),
                     ("no ring: 3-8 kHz at least 15 dB under the low band", lambda m: band_db(m, 3000, 8000) < band_db(m, 30, 120) - 15)],
    "mine_fire": [("heard through earth: > 700 Hz at least 30 dB down", lambda m: band_db(m, 700, 20000) < band_db(m, 30, 20000) - 30)],
    "mine_collapse": [("heard through earth: > 700 Hz at least 30 dB down", lambda m: band_db(m, 700, 20000) < band_db(m, 30, 20000) - 30)],
    "bed_mining": [("muffled: > 1 kHz at least 25 dB down", lambda m: band_db(m, 1000, 20000) < band_db(m, 30, 20000) - 25)],
    "trebuchet": [("sling snap near 1.1 s (4-12 kHz peak in 1.05-1.2 s above 0-0.9 s)", lambda m: band_db(m, 4000, 12000, 1.05, 1.2) > band_db(m, 4000, 12000, 0.1, 0.9) + 3),
                  ("counterweight thud (30-90 Hz) after 1.15 s louder than before", lambda m: band_db(m, 30, 90, 1.15, 1.8) > band_db(m, 30, 90, 0, 1.1) + 6)],
    "stone_fly": [("crescendo: last 0.3 s at least 12 dB over the first 0.3 s", lambda m: band_db(m, 100, 3000, len(m) / 48000 - 0.3) > band_db(m, 100, 3000, 0, 0.3) + 12)],
    "tower_collapse": [("long: > 7 s", lambda m: len(m) / 48000 > 7), ("sub rumble 25-80 Hz strong in 2-5 s", lambda m: band_db(m, 25, 80, 2, 5) > band_db(m, 25, 20000, 2, 5) - 8)],
    "portcullis_drop": [("chain rattle before the slam (2-7 kHz in 0.2-0.7 s)", lambda m: band_db(m, 2000, 7000, 0.2, 0.7) > band_db(m, 2000, 7000, 0.9, 20) - 20)],
    "ir_hall": [("RT60 1.0-2.2 s", lambda m: 1.0 < (rt60(m) or 0) < 2.2)],
    "ir_passage": [("RT60 0.6-1.6 s", lambda m: 0.6 < (rt60(m) or 0) < 1.6)],
}


def main():
    pref = sys.argv[1:] or NAMES
    files = sorted(f for f in glob.glob(os.path.join(WAV, "*.wav")) if any(os.path.basename(f).startswith(p) and os.path.basename(f)[len(p):len(p) + 1] in ("_", ".") for p in pref))
    out, bad = [], 0
    for f in files:
        sr, x = wavfile.read(f); x = x.astype(np.float64)
        m = x.mean(1) if x.ndim == 2 else x
        name = os.path.basename(f)[:-4]; base = name.rsplit("_", 1)[0] if name.rsplit("_", 1)[-1].isdigit() else name
        S = np.abs(np.fft.rfft(m)) ** 2; fr = np.fft.rfftfreq(len(m), 1 / sr)
        r = {"file": name, "sec": round(len(m) / sr, 2), "peak_dbfs": round(20 * np.log10(np.max(np.abs(x)) + 1e-20), 2),
             "true_peak": round(true_peak_db(x), 2), "clipped": int(np.sum(np.abs(x) >= 0.999)), "dc": round(float(np.mean(m)), 5),
             "lufs_M": round(momentary_max(x), 1), "centroid_hz": int(np.sum(fr * S) / np.sum(S)),
             "bands": {b: round(band_db(m, b / 1.414, b * 1.414) - band_db(m, 20, 20000), 1) for b in (63, 125, 250, 500, 1000, 2000, 4000, 8000)}}
        if base.startswith("ir_"): r["rt60"] = round(rt60(m) or -1, 2)
        fails = [d for d, fn in CHECKS.get(base, []) if not fn(m)]
        r["checks"] = f"{len(CHECKS.get(base, [])) - len(fails)}/{len(CHECKS.get(base, []))}"
        if fails: r["failed"] = fails
        if r["clipped"] or r["true_peak"] > -0.9 or abs(r["dc"]) > 0.01 or fails: bad += 1
        out.append(r)
        print(f"{name:22s} {r['sec']:6.2f}s pk {r['peak_dbfs']:6.1f} tp {r['true_peak']:6.1f} clip {r['clipped']} M {r['lufs_M']:6.1f} cent {r['centroid_hz']:5d}Hz "
              f"checks {r['checks']}" + (f" rt60 {r['rt60']}" if 'rt60' in r else "") + (f"  FAIL: {fails}" if fails else ""))
    json.dump(out, open(os.path.join(ROOT, "status", "audio", "siege_check.json"), "w"), indent=1)
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        firsts = [f for f in files if f.endswith("_0.wav") or not os.path.basename(f)[:-4].rsplit("_", 1)[-1].isdigit()]
        cols = 3; rows = (len(firsts) + cols - 1) // cols
        fig, axs = plt.subplots(rows, cols, figsize=(18, 2.6 * rows))
        for ax, f in zip(axs.flat, firsts):
            sr, x = wavfile.read(f); m = x.mean(1) if x.ndim == 2 else x
            fq, t, Sx = signal.spectrogram(m, sr, nperseg=2048, noverlap=1536)
            ax.pcolormesh(t, fq, 10 * np.log10(Sx + 1e-14), vmin=-130, vmax=-40, shading="auto", cmap="magma"); ax.set_yscale("symlog", linthresh=200); ax.set_ylim(30, 20000)
            ax.set_title(os.path.basename(f)[:-4], fontsize=9)
        for ax in list(axs.flat)[len(firsts):]: ax.axis("off")
        fig.tight_layout(); fig.savefig(os.path.join(ROOT, "status", "audio", "siege_sheet.png"), dpi=60)
    except ImportError:
        pass
    print(f"{len(out)} files, {bad} with problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
