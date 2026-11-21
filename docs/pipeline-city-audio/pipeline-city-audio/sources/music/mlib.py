"""Afterglow music building blocks: shared, original synthesis (numpy/scipy only).

Every loop is rendered as ONE PERIOD of a periodic signal, so the seam is sample-accurate:
- sustained oscillators are snapped to an integer number of cycles per loop (<= 1.5 cents error),
- every envelope / LFO is periodic in the loop length,
- note tails, echoes and reverb are rendered linearly and then folded back modulo the loop length
  (= steady-state of a looping signal through an LTI chain),
- filtering is done in the frequency domain on the period (circular, zero-phase).
"""
import re, subprocess, wave, json
import numpy as np
from scipy import signal, ndimage

SR = 48000
BPM = 66
BEAT = 60 / BPM                      # 0.909090.. s
BAR_BEATS = 4
LOOP_BARS = 4
LOOP_SAMPLES = round(LOOP_BARS * BAR_BEATS * BEAT * SR)   # 698182 (exact 4 bars = 698181.8)
LOOP_PAD = 4800                      # Ogg stems carry 100 ms of wrap-around audio before and after the loop (see encode_loop_ogg)
BEAT_S = LOOP_SAMPLES / (LOOP_BARS * BAR_BEATS)           # grid in samples (fractional, exact w.r.t. the file)
LYD = [0, 2, 4, 6, 7, 9, 11]
KEYS = ["F", "C", "G", "D", "A", "E", "B", "Fs", "Cs", "Gs", "Ds", "As"]   # level order (level 1..12)
PC = {"C": 0, "Cs": 1, "D": 2, "Ds": 3, "E": 4, "F": 5, "Fs": 6, "G": 7, "Gs": 8, "A": 9, "As": 10, "B": 11}
NOTE_NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]

def key_for_level(level):
    return KEYS[(level - 1) % 12]

def bed_root(key):
    """Bed root MIDI in E2..D#3 (40..51)."""
    return 40 + ((PC[key] - 4) % 12)

def note_name(m):
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"

def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)

def qf(f, P):
    """Snap f to an integer number of cycles in P samples."""
    L = P / SR
    return max(1, round(f * L)) / L

def scale_notes(key, lo, hi):
    pcs = {(PC[key] + s) % 12 for s in LYD}
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]

def deg(key, d, lo, hi, anchor=60):
    """Scale degree d (0 = root, 7 = root an octave up) from the root octave near anchor, folded into lo..hi."""
    r = anchor + ((PC[key] - anchor) % 12)
    if r - anchor > 6: r -= 12
    m = r + 12 * (d // 7) + LYD[d % 7]
    while m < lo: m += 12
    while m > hi: m -= 12
    return m

def pan2(x, pan):
    L = np.cos((pan + 1) * np.pi / 4); R = np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * L, x * R])

# ---------- periodic helpers ----------
def periodic_env(P, segments, xfade):
    """segments: list of (start_frac, end_frac) of the loop where the env is 1 (circular). Smooth edges of xfade samples."""
    e = np.zeros(P)
    for a, b in segments:
        ia, ib = int(round(a * P)), int(round(b * P))
        if ia <= ib: e[ia:ib] = 1
        else: e[ia:] = 1; e[:ib] = 1
    w = max(3, int(xfade))
    e = ndimage.uniform_filter1d(e, w, mode="wrap")
    e = ndimage.uniform_filter1d(e, w, mode="wrap")
    return np.sqrt(np.clip(e, 0, 1))   # equal-power-ish

def lfo(P, cycles, phase=0.0):
    t = np.arange(P) / P
    return np.sin(2 * np.pi * (cycles * t + phase))

def fold(x, P):
    """x: (2, n) linear render with tails -> (2, P) steady-state period."""
    out = np.zeros((x.shape[0], P))
    for s in range(0, x.shape[1], P):
        seg = x[:, s:s + P]; out[:, :seg.shape[1]] += seg
    return out

def circ_lowpass(x, fc, order=2):
    """Zero-phase Butterworth magnitude applied on the period's spectrum (circular)."""
    X = np.fft.rfft(x, axis=-1); f = np.fft.rfftfreq(x.shape[-1], 1 / SR)
    H = 1 / np.sqrt(1 + (f / fc) ** (2 * order))
    return np.fft.irfft(X * H, n=x.shape[-1], axis=-1)

