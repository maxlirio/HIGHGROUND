"""Measure rendered mixes (or any WAVs): clipping, true peak, BS.1770 loudness (integrated, max short-term 3 s,
per 10 s), loudness range (10th-95th percentile of short-term), octave-band balance relative to the loudest band,
and a spectrogram PNG next to each file (if matplotlib is present). Writes <file>.json beside each WAV."""
import json, sys, os
import numpy as np
from scipy.io import wavfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import SR, loudness, true_peak_db, _kweight, bp, secs


def short_term(x, win=3.0, hop=1.0):
    k = _kweight(x)
    b, h = secs(win), secs(hop)
    out = []
    for i in range(0, len(k) - b + 1, h):
        ms = np.sum(np.mean(k[i:i + b] ** 2, axis=0))
        out.append(-0.691 + 10 * np.log10(ms + 1e-20))
    return np.array(out)


def analyse(path):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64) / (32768.0 if x.dtype == np.int16 else 1.0)
    if x.ndim == 1: x = x[:, None]
    clip = int(np.sum(np.abs(x) >= 32767 / 32768))
    st = short_term(x)
    seg = [round(loudness(x[i:i + secs(10)]), 1) for i in range(0, len(x) - secs(5), secs(10))]
    mono = x.mean(1)
    bands = {}
    for fc in [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]:
        y = bp(mono, fc / 1.414, min(fc * 1.414, SR * 0.49), 2)
        bands[fc] = 10 * np.log10(np.mean(y ** 2) + 1e-20)
    top = max(bands.values())
    r = {
        "file": os.path.basename(path), "seconds": round(len(x) / sr, 1), "clipped_samples": clip,
        "sample_peak_dbfs": round(20 * np.log10(np.max(np.abs(x)) + 1e-20), 2), "true_peak_dbtp": round(true_peak_db(x), 2),
        "integrated_lufs": round(loudness(x), 1), "short_term_max_lufs": round(float(st.max()), 1),
        "loudness_range_lu": round(float(np.percentile(st[st > -70], 95) - np.percentile(st[st > -70], 10)), 1),
        "per_10s_lufs": seg, "octave_bands_db_rel": {k: round(v - top, 1) for k, v in bands.items()},
        "stereo_correlation": round(float(np.corrcoef(x[:, 0], x[:, 1])[0, 1]), 2) if x.shape[1] == 2 else 1.0,
    }
    json.dump(r, open(path.replace(".wav", ".json"), "w"), indent=1)
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        from scipy import signal
        f, t, S = signal.spectrogram(mono, sr, nperseg=2048, noverlap=1024)
        fig, ax = plt.subplots(2, 1, figsize=(14, 6), gridspec_kw={"height_ratios": [3, 1]})
        ax[0].pcolormesh(t, f, 10 * np.log10(S + 1e-14), vmin=-120, vmax=-40, shading="auto", cmap="magma"); ax[0].set_yscale("symlog", linthresh=300); ax[0].set_ylim(30, 20000)
        ax[0].set_title(r["file"]); ax[1].plot(np.arange(len(st)) + 1.5, st); ax[1].set_ylabel("short-term LUFS"); ax[1].set_xlim(0, len(x) / sr); ax[1].grid(alpha=.3)
        plt.tight_layout(); plt.savefig(path.replace(".wav", ".png"), dpi=70); plt.close(fig)
    except ImportError:
        pass
    return r


if __name__ == "__main__":
    bad = False
    for p in sys.argv[1:]:
        r = analyse(p)
        print(f"{r['file']}: {r['seconds']} s | clipped {r['clipped_samples']} | peak {r['sample_peak_dbfs']} dBFS, true peak {r['true_peak_dbtp']} dBTP | "
              f"integrated {r['integrated_lufs']} LUFS, short-term max {r['short_term_max_lufs']}, LRA {r['loudness_range_lu']} LU")
        print("   per 10 s:", r["per_10s_lufs"], "| bands (dB re loudest):", r["octave_bands_db_rel"], "| L/R corr", r["stereo_correlation"])
        if r["clipped_samples"] or r["true_peak_dbtp"] > 0.0: bad = True
    sys.exit(1 if bad else 0)
