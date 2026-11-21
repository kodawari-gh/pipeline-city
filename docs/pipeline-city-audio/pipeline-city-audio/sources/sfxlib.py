"""Shared synthesis + measurement for the Pipeline City SFX, UI and ambience (original synthesis, numpy/scipy only).
Used by gen_sfx.py, gen_ui.py, gen_ambience.py, gen_previews.py, check_all.py."""
import os, re, json, wave, subprocess
import numpy as np
from scipy import signal, ndimage

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
ASSETS = os.path.join(PKG, "assets")

# ---------------- music theory ----------------
F_PC = 5                                   # F
PAD_END = 480                              # samples of trailing silence on one-shots (10 ms)
LYDIAN = [0, 2, 4, 6, 7, 9, 11]
# Render roots for pitched cues: four roots a minor third apart. Each game key is at most 1 semitone from one of them,
# so the game plays the nearest file with playbackRate 2^(d/12), |d| <= 1 (IMPLEMENTATION.md §5).
ROOTS = {"F": 0, "Gs": 3, "B": -6, "D": -3}          # semitone offset from F used when rendering (keeps registers fixed)
KEY_NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]   # same tokens as the music lane (s = sharp, URL-safe)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def deg(root_midi, d):
    n = len(LYDIAN); return root_midi + 12 * (d // n) + LYDIAN[d % n]

# ---------------- voices (mono float arrays) ----------------
rng = np.random.default_rng(11)
def _t(dur): return np.arange(int(dur * SR)) / SR
def _endfade(x, ms=8):
    n = min(int(ms / 1000 * SR), x.shape[-1] // 2)
    if n > 1: x[..., -n:] *= np.cos(np.linspace(0, np.pi / 2, n)) ** 2
    return x

def faded(fn):
    """Every voice ends with an 8 ms fade: no step where its buffer stops."""
    def w(*a, **k): return _endfade(np.array(fn(*a, **k), dtype=float))
    w.__name__ = fn.__name__; w.__doc__ = fn.__doc__; return w

def cut(x, sec, ms=30):
    """Shorten a buffer with a fade (never a hard cut)."""
    return _endfade(np.array(x[..., : int(sec * SR)], dtype=float), ms)

def _att(x, ms):
    n = max(1, int(ms / 1000 * SR)); x[:n] *= np.linspace(0, 1, n) ** 1.5; return x

@faded
def cue_pluck(f, vel=1.0, dec=0.32, bright=1.0, dur=None):
    """Event pluck (cue-clarity rule): 1.5 ms attack, bright upper harmonics, decay <= 0.4 s, no echo on the hit."""
    dur = dur or min(1.4, dec * 4.5); t = _t(dur); x = np.zeros_like(t)
    for k in range(1, 16):
        if f * k > 15000: break
        x += (1.0 / k ** (1.15 - 0.25 * bright)) * np.sin(2 * np.pi * f * k * t + 0.4 * k) * np.exp(-t * (1 / dec + 3.2 * k / bright))
    tr = rng.standard_normal(int(0.004 * SR)) * np.exp(-np.arange(int(0.004 * SR)) / 60) * 0.08 * bright
    x[:tr.size] += tr
    return _att(x, 1.5) * vel * 0.6

@faded
def soft_pluck(f, vel=1.0, dec=0.5):
    t = _t(dec * 4); x = np.zeros_like(t)
    for k in range(1, 10):
        if f * k > 12000: break
        x += (1 / k ** 1.6) * np.sin(2 * np.pi * f * k * t) * np.exp(-t * (1 / dec + 6 * k))
    return _att(x, 4) * vel * 0.7

@faded
def glint(f, vel=1.0, dec=0.09):
    t = _t(dec * 6)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / dec) + 0.3 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / (dec / 2))
    return _att(x, 1.0) * vel

@faded
def bell(f, vel=1.0, dur=1.2, index=1.4, ratio=3.5, dec=0.45):
    t = _t(dur); ie = index * np.exp(-t / 0.25)
    x = np.sin(2 * np.pi * f * t + ie * np.sin(2 * np.pi * f * ratio * t)) * np.exp(-t / dec)
    return _att(x, 2) * vel

