"""Render the Afterglow loop stems: 6 layers x 12 keys (4 bars each) + the menu/title loop (F, 8 bars).
Masters (24-bit WAV) -> sources/masters/stems/, Ogg Vorbis q6 -> stems/. Re-run: python gen_stems.py [layer ...]"""
import sys, os, json
import numpy as np
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mlib import *

HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.dirname(HERE)
P = LOOP_SAMPLES
STEM_LUFS = -20.0           # every stem file is normalized to this; the mix tokens set the balance
TAIL = 8 * SR
IR = reverb_ir(4.0, 5000)

def at(beat):  # sample index of a beat position inside the loop
    return int(round(beat * BEAT_S))

def place(buf, beat, x, pan=0.0, gain=1.0):
    i = at(beat); s = pan2(x * gain, pan)
    buf[:, i:i + s.shape[1]] += s[:, : buf.shape[1] - i]

# --- harmony (relative to bed root R) ---
# bars 1-2: I (Lydian tonic, maj9 colour); bars 3-4: II/I (major triad on the 2nd over the root: the Lydian sound)
SECTION_A = [7 + 12, 16, 23]          # 5th (upper), 3rd, maj7   (+ shared below)
SECTION_B = [9 + 12, 14, 18]          # 13th, 9th, #11  -> II triad over the root
SHARED = [0, 7, 14 + 12]              # root, 5th, 9th up high (common to both sections)

def pad_layer(key, P, sections, bright=0.5, xfade_beats=1.5, shared=SHARED, gain=1.0, detune=7, swell=0.15, seed=0, maxf=9000):
    R = bed_root(key); out = np.zeros((2, P)); nsec = len(sections)
    for j, iv in enumerate(shared):
        env = 1 - swell * (0.5 + 0.5 * lfo(P, 1 + j % 2, 0.13 * j))
        x = pad_partials(hz(R + iv), P, env, bright, detune, seed + j, maxf=maxf)
        out += pan2(x, (j / max(1, len(shared) - 1) - 0.5) * 0.6) * (1.0 if iv == 0 else 0.8)
    for s, ivs in enumerate(sections):
        env = periodic_env(P, [(s / nsec, (s + 1) / nsec)], xfade_beats * BEAT_S)
        for j, iv in enumerate(ivs):
            x = pad_partials(hz(R + iv), P, env * (1 - swell * (0.5 + 0.5 * lfo(P, 2, 0.21 * j))), bright, detune, seed + 10 * s + j + 5, maxf=maxf)
            out += pan2(x, (j / max(1, len(ivs) - 1) - 0.5) * 0.9) * 0.6
    return out * gain

def finish(dry, wet=0.35, lp=None, hp=None):
    y = dry + circ_reverb(dry, IR, wet)
    if lp: y = circ_lowpass(y, lp)
    if hp: y = circ_highpass(y, hp)
    return y

# ---------------- layers ----------------
def L_bed(key):
    return finish(pad_layer(key, P, [SECTION_A, SECTION_B], bright=0.5), wet=0.4, lp=7000, hp=30)

def L_pausebed(key):
    # darker and held: same chords, slower 4-beat crossfades, less movement, low-passed ~2.5 kHz
    d = pad_layer(key, P, [SECTION_A, SECTION_B], bright=0.25, xfade_beats=4, swell=0.06, detune=5, seed=40)
    return finish(d, wet=0.5, lp=2500, hp=30)

PLUCK_PAT = [  # (beat, degree) over 4 bars; degree 0 = root, 7 = root +8va; folded into D4..A5
    (0, 4), (0.75, 2), (2.25, 6), (3, 7),
    (4, 4), (5.5, 9), (6.25, 2), (7.5, 11),
    (8, 1), (8.75, 3), (10.25, 5), (11, 8),
    (12, 3), (13.5, 5), (14.25, 1), (15.25, 10)]
def L_pluck(key):
    buf = np.zeros((2, P + TAIL))
    for i, (b, d) in enumerate(PLUCK_PAT):
        m = deg(key, d, 62, 81, anchor=64)
        v = 0.5 * (1.0 if b % 4 == 0 else 0.8)
        place(buf, b, echo_buf(pluck(hz(m), v, bright=0.45), BEAT * 0.75, 3, 0.33), pan=0.45 * np.sin(i * 1.7))
    return finish(fold(buf, P), wet=0.32, lp=9000)

def L_bass(key):
    R = bed_root(key) - 12      # E1..D#2, with 2nd/3rd harmonics so small speakers still read it
    buf = np.zeros((2, P + TAIL))
    for bar in range(LOOP_BARS):
        b0 = bar * 4
        fifth = 7 if bar < 2 else 9        # bars 3-4 follow II/I: the 6th gives the II-chord motion over the pedal
        for b, iv, v, dur in ((0, 0, 0.9, 1.6), (1.5, 12, 0.35, 0.6), (2, iv2 := fifth, 0.6, 1.1), (3.5, 0, 0.45, 0.7)):
            place(buf, b0 + b, bass_note(hz(R + iv), v, dur * BEAT))
    return finish(fold(buf, P), wet=0.12, lp=1800, hp=28)

