"""Gameplay SFX for Pipeline City. Pitched cues are rendered at 4 roots (F, Gs, B, D) so every game key is <= 1 semitone
away (playbackRate). The level-up stinger is rendered in all 12 keys. Unpitched cues are rendered once.
Run: /workspace/audio/.venv/bin/python gen_sfx.py   (writes assets/sfx/*.ogg, sources/masters/sfx/*.wav, sources/manifest_sfx.json)"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from sfxlib import *
from levels import TARGETS

def mono(n): return np.zeros(int(n * SR))
cues = {}   # id -> (family, level, pitched, fn(o) -> mono/stereo array, trigger)

def C(id, family, level, pitched, trigger):
    def deco(fn): cues[id] = (family, level, pitched, fn, trigger); return fn
    return deco

# registers (§0.5): build C4-C5, flow/jobs C5-C6, failure C2-C3; o = render-root offset from F
B = lambda o: 65 + o; FL = lambda o: 77 + o; MD = lambda o: 53 + o; LO = lambda o: 41 + o

@C("job_fulfilled", "flow", "sfx.key", True, "note kind 'job' (key N holds its result); also Phase 'flashing' -> done")
def _(o):
    x = mono(1.6)
    place(x, cue_pluck(hz(deg(FL(o), 4)), 0.8, 0.28), 0.0)
    place(x, cue_pluck(hz(deg(FL(o), 7)), 0.9, 0.34), 0.075)
    place(x, glint(hz(deg(FL(o), 9) + 12), 0.25, 0.12), 0.15)
    return echo_tail(cut(x, 0.75))

@C("payout", "flow", "sfx.key", True, "note kind 'payout' (key N ...: $X), not late")
def _(o):
    x = mono(1.2)
    for i, d in enumerate([0, 2, 4, 7]):
        place(x, cue_pluck(hz(deg(FL(o), d)), 0.55 + 0.1 * i, 0.22), i * 0.055)
    for i, d in enumerate([4, 7, 9]):
        place(x, glint(hz(deg(FL(o), d) + 12), 0.18, 0.06), 0.24 + i * 0.045)
    return echo_tail(cut(x, 0.7))

@C("payout_late", "flow", "sfx.standard", True, "note kind 'payout' whose text ends '(late)'")
def _(o):
    x = mono(0.9)
    place(x, cue_pluck(hz(deg(FL(o), 4)), 0.6, 0.22), 0)
    place(x, cue_pluck(hz(deg(FL(o), 2)), 0.5, 0.26), 0.09)
    return echo_tail(cut(x, 0.6), gain_db=-15)

@C("install", "build", "sfx.standard", True, "note kind 'install' '... installed in <slot>' / board / case / OS installed / placed next to the monitor")
def _(o):
    x = mono(0.7)
    place(x, click(2600, 0.5, 0.02, 1.0, 0.003), 0); place(x, thump(140, 0.5, 0.1, 0.025), 0)
    place(x, cue_pluck(hz(deg(B(o), 0)), 0.7, 0.2), 0.012)
    place(x, cue_pluck(hz(deg(B(o), 4)), 0.35, 0.16), 0.07)
    return x

@C("uninstall", "build", "sfx.standard", True, "note kind 'install' '... removed' / 'came off'; ToSim uninstall, sell of an installed part")
def _(o):
    x = mono(0.6)
    place(x, click(1800, 0.45, 0.02, 1.0, 0.003), 0)
    place(x, cue_pluck(hz(deg(B(o), 4)), 0.5, 0.16), 0.01)
    place(x, cue_pluck(hz(deg(B(o), 0)), 0.45, 0.2), 0.08)
    return x

@C("swap_queued", "build", "sfx.standard", True, "note kind 'install' '... will be swapped in as soon as the job is done' (swapInstall queued, pendingSwaps grows)")
def _(o):
    x = mono(0.7)
    place(x, click(3000, 0.3, 0.015), 0)
    place(x, soft_pluck(hz(deg(B(o), 2)), 0.6, 0.18), 0.0)
    place(x, soft_pluck(hz(deg(B(o), 4)), 0.4, 0.2), 0.13)
    return x

@C("swap_done", "build", "sfx.standard", True, "swapMany fitted parts: one or more 'installed in' notes in the same tick while pendingSwaps empties (old part back to inventory)")
def _(o):
    x = mono(0.9)
    place(x, click(1800, 0.4, 0.02), 0); place(x, cue_pluck(hz(deg(B(o), 2)), 0.4, 0.14), 0.005)
    place(x, click(2800, 0.5, 0.02), 0.12); place(x, thump(150, 0.45, 0.1, 0.02), 0.12)
    place(x, cue_pluck(hz(deg(B(o), 0)), 0.6, 0.18), 0.13)
    place(x, cue_pluck(hz(deg(B(o), 4)), 0.55, 0.18), 0.19)
    place(x, cue_pluck(hz(deg(B(o), 7)), 0.6, 0.24), 0.25)
    return x

@C("swap_cancelled", "build", "sfx.minor", True, "note kind 'install' 'queued install(s) cancelled' / 'a queued swap was dropped'")
def _(o):
    x = mono(0.5)
    place(x, soft_pluck(hz(deg(B(o), 4)), 0.5, 0.15), 0); place(x, soft_pluck(hz(deg(B(o), 2)), 0.4, 0.18), 0.1)
    return x

@C("cable_connect", "build", "sfx.standard", True, "note kind 'cable' '... connected' / 'Ethernet cable connected to ...'")
def _(o):
    x = mono(0.7)
    place(x, thump(180, 0.6, 0.08, 0.02), 0); place(x, click(1300, 0.5, 0.02, 0.8, 0.005), 0)
    place(x, cue_pluck(hz(deg(B(o), 0)), 0.55, 0.16), 0.02)
    place(x, cue_pluck(hz(deg(B(o), 4)), 0.7, 0.22), 0.09)
    return x

@C("cable_disconnect", "build", "sfx.standard", True, "note kind 'cable' '... disconnected' (player pulled it)")
def _(o):
    x = mono(0.6)
    place(x, click(1500, 0.45, 0.02, 0.8, 0.004), 0)
    place(x, cue_pluck(hz(deg(B(o), 4)) * 2 ** (-25 / 1200), 0.5, 0.15), 0.01)
    place(x, cue_pluck(hz(deg(B(o), 0)) * 2 ** (-25 / 1200), 0.45, 0.2), 0.08)
    return x

@C("cable_unplugged", "build", "sfx.standard", True, "note kind 'cable' '... came unplugged' (side effect; collapse repeats in one tick)")
def _(o):
    x = mono(0.7)
    place(x, click(1100, 0.4, 0.025, 0.8, 0.005), 0)
    place(x, cue_pluck(hz(deg(MD(o), 4)) * 2 ** (-35 / 1200), 0.55, 0.18, 0.7), 0.01)
    place(x, cue_pluck(hz(deg(MD(o), 0)) * 2 ** (-35 / 1200), 0.5, 0.24, 0.7), 0.1)
    return x

@C("key_plug", "flow", "sfx.minor", True, "note kind 'key' 'key N plugged in'")
def _(o):
    x = mono(0.4)
    place(x, click(4200, 0.5, 0.012, 1.5, 0.002), 0); place(x, click(2400, 0.4, 0.015), 0.03)
    place(x, glint(hz(deg(FL(o), 4)), 0.5, 0.07), 0.035)
    return x

@C("key_eject", "flow", "sfx.minor", False, "a key leaves the port: KeyStage 'done' / keyActivity 'done' -> 'none', ToSim ejectKey; note 'key N pulled before the job finished' uses key_refused")
def _(o):
    x = mono(0.2)
    place(x, click(2400, 0.45, 0.015), 0); place(x, click(4200, 0.35, 0.012, 1.5, 0.002), 0.035)
    return x

@C("key_refused", "flow", "sfx.minor", True, "note kind 'key' '... refused: needs ...' or '... pulled before the job finished'")
def _(o):
    x = mono(0.5)
    place(x, soft_pluck(hz(deg(MD(o), 1)), 0.6, 0.14), 0); place(x, soft_pluck(hz(deg(MD(o), 0)), 0.55, 0.18), 0.09)
    return x

@C("new_clients", "flow", "sfx.standard", True, "note kind 'key' 'your first client told two friends ...'")
def _(o):
    x = mono(1.0)
    for i, d in enumerate([0, 4, 7, 9, 11]):
        place(x, glint(hz(deg(FL(o), d)), 0.4, 0.08), i * 0.06)
    return echo_tail(cut(x, 0.55))

@C("net_link_up", "flow", "sfx.standard", True, "snapshot.net.state changes to 'link-up' from 'no-device'/'no-cable'/'no-os'/'down' (note 'net' 'link up: ...' only the first time)")
def _(o):
    x = mono(0.9)
    for i, d in enumerate([0, 4, 7]):
        place(x, glint(hz(deg(FL(o), d)), 0.55, 0.09), i * 0.07)
    place(x, cue_pluck(hz(deg(FL(o), 7)), 0.45, 0.25), 0.14)
    return x

@C("net_saturated", "flow", "sfx.standard", True, "snapshot.net.state changes to 'saturated'")
def _(o):
    x = mono(0.7)
    for i in range(7):
        place(x, glint(hz(deg(FL(o), 7 if i % 2 == 0 else 9)), 0.35 + 0.05 * (i % 3), 0.05), i * 0.035)
    b, a = signal.butter(2, 5000 / (SR / 2)); return signal.lfilter(b, a, x)

@C("net_down", "flow", "sfx.standard", True, "snapshot.net.state changes from 'link-up'/'saturated' to 'down'/'no-cable'/'no-os'/'no-device'")
def _(o):
    x = mono(0.8)
    place(x, glint(hz(deg(FL(o), 4)), 0.55, 0.1), 0)
    place(x, bend_tone(hz(deg(FL(o), 0)), hz(deg(FL(o), 0)) * 2 ** (-45 / 1200), 0.45, 0.45, 0.14, 2), 0.09)
    return x

@C("ecc", "flow", "sfx.minor", True, "note kind 'ecc' (ECC corrected a flipped bit); rate limit 1 per 2 s")
def _(o):
    x = mono(0.3)
    place(x, glint(hz(deg(FL(o), 6) + 12), 0.5, 0.05), 0); place(x, glint(hz(deg(FL(o), 9) + 12), 0.3, 0.04), 0.03)
    return x

@C("power_on", "build", "sfx.key", True, "note kind 'power' 'powered on' (ToSim powerButton), also 'the power company reconnected the wall'")
def _(o):
    x = mono(1.2)
    place(x, click(900, 0.6, 0.03, 0.7, 0.006), 0); place(x, thump(90, 0.5, 0.15, 0.04), 0)
    place(x, bend_tone(hz(deg(MD(o), 0)), hz(deg(B(o), 0)), 0.6, 0.35, None, 5), 0.02)
    place(x, cue_pluck(hz(deg(B(o), 4)), 0.6, 0.26), 0.5)
    place(x, cue_pluck(hz(deg(B(o), 7)), 0.45, 0.3), 0.56)
    return x

@C("power_off", "build", "sfx.standard", True, "note kind 'power' 'powered off'")
def _(o):
    x = mono(0.9)
    place(x, click(900, 0.5, 0.03, 0.7, 0.006), 0)
    place(x, bend_tone(hz(deg(B(o), 0)), hz(deg(MD(o), 0)), 0.55, 0.4, 0.22, 5), 0.01)
    return x

@C("post_boot", "build", "sfx.standard", True, "Phase enters 'posting' (power on, or the reboot after a crash); one per boot")
def _(o):
    x = mono(1.2)
    for i, d in enumerate([0, 1, 2, 4, 5, 7]):
        place(x, cue_pluck(hz(deg(B(o), d)), 0.32 + 0.06 * i, 0.15), i * 0.07)
    return x

@C("boot_ready", "build", "sfx.minor", True, "Phase enters 'idle-os' (OS booted) or 'running' (no-OS flow) after posting")
def _(o):
    x = mono(0.8)
    place(x, soft_pluck(hz(deg(B(o), 7)), 0.6, 0.3), 0); place(x, glint(hz(deg(FL(o), 4)), 0.3, 0.1), 0.05)
    return x

@C("fault_crash", "failure", "sfx.key", True, "note kind 'fault' '...: the machine crashed and rebooted' (thermal error, VRM droop, protected-mode violation); errors +1")
def _(o):
    x = mono(1.4)
    place(x, thump(70, 0.6, 0.25, 0.08), 0)
    place(x, noise_sweep(2500, 250, 0.4, 0.12, "fall"), 0)
    place(x, cue_pluck(hz(deg(MD(o), 4)), 0.7, 0.3, 0.55), 0.0)
    place(x, cue_pluck(hz(deg(MD(o), 0)), 0.75, 0.45, 0.5), 0.2)
    return x

@C("fault_hard", "failure", "sfx.key", True, "note kind 'fault' 'the VRM burnt out' / 'the power company cut the wall' / 'the power cord was pulled' / 'hard power-off'; power.tripped false->true; Phase 'error'")
def _(o):
    x = mono(1.5)
    place(x, thump(55, 0.8, 0.35, 0.12), 0)
    ch = pad_chord([LO(o) + 12, LO(o) + 19, LO(o) + 24, LO(o) + 26], 1.4, 1.0, 0.25, 0.03, 0.9)
    place(x, ch * 2.2, 0.01)
    place(x, cue_pluck(hz(deg(MD(o), 0)), 0.5, 0.4, 0.45), 0.02)
    return x

@C("fault_soft", "failure", "sfx.standard", True, "note kind 'fault' 'POST failed' / 'memory fault ...' / 'a bit flipped ...: no ECC' / '... could not be fitted' and other fault notes")
def _(o):
    x = mono(0.9)
    place(x, bell(hz(deg(MD(o), 2)), 0.5, 0.8, 0.9, 2.0, 0.25), 0)
    place(x, bell(hz(deg(MD(o), 0)), 0.5, 0.8, 0.9, 2.0, 0.3), 0.12)
    return x

@C("client_drop", "failure", "sfx.standard", True, "note kind 'drop' (tray / offer list full: a client gave up)")
def _(o):
    x = mono(1.1)
    place(x, bell(hz(deg(FL(o) - 12, 4)), 0.6, 0.9, 1.2, 3.5, 0.3), 0)
    place(x, bend_tone(hz(deg(FL(o) - 12, 3)), hz(deg(FL(o) - 12, 3)) * 2 ** (-50 / 1200), 0.5, 0.4, 0.2, 3), 0.14)
    return x

@C("job_expired", "failure", "sfx.standard", True, "note kind 'expire' (a client took back job N)")
def _(o):
    x = mono(1.0)
    place(x, bend_tone(hz(deg(MD(o), 2)), hz(deg(MD(o), 0)) * 2 ** (-40 / 1200), 0.6, 0.6, None, 4), 0)
    return x

@C("job_declined", "flow", "sfx.minor", True, "note kind 'decline' (declined job N)")
def _(o):
    x = mono(0.4)
    place(x, click(1600, 0.3, 0.015), 0); place(x, soft_pluck(hz(deg(MD(o), 4)), 0.5, 0.14), 0.005)
    return x

@C("purchase", "build", "sfx.standard", True, "note kind 'purchase' 'bought ...'")
def _(o):
    x = mono(0.7)
    place(x, click(3500, 0.3, 0.012), 0)
    place(x, cue_pluck(hz(deg(B(o), 4)), 0.55, 0.15), 0.0); place(x, cue_pluck(hz(deg(B(o), 7)), 0.6, 0.2), 0.065)
    place(x, glint(hz(deg(FL(o), 9)), 0.2, 0.06), 0.12)
    return x

@C("sell", "build", "sfx.standard", True, "note kind 'purchase' 'sold ... for $N'")
def _(o):
    x = mono(0.6)
    place(x, cue_pluck(hz(deg(B(o), 7)), 0.5, 0.15), 0.0); place(x, cue_pluck(hz(deg(B(o), 4)), 0.5, 0.2), 0.065)
    return x

@C("bill_issued", "failure", "sfx.minor", True, "note kind 'bill' 'power bill: $N ...'")
def _(o):
    x = mono(0.8)
    place(x, bell(hz(deg(MD(o), 0)), 0.5, 0.6, 0.8, 2.0, 0.2), 0); place(x, bell(hz(deg(MD(o), 0)), 0.4, 0.6, 0.8, 2.0, 0.22), 0.16)
    return x

@C("bill_paid", "failure", "sfx.minor", True, "note kind 'bill' 'paid the power bill: $N'")
def _(o):
    x = mono(0.7)
    place(x, bell(hz(deg(MD(o), 4)), 0.5, 0.6, 0.8, 2.0, 0.2), 0); place(x, bell(hz(deg(MD(o), 7)), 0.5, 0.6, 0.8, 2.0, 0.25), 0.1)
    return x

@C("contract_accepted", "flow", "sfx.minor", True, "note kind 'contract' '...: <kind> accepted on <drive>'")
def _(o):
    x = mono(0.8)
    place(x, bell(hz(deg(FL(o), 0)), 0.45, 0.8, 1.0, 3.0, 0.3), 0); place(x, bell(hz(deg(FL(o), 4)), 0.45, 0.8, 1.0, 3.0, 0.3), 0.03)
    return x

@C("contract_ended", "flow", "sfx.minor", True, "note kind 'contract' '...: <kind> <word>' (any other contract note)")
def _(o):
    x = mono(0.8)
    place(x, bell(hz(deg(FL(o), 4)), 0.45, 0.8, 1.0, 3.0, 0.3), 0); place(x, bell(hz(deg(FL(o), 2)), 0.4, 0.8, 1.0, 3.0, 0.3), 0.1)
    return x

# ---- unpitched / fixed (never transposed) ----
@C("pause", "time", "sfx.standard", False, "speed signal becomes 0 (Space / HUD 'Pause' / Paused menu open / popupPause / crash)")
def _(o):
    x = mono(0.45)
    place(x, noise_sweep(3000, 350, 0.38, 0.25, "fall"), 0)
    place(x, bend_tone(330, 150, 0.36, 0.35, 0.12, 3), 0)
    place(x, click(2000, 0.25, 0.015), 0)
    return x

@C("resume", "time", "sfx.standard", False, "speed signal leaves 0 (resume at lastRunSpeed or a chosen speed)")
def _(o):
    x = mono(0.4)
    place(x, noise_sweep(400, 3200, 0.3, 0.22, "rise"), 0)
    place(x, bend_tone(160, 330, 0.3, 0.3, None, 3), 0)
    place(x, click(3000, 0.3, 0.012), 0.27)
    return x

@C("speed_up", "time", "sfx.minor", False, "speed signal rises between two non-zero speeds (also Build run speeds 1/4/16/64)")
def _(o):
    x = mono(0.2); place(x, click(2400, 0.5, 0.015), 0); place(x, click(4200, 0.5, 0.012), 0.055); return x

@C("speed_down", "time", "sfx.minor", False, "speed signal falls between two non-zero speeds")
def _(o):
    x = mono(0.2); place(x, click(4200, 0.5, 0.012), 0); place(x, click(2200, 0.5, 0.015), 0.055); return x

def level_up(key_pc):
    """Stinger in the NEW key (open voicing root, 5th, 9th, 3rd up an octave; #4 stays in the music bed)."""
    root = 48 + ((key_pc - 0) % 12)        # C3..B3
    x = mono(2.6)
    ch = pad_chord([root, root + 7, root + 14, root + 16], 2.4, 1.0, 0.5, 0.05, 1.4)
    place(x, ch * 1.6, 0.0)
    for i, m in enumerate([root + 12, root + 19, root + 26, root + 28, root + 31]):
        place(x, cue_pluck(hz(m), 0.55 + 0.05 * i, 0.3), i * 0.06)
    place(x, glint(hz(root + 36), 0.25, 0.15), 0.32)
    return echo_tail(x, gain_db=-14)

if __name__ == "__main__":
    rows = []
    for id, (family, lvl, pitched, fn, trig) in cues.items():
        for rname, off in (ROOTS.items() if pitched else [("fixed", 0)]):
            x = fn(off); x = small_room(x, 0.10)
            name = f"{id}__{rname}" if pitched else id
            rows.append(save("sfx", name, x, TARGETS[lvl], dict(id=id, family=family, level=lvl, pitched=pitched,
                             root=(rname if pitched else None), trigger=trig)))
    for pc in range(12):
        k = KEY_NAMES[pc]
        x = small_room(level_up(pc), 0.12)
        rows.append(save("sfx", f"level_up__{k}", x, TARGETS["sfx.stinger"], dict(id="level_up", family="milestone", level="sfx.stinger",
                         pitched=True, root=k, trigger="note kind 'level' / levelUp signal; play the file of the NEW key on the next bar line, rate 1.0")))
    json.dump(rows, open(os.path.join(HERE, "manifest_sfx.json"), "w"), indent=1)
    print(len(rows), "sfx files")