def circ_highpass(x, fc, order=2):
    X = np.fft.rfft(x, axis=-1); f = np.fft.rfftfreq(x.shape[-1], 1 / SR)
    H = 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-6)) ** (2 * order))
    return np.fft.irfft(X * H, n=x.shape[-1], axis=-1)

def reverb_ir(seconds=4.0, damp=5000, seed=3):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR); t = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-t / (seconds / 6.9))
    b, a = signal.butter(1, damp / (SR / 2))
    ir = signal.lfilter(b, a, ir, axis=1)
    ir[:, : int(0.012 * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))

def circ_reverb(x, ir, wet):
    """Steady-state reverb of a periodic signal: linear conv then fold."""
    P = x.shape[1]
    y = np.stack([signal.fftconvolve(x[c], ir[c]) for c in range(2)])
    return fold(y, P) * wet

def echo_buf(x, delay_s, n=3, g=0.33):
    d = int(round(delay_s * SR)); out = np.zeros(x.size + d * n)
    for k in range(n + 1): out[k * d:k * d + x.size] += x * g ** k
    return out

# ---------- voices ----------
def pad_partials(f, P, env, bright=0.5, detune_c=7, seed=0, nparts=7, maxf=9000):
    """Warm detuned pad tone, periodic in P. env: periodic amplitude (P,)."""
    rng = np.random.default_rng(seed)
    t = np.arange(P) / SR
    out = np.zeros(P); p = 2.6 - 1.4 * bright
    for dc in (-detune_c, 0, detune_c):
        ff = f * 2 ** (dc / 1200); ph = rng.uniform(0, 2 * np.pi)
        for k in range(1, nparts + 1):
            if ff * k > maxf: break
            out += (1 / k ** p) * np.sin(2 * np.pi * qf(ff * k, P) * t + ph * k)
    return out / 3 * env

def pluck(f, vel, dur=1.4, bright=1.0, attack=0.002, decay_k=2.2):
    """Additive saw pluck: upper harmonics die first."""
    n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for k in range(1, 16):
        if f * k > 14000: break
        out += (1 / k) * np.sin(2 * np.pi * f * k * t + 0.3 * k) * np.exp(-t * (decay_k + 2.8 * k / bright))
    na = max(1, int(attack * SR)); out[:na] *= np.linspace(0, 1, na)
    nr = int(0.01 * SR); out[-nr:] *= np.linspace(1, 0, nr)
    return out * vel * 0.8

def cue_pluck(f, vel=1.0, dur=1.2):
    """Brighter, shorter event pluck (audio-style §0.5): 1.5 ms attack, +4 dB upper harmonics, decay <= 0.4 s."""
    n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for k in range(1, 18):
        if f * k > 15000: break
        amp = (1 / k) * (1.6 if k >= 3 else 1.0)
        out += amp * np.sin(2 * np.pi * f * k * t + 0.2 * k) * np.exp(-t * (3.0 + 3.6 * k))
    out += 0.25 * np.sin(2 * np.pi * f * t) * np.exp(-t / 0.35)   # body
    na = int(0.0015 * SR); out[:na] *= np.linspace(0, 1, na)
    nr = int(0.02 * SR); out[-nr:] *= np.linspace(1, 0, nr)
    return out * vel

def glint(f, vel=1.0, dur=0.6):
    n = int(dur * SR); t = np.arange(n) / SR
    out = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.05)) * np.exp(-t / 0.11)
    na = int(0.0015 * SR); out[:na] *= np.linspace(0, 1, na)
    nr = int(0.02 * SR); out[-nr:] *= np.linspace(1, 0, nr)
    return out * vel

def low_tone(f, vel=1.0, dur=1.8):
    """Soft low 'thud tone' for failure / lost-client cues (C2-C3)."""
    n = int(dur * SR); t = np.arange(n) / SR
    out = (np.sin(2 * np.pi * f * t) + 0.45 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.4)
           + 0.2 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.2)) * np.exp(-t / 0.55)
    na = int(0.006 * SR); out[:na] *= np.linspace(0, 1, na)
    nr = int(0.03 * SR); out[-nr:] *= np.linspace(1, 0, nr)
    return out * vel

