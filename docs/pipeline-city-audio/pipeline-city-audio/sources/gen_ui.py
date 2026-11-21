"""Menu and HUD UI sounds (fixed, unpitched: never transposed). Short, soft, dry; round-robin variants for the
sounds that repeat a lot. Matched to the AD handoff screens (SPEC §4-§10 of pipeline-city-menu-ui).
Run: /workspace/audio/.venv/bin/python gen_ui.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from sfxlib import *
from levels import TARGETS

def mono(n): return np.zeros(int(n * SR))
def lp(x, fc): b, a = signal.butter(2, fc / (SR / 2)); return signal.lfilter(b, a, x)
ui = {}
def U(id, level, use, variants=1):
    def deco(fn): ui[id] = (level, fn, use, variants); return fn
    return deco

@U("ui_hover", "ui.micro", "pointer enters a row, tag, tab, value or HUD item ((hover: hover) devices only)", 3)
def _(v):
    x = mono(0.05); place(x, click([5200, 5600, 4900][v], 0.6, 0.02, 1.4, 0.0022), 0); return lp(x, 9000)

@U("ui_focus_move", "ui.micro", "keyboard focus moves (chip slides 120 ms): arrows on spines, rails, tabs; Home/End", 2)
def _(v):
    x = mono(0.08); place(x, click([4300, 4700][v], 0.5, 0.02, 1.2, 0.003), 0)
    place(x, noise_sweep(2500, 5000, 0.06, 0.12, "arch"), 0.005); return lp(x, 8000)

@U("ui_click", "ui.action", "activate a row / text button / dock item / HUD item (click, tap, Enter, Space)", 2)
def _(v):
    x = mono(0.09); place(x, click([3200, 3500][v], 0.7, 0.025, 1.0, 0.004), 0); place(x, thump(240, 0.35, 0.05, 0.008), 0); return lp(x, 9000)

@U("ui_back", "ui.action", "'← Back', Esc that closes a screen or panel, Cancel on Load confirm")
def _(v):
    x = mono(0.14); place(x, click(2200, 0.6, 0.025, 1.0, 0.004), 0); place(x, thump(170, 0.35, 0.06, 0.01), 0)
    place(x, noise_sweep(3000, 900, 0.08, 0.15, "fall"), 0.01); return lp(x, 7000)

@U("ui_toggle_on", "ui.action", "branch value Off -> On (Tutorial On, Auto-adjust On, Zoom slow ON, Tools 'Show ...')")
def _(v):
    x = mono(0.1); place(x, click(2200, 0.5, 0.02), 0); place(x, click(3800, 0.6, 0.02), 0.035); return lp(x, 9000)

@U("ui_toggle_off", "ui.action", "branch value On -> Off")
def _(v):
    x = mono(0.1); place(x, click(3800, 0.5, 0.02), 0); place(x, click(2000, 0.55, 0.02), 0.035); return lp(x, 8000)

@U("ui_value_change", "ui.action", "← → or click on a value branch (Campaign/Sandbox, Preset Low..Ultra, Device, Frame limit, LIGHT/DETAIL rows)")
def _(v):
    x = mono(0.08); place(x, click(2800, 0.55, 0.02, 1.0, 0.003), 0); place(x, noise_sweep(1800, 3600, 0.05, 0.12), 0.01); return lp(x, 8000)

@U("ui_tab_switch", "ui.action", "stage tab change (Settings: Quality/Display/Light/Detail/Interface; Controls: Mouse/View/Game); Build category rail tag")
def _(v):
    x = mono(0.1); place(x, click(3000, 0.55, 0.02), 0); place(x, noise_sweep(1500, 3500, 0.07, 0.18), 0.01); return lp(x, 8000)

@U("ui_slider_tick", "ui.micro", "slider moves one 5 % step (Render scale, Brightness, UI size); rate-limited", 2)
def _(v):
    x = mono(0.03); place(x, click([6000, 6400][v], 0.6, 0.012, 1.6, 0.0015), 0); return lp(x, 10000)

@U("ui_confirm", "ui.important", "WB commit: 'Start' / 'Replace save and start', 'Replace save and load', 'Save now', Benchmark start")
def _(v):
    x = mono(0.3); place(x, click(2600, 0.6, 0.025), 0); place(x, thump(200, 0.4, 0.07, 0.012), 0)
    place(x, noise_sweep(1200, 6000, 0.2, 0.18, "rise"), 0.02); place(x, click(4200, 0.6, 0.02), 0.22); return lp(x, 9000)

@U("ui_error", "ui.important", "refused action: toast '[ no ]', unreadable file, invalid drop, a ToSim reply with an error (lastError)")
def _(v):
    x = mono(0.22); place(x, thump(150, 0.7, 0.08, 0.02), 0); place(x, thump(118, 0.7, 0.1, 0.025), 0.075)
    place(x, lp(click(900, 0.4, 0.04, 0.8, 0.01), 2500), 0); return lp(x, 3000)

@U("ui_warn", "ui.important", "toast '[ !! ]', HUD notice in --c-warn")
def _(v):
    x = mono(0.16); place(x, thump(170, 0.6, 0.09, 0.025), 0); place(x, click(1800, 0.4, 0.02), 0.04); return lp(x, 5000)

@U("ui_notify", "ui.action", "toast '[ ok ]' ('Saved.' etc.)")
def _(v):
    x = mono(0.12); place(x, click(4800, 0.5, 0.015, 1.5, 0.002), 0); place(x, click(6000, 0.4, 0.012, 1.5, 0.002), 0.05); return lp(x, 10000)

@U("ui_transition_in", "ui.transition", "Main menu -> sub-screen and Paused -> Settings/Controls (chip flash 80 ms, trace runs, 360 ms); studio enter (Build, Gallery)")
def _(v):
    x = mono(0.4); place(x, click(3600, 0.4, 0.015), 0); place(x, noise_sweep(600, 5000, 0.32, 0.4, "rise"), 0.06); return lp(x, 8000)

@U("ui_transition_out", "ui.transition", "sub-screen -> back (trace retracts, ~360 ms)")
def _(v):
    x = mono(0.38); place(x, noise_sweep(5000, 600, 0.3, 0.38, "fall"), 0); place(x, click(2000, 0.3, 0.015), 0.28); return lp(x, 7000)

@U("ui_panel_open", "ui.action", "Build flyout, inventory panel, machine list, Paused Files/Tools/Help list, Shop/Almanac/Log/OS panels open; 'Hold to peek' release")
def _(v):
    x = mono(0.14); place(x, noise_sweep(1000, 4000, 0.12, 0.25, "arch"), 0); place(x, click(3300, 0.4, 0.015), 0.0); return lp(x, 8000)

@U("ui_panel_close", "ui.action", "the same panels close; 'Hold to peek' press (layer fades out)")
def _(v):
    x = mono(0.14); place(x, noise_sweep(4000, 1000, 0.12, 0.25, "arch"), 0); place(x, click(2400, 0.35, 0.015), 0.1); return lp(x, 7000)

@U("ui_pickup", "ui.action", "drag a part from the shelf/flyout starts (Controls: 'Drag a part')")
def _(v):
    x = mono(0.08); place(x, click(1500, 0.6, 0.03, 0.8, 0.006), 0); place(x, thump(210, 0.4, 0.05, 0.01), 0); return lp(x, 6000)

@U("ui_type_tick", "ui.tick", "tutorial step meta types in (20 ms per char): play on every 3rd character, max 1 per 50 ms", 3)
def _(v):
    x = mono(0.02); place(x, click([7000, 7600, 6600][v], 0.6, 0.008, 1.8, 0.0012), 0); return lp(x, 11000)

if __name__ == "__main__":
    rows = []
    for id, (lvl, fn, use, nv) in ui.items():
        for v in range(nv):
            name = id if nv == 1 else f"{id}_{v + 1}"
            rows.append(save("ui", name, fn(v), TARGETS[lvl], dict(id=id, family="ui", level=lvl, pitched=False, root=None,
                             variant=(v + 1 if nv > 1 else None), trigger=use)))
    json.dump(rows, open(os.path.join(HERE, "manifest_ui.json"), "w"), indent=1)
    print(len(rows), "ui files")
    for r in rows: print(f"{r['file']:40} {r['seconds']:6} M={r['max_m']} tp={r['tp']}")