@faded
def bend_tone(f0, f1, dur, vel=1.0, dec=None, harmonics=4):
    """Sine-ish tone gliding f0 -> f1 (exponential), soft harmonics."""
    t = _t(dur); f = f0 * (f1 / f0) ** (t / dur); ph = 2 * np.pi * np.cumsum(f) / SR
    x = sum((1 / k ** 2) * np.sin(k * ph) for k in range(1, harmonics + 1))
    e = np.exp(-t / dec) if dec else np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.7
    return _att(x * e, 3) * vel

@faded
def thump(f=110, vel=1.0, dur=0.12, dec=0.035):
    t = _t(dur); f_t = f * (1 + 0.6 * np.exp(-t / 0.01))
    x = np.sin(2 * np.pi * np.cumsum(f_t) / SR) * np.exp(-t / dec)
    return _att(x, 0.8) * vel

@faded
def click(center=3000, vel=1.0, dur=0.025, q=1.2, dec=0.004):
    n = int(max(dur, dec * 9) * SR); x = rng.standard_normal(n)   # long enough to decay ~-78 dB: no cut-off
    lo, hi = center / (1 + 0.5 / q), min(center * (1 + 0.5 / q), 0.95 * SR / 2)
    b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], "band")
    x = signal.lfilter(b, a, x) * np.exp(-np.arange(n) / SR / dec)
    return _att(x / (np.max(np.abs(x)) + 1e-9), 0.3) * vel

@faded
def noise_sweep(f0, f1, dur, vel=1.0, shape="arch"):
    """Filtered-noise whoosh with the band moving f0 -> f1 (block-wise filter)."""
    n = int(dur * SR); x = rng.standard_normal(n); out = np.zeros(n); blk = 256; zi = np.zeros(2)
    for s in range(0, n, blk):
        fc = f0 * (f1 / f0) ** (s / n)
        b, a = signal.butter(1, min(0.95, fc / (SR / 2)))
        out[s:s + blk], zi[:1] = signal.lfilter(b, a, x[s:s + blk], zi=zi[:1])
    t = np.arange(n) / n
    e = np.sin(np.pi * t) ** 1.2 if shape == "arch" else (np.exp(-t * 5) if shape == "fall" else t ** 2 * (1 - t) * 6.75)
    return out / (np.max(np.abs(out)) + 1e-9) * e * vel

@faded
def pad_chord(midis, dur, vel=1.0, bright=0.4, attack=0.6, release=1.0):
    t = _t(dur); x = np.zeros_like(t); p = 2.6 - 1.4 * bright
    for m in midis:
        for dc in (-6, 0, 6):
            ff = hz(m) * 2 ** (dc / 1200); ph = rng.uniform(0, 6.28)
            for k in range(1, 6):
                x += (1 / k ** p) * np.sin(2 * np.pi * ff * k * t + ph * k)
    e = np.ones_like(t); na = int(attack * SR); nr = int(release * SR)
    e[:na] = np.linspace(0, 1, na) ** 1.5; e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return x * e * vel / (3 * len(midis))

def echo_tail(x, delay=60 / 66 * 0.75, gain_db=-12.0, repeats=1):
    """Echo only on the tail (cue-clarity rule): the first hit is dry; one repeat at -12 dB, low-passed."""
    d = int(delay * SR); out = np.zeros(x.size + d * repeats); out[:x.size] += x
    b, a = signal.butter(1, 3500 / (SR / 2)); y = signal.lfilter(b, a, x)
    for r in range(1, repeats + 1): out[r * d:r * d + x.size] += y * 10 ** (gain_db * r / 20)
    return out

def place(dst, x, t, gain=1.0):
    i = int(t * SR)
    if i + x.size > dst.size: x = _endfade(np.array(x[:dst.size - i], dtype=float), 15)
    dst[i:i + x.size] += x * gain
    return dst

