# Menu and UI sounds reel (AD screens 01, 06, 04, 11, HUD toasts, 10)

Built from the shipped Ogg files over the room ambience and a very quiet preview-only pad (not a shipped asset). Screens from /workspace/menu-review/handoff/pipeline-city-menu-ui SPEC §5, §7, §8, §10. Bus levels from mix-tokens.json.

Measured: -19.5 LUFS integrated, -1.4 dBTP true peak, 21.0 s.

| time (s) | game event / UI action | file | bus |
|---:|---|---|---|
| 0.00 | ambience | `assets/ambience/amb_room_city_loop.ogg (loop until 21.0 s)` | ambience |
| 0.00 | music stand-in | `(preview-only pad, F Lydian, menu)` | music |
| 0.30 | 01 Main menu: pointer over 'New game' | `assets/ui/ui_hover_1.ogg` | ui |
| 0.75 | pointer over 'Build my PC' | `assets/ui/ui_hover_2.ogg` | ui |
| 1.20 | ↓ focus to 'Gallery' (chip slides) | `assets/ui/ui_focus_move_1.ogg` | ui |
| 1.60 | ↓ focus to 'Settings' | `assets/ui/ui_focus_move_2.ogg` | ui |
| 2.10 | Enter on 'Settings' | `assets/ui/ui_click_1.ogg` | ui |
| 2.18 | Main menu -> 06 Settings (trace extends) | `assets/ui/ui_transition_in.ogg` | ui |
| 3.00 | → tab 'Display' | `assets/ui/ui_tab_switch.ogg` | ui |
| 3.60 | → tab 'Light' | `assets/ui/ui_tab_switch.ogg` | ui |
| 4.20 | → value 'High' | `assets/ui/ui_value_change.ogg` | ui |
| 4.70 | → value 'Ultra' | `assets/ui/ui_value_change.ogg` | ui |
| 5.30 | slider 'UI size' +5 % step | `assets/ui/ui_slider_tick_1.ogg` | ui |
| 5.37 | slider step | `assets/ui/ui_slider_tick_2.ogg` | ui |
| 5.44 | slider step | `assets/ui/ui_slider_tick_1.ogg` | ui |
| 5.51 | slider step | `assets/ui/ui_slider_tick_2.ogg` | ui |
| 5.58 | slider step | `assets/ui/ui_slider_tick_1.ogg` | ui |
| 5.65 | slider step | `assets/ui/ui_slider_tick_2.ogg` | ui |
| 5.72 | slider step | `assets/ui/ui_slider_tick_1.ogg` | ui |
| 5.79 | slider step | `assets/ui/ui_slider_tick_2.ogg` | ui |
| 6.40 | 'Auto-adjust' Off -> On | `assets/ui/ui_toggle_on.ogg` | ui |
| 7.00 | 'Auto-adjust' On -> Off | `assets/ui/ui_toggle_off.ogg` | ui |
| 7.80 | 'Hold to peek' pressed (layer fades) | `assets/ui/ui_panel_close.ogg` | ui |
| 8.40 | 'Hold to peek' released | `assets/ui/ui_panel_open.ogg` | ui |
| 9.20 | Esc: back | `assets/ui/ui_back.ogg` | ui |
| 9.25 | 06 Settings -> Main menu (trace retracts) | `assets/ui/ui_transition_out.ogg` | ui |
| 10.20 | pointer over 'New game' | `assets/ui/ui_hover_3.ogg` | ui |
| 10.60 | click 'New game' | `assets/ui/ui_click_2.ogg` | ui |
| 10.68 | -> 04 New game | `assets/ui/ui_transition_in.ogg` | ui |
| 11.60 | → 'Sandbox' | `assets/ui/ui_value_change.ogg` | ui |
| 12.30 | WB 'Replace save and start' | `assets/ui/ui_confirm.ogg` | ui |
| 13.20 | 11 First frame: meta types in | `assets/ui/ui_type_tick_1.ogg` | ui |
| 13.26 | typing | `assets/ui/ui_type_tick_2.ogg` | ui |
| 13.32 | typing | `assets/ui/ui_type_tick_3.ogg` | ui |
| 13.38 | typing | `assets/ui/ui_type_tick_1.ogg` | ui |
| 13.44 | typing | `assets/ui/ui_type_tick_2.ogg` | ui |
| 13.50 | typing | `assets/ui/ui_type_tick_3.ogg` | ui |
| 13.56 | typing | `assets/ui/ui_type_tick_1.ogg` | ui |
| 13.62 | typing | `assets/ui/ui_type_tick_2.ogg` | ui |
| 14.20 | 'Next' (tutorial) | `assets/ui/ui_click_1.ogg` | ui |
| 15.00 | toast '[ ok ] Saved.' | `assets/ui/ui_notify.ogg` | ui |
| 15.80 | toast '[ no ]' unreadable file | `assets/ui/ui_error.ogg` | ui |
| 16.60 | toast '[ !! ]' | `assets/ui/ui_warn.ogg` | ui |
| 17.40 | Esc in game -> 10 Paused (clock stops) | `assets/sfx/pause.ogg` | sfx |
| 18.40 | ↓ in Paused | `assets/ui/ui_focus_move_1.ogg` | ui |
| 18.90 | ↑ back to 'Resume' | `assets/ui/ui_focus_move_2.ogg` | ui |
| 19.40 | Enter 'Resume' | `assets/ui/ui_click_2.ogg` | ui |
| 19.45 | clock restarts at 1x | `assets/sfx/resume.ogg` | sfx |
