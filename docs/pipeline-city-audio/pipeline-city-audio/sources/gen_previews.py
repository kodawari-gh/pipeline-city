"""Preview reels built from the SHIPPED Ogg files (decoded), mixed with the bus levels and ducking of mix-tokens.json.
- previews/sfx_preview.ogg: a plausible game moment, over the room ambience, the machine hum and a very quiet
  Afterglow-style pad (F Lydian, then C Lydian after the level-up) so the key fit can be heard.
- previews/ui_preview.ogg: the menu screens of the AD handoff, over the room ambience and the same quiet pad.
Each writes a timestamped cue list (.md + .json). Loudness: -16 LUFS integrated, true peak <= -1 dBTP.
Run: /workspace/audio/.venv/bin/python gen_previews.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, soundfile as sf
from sfxlib import *

TOK = json.load(open(os.path.join(PKG, "mix-tokens.json")))
DB = lambda d: 10 ** (d / 20)
ROOT_PC = {"F": 5, "Gs": 8, "B": 11, "D": 2}

def pick_root(key_pc):
    """Nearest render root and the playbackRate (IMPLEMENTATION.md cueFile())."""
    best = min(ROOT_PC.items(), key=lambda kv: abs(((key_pc - kv[1] + 6) % 12) - 6))
    d = ((key_pc - best[1] + 6) % 12) - 6
    return best[0], 2 ** (d / 12), d

def load(rel):
    x, sr = sf.read(os.path.join(PKG, rel), always_2d=True); return x.T

class Reel:
    def __init__(self, seconds):
        self.n = int(seconds * SR); self.bus = {b: np.zeros((2, self.n)) for b in ("sfx", "ui", "ambience", "music")}
        self.log = []; self.duck = np.zeros(self.n)
    def put(self, bus, t, x, label, code, duck_db=0.0):
        i = int(t * SR); m = min(x.shape[1], self.n - i); self.bus[bus][:, i:i + m] += x[:, :m]
        self.log.append(dict(t=round(t, 2), file=label, event=code, bus=bus))
        if duck_db:
            a, r = int(TOK["ducking"]["attackMs"] / 1000 * SR), int(TOK["ducking"]["releaseMs"] / 1000 * SR)
            hold = int(TOK["ducking"]["holdMs"] / 1000 * SR)
            env = np.concatenate([np.linspace(0, 1, a), np.ones(hold), np.linspace(1, 0, r)]) * duck_db
            seg = env[: self.n - i]; self.duck[i:i + seg.size] = np.minimum(self.duck[i:i + seg.size], seg)
    def cue(self, t, id, key_pc=None, code="", bus="sfx"):
        cat = "ui" if id.startswith("ui_") else "sfx"
        if key_pc is None:
            rel = f"assets/{cat}/{id}.ogg"; x = load(rel); label = rel
        else:
            root, rate, d = pick_root(key_pc); rel = f"assets/sfx/{id}__{root}.ogg"; x = load(rel)
            if rate != 1.0: x = resample_rate(x, rate)
            label = rel + (f" @ playbackRate {rate:.4f} ({d:+d} st)" if rate != 1 else "")
        duck = TOK["ducking"]["cueDuckDb"].get(TOK_CLASS.get(id, ""), 0.0)
        self.put(bus if cat == "sfx" else "ui", t, x, label, code, duck)
    def loop(self, id, t0, t1, fade=1.0):
        x = load(f"assets/ambience/{id}.ogg"); i0, i1 = int(t0 * SR), int(t1 * SR); n = i1 - i0
        reps = np.tile(x, (1, n // x.shape[1] + 1))[:, :n]; e = np.ones(n); f = int(fade * SR)
        e[:f] = np.linspace(0, 1, f) if t0 > 0 else e[:f]; e[-f:] *= np.linspace(1, 0, f)
        self.bus["ambience"][:, i0:i1] += reps * e
        self.log.append(dict(t=round(t0, 2), file=f"assets/ambience/{id}.ogg (loop until {t1:.1f} s)", event="ambience", bus="ambience"))
    def pad(self, t0, t1, root_midi, gain_db, label):
        ch = [root_midi, root_midi + 7, root_midi + 14, root_midi + 18, root_midi + 23]   # root 5th 9th #11 maj7: Lydian colour
        x = pad_chord(ch, t1 - t0 + 1.5, 1.0, 0.35, 1.2 if t0 > 0 else 0.05, 1.5)
        y = small_room(x, 0.3, 1.5)[:, : x.size]; y *= DB(gain_db) / (np.sqrt(np.mean(y ** 2)) + 1e-12) * 0.05
        i = int(t0 * SR); m = min(y.shape[1], self.n - i); self.bus["music"][:, i:i + m] += y[:, :m]
        self.log.append(dict(t=round(t0, 2), file=f"(preview-only pad, {label})", event="music stand-in", bus="music"))
    def render(self, paused=None):
        g = {b: DB(TOK["buses"][b]["defaultDb"]) for b in self.bus}
        duck = DB(self.duck)
        mus = self.bus["music"].copy()
        if paused:   # pause hold stand-in on the pad: low-pass and -3 dB (the music lane does the real one)
            t0, t1 = paused; i0, i1 = int(t0 * SR), int(t1 * SR)
            b, a = signal.butter(2, 900 / (SR / 2)); lp = signal.lfilter(b, a, mus, axis=1)
            w = np.zeros(self.n); w[i0:i1] = 1; w = ndimage.uniform_filter1d(w, int(0.8 * SR))
            mus = mus * (1 - w) + lp * w * DB(-3)
        mix = (self.bus["sfx"] * g["sfx"] + self.bus["ui"] * g["ui"] + (self.bus["ambience"] * g["ambience"] + mus * g["music"]) * duck)
        return mix * DB(TOK["buses"]["master"]["defaultDb"])

from scipy import ndimage
TOK_CLASS = {c["id"]: c["duckClass"] for c in TOK["cues"] if c.get("duckClass")}

def finish_reel(mix, name, title, log, notes):
    out = os.path.join(PKG, "previews"); os.makedirs(out, exist_ok=True)
    mix -= mix.mean(axis=1, keepdims=True)
    n = int(0.02 * SR); mix[:, :n] *= np.linspace(0, 1, n); f = int(1.0 * SR); mix[:, -f:] *= np.linspace(1, 0, f) ** 2
    tmp = os.path.join(out, name + ".tmp.wav")
    # gain toward -16 LUFS, but allow at most 4 dB of true-peak limiting so cue-to-cue levels stay honest
    write_wav(tmp, mix); I, tp = ffmpeg_measure(tmp)
    g = min(-16.0 - I, (-1.5 - tp) + 4.0); mix = tp_limit(mix * DB(g), -1.5)
    for _ in range(3):
        write_wav(tmp, mix); I2, tp2 = ffmpeg_measure(tmp)
        if tp2 <= -1.2: break
        mix *= DB(-1.3 - tp2)
    mix -= mix.mean(axis=1, keepdims=True)                           # DC after the limiter
    f = int(1.0 * SR); mix[:, -f:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, f))   # re-fade after the limiter
    for _ in range(3):                                                 # final true-peak trim on the finished mix
        write_wav(tmp, mix); _, tp3 = ffmpeg_measure(tmp)
        if tp3 <= -1.25: break
        mix *= DB(-1.35 - tp3)
    wav = os.path.join(HERE, "masters", "previews"); os.makedirs(wav, exist_ok=True); wav = os.path.join(wav, name + ".wav")
    write_wav(wav, mix); os.remove(tmp); encode_ogg(wav, os.path.join(out, name + ".ogg"))
    I, tp = ffmpeg_measure(os.path.join(out, name + ".ogg"))
    log = sorted(log, key=lambda e: e["t"])
    with open(os.path.join(out, name + "_cues.md"), "w") as fh:
        fh.write(f"# {title}\n\n{notes}\n\nMeasured: {I} LUFS integrated, {tp} dBTP true peak, {mix.shape[1] / SR:.1f} s.\n\n| time (s) | game event / UI action | file | bus |\n|---:|---|---|---|\n")
        for e in log: fh.write(f"| {e['t']:.2f} | {e['event']} | `{e['file']}` | {e['bus']} |\n")
    json.dump(log, open(os.path.join(out, name + "_cues.json"), "w"), indent=1)
    print(name, I, tp)

def sfx_reel():
    D = 30.0; r = Reel(D); F, Cc = 5, 0
    r.loop("amb_room_city_loop", 0, D); r.loop("amb_machine_hum_loop", 5.9, D)
    r.pad(0, 22.0, 41, -2, "F Lydian, level 1"); r.pad(22.0, D, 36, -2, "C Lydian, level 2")
    S = [(0.30, "ui_click_1", None, "click dock 'Inventory 1'"), (0.55, "ui_panel_open", None, "inventory panel opens"),
         (1.40, "ui_pickup", None, "drag a CPU from the shelf"), (2.00, "install", F, "note 'install': CPU installed in cpu0"),
         (3.00, "install", F, "note 'install': RAM installed in dimm1"), (3.90, "cable_connect", F, "note 'cable': 24-pin cable connected"),
         (4.90, "cable_connect", F, "note 'cable': Ethernet cable connected to the board jack"), (5.80, "power_on", F, "note 'power': powered on"),
         (7.00, "post_boot", F, "Phase 'posting'"), (8.30, "boot_ready", F, "Phase 'idle-os'"), (9.20, "key_plug", F, "note 'key': key 3 plugged in"),
         (10.0, "net_link_up", F, "net.state -> 'link-up'"), (11.3, "job_fulfilled", F, "note 'job': key 3 holds its result"),
         (12.2, "payout", F, "note 'payout': key 3 returned: $40"), (13.6, "purchase", F, "note 'purchase': bought fan"),
         (14.4, "swap_queued", F, "note 'install': ... will be swapped in as soon as the job is done"),
         (15.6, "swap_done", F, "swapMany: queued part fitted"), (16.6, "ecc", F, "note 'ecc'"), (17.3, "net_saturated", F, "net.state -> 'saturated'"),
         (18.3, "client_drop", F, "note 'drop': tray full: a client gave up"), (19.2, "fault_crash", F, "note 'fault': thermal error: the machine crashed and rebooted"),
         (20.6, "post_boot", F, "Phase 'posting' (reboot)"), (22.0, "level_up", None, "note 'level': Level 2 (key F -> C Lydian on the bar)"),
         (24.2, "payout", Cc, "note 'payout' in the new key"), (25.4, "pause", None, "speed -> 0 (Space)"), (27.0, "resume", None, "speed 0 -> 4 (resume 1x)"),
         (27.8, "speed_up", None, "speed 4 -> 8 (2x)"), (28.5, "cable_connect", Cc, "note 'cable': video cable connected (new key)")]
    for t, id, k, code in S:
        if id == "level_up":
            x = load("assets/sfx/level_up__C.ogg"); r.put("sfx", t, x, "assets/sfx/level_up__C.ogg", code, TOK["ducking"]["cueDuckDb"]["milestone"])
        else: r.cue(t, id, k, code)
    mix = r.render(paused=(25.4, 27.0))
    finish_reel(mix, "sfx_preview", "SFX preview reel: a game moment", r.log,
                "Built from the shipped Ogg files. Pitched cues use the 4-root files; after the level-up (22.0 s) the key is C Lydian, so pitched cues "
                "play the B-root file at playbackRate 2^(1/12). A very quiet Afterglow-style pad (preview-only, NOT a shipped asset; the music lane makes the real stems) "
                "sits under the cues, with ducking from mix-tokens.json, and a low-pass stand-in for the pause hold (25.4-27.0 s). Room ambience all through; machine hum from power-on.")

def ui_reel():
    D = 21.0; r = Reel(D)
    r.loop("amb_room_city_loop", 0, D); r.pad(0, D, 41, -2, "F Lydian, menu")
    S = [(0.30, "ui_hover_1", "01 Main menu: pointer over 'New game'"), (0.75, "ui_hover_2", "pointer over 'Build my PC'"),
         (1.20, "ui_focus_move_1", "↓ focus to 'Gallery' (chip slides)"), (1.60, "ui_focus_move_2", "↓ focus to 'Settings'"),
         (2.10, "ui_click_1", "Enter on 'Settings'"), (2.18, "ui_transition_in", "Main menu -> 06 Settings (trace extends)"),
         (3.00, "ui_tab_switch", "→ tab 'Display'"), (3.60, "ui_tab_switch", "→ tab 'Light'"), (4.20, "ui_value_change", "→ value 'High'"),
         (4.70, "ui_value_change", "→ value 'Ultra'")]
    S += [(5.30 + i * 0.07, f"ui_slider_tick_{i % 2 + 1}", "slider 'UI size' +5 % step" if i == 0 else "slider step") for i in range(8)]
    S += [(6.40, "ui_toggle_on", "'Auto-adjust' Off -> On"), (7.00, "ui_toggle_off", "'Auto-adjust' On -> Off"),
          (7.80, "ui_panel_close", "'Hold to peek' pressed (layer fades)"), (8.40, "ui_panel_open", "'Hold to peek' released"),
          (9.20, "ui_back", "Esc: back"), (9.25, "ui_transition_out", "06 Settings -> Main menu (trace retracts)"),
          (10.20, "ui_hover_3", "pointer over 'New game'"), (10.60, "ui_click_2", "click 'New game'"), (10.68, "ui_transition_in", "-> 04 New game"),
          (11.60, "ui_value_change", "→ 'Sandbox'"), (12.30, "ui_confirm", "WB 'Replace save and start'")]
    S += [(13.20 + i * 0.06, f"ui_type_tick_{i % 3 + 1}", "11 First frame: meta types in" if i == 0 else "typing") for i in range(8)]
    S += [(14.20, "ui_click_1", "'Next' (tutorial)"), (15.00, "ui_notify", "toast '[ ok ] Saved.'"), (15.80, "ui_error", "toast '[ no ]' unreadable file"),
          (16.60, "ui_warn", "toast '[ !! ]'"), (17.40, "pause", "Esc in game -> 10 Paused (clock stops)"), (18.40, "ui_focus_move_1", "↓ in Paused"),
          (18.90, "ui_focus_move_2", "↑ back to 'Resume'"), (19.40, "ui_click_2", "Enter 'Resume'"), (19.45, "resume", "clock restarts at 1x")]
    for t, id, code in S: r.cue(t, id, None, code)
    finish_reel(r.render(paused=(17.4, 19.45)), "ui_preview", "Menu and UI sounds reel (AD screens 01, 06, 04, 11, HUD toasts, 10)", r.log,
                "Built from the shipped Ogg files over the room ambience and a very quiet preview-only pad (not a shipped asset). Screens from "
                "/workspace/menu-review/handoff/pipeline-city-menu-ui SPEC §5, §7, §8, §10. Bus levels from mix-tokens.json.")

if __name__ == "__main__":
    sfx_reel(); ui_reel()
