"""Preview: Afterglow reacting through install, cable, link-up, payout, stress, ecc, a level-up key change
(F -> C Lydian) that lands inside the level-up pause hold, a step while paused, resume, job + payout.
Built ONLY from the shipped stems and note files (decoded Ogg), mixed with the music-spec rules and mix tokens,
so it is a faithful model of the runtime. Output: previews/music_reactive_preview.{ogg} (+ wav master, cue list)."""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mlib import *
HERE = os.path.dirname(os.path.abspath(__file__)); MUSIC = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(os.path.dirname(MUSIC), "samples"))
from synth import tp_limit

spec = json.load(open(os.path.join(MUSIC, "music-spec.json")))
G = spec["mix"]["layer_gain_db"]; TRIM = spec["mix"]["music_trim_db"]; CUE = spec["mix"]["cue_gain_db"]
DUR = 40.0; N = int(DUR * SR); P = LOOP_SAMPLES
BAR = 4 * BEAT_S / SR; B = BEAT_S / SR
def db(g): return 10 ** (g / 20)
cache = {}
def stem(layer, key, lp=None):
    k = (layer, key, lp)
    if k not in cache:
        x = decode_loop(os.path.join(MUSIC, "stems", f"music_{layer}_{key}.ogg"))
        cache[k] = circ_lowpass(x, lp) if lp else x
    return cache[k]
def tiled(x):
    idx = np.arange(N) % x.shape[1]; return x[:, idx]
def ramp(points):
    """[(t, value_linear)] linear ramps between points."""
    t = np.arange(N) / SR; ts, vs = zip(*points); return np.interp(t, ts, vs)
def q(t, grid):  # next grid line at or after t (grid in beats)
    g = grid * B; return np.ceil(t / g - 1e-9) * g
