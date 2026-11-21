"""Render the one-shot musical notes and the key-locked stingers.
- music_note_pluck_<N>: cue pluck, chromatic C3..C6 (37)     -> event notes in build / flow registers
- music_note_glint_<N>: sine glint, chromatic C5..C7 (25)     -> payout fans, ecc, data accents
- music_note_low_<N>:   low thud tone, chromatic C2..C3 (13)  -> fault / drop / expire
- music_levelup_<K>:    level-up transition chord in the NEW key (12), plays on the bar line of the key change
- music_fault_<K>:      crash fall (5th -> root, low) + dark swell, in the current key (12)
Chromatic so no runtime pitch shift is needed in any of the 12 keys. Dry (no echo/reverb): the runtime cue bus adds the
dotted-eighth echo at -12 dB and the shared reverb send (music-spec §5)."""
import sys, os
import numpy as np
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mlib import *
HERE = os.path.dirname(os.path.abspath(__file__)); MUSIC = os.path.dirname(HERE)
NOTE_LUFS = -20.0; STINGER_LUFS = -18.0
IR = reverb_ir(3.5, 5000, seed=5)

def st(x): return np.stack([x, x]) if x.ndim == 1 else x

def stinger_levelup(key):
    R = 48 + PC[key] % 12            # C3..B3
    n = int(4.5 * SR); out = np.zeros((2, n))
    for i, iv in enumerate([0, 7, 14, 16]):
        x = cue_pluck(hz(R + iv), 0.8 - 0.08 * i, dur=2.0); s = int(i * 0.035 * SR)
        out[:, s:s + x.size] += pan2(x, (-0.4, -0.1, 0.15, 0.4)[i])
    for i, iv in enumerate([24, 28]):
        x = glint(hz(R + iv), 0.35, dur=0.8); s = int((0.16 + 0.06 * i) * SR)
        out[:, s:s + x.size] += pan2(x, (0.3, -0.3)[i])
    t = np.arange(n) / SR; env = (1 - np.exp(-t / 0.35)) * np.exp(-t / 1.6)
    for j, iv in enumerate([0, 7, 16]):
        out += pan2(pad_partials(hz(R + iv), n, env, bright=0.5, seed=j), (j - 1) * 0.5) * 0.35
    y = out + circ_reverb_lin(out, 0.35)
    return fade_tail(y, 0.4)

def stinger_fault(key):
    Rl = 36 + PC[key] % 12           # C2..B2
    n = int(4.0 * SR); out = np.zeros((2, n))
    for s_beat, iv, v in ((0, 7, 0.9), (1, 0, 1.0)):
        x = low_tone(hz(Rl + iv), v, dur=2.2); s = int(s_beat * BEAT * SR)
        out[:, s:s + x.size] += st(x)[:, : n - s]
    t = np.arange(n) / SR; env = (1 - np.exp(-t / 0.5)) * np.exp(-t / 1.4)
    for j, iv in enumerate([12, 19, 22]):        # root, 5th, a flat-ish 7th colour (darker, not an alarm)
        out += pan2(pad_partials(hz(Rl + iv), n, env, bright=0.15, seed=30 + j), (j - 1) * 0.4) * 0.3
    y = circ_lowpass(out + circ_reverb_lin(out, 0.3), 1800)
    return fade_tail(y, 0.4)

def circ_reverb_lin(x, wet):
    from scipy import signal
    y = np.stack([signal.fftconvolve(x[c], IR[c])[: x.shape[1]] for c in range(2)])
    return y * wet

def fade_tail(x, sec):
    nf = int(sec * SR); x = x.copy(); x[:, -nf:] *= np.linspace(1, 0, nf) ** 2; return x

def job(a):
    kind, arg = a
    if kind == "pluck": x, name, tgt = st(cue_pluck(hz(arg))), f"music_note_pluck_{note_name(arg)}", NOTE_LUFS
    elif kind == "glint": x, name, tgt = st(glint(hz(arg))), f"music_note_glint_{note_name(arg)}", NOTE_LUFS
    elif kind == "low": x, name, tgt = st(low_tone(hz(arg))), f"music_note_low_{note_name(arg)}", NOTE_LUFS
    elif kind == "levelup": x, name, tgt = stinger_levelup(arg), f"music_levelup_{arg}", STINGER_LUFS
    else: x, name, tgt = stinger_fault(arg), f"music_fault_{arg}", STINGER_LUFS
    x = normalize(x, tgt)
    wav = os.path.join(HERE, "masters", "notes", name + ".wav"); ogg = os.path.join(MUSIC, "notes", name + ".ogg")
    write_wav24(wav, x); encode_ogg(wav, ogg, 6)
    return name

if __name__ == "__main__":
    jobs = [("pluck", m) for m in range(48, 85)] + [("glint", m) for m in range(72, 97)] + [("low", m) for m in range(36, 49)] \
         + [("levelup", k) for k in KEYS] + [("fault", k) for k in KEYS]
    with ProcessPoolExecutor(6) as ex:
        names = list(ex.map(job, jobs))
    print(len(names), "files")
