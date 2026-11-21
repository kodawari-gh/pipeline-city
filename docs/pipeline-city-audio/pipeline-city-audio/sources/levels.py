"""Per-category loudness targets: max momentary loudness (BS.1770, 400 ms window) of each file, in LUFS.
Mirrors mix-tokens.json "fileTargets". Peaks always <= -1.2 dBTP (files) / -1 dBTP (mix)."""
TARGETS = {
    "ui.micro": -38.0,      # hover, focus move, slider tick
    "ui.tick": -42.0,       # tutorial typing tick (plays many times)
    "ui.action": -32.0,     # click, back, toggle, value, tab, panel, pickup, notify
    "ui.transition": -30.0, # screen transitions
    "ui.important": -28.0,  # confirm, error, warn
    "sfx.minor": -26.0,     # ecc, key plug/eject, decline, bill, contract, speed
    "sfx.standard": -23.0,  # install, swap, cable, net, purchase, drop, expire, pause/resume
    "sfx.key": -20.0,       # job fulfilled, payout, power on, POST, crash, hard fault
    "sfx.stinger": -18.0,   # level-up
}
AMBIENCE = {"amb_room_city_loop": -40.0, "amb_machine_hum_loop": -38.0}   # integrated loudness of the loop
