"""Dev aid: render N variations of generator functions and draw their spectrograms + waveforms to a PNG,
so a sound can be *looked at* (partials, formants, decay, transient) as well as listened to.
  python look.py out.png module:func[:n] ...   (also writes out_<func>_<k>.wav next to the PNG)"""
import sys, importlib, numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.io import wavfile
from scipy import signal
from dsp import SR
out = sys.argv[1]
specs = sys.argv[2:]
rows = []
for sp in specs:
    parts = sp.split(":"); mod, fn = parts[0], parts[1]; n = int(parts[2]) if len(parts) > 2 else 3
    kw = eval("dict(" + parts[3] + ")") if len(parts) > 3 else {}
    f = getattr(importlib.import_module(mod), fn)
    for k in range(n):
        y = f(np.random.default_rng(1000 + k), **kw)
        y = np.asarray(y, float)
        if y.ndim == 2: y = y.mean(1)
        y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
        wavfile.write(out.replace(".png", f"_{fn}_{k}.wav"), SR, (y * 32767).astype(np.int16))
        rows.append((f"{fn}#{k}", y))
fig, ax = plt.subplots(len(rows), 2, figsize=(14, 2.1 * len(rows)), gridspec_kw={"width_ratios": [3, 1]}, squeeze=False)
for i, (name, y) in enumerate(rows):
    f, t, S = signal.spectrogram(y, SR, nperseg=1024, noverlap=896)
    ax[i, 0].pcolormesh(t, f, 10 * np.log10(S + 1e-12), vmin=-110, vmax=-30, shading="auto", cmap="magma")
    ax[i, 0].set_yscale("symlog", linthresh=500); ax[i, 0].set_ylim(40, 20000); ax[i, 0].set_ylabel(name, fontsize=8)
    ax[i, 1].plot(np.arange(len(y)) / SR, y, lw=0.4); ax[i, 1].set_ylim(-1, 1)
plt.tight_layout(); plt.savefig(out, dpi=70)
print("wrote", out, len(rows))