def bass_note(f, vel, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    out = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t) + 0.18 * np.sin(2 * np.pi * 3 * f * t)) * np.exp(-t / (dur * 0.45))
    na = int(0.04 * SR); out[:na] *= np.linspace(0, 1, na) ** 2
    nr = int(0.05 * SR); out[-nr:] *= np.linspace(1, 0, nr)
    return out * vel

def blip(f, vel, dur=0.3):
    n = int(dur * SR); t = np.arange(n) / SR
    out = (np.sin(2 * np.pi * f * t) + 0.15 * np.sin(2 * np.pi * 3 * f * t)) * np.exp(-t / 0.045)
    na = int(0.002 * SR); out[:na] *= np.linspace(0, 1, na)
    return out * vel

# ---------- IO / measurement ----------
def write_wav24(path, x):
    y = np.clip(x, -1, 1 - 2 ** -23)
    i = np.round(y.T * (2 ** 23)).astype("<i4").reshape(-1)
    b = i.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[0]); w.setsampwidth(3); w.setframerate(SR); w.writeframes(b)

def read_wav(path):
    with wave.open(path) as w:
        ch, sw, n = w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = np.frombuffer(w.readframes(n), np.uint8)
    if sw == 3:
        a = raw.reshape(-1, 3); i = (a[:, 0].astype(np.int32) | (a[:, 1].astype(np.int32) << 8) | (a[:, 2].astype(np.int32) << 16))
        i = np.where(i >= 2 ** 23, i - 2 ** 24, i); x = i / 2 ** 23
    else:
        x = raw.view("<i2") / 32768.0
    return x.reshape(-1, ch).T

def decode(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, "<f4").reshape(-1, 2).T.astype(np.float64)

def measure(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    summ = r[r.rfind("Summary:"):]
    I = float(re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summ).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summ.split("True peak:")[1]).group(1))
    lra = float(re.search(r"LRA:\s+(-?[\d.]+) LU", summ).group(1))
    return I, tp, lra

def measure_array(x, tmp=None):
    import os; tmp = tmp or f"/tmp/_m_{os.getpid()}.wav"
    write_wav24(tmp, x); return measure(tmp)

def true_peak_db(x):
    up = signal.resample_poly(x, 4, 1, axis=1)
    return 20 * np.log10(np.max(np.abs(up)) + 1e-12)

def normalize(x, target_lufs, tp_ceiling=-1.2):
    """Gain-only normalization (keeps loops periodic). If the true peak would pass the ceiling, stop at the ceiling."""
    x = x - x.mean(axis=1, keepdims=True)
    pre = 0.5 / (np.max(np.abs(x)) + 1e-12)          # avoid clipping the temp file used for measuring
    I, _, _ = measure_array(x * pre)
    g = pre * 10 ** ((target_lufs - I) / 20)
    y = x * g
    tp = true_peak_db(y)
    if tp > tp_ceiling:
        y *= 10 ** ((tp_ceiling - tp) / 20)
    return y

def encode_ogg(wav, ogg, q=5):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libvorbis", "-q:a", str(q), ogg], check=True)

def encode_loop_ogg(x, ogg, q=5, pad=LOOP_PAD):
    """Lossy codecs smear the first/last frames of a stream, so a looped Ogg would click at the file edges.
    Encode [last pad samples | loop | first pad samples]; the runtime loops loopStart=pad/SR .. loopEnd=(pad+P)/SR,
    so the seam is mid-stream and continuous."""
    import os
    y = np.concatenate([x[:, -pad:], x, x[:, :pad]], axis=1)
    tmp = f"/tmp/_loop_{os.getpid()}.wav"; write_wav24(tmp, y); encode_ogg(tmp, ogg, q); os.remove(tmp)

def decode_loop(ogg, pad=LOOP_PAD):
    y = decode(ogg)
    return y[:, pad:y.shape[1] - pad]

def stitch_loop(raw, pad=LOOP_PAD, P=LOOP_SAMPLES, n=480):
    """Runtime seam stitch (mirror of stitchLoop() in music-spec.md §6): the n samples before loopEnd are crossfaded
    into the pre-roll copy of the same audio (decoded just before loopStart), so the last played sample is
    stream-continuous with loopStart. Returns the loop body [pad, pad+P)."""
    y = raw.copy(); a = np.linspace(0, 1, n, endpoint=False) ** 1
    e0 = pad + P - n
    y[:, e0:pad + P] = y[:, e0:pad + P] * (1 - a) + y[:, pad - n:pad] * a
    return y[:, pad:pad + P]
