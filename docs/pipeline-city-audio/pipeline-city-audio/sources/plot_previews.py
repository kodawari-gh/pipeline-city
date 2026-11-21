"""Waveform + spectrogram with cue markers for the preview reels -> reference/checks/<reel>_check.png"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, soundfile as sf
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from sfxlib import PKG, true_peak_db, ffmpeg_measure
for name in ("sfx_preview", "ui_preview"):
    ogg = os.path.join(PKG, "previews", name + ".ogg"); x, sr = sf.read(ogg, always_2d=True); x = x.T
    cues = json.load(open(os.path.join(PKG, "previews", name + "_cues.json"))); I, tp = ffmpeg_measure(ogg)
    fig, ax = plt.subplots(2, 1, figsize=(16, 7), sharex=True); t = np.arange(x.shape[1]) / sr
    ax[0].plot(t[::10], x[0, ::10], lw=0.3, color="#3be3ff"); ax[0].set_ylim(-1, 1); ax[0].set_title(f"{name}  I={I} LUFS  TP={tp} dBTP  clipped={int((np.abs(x) >= 0.999).sum())}")
    ax[1].specgram(x.mean(axis=0), NFFT=2048, Fs=sr, noverlap=1536, cmap="magma", vmin=-130); ax[1].set_ylim(0, 14000)
    for c in cues:
        if c["bus"] in ("sfx", "ui"):
            for a in ax: a.axvline(c["t"], color="lime", lw=0.5, alpha=0.6)
            ax[0].text(c["t"], 0.95, os.path.basename(c["file"]).split(".")[0].split(" ")[0][:16], fontsize=5, rotation=90, va="top", color="green")
    plt.tight_layout(); plt.savefig(os.path.join(PKG, "reference", "checks", name + "_check.png"), dpi=80); plt.close()
    print(name, x.shape[1] / sr, I, tp)
