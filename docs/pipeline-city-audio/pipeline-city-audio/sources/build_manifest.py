"""Builds mix-tokens.json + mix-tokens.ts (the mix contract) and assets/manifest.json (every shipped file, its repo path,
cue id, root/variant and measured values from reference/checks/checks.json).
Run after gen_*.py and check_all.py: /workspace/audio/.venv/bin/python build_manifest.py"""
import os, sys, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from levels import TARGETS, AMBIENCE
HERE = os.path.dirname(os.path.abspath(__file__)); PKG = os.path.dirname(HERE)
REPO = os.path.join(PKG, "..", "..", "..")  # repo root: shipped audio is in public/audio, app data in src/app/audio

# ---- per-cue behaviour: bus, duck class, priority, rate limits ----
# minIntervalMs: drop a new play if the same cue started less than this ago. maxVoices: concurrent copies (oldest stops).
# collapseMs: several triggers inside this window play once. duckClass: how much music+ambience dip under it.
RL = lambda mi, mv, co=0: dict(minIntervalMs=mi, maxVoices=mv, collapseMs=co)
CUES = {
 # gameplay, pitched (4 roots) unless noted
 "job_fulfilled": ("sfx", "key", 3, RL(120, 2, 120)), "payout": ("sfx", "key", 3, RL(120, 2, 150)), "payout_late": ("sfx", "standard", 2, RL(120, 2, 150)),
 "install": ("sfx", "standard", 2, RL(60, 3, 80)), "uninstall": ("sfx", "standard", 2, RL(60, 3, 80)),
 "swap_queued": ("sfx", "standard", 2, RL(100, 2, 100)), "swap_done": ("sfx", "standard", 3, RL(200, 1, 300)), "swap_cancelled": ("sfx", "standard", 1, RL(150, 1, 150)),
 "cable_connect": ("sfx", "standard", 2, RL(80, 2, 100)), "cable_disconnect": ("sfx", "standard", 2, RL(80, 2, 100)), "cable_unplugged": ("sfx", "standard", 2, RL(150, 1, 250)),
 "key_plug": ("sfx", "standard", 2, RL(80, 2, 80)), "key_eject": ("sfx", None, 1, RL(80, 2, 80)), "key_refused": ("sfx", "standard", 2, RL(300, 1, 200)),
 "new_clients": ("sfx", "key", 2, RL(1000, 1, 0)),
 "net_link_up": ("sfx", "standard", 2, RL(1000, 1, 300)), "net_saturated": ("sfx", "standard", 1, RL(3000, 1, 300)), "net_down": ("sfx", "standard", 2, RL(1000, 1, 300)),
 "ecc": ("sfx", None, 0, RL(2000, 1, 0)),
 "power_on": ("sfx", "key", 3, RL(300, 1, 200)), "power_off": ("sfx", "standard", 3, RL(300, 1, 200)),
 "post_boot": ("sfx", "standard", 2, RL(500, 1, 300)), "boot_ready": ("sfx", None, 1, RL(500, 1, 300)),
 "fault_crash": ("sfx", "failure", 4, RL(500, 1, 300)), "fault_hard": ("sfx", "failure", 4, RL(800, 1, 400)), "fault_soft": ("sfx", "standard", 3, RL(400, 1, 300)),
 "client_drop": ("sfx", "standard", 2, RL(600, 1, 300)), "job_expired": ("sfx", "standard", 2, RL(600, 1, 300)), "job_declined": ("sfx", None, 1, RL(150, 1, 100)),
 "purchase": ("sfx", "standard", 2, RL(100, 2, 100)), "sell": ("sfx", "standard", 2, RL(100, 2, 100)),
 "bill_issued": ("sfx", "standard", 2, RL(1000, 1, 0)), "bill_paid": ("sfx", None, 1, RL(1000, 1, 0)),
 "contract_accepted": ("sfx", None, 1, RL(500, 1, 0)), "contract_ended": ("sfx", None, 1, RL(500, 1, 0)),
 "level_up": ("sfx", "milestone", 5, RL(3000, 1, 0)),
 # gameplay, fixed
 "pause": ("sfx", None, 3, RL(150, 1, 0)), "resume": ("sfx", None, 3, RL(150, 1, 0)), "speed_up": ("sfx", None, 1, RL(60, 1, 0)), "speed_down": ("sfx", None, 1, RL(60, 1, 0)),
 # UI, fixed
 "ui_hover": ("ui", None, 0, RL(40, 2, 0)), "ui_focus_move": ("ui", None, 0, RL(30, 2, 0)), "ui_click": ("ui", None, 1, RL(30, 3, 0)),
 "ui_back": ("ui", None, 1, RL(60, 1, 0)), "ui_toggle_on": ("ui", None, 1, RL(40, 1, 0)), "ui_toggle_off": ("ui", None, 1, RL(40, 1, 0)),
 "ui_value_change": ("ui", None, 1, RL(40, 2, 0)), "ui_tab_switch": ("ui", None, 1, RL(60, 1, 0)), "ui_slider_tick": ("ui", None, 0, RL(35, 1, 0)),
 "ui_confirm": ("ui", None, 2, RL(150, 1, 0)), "ui_error": ("ui", None, 2, RL(250, 1, 0)), "ui_warn": ("ui", None, 2, RL(250, 1, 0)), "ui_notify": ("ui", None, 1, RL(250, 1, 0)),
 "ui_transition_in": ("ui", None, 1, RL(200, 1, 0)), "ui_transition_out": ("ui", None, 1, RL(200, 1, 0)),
 "ui_panel_open": ("ui", None, 1, RL(80, 1, 0)), "ui_panel_close": ("ui", None, 1, RL(80, 1, 0)), "ui_pickup": ("ui", None, 1, RL(80, 1, 0)),
 "ui_type_tick": ("ui", None, 0, RL(50, 1, 0)),
}

