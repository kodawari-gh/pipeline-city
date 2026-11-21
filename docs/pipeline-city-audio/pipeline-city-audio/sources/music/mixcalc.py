"""Compute the music mix tokens: per-layer gains (relative), then one music-bus trim so that the all-layers-on mix
sits at -16 LUFS integrated (average over the 12 keys), true peak <= -1 dBTP. Measured on the decoded Ogg files."""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mlib import *
MUSIC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = {"bed": 0.0, "pluck": -2.0, "bass": -5.0, "shimmer": -7.0, "stress": -6.0}   # balance by ear-proxy (J)
PAUSE = {"pausebed": 1.0, "pluck": -2.0 - 5.0}      # pause: pause bed + pluck -5 dB through an 850 Hz low-pass
MENU_DB = 2.5
def db(g): return 10 ** (g / 20)
def load(layer, key): return decode_loop(os.path.join(MUSIC, "stems", f"music_{layer}_{key}.ogg"))
def mix(gains, key, lp_pluck=None):
    y = 0
    for l, g in gains.items():
        x = load(l, key)
        if lp_pluck and l == "pluck": x = circ_lowpass(x, lp_pluck)
        y = y + x * db(g)
    return y
full = {k: measure_array(mix(REL, k)) for k in KEYS}
I_avg = np.mean([v[0] for v in full.values()])
trim = round(-16.0 - I_avg, 1)
res = {"rel_db": REL, "music_trim_db": trim, "full_mix": {}, "running_no_stress": {}, "pause_mix": {}, "menu": None}
for k in KEYS:
    g = {l: v + trim for l, v in REL.items()}
    res["full_mix"][k] = measure_array(mix(g, k))[:2]
    g2 = {l: v for l, v in g.items() if l != "stress"}
    res["running_no_stress"][k] = measure_array(mix(g2, k))[:2]
    gp = {l: v + trim for l, v in PAUSE.items()}
    res["pause_mix"][k] = measure_array(mix(gp, k, lp_pluck=850))[:2]
res["menu"] = measure_array(load("menu", "F") * db(trim + MENU_DB))[:2]
json.dump(res, open(os.path.join(HERE := os.path.dirname(os.path.abspath(__file__)), "mixcalc.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