def L_shimmer(key):
    # data-flow shimmer: triplet-8th blips walking the scale in C6..C7 + soft high ticks on 16ths
    buf = np.zeros((2, P + TAIL)); notes = scale_notes(key, 79, 96)
    walk = list(range(len(notes))) + list(range(len(notes) - 2, 0, -1))
    rng = np.random.default_rng(PC[key] + 11)
    for i in range(LOOP_BARS * 4 * 3):
        m = notes[walk[i % len(walk)]]
        v = 0.35 * (1.0 if i % 3 == 0 else 0.6)
        place(buf, i / 3, echo_buf(blip(hz(m), v), BEAT * 0.75, 2, 0.3), pan=0.6 * np.sin(i * 0.9))
    from scipy import signal as sg
    b, a = sg.butter(2, [5000 / (SR / 2), 9500 / (SR / 2)], "band")
    for i in range(LOOP_BARS * 16):
        n = int(0.04 * SR); tk = sg.lfilter(b, a, rng.standard_normal(n)) * np.exp(-np.arange(n) / SR / 0.01)
        place(buf, i / 4, tk / np.max(np.abs(tk)) * (0.05 if i % 2 else 0.08), pan=rng.uniform(-0.7, 0.7))
    return finish(fold(buf, P), wet=0.3, hp=900)

def L_stress(key):
    # overload: upper bed voices doubled 28 cents sharp with a 16th-note tremolo, plus sharp off-beat plucks
    R = bed_root(key); out = np.zeros((2, P))
    trem = 1 - 0.55 * (0.5 + 0.5 * lfo(P, LOOP_BARS * 16))          # 64 cycles per loop = 16ths (4.4 Hz)
    for j, iv in enumerate([14, 18, 21, 26]):
        x = pad_partials(hz(R + iv) * 2 ** (28 / 1200), P, trem, bright=0.75, detune_c=11, seed=70 + j)
        out += pan2(x, (-0.6, 0.6, -0.3, 0.3)[j]) * 0.6
    buf = np.zeros((2, P + TAIL))
    for i in range(LOOP_BARS * 4):
        m = deg(key, (4, 6, 1, 3)[i % 4], 64, 81, anchor=64)
        place(buf, i + 0.5, pluck(hz(m) * 2 ** (28 / 1200), 0.35, dur=0.8, bright=0.7), pan=0.5 if i % 2 else -0.5)
    return finish(out + fold(buf, P), wet=0.3, lp=8000, hp=120)

def L_menu(key="F"):
    # title / menu state: 8 bars, pad + sparse long-echo plucks + rare glints, no bass, no shimmer
    P8 = 2 * P
    secs = [SECTION_A, SECTION_B, [7 + 12, 16, 21], [11, 19, 23]]   # I, II/I, I6/9, V/I (C major over F)
    pad = pad_layer(key, P8, secs, bright=0.4, xfade_beats=2.5, swell=0.2, seed=90)
    buf = np.zeros((2, P8 + TAIL))
    pat = [(0, 4), (3, 2), (6, 6), (9, 7), (12, 1), (14, 5), (18, 3), (21, 8), (24, 4), (26.5, 9), (29, 6), (31, 2)]
    for i, (b, d) in enumerate(pat):
        place(buf, b, echo_buf(pluck(hz(deg(key, d, 62, 81, 64)), 0.42, dur=1.8, bright=0.4), BEAT * 0.75, 4, 0.38), pan=0.5 * np.sin(i * 2.1))
    for b, d in ((7, 11), (23, 13)):
        place(buf, b, echo_buf(glint(hz(deg(key, d, 84, 98, 84)), 0.2), BEAT * 0.75, 3, 0.35), pan=0.4)
    return finish(pad + fold(buf, P8), wet=0.45, lp=7000, hp=30)

LAYERS = {"bed": L_bed, "pluck": L_pluck, "bass": L_bass, "shimmer": L_shimmer, "stress": L_stress, "pausebed": L_pausebed}

def job(args):
    layer, key = args
    x = (L_menu if layer == "menu" else LAYERS[layer])(key)
    x = normalize(x, STEM_LUFS)
    name = f"music_{layer}_{key}"
    wav = os.path.join(HERE, "masters", "stems", name + ".wav"); ogg = os.path.join(MUSIC, "stems", name + ".ogg")
    write_wav24(wav, x); encode_loop_ogg(x, ogg, 6)
    return name, x.shape[1]

if __name__ == "__main__":
    sel = sys.argv[1:] or list(LAYERS) + ["menu"]
    jobs = [(l, k) for l in sel if l != "menu" for k in KEYS] + ([("menu", "F")] if "menu" in sel else [])
    with ProcessPoolExecutor(6) as ex:
        for name, n in ex.map(job, jobs): print(name, n)