# GameEvent (snapshot.log) -> cue. First match wins. `match` is a JS RegExp source, tested on GameEvent.text.
LOG_RULES = [
 ("install", "will be swapped in", "swap_queued"), ("install", "queued installs? cancelled|queued swap was dropped", "swap_cancelled"),
 ("install", "removed|came off", "uninstall"), ("install", "installed|placed next to|formatted", "install"),
 ("cable", "came unplugged", "cable_unplugged"), ("cable", "disconnected", "cable_disconnect"), ("cable", "connected", "cable_connect"),
 ("power", "powered on|reconnected", "power_on"), ("power", "powered off", "power_off"),
 ("key", "refused|pulled before", "key_refused"), ("key", "plugged in", "key_plug"), ("key", "told two friends", "new_clients"),
 ("job", "", "job_fulfilled"), ("payout", "\\(late\\)$", "payout_late"), ("payout", "", "payout"),
 ("drop", "", "client_drop"), ("expire", "", "job_expired"), ("decline", "", "job_declined"), ("level", "", "level_up"), ("ecc", "", "ecc"),
 ("fault", "crashed and rebooted", "fault_crash"),
 ("fault", "VRM burnt out|cut the wall|power cord was pulled|hard power-off", "fault_hard"), ("fault", "", "fault_soft"),
 ("purchase", "^sold", "sell"), ("purchase", "", "purchase"), ("bill", "^paid", "bill_paid"), ("bill", "", "bill_issued"),
 ("contract", "accepted", "contract_accepted"), ("contract", "", "contract_ended"),
 ("net", "link up", None), ("net", "", "ui_notify"), ("sandbox", "", "ui_notify"),
]

