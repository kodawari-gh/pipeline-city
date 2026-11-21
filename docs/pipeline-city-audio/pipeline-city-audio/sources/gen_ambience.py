"""Ambience loops, built to be exactly periodic (seamless): noise is made in the frequency domain at the loop length
(circular), every LFO and tone has a whole number of cycles per loop. No fades at the ends.
- amb_room_city_loop: quiet room tone + distant city wash through the window (always on in the room, menus included).
- amb_machine_hum_loop: PC fans + soft PSU hum (on while snapshot.powered; gain/playbackRate follow fan speed).
Run: /workspace/audio/.venv/bin/python gen_ambience.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from sfxlib import *
from levels import AMBIENCE

R = np.random.default_rng(21)
def periodic_noise(n, shape):
    """Stereo noise, exactly periodic over n samples, magnitude = shape(freqs)."""
    f = np.fft.rfftfreq(n, 1 / SR); mag = shape(np.maximum(f, 1.0)); mag[0] = 0
    out = []
    for _ in range(2):
        ph = R.uniform(0, 2 * np.pi, f.size); out.append(np.fft.irfft(mag * np.exp(1j * ph), n))
    x = np.stack(out); return x / np.sqrt(np.mean(x ** 2))

def lfo(n, cycles, depth, phase=0.0):
    t = np.arange(n) / n; return 1 + depth * np.sin(2 * np.pi * cycles * t + phase)

def tone(n, f, amp):
    T = n / SR; f = round(f * T) / T; t = np.arange(n) / SR; return amp * np.sin(2 * np.pi * f * t)

def integrated(x):
    y = kweight(x) ** 2; return float(-0.691 + 10 * np.log10(y.sum(axis=0).mean()))

def room_city(seconds=24.0):
    n = int(seconds * SR)
    rumble = periodic_noise(n, lambda f: (1 / f ** 0.9) * np.exp(-f / 380))                  # city rumble, dark
    wash = periodic_noise(n, lambda f: (1 / f ** 0.5) * np.exp(-((np.log(f / 900)) ** 2) / 1.2))  # traffic wash
    air = periodic_noise(n, lambda f: np.exp(-((np.log(f / 5000)) ** 2) / 0.6))                 # room air
    x = 1.0 * rumble * lfo(n, 2, 0.15)[None] + 0.35 * wash * lfo(n, 3, 0.35, 1.0)[None] * lfo(n, 5, 0.15, 2.0)[None] + 0.04 * air
    return x

def machine_hum(seconds=12.0):
    n = int(seconds * SR)
    fan = periodic_noise(n, lambda f: np.exp(-((np.log(f / 420)) ** 2) / 0.5) + 0.4 * np.exp(-((np.log(f / 1600)) ** 2) / 0.3))
    whoosh = periodic_noise(n, lambda f: 1 / f ** 1.2 * np.exp(-f / 2500))
    x = 0.8 * fan * lfo(n, 3, 0.04)[None] + 0.5 * whoosh
    hum = tone(n, 100, 0.10) + tone(n, 200, 0.03) + tone(n, 116, 0.05) * lfo(n, 4, 0.3)   # PSU / fan blade tones, low and soft
    x = x + hum[None]
    return x

if __name__ == "__main__":
    rows = []
    for name, fn in (("amb_room_city_loop", room_city), ("amb_machine_hum_loop", machine_hum)):
        x = fn(); x -= x.mean(axis=1, keepdims=True)
        x *= 10 ** ((AMBIENCE[name] - integrated(x)) / 20)
        tp = true_peak_db(x)
        if tp > -1.2: x *= 10 ** ((-1.2 - tp) / 20)
        rows.append(save("ambience", name, x, None, dict(id=name, family="ambience", level="ambience", pitched=False, root=None, loop=True,
                         integrated_target=AMBIENCE[name], integrated=round(integrated(x), 2), tp=round(true_peak_db(x), 2),
                         trigger=("always in the room scene (main menu, game); not in Build/Gallery studio" if "room" in name else
                                  "while snapshot.powered; gain and playbackRate follow mean DeviceSnap.fan / cooling load"))))
    json.dump(rows, open(os.path.join(HERE, "manifest_ambience.json"), "w"), indent=1)
    for r in rows: print(r["file"], r["seconds"], r["integrated"], r["tp"])
