# SFX preview reel: a game moment

Built from the shipped Ogg files. Pitched cues use the 4-root files; after the level-up (22.0 s) the key is C Lydian, so pitched cues play the B-root file at playbackRate 2^(1/12). A very quiet Afterglow-style pad (preview-only, NOT a shipped asset; the music lane makes the real stems) sits under the cues, with ducking from mix-tokens.json, and a low-pass stand-in for the pause hold (25.4-27.0 s). Room ambience all through; machine hum from power-on.

Measured: -16.3 LUFS integrated, -1.4 dBTP true peak, 30.0 s.

| time (s) | game event / UI action | file | bus |
|---:|---|---|---|
| 0.00 | ambience | `assets/ambience/amb_room_city_loop.ogg (loop until 30.0 s)` | ambience |
| 0.00 | music stand-in | `(preview-only pad, F Lydian, level 1)` | music |
| 0.30 | click dock 'Inventory 1' | `assets/ui/ui_click_1.ogg` | ui |
| 0.55 | inventory panel opens | `assets/ui/ui_panel_open.ogg` | ui |
| 1.40 | drag a CPU from the shelf | `assets/ui/ui_pickup.ogg` | ui |
| 2.00 | note 'install': CPU installed in cpu0 | `assets/sfx/install__F.ogg` | sfx |
| 3.00 | note 'install': RAM installed in dimm1 | `assets/sfx/install__F.ogg` | sfx |
| 3.90 | note 'cable': 24-pin cable connected | `assets/sfx/cable_connect__F.ogg` | sfx |
| 4.90 | note 'cable': Ethernet cable connected to the board jack | `assets/sfx/cable_connect__F.ogg` | sfx |
| 5.80 | note 'power': powered on | `assets/sfx/power_on__F.ogg` | sfx |
| 5.90 | ambience | `assets/ambience/amb_machine_hum_loop.ogg (loop until 30.0 s)` | ambience |
| 7.00 | Phase 'posting' | `assets/sfx/post_boot__F.ogg` | sfx |
| 8.30 | Phase 'idle-os' | `assets/sfx/boot_ready__F.ogg` | sfx |
| 9.20 | note 'key': key 3 plugged in | `assets/sfx/key_plug__F.ogg` | sfx |
| 10.00 | net.state -> 'link-up' | `assets/sfx/net_link_up__F.ogg` | sfx |
| 11.30 | note 'job': key 3 holds its result | `assets/sfx/job_fulfilled__F.ogg` | sfx |
| 12.20 | note 'payout': key 3 returned: $40 | `assets/sfx/payout__F.ogg` | sfx |
| 13.60 | note 'purchase': bought fan | `assets/sfx/purchase__F.ogg` | sfx |
| 14.40 | note 'install': ... will be swapped in as soon as the job is done | `assets/sfx/swap_queued__F.ogg` | sfx |
| 15.60 | swapMany: queued part fitted | `assets/sfx/swap_done__F.ogg` | sfx |
| 16.60 | note 'ecc' | `assets/sfx/ecc__F.ogg` | sfx |
| 17.30 | net.state -> 'saturated' | `assets/sfx/net_saturated__F.ogg` | sfx |
| 18.30 | note 'drop': tray full: a client gave up | `assets/sfx/client_drop__F.ogg` | sfx |
| 19.20 | note 'fault': thermal error: the machine crashed and rebooted | `assets/sfx/fault_crash__F.ogg` | sfx |
| 20.60 | Phase 'posting' (reboot) | `assets/sfx/post_boot__F.ogg` | sfx |
| 22.00 | music stand-in | `(preview-only pad, C Lydian, level 2)` | music |
| 22.00 | note 'level': Level 2 (key F -> C Lydian on the bar) | `assets/sfx/level_up__C.ogg` | sfx |
| 24.20 | note 'payout' in the new key | `assets/sfx/payout__B.ogg @ playbackRate 1.0595 (+1 st)` | sfx |
| 25.40 | speed -> 0 (Space) | `assets/sfx/pause.ogg` | sfx |
| 27.00 | speed 0 -> 4 (resume 1x) | `assets/sfx/resume.ogg` | sfx |
| 27.80 | speed 4 -> 8 (2x) | `assets/sfx/speed_up.ogg` | sfx |
| 28.50 | note 'cable': video cable connected (new key) | `assets/sfx/cable_connect__B.ogg @ playbackRate 1.0595 (+1 st)` | sfx |
