"""Measure every music file (we cannot listen): LUFS / true peak (ffmpeg ebur128) on the WAV master and the shipped Ogg,
clipping, DC, leading silence, decoded length, loop-seam continuity (stems), and render waveform+spectrogram contact sheets.
Writes ../checks.json and sources/checks/*.png."""
import sys, os, json, glob
import numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mlib import *
HERE = os.path.dirname(os.path.abspath(__file__)); MUSIC = os.path.dirname(HERE)

def hf_windows(z, w=256):
    z = circ_highpass(z, 5000, order=4).mean(axis=0); n = z.size // w
    return np.sqrt((z[: n * w].reshape(n, w) ** 2).mean(axis=1)), z

def seam(x, ref=None):
    """Loop seam as it plays (the loop tiled twice, seam at sample P).
    - seam_delta: |x[0] - x[-1]| vs the 99.9th percentile of in-file sample steps (step_p999). Gated for both.
    - Ogg only (ref = the WAV master): click test on the CODING ERROR of the tiled loop (decoded - master).
      RMS above 5 kHz of that error in a 256-sample window on the seam vs its 99th percentile over the loop.
      A seam click would show up as extra error right at the seam. Pass if it is no higher (+3 dB, the spread of coding error between onsets) than the larger of
      the loop's 99th percentile and the same window on the loop's other bar lines (onsets there code the same way).
      seam_ogg = after the runtime stitch (stitch_loop / stitchLoop); seam_ogg_raw = without it (reported only).
    - seam_pred_err: 2nd-order prediction error at the seam (reported only)."""
    P = x.shape[1]; w = 256
    d = np.abs(np.diff(x, axis=1)); jump = np.abs(x[:, 0] - x[:, -1]).max()
    pj = np.abs(x[:, 0] - 2 * x[:, -1] + x[:, -2]).max()
    r = dict(seam_delta=float(f"{jump:.2e}"), step_p999=float(f"{np.percentile(d, 99.9):.2e}"), seam_pred_err=float(f"{pj:.2e}"))
    ok = jump <= np.percentile(d, 99.9)
    if ref is not None:
        e = np.concatenate([x - ref, x - ref], axis=1)
        _, z = hf_windows(e, w); rms, _ = hf_windows(e, w)
        win = lambda i0: np.sqrt((z[i0:i0 + w] ** 2).mean())
        s = win(P - w // 2); p99 = np.percentile(rms, 99)
        bars = round(P / (4 * BEAT_S))                      # the seam is a bar line; compare with the other bar lines
        other = max(win(int(round(k * P / bars)) - w // 2) for k in range(1, bars))
        ref_db = 20 * np.log10(max(p99, other) + 1e-12)
        r.update(seam_err_hf_db=round(float(20 * np.log10(s + 1e-12)), 1), err_hf_p99_db=round(float(20 * np.log10(p99 + 1e-12)), 1),
                 err_hf_other_barlines_db=round(float(20 * np.log10(other + 1e-12)), 1))
        ok = ok and 20 * np.log10(s + 1e-12) <= ref_db + 3.0   # +3 dB = spread of Vorbis coding error between onsets
    r["seam_ok"] = bool(ok)
    return r

def one(wav):
    name = os.path.basename(wav)[:-4]; sub = os.path.basename(os.path.dirname(wav))
    ogg = os.path.join(MUSIC, sub, name + ".ogg")
    x = read_wav(wav); y = decode_loop(ogg) if sub == "stems" else decode(ogg)
    ys = stitch_loop(decode(ogg), P=x.shape[1]) if sub == "stems" else None
    I, tp, lra = measure(wav)
    if sub == "stems":   # measure the loop body only (what plays), not the 2 x 100 ms wrap padding
        Io, tpo, _ = measure_array(y)
    else:
        Io, tpo, _ = measure(ogg)
    loud = np.where(np.max(np.abs(x), axis=0) > 10 ** (-60 / 20))[0]
    r = dict(file=f"{sub}/{name}.ogg", seconds=round(x.shape[1] / SR, 4), samples=int(x.shape[1]), ogg_loop_samples=int(y.shape[1]),
             lufs=I, tp_dbtp=tp, lra=lra, ogg_lufs=Io, ogg_tp_dbtp=tpo, clipped=int(np.sum(np.abs(x) >= 1 - 2 ** -22)),
             dc=float(f"{np.abs(x.mean(axis=1)).max():.1e}"), lead_ms=round(loud[0] / SR * 1000, 2), bytes=os.path.getsize(ogg))
    if sub == "stems":
        r["bars"] = 8 if "menu" in name else 4
        r["seam_wav"] = seam(x); r["seam_ogg_raw"] = seam(y, ref=x); r["seam_ogg"] = seam(ys, ref=x)
    return r, x

def sheet(rows_x, title, path, cols=4):
    n = len(rows_x); rows = int(np.ceil(n / cols))
    fig, ax = plt.subplots(rows * 2, cols, figsize=(4.2 * cols, 2.6 * rows * 2 / 1.3), squeeze=False)
    for i, (r, x) in enumerate(rows_x):
        a0, a1 = ax[(i // cols) * 2, i % cols], ax[(i // cols) * 2 + 1, i % cols]
        t = np.arange(x.shape[1]) / SR; s = max(1, x.shape[1] // 4000)
        a0.plot(t[::s], x[0, ::s], lw=0.3, color="#3be3ff"); a0.plot(t[::s], x[1, ::s], lw=0.3, color="#a68bff", alpha=0.6)
        a0.set_ylim(-1, 1); a0.axhline(10 ** (-1 / 20), color="r", lw=0.4); a0.axhline(-10 ** (-1 / 20), color="r", lw=0.4)
        a0.set_title(f"{os.path.basename(r['file'])[6:-4]}  {r['ogg_lufs']} LUFS  {r['ogg_tp_dbtp']} dBTP", fontsize=7); a0.tick_params(labelsize=5)
        a1.specgram(x.mean(axis=0), NFFT=2048, Fs=SR, noverlap=1024, cmap="magma", vmin=-140); a1.set_ylim(0, 12000); a1.tick_params(labelsize=5)
    for j in range(n, rows * cols):
        ax[(j // cols) * 2, j % cols].axis("off"); ax[(j // cols) * 2 + 1, j % cols].axis("off")
    fig.suptitle(title, fontsize=10); plt.tight_layout(); plt.savefig(path, dpi=80); plt.close()

if __name__ == "__main__":
    wavs = sorted(glob.glob(os.path.join(HERE, "masters", "*", "*.wav")))
    with ProcessPoolExecutor(6) as ex: res = list(ex.map(one, wavs))
    by = {}
    for r, x in res: by.setdefault(r["file"], (r, x))
    os.makedirs(os.path.join(HERE, "checks"), exist_ok=True)
    groups = {}
    for f, (r, x) in by.items():
        b = os.path.basename(f)
        g = ("stems_" + b.split("_")[1]) if f.startswith("stems") else ("notes_" + b.split("_")[2] if "_note_" in b else ("notes_" + b.split("_")[1]) if f.startswith("notes") else "preview")
        groups.setdefault(g, []).append((r, x[:, ::1] if x.shape[1] < 30 * SR else x))
    for g, lst in groups.items():
        if g == "preview": continue
        sheet(lst, f"pipeline-city music: {g} (waveform L/R + spectrogram, 0-12 kHz)", os.path.join(HERE, "checks", f"{g}.png"), cols=4 if len(lst) <= 16 else 7)
    # preview: full-size plot with cue markers
    r, x = by["previews/music_reactive_preview.ogg"]; cues = json.load(open(os.path.join(MUSIC, "previews", "music_reactive_preview_cues.json")))
    fig, ax = plt.subplots(2, 1, figsize=(16, 7), sharex=True); t = np.arange(x.shape[1]) / SR
    ax[0].plot(t[::20], x[0, ::20], lw=0.3, color="#3be3ff"); ax[0].plot(t[::20], x[1, ::20], lw=0.3, color="#a68bff", alpha=0.6); ax[0].set_ylim(-1, 1)
    ax[0].set_title(f"music_reactive_preview  I={r['ogg_lufs']} LUFS  TP={r['ogg_tp_dbtp']} dBTP")
    ax[1].specgram(x.mean(axis=0), NFFT=2048, Fs=SR, noverlap=1536, cmap="magma", vmin=-140); ax[1].set_ylim(0, 12000)
    for c in cues:
        for a in ax: a.axvline(c["t"], color="lime", lw=0.6, alpha=0.7)
        ax[0].text(c["t"], 0.95, c["code"][:26], fontsize=6, color="green", rotation=90, va="top")
    plt.tight_layout(); plt.savefig(os.path.join(HERE, "checks", "preview.png"), dpi=90); plt.close()
    # reaction evidence in the preview: spectral centroid + short-term level per section
    m = x.mean(axis=0)
    def sect(a, b):
        s = m[int(a * SR):int(b * SR)]; S = np.abs(np.fft.rfft(s)) ; f = np.fft.rfftfreq(s.size, 1 / SR)
        return dict(t=[a, b], centroid_hz=round(float((S * f).sum() / S.sum())), rms_dbfs=round(float(20 * np.log10(np.sqrt((s ** 2).mean()))), 1))
    react = {"running_F_before_stress": sect(7.5, 10.9), "stress": sect(12.0, 15.6), "paused_C_hold": sect(19.6, 27.8), "resumed_C": sect(29.5, 35.5)}
    rows = [by[k][0] for k in sorted(by)]
    stems = [r for r in rows if r["file"].startswith("stems")]
    summary = dict(files=len(rows), all_tp_le_minus1=all(r["ogg_tp_dbtp"] <= -1.0 and r["tp_dbtp"] <= -1.0 for r in rows),
                   any_clipped=any(r["clipped"] for r in rows), max_dc=max(r["dc"] for r in rows),
                   max_stem_lead_ms=max(r["lead_ms"] for r in stems), max_note_lead_ms=max(r["lead_ms"] for r in rows if r["file"].startswith("notes")),
                   all_seams_ok_wav=all(r["seam_wav"]["seam_ok"] for r in stems), all_seams_ok_ogg=all(r["seam_ogg"]["seam_ok"] for r in stems),
                   max_seam_delta_wav=max(r["seam_wav"]["seam_delta"] for r in stems), max_seam_delta_ogg=max(r["seam_ogg"]["seam_delta"] for r in stems),
                   ogg_length_matches=all(r["samples"] == r["ogg_loop_samples"] for r in stems),
                   ogg_total_mb=round(sum(r["bytes"] for r in rows) / 1e6, 2), stems_mb=round(sum(r["bytes"] for r in stems) / 1e6, 2),
                   mix=json.load(open(os.path.join(HERE, "mixcalc.json"))), preview_reaction=react)
    json.dump(dict(summary=summary, files=rows), open(os.path.join(MUSIC, "checks.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in summary.items() if k != "mix"}, indent=1))
    bad = [r["file"] for r in stems if not (r["seam_wav"]["seam_ok"] and r["seam_ogg"]["seam_ok"])]
    print("seam fails:", bad)