TOKENS = {
 "version": 1, "sampleRate": 48000, "codec": "ogg-vorbis", "basePath": "audio/",
 "buses": {
  "master": {"defaultDb": 0.0}, "music": {"defaultDb": -8.0}, "sfx": {"defaultDb": 0.0}, "ui": {"defaultDb": -3.0}, "ambience": {"defaultDb": 0.0}},
 "sliders": {"_doc": "Settings sliders 0..100 %, gain = (v/100)^2 on top of the bus default; 0 % = silent. 'sounds' drives sfx and ui together.",
  "master": {"default": 100, "buses": ["master"]}, "music": {"default": 100, "buses": ["music"]},
  "sounds": {"default": 100, "buses": ["sfx", "ui"]}, "ambience": {"default": 100, "buses": ["ambience"]}, "stepPercent": 5, "storageKey": "pipeline-city.audio"},
 "ducking": {"_doc": "Music and ambience dip under cues (cue-clarity measure). Gain ramps; the deepest active duck wins.",
  "targets": ["music", "ambience"], "attackMs": 10, "holdMs": 150, "releaseMs": 400,
  "cueDuckDb": {"standard": -2.0, "key": -3.0, "failure": -4.0, "milestone": -4.0}},
 "pause": {"_doc": "speed === 0: the AudioContext keeps running; nothing is suspended.", "fadeMs": 1000,
  "musicHold": {"_doc": "tempo is fixed at 66 bpm (no nudge from speed or pause). The darkening is built into music_pausebed_{KEY} (equal-power crossfade from the bed); the pluck layer goes through a low-pass at -5 dB. Details: audio/music/music-spec.json -> pause.", "tempoScale": 1.0, "lowpassHz": 850, "pluckDb": -5.0},
  "ambienceGainDb": {"amb_room_city_loop": 0.0, "amb_machine_hum_loop": -4.0}, "uiDuringPause": "normal", "sfxDuringPause": "normal"},
 "hiddenTab": {"_doc": "document.visibilityState === 'hidden'", "fadeOutMs": 500, "suspendAfterMs": 2000, "fadeInMs": 800},
 "unlock": {"_doc": "browsers start the AudioContext suspended; resume() on the first pointerdown/keydown/touchend.", "events": ["pointerdown", "keydown", "touchend"]},
 "voices": {"global": 24, "sfx": 12, "ui": 6, "stealPolicy": "lowest priority, then oldest"},
 "ambience": {"amb_room_city_loop": {"bus": "ambience", "fadeInMs": 2000, "fadeOutMs": 1500, "when": "room scene visible (main menu and game; not Build/Gallery studio)"},
              "amb_machine_hum_loop": {"bus": "ambience", "fadeInMs": 1200, "fadeOutMs": 900, "when": "snapshot.powered",
                "fanFollow": {"_doc": "x = mean DeviceSnap.fan of fan-bearing devices (0..1), else 0.5", "gainDbAt0": -6.0, "gainDbAt1": 0.0, "rateAt0": 0.92, "rateAt1": 1.12, "smoothMs": 800}}},
 "transpose": {"_doc": "Key root pitch class for game level L: (5 + 7*(L-1)) mod 12 (F Lydian at level 1, up a fifth per level). Pitched cues: pick the render root with the smallest signed distance d in -6..5 and play at playbackRate 2^(d/12) (|d| <= 1). Level-up: play level_up__<NEW key>.ogg at rate 1 on the next bar line (music lane clock); with no music clock, 0 ms.",
  "levelOneKeyPc": 5, "stepSemitones": 7, "renderRoots": {"F": 5, "Gs": 8, "B": 11, "D": 2},
  "keyNames": ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"],
  "_keyNamesDoc": "indexed by pitch class; the same file tokens as the music lane (s = sharp, URL-safe). Level order: F C G D A E B Fs Cs Gs Ds As"},
 "fileTargets": {"_doc": "max momentary loudness (BS.1770, 400 ms) per file, LUFS; peaks <= -1.2 dBTP", **TARGETS, "ambienceIntegrated": AMBIENCE},
 "logRules": [dict(kind=k, match=m, cue=c) for k, m, c in LOG_RULES],
 "music": {"_doc": "Afterglow music lane. The engine reads the full rules from audio/music/music-spec.json (states, events, clock, key change); these are the values the mixer needs. Speed changes only density and brightness (music-spec.json -> speed).",
  "spec": "audio/music/music-spec.json", "bus": "music", "tempoBpm": 66, "tempoFollowsSpeed": False, "loopSamples": 698182, "menuLoopSamples": 1396364, "loopPadSamples": 4800,
  "levelupWithSfxDb": -6.0, "levelupWithSfxDoc": "music_levelup_{KEY} plays at -6 dB whenever the SFX stinger level_up__{KEY} plays on the same bar (both are kept)",
  "menu": {"file": "audio/music/stems/music_menu_F.ogg", "rule": "the menu always uses music_menu_F; on the first game frame crossfade (2 s, on the next menu bar) to the save's key stems"},
  "preload": "current key + next key (+7 semitones) decoded; ~34 MB decoded per key",
  "layerGainDb": None, "cueGainDb": None, "trimDb": None},
 "cues": [],
}