def stereo(x, pan=0.0, width=0.0):
    """Equal-power pan; optional tiny Haas width (ms) for ambience-like spread."""
    L = np.cos((pan + 1) * np.pi / 4); R = np.sin((pan + 1) * np.pi / 4)
    l, r = x * L, x * R
    if width:
        d = int(width / 1000 * SR); r = np.concatenate([np.zeros(d), r])[:x.size]
    return np.stack([l, r])

def resample_rate(x, rate):
    """Emulate AudioBufferSourceNode.playbackRate (pitch and duration change together)."""
    n = x.shape[-1]; m = int(n / rate); src = np.arange(m) * rate
    return np.stack([np.interp(src, np.arange(n), c) for c in np.atleast_2d(x)])

# ---------------- reverb ----------------
def small_room(x, wet=0.12, seconds=0.6, seed=5):
    r = np.random.default_rng(seed); n = int(seconds * SR); t = np.arange(n) / SR
    ir = r.standard_normal((2, n)) * np.exp(-t / (seconds / 6.9))
    b, a = signal.butter(1, 4500 / (SR / 2)); ir = signal.lfilter(b, a, ir, axis=1); ir[:, :int(0.006 * SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
    x = np.atleast_2d(x); x = np.vstack([x, x]) if x.shape[0] == 1 else x
    y = np.stack([signal.fftconvolve(x[c], ir[c]) for c in range(2)])
    out = np.zeros((2, y.shape[1])); out[:, :x.shape[1]] += x; out += y * wet
    return out

# ---------------- loudness ----------------
_KB1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_KB2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
def kweight(x):
    return signal.lfilter(*_KB2, signal.lfilter(*_KB1, x, axis=-1), axis=-1)

def max_momentary(x, win=0.4):
    """Max BS.1770 momentary loudness (400 ms window, 10 ms hop), file zero-padded to >= 1 window. LUFS."""
    x = np.atleast_2d(x); w = int(win * SR)
    pad = np.zeros((x.shape[0], max(0, w - x.shape[1]) + w)); y = kweight(np.concatenate([x, pad], axis=1)) ** 2
    s = y.sum(axis=0); cs = np.concatenate([[0], np.cumsum(s)]); hop = int(0.01 * SR)
    ms = (cs[w::hop] - cs[:-w:hop][: len(cs[w::hop])]) / w
    return float(-0.691 + 10 * np.log10(max(ms.max(), 1e-12)))

def true_peak_db(x):
    up = signal.resample_poly(np.atleast_2d(x), 4, 1, axis=1)
    return float(20 * np.log10(max(np.max(np.abs(up)), 1e-12)))

def rms_db(x):
    return float(20 * np.log10(np.sqrt(np.mean(np.atleast_2d(x) ** 2)) + 1e-12))

# ---------------- file finishing ----------------
def finish(x, target_lufs, tp_ceiling=-1.2, fade_ms=12, tail_db=-60):
    """DC-block, trim lead/trail silence, fade the tail to zero, normalize to a max-momentary target, keep TP under ceiling.
    Returns (stereo array, info)."""
    x = np.atleast_2d(np.asarray(x, float)); x = np.vstack([x, x]) if x.shape[0] == 1 else x
    b, a = signal.butter(1, 15 / (SR / 2), "high"); x = signal.filtfilt(b, a, x, axis=1)
    env = np.max(np.abs(x), axis=0); pk = env.max(); thr = pk * 10 ** (tail_db / 20)
    idx = np.where(env > pk * 10 ** (-50 / 20))[0]; start = max(0, idx[0] - int(0.0005 * SR))
    last = np.where(env > thr)[0][-1]; end = min(x.shape[1], last + int(0.002 * SR))
    x = x[:, start:end].copy()
    nf = min(int(fade_ms / 1000 * SR), x.shape[1] // 3); x[:, -nf:] *= np.linspace(1, 0, nf) ** 2
    na = int(0.0008 * SR); x[:, :na] *= np.linspace(0, 1, na)
    w = np.hanning(x.shape[1] + 2)[1:-1]; x -= (x.mean(axis=1, keepdims=True) / w.mean()) * w[None]  # DC out, ends stay at 0
    g = 10 ** ((target_lufs - max_momentary(x)) / 20); x = x * g
    tp = true_peak_db(x); limited = False
    if tp > tp_ceiling:
        x *= 10 ** ((tp_ceiling - tp) / 20); limited = True
    x = np.concatenate([x, np.zeros((2, PAD_END))], axis=1)   # 10 ms of digital silence: any decoder end-trim (<=128 samples) only eats zeros
    return x, dict(target=target_lufs, max_m=round(max_momentary(x), 2), tp=round(true_peak_db(x), 2), tp_capped=limited)

def write_wav(path, x, bits=24):
    x = np.clip(np.atleast_2d(x), -1, 1)
    if bits == 24:
        i = (x.T * 8388607).astype("<i4").reshape(-1); b = i.view(np.uint8).reshape(-1, 4)[:, :3].tobytes(); sw = 3
    else:
        b = (x.T * 32767).astype("<i2").tobytes(); sw = 2
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[0]); w.setsampwidth(sw); w.setframerate(SR); w.writeframes(b)

def read_wav(path):
    with wave.open(path) as w:
        n, ch, sw = w.getnframes(), w.getnchannels(), w.getsampwidth(); raw = w.readframes(n)
    if sw == 3:
        a = np.frombuffer(raw, np.uint8).reshape(-1, 3); i = (a[:, 0].astype(np.int32) | (a[:, 1].astype(np.int32) << 8) | (a[:, 2].astype(np.int32) << 16))
        i = np.where(i >= 1 << 23, i - (1 << 24), i); x = i / 8388608.0
    else:
        x = np.frombuffer(raw, "<i2") / 32768.0
    return x.reshape(-1, ch).T

def encode_ogg(wav, ogg, q=6):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ar", "48000", "-c:a", "libvorbis", "-q:a", str(q), ogg], check=True)

def save(category, name, x, target, meta):
    """Write the 24-bit WAV master (sources/masters/...) and the shipped Ogg (assets/<category>/...). Returns a manifest row."""
    y, info = finish(x, target) if target is not None else (x, {})
    mdir = os.path.join(HERE, "masters", category); os.makedirs(mdir, exist_ok=True)
    odir = os.path.join(ASSETS, category); os.makedirs(odir, exist_ok=True)
    wav = os.path.join(mdir, name + ".wav"); ogg = os.path.join(odir, name + ".ogg")
    write_wav(wav, y); encode_ogg(wav, ogg)
    row = dict(file=f"assets/{category}/{name}.ogg", master=f"sources/masters/{category}/{name}.wav",
               repo_path=f"public/audio/{category}/{name}.ogg", seconds=round(y.shape[1] / SR, 3), **meta, **info)
    return row

def ffmpeg_measure(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    summ = r[r.rfind("Summary:"):]
    I = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summ).group(1)
    tp = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summ.split("True peak:")[1]).group(1)
    return float(I), float(tp)
def tp_limit(x, ceiling_db=-1.5, look=0.003, release=0.12):
    """Look-ahead true-peak limiter: 4x oversampled peak detection, gain = sliding minimum, smoothed release."""
    thr = 10 ** (ceiling_db / 20)
    up = signal.resample_poly(x, 4, 1, axis=1)
    pk = np.max(np.abs(up), axis=0).reshape(-1, 4).max(axis=1)[: x.shape[1]]
    g = np.minimum(1.0, thr / np.maximum(pk, 1e-9))
    w = int(look * SR) * 2 + 1
    g = ndimage.minimum_filter1d(g, w, mode="nearest")
    g = ndimage.uniform_filter1d(g, int(look * SR) + 1, mode="nearest")
    # slow release: running one-pole on the gain going back up
    a = np.exp(-1 / (release * SR))
    gr = signal.lfilter([1 - a], [1, -a], g - 1.0) + 1.0
    g = np.minimum(g, gr)
    g = ndimage.minimum_filter1d(g, w, mode="nearest")
    return x * g