cues = []
def fan_notes(key, degrees, lo):
    """Ascending chord-tone fan from the first root at or above lo."""
    r = lo + ((PC[key] - lo) % 12)
    return [r + 12 * (d // 7) + LYD[d % 7] for d in degrees]
def cue(t, code, text): cues.append({"t": round(t, 2), "code": code, "music": text})

# ---- state timeline ----
T_INSTALL = 1.20; T_PLUCK_IN = q(T_INSTALL, 4)
T_CABLE = 5.30; T_CABLE_Q = q(T_CABLE, 1)
T_LINK = 6.90; T_LINK_Q = q(T_LINK, 4)
T_PAY1 = 9.40; T_PAY1_Q = q(T_PAY1, 1 / 12)
T_STRESS = 10.6; T_STRESS_Q = q(T_STRESS, 4)
T_ECC = 13.6; T_ECC_Q = q(T_ECC, 1 / 12)
T_STRESS_OFF = 15.6; T_STRESS_OFF_Q = q(T_STRESS_OFF, 1)
T_LEVEL = 16.9; T_KEY = q(T_LEVEL, 4)              # key change on the next bar line
T_PAUSE = 17.3                                      # popupPause (level-up card): speed 0
T_STEP = 22.0; T_STEP_Q = q(T_STEP, 1)
T_RESUME = 27.8; T_RESUME_Q = q(T_RESUME, 1)
T_JOB = 31.5; T_JOB_Q = q(T_JOB, 1 / 12)
T_PAY2 = 33.2; T_PAY2_Q = q(T_PAY2, 1 / 12)
T_FADE = 36.4

F_IN = 0.25; PAUSE_FADE = spec["pause"]["fade_s"]; KEY_X = spec["key_change"]["crossfade_s"]
out = np.zeros((2, N)); cue_bus = np.zeros((2, N + 6 * SR))

# key crossfade weights (F before, C after)
wC = ramp([(0, 0), (T_KEY, 0), (T_KEY + KEY_X, 1), (DUR, 1)]); wF = 1 - wC
# pause amount 0..1
pz = ramp([(0, 0), (T_PAUSE, 0), (T_PAUSE + PAUSE_FADE, 1), (T_RESUME_Q, 1), (T_RESUME_Q + spec["resume"]["fade_s"], 0), (DUR, 0)])
def keyed(layer, lp=None):
    return tiled(stem(layer, "F", lp)) * wF + tiled(stem(layer, "C", lp)) * wC

# bed <-> pause bed
bed = keyed("bed") * db(G["bed"] + TRIM) * np.sqrt(1 - pz) + keyed("pausebed") * db(G["pausebed"] + TRIM) * np.sqrt(pz)
# pluck: enters on the bar after install; in pause crossfade to the 850 Hz low-passed version at -5 dB
pl_on = ramp([(0, 0), (T_PLUCK_IN, 0), (T_PLUCK_IN + F_IN, 1), (DUR, 1)])
pluck = (keyed("pluck") * np.sqrt(1 - pz) + keyed("pluck", 850) * db(spec["pause"]["pluck_db"]) * np.sqrt(pz)) * pl_on * db(G["pluck"] + TRIM)
# bass + shimmer: on at link-up bar; out over the pause fade, back from the resume beat
run_on = ramp([(0, 0), (T_LINK_Q, 0), (T_LINK_Q + B, 1), (DUR, 1)]) * (1 - pz)
bass = keyed("bass") * run_on * db(G["bass"] + TRIM)
shim = keyed("shimmer") * run_on * db(G["shimmer"] + TRIM)
st_on = ramp([(0, 0), (T_STRESS_Q, 0), (T_STRESS_Q + BAR, 1), (T_STRESS_OFF_Q, 1), (T_STRESS_OFF_Q + BAR, 0), (DUR, 0)])
stress = keyed("stress") * st_on * (1 - pz) * db(G["stress"] + TRIM)   # stress is 0 while paused

duck = np.ones(N)
def add_duck(t, depth_db, hold=0.15):
    a, r = spec["ducking"]["attack_s"], spec["ducking"]["release_s"]; hold = max(hold, spec["ducking"]["hold_s"])
    g = ramp([(0, 1), (t, 1), (t + a, db(depth_db)), (t + a + hold, db(depth_db)), (t + a + hold + r, 1), (DUR, 1)])
    np.minimum(duck, g, out=duck)
def note(kind, midi, t, gain_db, pan=0.0, lp=None, duck_db=None):
    x = decode(os.path.join(MUSIC, "notes", f"music_note_{kind}_{note_name(midi)}.ogg"))
    if lp: x = circ_lowpass(np.pad(x, ((0, 0), (0, SR))), lp)
    m = x.mean(axis=0); s = pan2(m, pan) * db(gain_db + TRIM); i = int(round(t * SR))
    cue_bus[:, i:i + s.shape[1]] += s
    add_duck(t, spec["ducking"]["bed_db"] if duck_db is None else duck_db)
def stinger(name, t, gain_db, duck_db):
    x = decode(os.path.join(MUSIC, "notes", name + ".ogg")); i = int(round(t * SR))
    cue_bus[:, i:i + x.shape[1]] += x * db(gain_db + TRIM); add_duck(t, duck_db, hold=1.0)

cue(0.0, "Phase 'idle-os', speed 4 (1x)", "bed (F Lydian) on; nothing else yet")
note("pluck", 65, T_INSTALL, CUE["pluck"])
cue(T_INSTALL, "note 'install' (player drag-drop)", "immediate cue pluck F4 (build register, centre); pad ducks -3 dB")
cue(T_PLUCK_IN, "(next bar after install)", "pluck loop layer enters on the bar line")
note("pluck", 65, T_CABLE_Q, CUE["pluck"] - 1); note("pluck", 72, T_CABLE_Q + B / 2, CUE["pluck"])
cue(T_CABLE, "note 'cable' connected", f"rising root->5th (F4, C5), on the next beat {T_CABLE_Q:.2f} s")
cue(T_LINK, "LinkState 'link-up' + Phase 'running-os'", f"shimmer (data) + bass layers in on the next bar {T_LINK_Q:.2f} s")
for i, m in enumerate(fan_notes("F", [0, 2, 4, 6], 76)):
    note("glint", m, T_PAY1_Q + i * B / 3, CUE["glint"], pan=-0.4 + 0.27 * i)
cue(T_PAY1, "note 'payout'", f"fan of 4 chord-tone glints (F5 A5 C6 E6), 1/3-beat apart from {T_PAY1_Q:.2f} s")
cue(T_STRESS, "VrmSnap.loadRatio > 1 (stress 0 -> 0.8)", f"stress layer fades in over 1 bar from {T_STRESS_Q:.2f} s")
note("glint", 95, T_ECC_Q, CUE["glint"] - 4, pan=0.5, duck_db=-1)
cue(T_ECC, "note 'ecc'", "tiny high glint (B6)")
cue(T_STRESS_OFF, "stress back to 0", f"stress layer fades out over 1 bar from {T_STRESS_OFF_Q:.2f} s")
cue(T_LEVEL, "note 'level' (level 2)", f"key change queued for the next bar line {T_KEY:.2f} s")
cue(T_PAUSE, "popupPause: speed 0 (level-up card)", f"pause hold over {PAUSE_FADE} s: bed -> pause bed, pluck low-passed to 850 Hz at -5 dB, bass + shimmer out. Never cuts")
stinger("music_levelup_C", T_KEY, CUE["levelup"], spec["ducking"]["milestone_db"])
cue(T_KEY, "(bar line) key change F -> C Lydian", f"all stems crossfade F -> C over {KEY_X} s; music_levelup_C chord rings into the pause")
note("pluck", 67, T_STEP_Q, CUE["pluck"] - 8, lp=1500, duck_db=-1)
cue(T_STEP, "step while paused", "one quiet, darkened pluck (G4)")
cue(T_RESUME, "dismissLevelUp -> setSpeed(lastRunSpeed)", f"resume on the next beat {T_RESUME_Q:.2f} s: pause bed -> bed, filter opens, bass + shimmer back over {spec['resume']['fade_s']} s")
note("pluck", 72, T_JOB_Q, CUE["pluck"], pan=0.3)
cue(T_JOB, "note 'job' (result ready)", "single cue pluck C5 (flow register)")
for i, m in enumerate(fan_notes("C", [0, 2, 4, 6, 7], 72)):
    note("glint", m, T_PAY2_Q + i * B / 3, CUE["glint"], pan=0.4 - 0.2 * i)
cue(T_PAY2, "note 'payout' (bigger job)", "fan of 5 chord-tone glints C5 E5 G5 B5 C6, now in the new key")
cue(T_FADE, "(end of preview)", "fade out")

# cue bus: dry-forward with dotted-eighth echo at -12 dB and a small reverb send
from scipy import signal
d = int(round(0.75 * BEAT * SR)); cb = cue_bus.copy()
for k in range(1, 4): cb[:, k * d:] += cue_bus[:, : -k * d] * db(-12) * 0.3 ** (k - 1)
ir = reverb_ir(3.5, 5000, seed=9)
cb = cb + np.stack([signal.fftconvolve(cb[c], ir[c])[: cb.shape[1]] for c in range(2)]) * 0.18
music = (bed * duck + pluck + bass * duck + shim * (1 - (1 - duck) * 2 / 3) + stress)
mix = music + cb[:, :N]
fo = ramp([(0, 1), (T_FADE, 1), (DUR, 0)]) ** 2; mix *= fo
mix -= mix.mean(axis=1, keepdims=True)
# master to -16 LUFS / <= -1 dBTP
for _ in range(4):
    I, tp, _ = measure_array(mix)
    if abs(I + 16) < 0.2 and tp <= -1.2: break
    mix = tp_limit(mix * db(-16 - I), -1.5)
wav = os.path.join(HERE, "masters", "previews", "music_reactive_preview.wav"); ogg = os.path.join(MUSIC, "previews", "music_reactive_preview.ogg")
write_wav24(wav, mix); encode_ogg(wav, ogg, 6)
json.dump(cues, open(os.path.join(MUSIC, "previews", "music_reactive_preview_cues.json"), "w"), indent=1)
with open(os.path.join(MUSIC, "previews", "music_reactive_preview_cues.md"), "w") as f:
    f.write("# music_reactive_preview.ogg: cue list\n\n40 s, 66 bpm (bar = 3.636 s), F Lydian -> C Lydian at level 2. Built only from the shipped stems and notes with music-spec.json rules.\n\n| time (s) | game event (repo) | what the music does |\n|---:|---|---|\n")
    for c in cues: f.write(f"| {c['t']:.2f} | `{c['code']}` | {c['music']} |\n")
print(measure(wav), measure(ogg))