def main():
    rows = []
    for f in ("manifest_sfx.json", "manifest_ui.json", "manifest_ambience.json"): rows += json.load(open(os.path.join(HERE, f)))
    checks = {c["file"]: c for c in json.load(open(os.path.join(PKG, "reference", "checks", "checks.json")))}
    files = []
    for r in rows:
        c = checks.get(r["file"], {})
        files.append(dict(file=r["file"], repoPath=r["repo_path"], cue=r["id"], root=r.get("root"), variant=r.get("variant"),
                          loop=bool(r.get("loop")), seconds=c.get("seconds", r["seconds"]), samples=c.get("decoded_samples"),
                          maxMomentaryLufs=c.get("max_momentary"), truePeakDbtp=c.get("tp_ffmpeg"), rmsDb=c.get("rms_db"),
                          integratedLufs=c.get("integrated") if r.get("loop") else None, checkIssues=c.get("issues"), master=r["master"]))
    # music lane files (assets/music, copied from the music lane; measured in sources/music/checks.json)
    ms = json.load(open(os.path.join(REPO, "public", "audio", "music", "music-spec.json")))
    mc = {c["file"]: c for c in json.load(open(os.path.join(HERE, "music", "checks.json")))["files"]}
    TOKENS["music"].update(layerGainDb=ms["mix"]["layer_gain_db"], cueGainDb=ms["mix"]["cue_gain_db"], trimDb=ms["mix"]["music_trim_db"])
    assert ms["mix"]["levelup_with_sfx_db"] == TOKENS["music"]["levelupWithSfxDb"]
    for m in ms["manifest"]:
        if m["path"].startswith("previews/"): continue          # the music preview lives in previews/, not in assets
        c = mc.get(m["path"], {}); stem = os.path.basename(m["path"])[:-4]; parts = stem.split("_")
        files.append(dict(file="assets/music/" + m["path"], repoPath="public/audio/music/" + m["path"], cue="_".join(parts[:-1]) if m["path"].startswith("stems/") or parts[1] in ("levelup", "fault") else "_".join(parts[:3]),
                          root=parts[-1], variant=None, loop=m["path"].startswith("stems/"), seconds=c.get("seconds"), samples=c.get("samples"),
                          maxMomentaryLufs=None, truePeakDbtp=c.get("ogg_tp_dbtp"), rmsDb=None, integratedLufs=c.get("ogg_lufs"), checkIssues=c.get("issues", []), master="sources/music/masters/" + m["path"].replace(".ogg", ".wav")))
    json.dump(dict(generated_by="sources/build_manifest.py", files=files), open(os.path.join(PKG, "assets", "manifest.json"), "w"), indent=1)
    by = {}
    for r in rows: by.setdefault(r["id"], []).append(r)
    for id, (bus, duck, prio, rl) in CUES.items():
        rs = by[id]; pitched = rs[0]["pitched"]
        TOKENS["cues"].append(dict(id=id, bus=bus, duckClass=duck, priority=prio, pitched=pitched,
            transpose=("perKeyFile" if id == "level_up" else "nearestRootRate" if pitched else "fixed"),
            files=sorted(set(r["repo_path"].replace("public/", "") for r in rs)),
            fileLevel=rs[0]["level"], trigger=rs[0]["trigger"], **rl))
    json.dump(TOKENS, open(os.path.join(PKG, "mix-tokens.json"), "w"), indent=1, ensure_ascii=False)
    with open(os.path.join(REPO, "src", "app", "audio", "mixTokens.ts"), "w") as fh:
        fh.write("// Generated from mix-tokens.json by sources/build_manifest.py. Do not edit by hand: edit the generator, re-run.\n")
        fh.write("// READ-ONLY APP DATA. Do not edit this file, not even to test a number.\n")
        fh.write("// The game reads it; nothing writes it. Source: docs/pipeline-city-audio (mix-tokens.json).\n\n")
        fh.write("export const MIX = " + json.dumps(TOKENS, indent=1, ensure_ascii=False) + " as const;\n\n")
        fh.write("export type CueId = (typeof MIX.cues)[number]['id'];\nexport type BusId = keyof typeof MIX.buses;\n")
        fh.write("export type KeyName = (typeof MIX.transpose.keyNames)[number];\n")
    print(len(files), "files;", len(TOKENS["cues"]), "cues")

if __name__ == "__main__": main()
