"""Measured checks for every shipped Ogg (we cannot listen): decoded length vs master, true peak (ffmpeg ebur128 and our
4x oversampled peak), max momentary / short-term loudness, RMS, clipping, DC, lead silence, clean tail, loop seams.
Writes reference/checks/checks.json and contact sheets reference/checks/sheet_<category>_<n>.png.
Run: /workspace/audio/.venv/bin/python check_all.py [previews]"""
import os, sys, json, glob, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from sfxlib import *
from scipy import ndimage, signal

# Cues whose quiet tail holds a designed onset (the -12 dB echo repeat of payout, the 2nd click of notify, the sweep after
# the value click): the tail-click detector sees them, they are intended. Verified on the contact sheets.
DESIGNED_LATE_ONSETS = ["/payout__", "/payout_late__", "/new_clients__", "/job_fulfilled__", "/ui_notify", "/ui_value_change", "/level_up__", "music_reactive_preview"]   # the music preview ends on quiet designed note onsets
OUT = os.path.join(PKG, "reference", "checks"); os.makedirs(OUT, exist_ok=True)

def decode(ogg):
    """Reference decode with libsndfile (sample-exact Ogg granule handling). ffmpeg's decoder is checked separately."""
    import soundfile as sf
    x, sr = sf.read(ogg, always_2d=True); assert sr == SR, sr
    return x.T.astype(float)

def decode_ffmpeg(ogg):
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", ogg, "-f", "f32le", "-ac", "2", "-ar", "48000", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, "<f4").reshape(-1, 2).T.astype(float)

def short_term_max(x): return max_momentary(x, 3.0)

def check(ogg, master=None, loop=False):
    x = decode(ogg); n = x.shape[1]; env = np.max(np.abs(x), axis=0); pk = env.max()
    r = dict(file=os.path.relpath(ogg, PKG), seconds=round(n / SR, 3))
    try: I, tp_ff = ffmpeg_measure(ogg)
    except Exception: I, tp_ff = None, None
    r.update(tp_ffmpeg=tp_ff, tp_ours=round(true_peak_db(x), 2), max_momentary=round(max_momentary(x), 2),
             max_short_term=round(short_term_max(x), 2), rms_db=round(rms_db(x), 2), integrated=I,
             clipped=int(np.sum(np.abs(x) >= 0.999)), dc=float(f"{np.abs(x.mean(axis=1)).max():.1e}"))
    r["lead_ms"] = round(np.argmax(env > pk * 10 ** (-40 / 20)) / SR * 1000, 2)
    nz = np.where(env > 0)[0]; last = nz[-1] + 1 if nz.size else n
    r["trailing_zero_ms"] = round((n - last) / SR * 1000, 2)
    tail = x[:, max(0, last - int(0.005 * SR)):last]
    r["tail_last5ms_db_rel_peak"] = round(20 * np.log10(np.sqrt(np.mean(tail ** 2)) / pk + 1e-12), 1)
    r["tail_last_sample"] = float(f"{np.abs(x[:, -1]).max():.1e}")
    # click in the quiet tail: 2 ms frames of >10 kHz energy where the 10 ms envelope is 30 dB under the peak
    b, a = signal.butter(4, 10000 / (SR / 2), "high"); hf = signal.lfilter(b, a, x.mean(axis=0)) ** 2
    fr = int(0.002 * SR); k = hf.size // fr; hfe = 10 * np.log10(hf[:k * fr].reshape(k, fr).mean(axis=1) + 1e-20)
    e10 = ndimage.uniform_filter1d(x.mean(axis=0) ** 2, int(0.01 * SR))[:k * fr].reshape(k, fr).mean(axis=1)
    quiet = 10 * np.log10(e10 + 1e-20) < 20 * np.log10(pk) - 30
    quiet[: int(0.03 / 0.002)] = False
    if "previews" in ogg: quiet[: max(0, k - int(0.6 / 0.002))] = False   # reels: only the final 0.6 s (the fade after the last cue) is a tail
    r["tail_click_db"] = round(float((hfe[quiet] - np.median(hfe[quiet])).max()), 1) if quiet.sum() > 10 else 0.0
    r["tail_click_level_db"] = round(float(hfe[quiet].max()), 1) if quiet.sum() > 10 else -200.0   # audible only if > -80 dB
    if master:
        m = read_wav(master); r["master_samples"] = m.shape[1]; r["decoded_samples"] = n; r["length_diff"] = n - m.shape[1]
        r["ffmpeg_decoder_length_diff"] = decode_ffmpeg(ogg).shape[1] - m.shape[1]
    if loop:
        d = np.abs(np.diff(x, axis=1)); seam = np.abs(x[:, 0] - x[:, -1]).max()
        r["seam_jump"] = float(f"{seam:.2e}"); r["median_step"] = float(f"{np.median(d):.2e}"); r["p999_step"] = float(f"{np.percentile(d, 99.9):.2e}")
        w = int(0.05 * SR); rr = lambda a, b: 20 * np.log10(np.sqrt(np.mean(a ** 2)) / np.sqrt(np.mean(b ** 2)))
        r["seam_rms_ratio_db"] = round(rr(x[:, -w:], x[:, :w]), 2)
        cuts = np.random.default_rng(1).integers(w, n - w, 300); ref = np.abs([rr(x[:, c - w:c], x[:, c:c + w]) for c in cuts])
        r["seam_rms_ratio_pct_of_inner_cuts"] = round(float((ref < abs(r["seam_rms_ratio_db"])).mean() * 100), 1)
        r["loop_ok"] = bool(seam <= np.percentile(d, 99.9) * 1.5 and r["seam_rms_ratio_pct_of_inner_cuts"] < 95 and r.get("length_diff", 0) == 0)
        if m is not None:
            mm = m if master else x; r["master_seam_jump"] = float(f"{np.abs(mm[:, 0] - mm[:, -1]).max():.2e}")
    tp = r["tp_ffmpeg"] if r["tp_ffmpeg"] is not None else r["tp_ours"]
    issues = []
    if max(tp, r["tp_ours"]) > -1.0: issues.append("true peak > -1 dBTP")
    if r["clipped"]: issues.append("clipping")
    if r["dc"] > 5e-4: issues.append("DC (> -66 dBFS)")
    if not loop and "previews" not in ogg and r["trailing_zero_ms"] > 15: issues.append("trailing silence")
    if r["lead_ms"] > 5 and not loop: issues.append("lead silence")
    if not loop and r["tail_last5ms_db_rel_peak"] > -45: issues.append("tail not clean")
    if master and r["length_diff"] != 0 and loop: issues.append("loop length changed by encoder")
    designed = any(k in r["file"] for k in DESIGNED_LATE_ONSETS)
    if not loop and r["tail_click_db"] > 25 and r["tail_click_level_db"] > -80:
        (r.setdefault("notes", []).append("late quiet onset is designed (echo repeat / second click)") if designed else issues.append("click in tail"))
    if loop and not r["loop_ok"]: issues.append("loop seam")
    r["issues"] = issues
    return r, x

def sheet(items, path, cols=4):
    rows = (len(items) + cols - 1) // cols
    fig, axs = plt.subplots(rows * 2, cols, figsize=(cols * 4, rows * 3.2), squeeze=False)
    for i, (name, x, r) in enumerate(items):
        a1, a2 = axs[(i // cols) * 2][i % cols], axs[(i // cols) * 2 + 1][i % cols]
        t = np.arange(x.shape[1]) / SR
        a1.plot(t, x[0], lw=0.4, color="#3be3ff"); a1.set_ylim(-1, 1); a1.axhline(0.891, color="r", lw=0.4); a1.axhline(-0.891, color="r", lw=0.4)
        a1.set_title(f"{name}\n{r['seconds']}s M{r['max_momentary']} TP{r['tp_ours']}", fontsize=7); a1.tick_params(labelsize=5)
        mono = x.mean(axis=0); nfft = 512 if x.shape[1] < 8000 else 1024
        mono = np.pad(mono, (0, max(0, nfft * 2 - mono.size)))
        a2.specgram(mono, NFFT=nfft, Fs=SR, noverlap=nfft * 3 // 4, cmap="magma", vmin=-140); a2.set_ylim(0, 16000); a2.tick_params(labelsize=5)
    for j in range(len(items), rows * cols):
        axs[(j // cols) * 2][j % cols].axis("off"); axs[(j // cols) * 2 + 1][j % cols].axis("off")
    plt.tight_layout(); plt.savefig(path, dpi=80); plt.close()

if __name__ == "__main__":
    results = []; per = {}
    cats = ["sfx", "ui", "ambience"] + (["../previews"] if "previews" in sys.argv else [])
    for cat in cats:
        for ogg in sorted(glob.glob(os.path.join(ASSETS, cat, "*.ogg"))):
            name = os.path.basename(ogg)[:-4]
            master = os.path.join(HERE, "masters", cat, name + ".wav") if cat != "../previews" else None
            if master and not os.path.exists(master): master = None
            r, x = check(ogg, master, loop=name.endswith("_loop"))
            results.append(r); per.setdefault(cat.replace("../", ""), []).append((name, x, r))
    for cat, items in per.items():
        for k in range(0, len(items), 24):
            sheet(items[k:k + 24], os.path.join(OUT, f"sheet_{cat}_{k // 24 + 1:02d}.png"))
    json.dump(results, open(os.path.join(OUT, "checks.json"), "w"), indent=1)
    bad = [r for r in results if r["issues"]]
    print(len(results), "files checked;", len(bad), "with issues")
    for r in bad: print(r["file"], r["issues"])
    for r in results:
        if r["file"].endswith("_loop.ogg") or "preview" in r["file"]: print(r)
