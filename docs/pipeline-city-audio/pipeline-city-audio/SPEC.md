# Pipeline City audio: implementation spec

Status: v1, 2026-11-21. SFX, UI, ambience and music (Afterglow): complete first pass, synthesized and measured, **not yet heard by a person and not yet run in any browser** (KNOWN-ISSUES §2, §3).
Repo: read-only clone at `da577448`. All code names are real names from that tree. Style source: `reference/audio-style.md` (v2, direction B approved).

## 0. How to read this spec
### 0.1 Precedence
`mix-tokens.json` > this spec > `reference/audio-style.md` > previews. If a number here and in the tokens differ, the tokens win; report it.
### 0.2 Terms
- **Cue**: one named sound (`payout`). A cue has one or more **files** (render roots or round-robin variants).
- **Key**: the music key, F Lydian at level 1, up a fifth per level (§8). Key file tokens everywhere (SFX and music): `F C G D A E B Fs Cs Gs Ds As` (s = sharp). **Render root**: one of F, Gs, B, D, the four keys pitched cues are rendered in.
- **Bar**: 4 beats of the Afterglow clock (66 bpm → 3.64 s at run speed). Only the level-up stinger waits for it.
- **Max momentary**: the highest BS.1770 momentary loudness (400 ms window) of a file, in LUFS: how loud the cue is at its loudest. **dBTP**: true peak.
- **Note**: a `GameEvent { tick, kind, text }` in `snapshot.log` (written by `Game.note(kind, text)`, `src/worker/game/game.ts`). **State rule**: a cue fired by a change between two snapshots.

## 1. Decisions
Made by Khalil (2026-11-21, via Dev Lead): direction B Afterglow; key change on every level-up; Ogg only at 48 kHz; Safari < 18.4 unsupported (no `.m4a`); audio waits until after the POC for final assets (this package is the handoff for that work).

Decided here (the three open questions Dev Lead asked me to settle):
1. **Codec: Ogg Vorbis, quality 6 (~160-190 kbit/s), 48 kHz, stereo.** Reasons: (a) Safari 18.4+ (macOS 15.4, iOS 18.4) plays both Ogg Vorbis and Ogg Opus, Chrome / Edge / Firefox play both ([caniuse PR #7284](https://github.com/Fyrd/caniuse/pull/7284), [caniuse Opus](https://caniuse.com/opus)), so support does not separate them at our floor; caniuse still lists Safari desktop Opus as "partial". (b) Short cues gain nothing from Opus' low-bitrate efficiency: the whole SFX/UI/ambience set is 3.7 MB. (c) Every file here is encoded and measured as Vorbis; one codec for the whole game (the music lane uses the same). (d) Opus' fixed 48 kHz decode and pre-skip add a second set of edge cases for loops. Accepted cost: about 1.5-2x the bytes of Opus at equal quality.
2. **Event-cue clarity (the audio-style §0.5 to-do), adopted for the build:** event cues use bright 1.5 ms-attack plucks, decay ≤ 0.4 s, dry first hit, echo only on the tail at −12 dB; music and ambience **duck** under cues (−2 dB standard, −3 dB key cues, −4 dB failure and milestone; attack 10 ms, hold 150 ms, release 400 ms); **one register per family** (build C4–C5, flow/jobs C5–C6, failure C2–C3, milestone wide C3–C6); cue files sit 3–8 dB over the music bus (§7.2); at most 24 voices, low-priority voices stolen first. The music lane owns the loop-side half (thin loops to 4 voices when a cue fires, loop plucks softer than cue plucks).
3. **Volume sliders: yes.** Four sliders, Master / Music / Sounds (SFX + UI) / Ambience, 0–100 % in 5 % steps, default 100 % (= the designed mix), gain = (v/100)², stored per device in `localStorage["pipeline-city.audio"]` (not in the save), plus a "Mute" branch Off ━ On. Placement: Settings → Interface tab, under "UI size" (needs AD sign-off, KNOWN-ISSUES §1). **Hidden-tab fade: yes.** On `visibilitychange` to hidden: master fades to silence over 500 ms, the AudioContext is suspended after 2000 ms; on visible: resume, fade in over 800 ms. The game clock is not touched.

Music decisions (merge of the music lane, 2026-11-21):
4. **Level-up: keep both sounds.** The SFX stinger `level_up__{KEY}` and `music_levelup_{KEY}` play on the same bar in the new key; whenever the SFX stinger plays, the music stinger is at −6 dB (`mix-tokens.json` → `music.levelupWithSfxDb`).
5. **Music tempo is fixed at 66 bpm.** No tempo change from game speed or pause (`pause.musicHold.tempoScale = 1.0`). The pause darkening is built into `music_pausebed_{KEY}`; there is no extra pad low-pass and no extra music gain change in pause. Speed changes only density and brightness (§6.4).
6. **Menu music is always `music_menu_F`**; on the first game frame it crossfades (2 s, next menu bar) to the save's key.
7. **Music bus default stays −8 dB**; that covers the music's −1.0 dBTP worst-case peak with all layers on (KNOWN-ISSUES §5).
8. **Music keys are rendered in all 12 keys** (no `playbackRate` on loops; it would change their length); only the current and the next key are loaded (~67 MB decoded, KNOWN-ISSUES §4).

## 2. Palette
- **Synthetic first, organic touches:** plucked additive tones, sine glints and FM bells for pitched content; band-passed noise "latches", "thocks" and clicks for the physical acts (seating a part, a plug, a relay). No samples, no recordings.
- **Brightness:** cues bright on the attack, dark in the tail (upper partials decay 3x faster); UI low-passed at 6–11 kHz; failure cues low-passed and low.
- **Lengths:** UI 14–400 ms (all but four under 150 ms); gameplay ≤ 1.45 s; level-up stinger 2.9 s; ambience loops 24 s and 12 s.
- **Families and registers:** build (install, swap, cable, power, POST, purchase) C4–C5 · flow and jobs (job, payout, key, net, ecc, contract) C5–C6 · failure (fault, drop, expire, bill) C2–C4 · milestone (level-up) C3–C6 · time (pause, resume, speed) and UI: unpitched.
- **Key fit:** every pitched note is a tone of the current Lydian scale; chords are open (root, 5th, 9th, 3rd); the SFX leave out the #4 (it lives in the music bed and the music's ecc glint), so cues never clash with a key change.

## 3. Event-to-sound map
### 3.1 Notes (`snapshot.log`): rules, first match wins (`mix-tokens.json` → `logRules`)

| # | `GameEvent.kind` | `text` matches | Cue |
|---:|---|---|---|
| 1 | `install` | `/will be swapped in/` | `swap_queued` |
| 2 | `install` | `/queued installs? cancelled|queued swap was dropped/` | `swap_cancelled` |
| 3 | `install` | `/removed|came off/` | `uninstall` |
| 4 | `install` | `/installed|placed next to|formatted/` | `install` |
| 5 | `cable` | `/came unplugged/` | `cable_unplugged` |
| 6 | `cable` | `/disconnected/` | `cable_disconnect` |
| 7 | `cable` | `/connected/` | `cable_connect` |
| 8 | `power` | `/powered on|reconnected/` | `power_on` |
| 9 | `power` | `/powered off/` | `power_off` |
| 10 | `key` | `/refused|pulled before/` | `key_refused` |
| 11 | `key` | `/plugged in/` | `key_plug` |
| 12 | `key` | `/told two friends/` | `new_clients` |
| 13 | `job` | (any) | `job_fulfilled` |
| 14 | `payout` | `/\(late\)$/` | `payout_late` |
| 15 | `payout` | (any) | `payout` |
| 16 | `drop` | (any) | `client_drop` |
| 17 | `expire` | (any) | `job_expired` |
| 18 | `decline` | (any) | `job_declined` |
| 19 | `level` | (any) | `level_up` |
| 20 | `ecc` | (any) | `ecc` |
| 21 | `fault` | `/crashed and rebooted/` | `fault_crash` |
| 22 | `fault` | `/VRM burnt out|cut the wall|power cord was pulled|hard power-off/` | `fault_hard` |
| 23 | `fault` | (any) | `fault_soft` |
| 24 | `purchase` | `/^sold/` | `sell` |
| 25 | `purchase` | (any) | `purchase` |
| 26 | `bill` | `/^paid/` | `bill_paid` |
| 27 | `bill` | (any) | `bill_issued` |
| 28 | `contract` | `/accepted/` | `contract_accepted` |
| 29 | `contract` | (any) | `contract_ended` |
| 30 | `net` | `/link up/` | — (state rule plays net_link_up) |
| 31 | `net` | (any) | `ui_notify` |
| 32 | `sandbox` | (any) | `ui_notify` |

Text sources (grep `this.note(` in the repo): `parts.ts` (install, cable, fault), `machine.ts` (power, fault), `keys.ts` (key, payout, job, decline), `clients.ts` (drop, expire, level), `shop.ts` (purchase), `bill.ts` (bill, power, fault), `cloud.ts` (contract), `memory.ts` (ecc, fault), `os.ts` (install), `network.ts` (net), `sandbox.ts` (sandbox). If a note text changes in the repo, the rules must follow (ACCEPTANCE §3 has a test).

### 3.2 State rules (diff of the previous and the new `Snapshot`, main thread)

| Rule | Condition | Cue |
|---|---|---|
| Swap done | `pendingSwaps.length` decreased and the same snapshot brought an `install` "installed" note | `swap_done` **instead of** `install` |
| Link up | `net.state` → `"link-up"` from any state but `"saturated"` | `net_link_up` |
| Saturated | `net.state` → `"saturated"` | `net_saturated` |
| Link down | `net.state` from `"link-up"`/`"saturated"` → `"down"`, `"no-cable"`, `"no-os"`, `"no-device"` | `net_down` |
| POST | `phase` → `"posting"` | `post_boot` |
| Booted | `phase` → `"idle-os"`, or `"loading"` → `"running"` | `boot_ready` |
| Error | `phase` → `"error"` with no `fault` note in the same snapshot | `fault_hard` |
| PSU trip | `power.tripped` false → true with no `fault` note in the same snapshot | `fault_hard` |
| Key out | `plugged` non-null → null (or `keyActivity` `"done"` → `"none"`) with no `key` note | `key_eject` |
| Pause | `speed` signal → 0 (`togglePause`, HUD, Paused menu, `popupPause`, `crash`) | `pause` |
| Resume | `speed` 0 → non-zero | `resume` |
| Speed | non-zero → higher / lower non-zero (`SPEEDS`, Build `RUN_SPEEDS`) | `speed_up` / `speed_down` |
| Sim crash | `crash` signal set (`CrashReport`) | `ui_error` (the `pause` cue also plays via the speed rule) |
| Level-up | `note("level")` or the `levelUp` signal; play once per level | `level_up__<new key>` on the next bar, together with the music's key change and `music_levelup_<new key>` at −6 dB |

Skip all cues while `snapshot` goes from null to the first snapshot (load / new game), and when a save is loaded (one snapshot of silence).

### 3.3 Every cue
Files are under `assets/` (repo: `public/audio/`). Pitched cues ship 4 files (`__F`, `__Gs`, `__B`, `__D`); the game picks one per key (§8). Lengths and peaks are measured on the Ogg files (all roots / variants).

| Cue id | Trigger (real repo code) | File(s) under assets/ | Transpose | Bus | File level (max momentary LUFS) | Length s | Max TP dBTP | Duck | Rate limit ms/voices/collapse ms |
|---|---|---|---|---|---|---|---|---|---|
| `job_fulfilled` | note kind 'job' (key N holds its result); also Phase 'flashing' -> done | `sfx/job_fulfilled__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.key (-20.0) | 1.43–1.43 | -9.8 | key | 120/2/120 |
| `payout` | note kind 'payout' (key N ...: $X), not late | `sfx/payout__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.key (-20.0) | 1.38–1.41 | -9.4 | key | 120/2/150 |
| `payout_late` | note kind 'payout' whose text ends '(late)' | `sfx/payout_late__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 1.28–1.32 | -12.5 | standard | 120/2/150 |
| `install` | note kind 'install' '... installed in <slot>' / board / case / OS installed / placed next to the monitor | `sfx/install__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.70–0.74 | -9.5 | standard | 60/3/80 |
| `uninstall` | note kind 'install' '... removed' / 'came off'; ToSim uninstall, sell of an installed part | `sfx/uninstall__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.69–0.73 | -11.2 | standard | 60/3/80 |
| `swap_queued` | note kind 'install' '... will be swapped in as soon as the job is done' (swapInstall queued, pendingSwaps grows) | `sfx/swap_queued__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.70–0.71 | -13.2 | standard | 100/2/100 |
| `swap_done` | swapMany fitted parts: one or more 'installed in' notes in the same tick while pendingSwaps empties (old part back to inventory) | `sfx/swap_done__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.92–0.97 | -12.0 | standard | 200/1/300 |
| `swap_cancelled` | note kind 'install' 'queued install(s) cancelled' / 'a queued swap was dropped' | `sfx/swap_cancelled__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 0.61–0.70 | -16.9 | standard | 150/1/150 |
| `cable_connect` | note kind 'cable' '... connected' / 'Ethernet cable connected to ...' | `sfx/cable_connect__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.73–0.77 | -10.6 | standard | 80/2/100 |
| `cable_disconnect` | note kind 'cable' '... disconnected' (player pulled it) | `sfx/cable_disconnect__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.66–0.72 | -10.7 | standard | 80/2/100 |
| `cable_unplugged` | note kind 'cable' '... came unplugged' (side effect; collapse repeats in one tick) | `sfx/cable_unplugged__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.74–0.78 | -11.8 | standard | 150/1/250 |
| `key_plug` | note kind 'key' 'key N plugged in' | `sfx/key_plug__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 0.54–0.61 | -14.0 | standard | 80/2/80 |
| `key_eject` | a key leaves the port: KeyStage 'done' / keyActivity 'done' -> 'none', ToSim ejectKey; note 'key N pulled before the job finished' uses key_refused | `sfx/key_eject.ogg` | fixed | sfx | sfx.minor (-26.0) | 0.41–0.41 | -6.1 | — | 80/2/80 |
| `key_refused` | note kind 'key' '... refused: needs ...' or '... pulled before the job finished' | `sfx/key_refused__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 0.63–0.67 | -15.9 | standard | 300/1/200 |
| `new_clients` | note kind 'key' 'your first client told two friends ...' | `sfx/new_clients__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 1.33–1.34 | -14.3 | key | 1000/1/0 |
| `net_link_up` | snapshot.net.state changes to 'link-up' from 'no-device'/'no-cable'/'no-os'/'down' (note 'net' 'link up: ...' only the first time) | `sfx/net_link_up__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.89–0.90 | -12.7 | standard | 1000/1/300 |
| `net_saturated` | snapshot.net.state changes to 'saturated' | `sfx/net_saturated__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.65–0.73 | -14.4 | standard | 3000/1/300 |
| `net_down` | snapshot.net.state changes from 'link-up'/'saturated' to 'down'/'no-cable'/'no-os'/'no-device' | `sfx/net_down__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.74–0.80 | -13.8 | standard | 1000/1/300 |
| `ecc` | note kind 'ecc' (ECC corrected a flipped bit); rate limit 1 per 2 s | `sfx/ecc__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 0.53–0.55 | -15.9 | — | 2000/1/0 |
| `power_on` | note kind 'power' 'powered on' (ToSim powerButton), also 'the power company reconnected the wall' | `sfx/power_on__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.key (-20.0) | 1.27–1.29 | -11.1 | key | 300/1/200 |
| `power_off` | note kind 'power' 'powered off' | `sfx/power_off__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.83–0.87 | -14.9 | standard | 300/1/200 |
| `post_boot` | Phase enters 'posting' (power on, or the reboot after a crash); one per boot | `sfx/post_boot__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.99–1.03 | -12.2 | standard | 500/1/300 |
| `boot_ready` | Phase enters 'idle-os' (OS booted) or 'running' (no-OS flow) after posting | `sfx/boot_ready__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 0.75–0.78 | -15.4 | — | 500/1/300 |
| `fault_crash` | note kind 'fault' '...: the machine crashed and rebooted' (thermal error, VRM droop, protected-mode violation); errors +1 | `sfx/fault_crash__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.key (-20.0) | 0.90–0.96 | -7.3 | failure | 500/1/300 |
| `fault_hard` | note kind 'fault' 'the VRM burnt out' / 'the power company cut the wall' / 'the power cord was pulled' / 'hard power-off'; power.tripped false->true; Phase 'error' | `sfx/fault_hard__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.key (-20.0) | 1.43–1.50 | -11.9 | failure | 800/1/400 |
| `fault_soft` | note kind 'fault' 'POST failed' / 'memory fault ...' / 'a bit flipped ...: no ECC' / '... could not be fitted' and other fault notes | `sfx/fault_soft__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 1.09–1.15 | -16.0 | standard | 400/1/300 |
| `client_drop` | note kind 'drop' (tray / offer list full: a client gave up) | `sfx/client_drop__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 1.05–1.12 | -16.2 | standard | 600/1/300 |
| `job_expired` | note kind 'expire' (a client took back job N) | `sfx/job_expired__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.95–0.98 | -18.3 | standard | 600/1/300 |
| `job_declined` | note kind 'decline' (declined job N) | `sfx/job_declined__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 0.52–0.60 | -13.6 | — | 150/1/100 |
| `purchase` | note kind 'purchase' 'bought ...' | `sfx/purchase__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.71–0.76 | -10.8 | standard | 100/2/100 |
| `sell` | note kind 'purchase' 'sold ... for $N' | `sfx/sell__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.standard (-23.0) | 0.68–0.70 | -11.1 | standard | 100/2/100 |
| `bill_issued` | note kind 'bill' 'power bill: $N ...' | `sfx/bill_issued__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 1.00–1.03 | -20.2 | standard | 1000/1/0 |
| `bill_paid` | note kind 'bill' 'paid the power bill: $N' | `sfx/bill_paid__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 0.96–1.00 | -19.2 | — | 1000/1/0 |
| `contract_accepted` | note kind 'contract' '...: <kind> accepted on <drive>' | `sfx/contract_accepted__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 1.04–1.09 | -18.5 | — | 500/1/0 |
| `contract_ended` | note kind 'contract' '...: <kind> <word>' (any other contract note) | `sfx/contract_ended__{F,Gs,B,D}.ogg` | nearestRootRate | sfx | sfx.minor (-26.0) | 1.04–1.11 | -19.0 | — | 500/1/0 |
| `level_up` | note kind 'level' / levelUp signal; play the file of the NEW key on the next bar line, rate 1.0 | `sfx/level_up__{KEY}.ogg` (12) | perKeyFile | sfx | sfx.stinger (-18.0) | 2.93–2.97 | -7.2 | milestone | 3000/1/0 |
| `pause` | speed signal becomes 0 (Space / HUD 'Pause' / Paused menu open / popupPause / crash) | `sfx/pause.ogg` | fixed | sfx | sfx.standard (-23.0) | 0.65–0.65 | -10.8 | — | 150/1/0 |
| `resume` | speed signal leaves 0 (resume at lastRunSpeed or a chosen speed) | `sfx/resume.ogg` | fixed | sfx | sfx.standard (-23.0) | 0.73–0.73 | -15.1 | — | 150/1/0 |
| `speed_up` | speed signal rises between two non-zero speeds (also Build run speeds 1/4/16/64) | `sfx/speed_up.ogg` | fixed | sfx | sfx.minor (-26.0) | 0.44–0.44 | -7.0 | — | 60/1/0 |
| `speed_down` | speed signal falls between two non-zero speeds | `sfx/speed_down.ogg` | fixed | sfx | sfx.minor (-26.0) | 0.45–0.45 | -7.6 | — | 60/1/0 |
| `ui_hover` | pointer enters a row, tag, tab, value or HUD item ((hover: hover) devices only) | `ui/ui_hover_{1..3}.ogg` | fixed | ui | ui.micro (-38.0) | 0.04–0.06 | -13.4 | — | 40/2/0 |
| `ui_focus_move` | keyboard focus moves (chip slides 120 ms): arrows on spines, rails, tabs; Home/End | `ui/ui_focus_move_{1..2}.ogg` | fixed | ui | ui.micro (-38.0) | 0.08–0.08 | -14.0 | — | 30/2/0 |
| `ui_click` | activate a row / text button / dock item / HUD item (click, tap, Enter, Space) | `ui/ui_click_{1..2}.ogg` | fixed | ui | ui.action (-32.0) | 0.06–0.06 | -8.2 | — | 30/3/0 |
| `ui_back` | '← Back', Esc that closes a screen or panel, Cancel on Load confirm | `ui/ui_back.ogg` | fixed | ui | ui.action (-32.0) | 0.10–0.10 | -9.5 | — | 60/1/0 |
| `ui_toggle_on` | branch value Off -> On (Tutorial On, Auto-adjust On, Zoom slow ON, Tools 'Show ...') | `ui/ui_toggle_on.ogg` | fixed | ui | ui.action (-32.0) | 0.07–0.07 | -11.1 | — | 40/1/0 |
| `ui_toggle_off` | branch value On -> Off | `ui/ui_toggle_off.ogg` | fixed | ui | ui.action (-32.0) | 0.07–0.07 | -11.2 | — | 40/1/0 |
| `ui_value_change` | ← → or click on a value branch (Campaign/Sandbox, Preset Low..Ultra, Device, Frame limit, LIGHT/DETAIL rows) | `ui/ui_value_change.ogg` | fixed | ui | ui.action (-32.0) | 0.08–0.08 | -8.4 | — | 40/2/0 |
| `ui_tab_switch` | stage tab change (Settings: Quality/Display/Light/Detail/Interface; Controls: Mouse/View/Game); Build category rail tag | `ui/ui_tab_switch.ogg` | fixed | ui | ui.action (-32.0) | 0.09–0.09 | -10.8 | — | 60/1/0 |
| `ui_slider_tick` | slider moves one 5 % step (Render scale, Brightness, UI size); rate-limited | `ui/ui_slider_tick_{1..2}.ogg` | fixed | ui | ui.micro (-38.0) | 0.04–0.04 | -12.6 | — | 35/1/0 |
| `ui_confirm` | WB commit: 'Start' / 'Replace save and start', 'Replace save and load', 'Save now', Benchmark start | `ui/ui_confirm.ogg` | fixed | ui | ui.important (-28.0) | 0.26–0.26 | -8.5 | — | 150/1/0 |
| `ui_error` | refused action: toast '[ no ]', unreadable file, invalid drop, a ToSim reply with an error (lastError) | `ui/ui_error.ogg` | fixed | ui | ui.important (-28.0) | 0.19–0.19 | -12.8 | — | 250/1/0 |
| `ui_warn` | toast '[ !! ]', HUD notice in --c-warn | `ui/ui_warn.ogg` | fixed | ui | ui.important (-28.0) | 0.10–0.10 | -12.6 | — | 250/1/0 |
| `ui_notify` | toast '[ ok ]' ('Saved.' etc.) | `ui/ui_notify.ogg` | fixed | ui | ui.action (-32.0) | 0.07–0.07 | -9.3 | — | 250/1/0 |
| `ui_transition_in` | Main menu -> sub-screen and Paused -> Settings/Controls (chip flash 80 ms, trace runs, 360 ms); studio enter (Build, Gallery) | `ui/ui_transition_in.ogg` | fixed | ui | ui.transition (-30.0) | 0.40–0.40 | -15.2 | — | 200/1/0 |
| `ui_transition_out` | sub-screen -> back (trace retracts, ~360 ms) | `ui/ui_transition_out.ogg` | fixed | ui | ui.transition (-30.0) | 0.32–0.32 | -14.6 | — | 200/1/0 |
| `ui_panel_open` | Build flyout, inventory panel, machine list, Paused Files/Tools/Help list, Shop/Almanac/Log/OS panels open; 'Hold to peek' release | `ui/ui_panel_open.ogg` | fixed | ui | ui.action (-32.0) | 0.13–0.13 | -13.7 | — | 80/1/0 |
| `ui_panel_close` | the same panels close; 'Hold to peek' press (layer fades out) | `ui/ui_panel_close.ogg` | fixed | ui | ui.action (-32.0) | 0.14–0.14 | -12.9 | — | 80/1/0 |
| `ui_pickup` | drag a part from the shelf/flyout starts (Controls: 'Drag a part') | `ui/ui_pickup.ogg` | fixed | ui | ui.action (-32.0) | 0.06–0.06 | -10.5 | — | 80/1/0 |
| `ui_type_tick` | tutorial step meta types in (20 ms per char): play on every 3rd character, max 1 per 50 ms | `ui/ui_type_tick_{1..3}.ogg` | fixed | ui | ui.tick (-42.0) | 0.02–0.03 | -16.2 | — | 50/1/0 |


## 4. UI sounds by screen (the AD menu handoff, `/workspace/menu-review/handoff/pipeline-city-menu-ui`)
### 4.1 Components (AD SPEC §4, §8, §10)

| Component / action | Cue |
|---|---|
| Pointer enters a row, tag, tab, value, text button, HUD item (`(hover: hover)` only; not again while the pointer stays) | `ui_hover` (round-robin 1-3) |
| Keyboard focus moves (chip slides 120 ms; ↑ ↓ on spines, ← → on rails, Home / End) | `ui_focus_move` (1-2) |
| Activate a row, dock item, HUD item, text button (click, tap, Enter, Space) | `ui_click` (1-2) |
| "← Back", Esc that closes a screen or a panel, "Cancel" | `ui_back` |
| Value branch change (← → or click a value) | `ui_value_change` |
| Off ━ On branch, "Zoom slow ON/OFF", lens on/off, Tools "Show/Hide …" | `ui_toggle_on` / `ui_toggle_off` |
| Stage tabs (Settings, Controls), Build category rail tag, Gallery category spine | `ui_tab_switch` |
| Slider, per 5 % step (pointer drag or ← →) | `ui_slider_tick` (1-2), max 1 per 35 ms |
| WB commit ("Start", "Replace save and start", "Replace save and load", "Continue", "Save now", "Export game", "Reset to defaults", "Benchmark") | `ui_confirm` |
| Toast `[ ok ]` / `[ !! ]` / `[ no ]` (AD §4.10) | `ui_notify` / `ui_warn` / `ui_error` |
| Refused action: disabled bubble ("after loading"), invalid drop, any `lastError` | `ui_error` |
| Sub-screen opens (main menu → 04/05/06/07/08; Paused → 06/09) | `ui_transition_in` (starts with the chip flash) |
| Sub-screen closes (trace retracts, ~360 ms) | `ui_transition_out` |
| Panel / flyout / list opens or closes (Build flyout, machine list, inventory panel, Shop, Almanac, Log, OS, Paused Files/Tools/Help) | `ui_panel_open` / `ui_panel_close` |
| Drag a part starts | `ui_pickup` |
| Tutorial meta types in (20 ms per char) | `ui_type_tick` (1-3) on every 3rd character, max 1 per 50 ms; none with `prefers-reduced-motion` |

Combination rule: when one action fires two cues (a click that opens a screen), play both; the click first, the transition 60–80 ms later (as the chip flash).

### 4.2 Screens

| Screen (AD mock) | Sounds |
|---|---|
| 01 / 02 Main menu | rows: hover / focus / click; "Continue" `ui_confirm` (the game starts; room ambience keeps playing); "New game", "Build my PC", "Gallery", "Settings" → `ui_click` + `ui_transition_in`; "Load file" `ui_click` (file picker) |
| 03 Loading | no stage sounds (cells change instantly). The room ambience fades in (2 s) when `booted` turns true; nothing before the first user gesture (unlock, IMPLEMENTATION §3) |
| 04 New game | Campaign ━ Sandbox and Start with `ui_value_change`; Tutorial On ━ Off toggles; WB `ui_confirm`; Esc / Back `ui_back` + `ui_transition_out` |
| 05 Load confirm | opens with `ui_transition_in`; "Cancel" `ui_back`; "Replace save and load" `ui_confirm`; unreadable file: no screen, `ui_error` with the `[ no ]` toast |
| 06 Settings | tabs `ui_tab_switch`; branches `ui_value_change` / toggles; sliders `ui_slider_tick`; "Hold to peek": press `ui_panel_close`, release `ui_panel_open`; "Reset to defaults" `ui_confirm`; Back `ui_back` + `ui_transition_out`. New audio sliders (§1.3) tick like the others and the "Sounds" slider plays one `ui_click` at the new level on release so the player hears it |
| 06 from Paused (5.6a) | the same; ambience and the paused music hold under it |
| 07 Build my PC | enter `ui_transition_in`; category tags `ui_tab_switch`; flyout `ui_panel_open/close`; drag a part `ui_pickup`; fits → `install` ("Fit …", "Put back …"); "Take out …" → `uninstall`; "Plug in …" → `cable_connect`; "Unplug …" → `cable_disconnect`; "Powered on/off" (Run tab) → `power_on` / `power_off`; run speeds 1x/4x/16x/64x → `speed_up` / `speed_down`; lenses (Power, Airflow) toggles; "Benchmark" `ui_confirm`, benchmark finished → `job_fulfilled`; "Done: N steps" → `ui_confirm`; hint "Skip/Undo/Dismiss" `ui_click`. Key: F (the studio has no level). Machine hum while the studio machine is powered; no room ambience in the studio |
| 08 Gallery | category spine ↑ ↓ `ui_tab_switch`; ← → part `ui_value_change`; enter `ui_transition_in`; turntable drag/zoom: silent |
| 09 Controls | tabs `ui_tab_switch`; open with "?" `ui_panel_open`; Back / Esc / "?" `ui_back` |
| 10 Paused | opening via Esc / "Menu": `pause` if the menu paused the clock, else `ui_panel_open`; rows hover / focus / click; "Resume" `ui_click` + `resume`; "Save now" `ui_confirm`; "Main menu" `ui_confirm` + `ui_transition_out` (music and ambience fade out 1.5 s as the room title returns); Files / Tools / Help lists `ui_panel_open/close`; "New game" (bad) `ui_click` + `ui_transition_in`; items that open a game panel `ui_panel_open` + `resume` |
| 11 First frame / tutorial steps | step opens `ui_panel_open` then typing ticks; "Next" `ui_click`; "Skip tutorial" `ui_back`. The tutorial popup pauses the game (`popupPause`) → `pause`, closing it → `resume` |
| 12 HUD | speed rail: "Pause" → `pause`; a speed while paused → `resume`; faster / slower → `speed_up` / `speed_down`; phone speed tap: the same; "Zoom slow" toggles; "Menu" → Paused (above); dock items `ui_click` + `ui_panel_open`; level tab click `ui_click` + `ui_panel_open`; toasts per §4.1; level-up popup: the stinger comes from the `level` event; its "Next" `ui_click` (+ `resume`) |
| 13 Flow diagram | reference only, nothing to play |

## 5. Ambience

| Loop | File | Length | Level | When | Behaviour |
|---|---|---|---|---|---|
| Room and city | `ambience/amb_room_city_loop.ogg` | 24.000 s (1 152 000 samples) | −40 LUFS integrated | room scene visible: main menu, game (not the Build / Gallery studios) | fade in 2 s, out 1.5 s; unchanged by pause |
| Machine hum | `ambience/amb_machine_hum_loop.ogg` | 12.000 s (576 000 samples) | −38 LUFS integrated | `snapshot.powered` (and the Build studio machine when powered) | fade in 1.2 s, out 0.9 s; follows fan speed: gain −6 → 0 dB and playbackRate 0.92 → 1.12 for mean `DeviceSnap.fan` 0 → 1 (smoothed 800 ms); −4 dB while paused |

Both are exactly periodic (built at the loop length); loop them with `loop = true`, `loopStart = 0`, `loopEnd = samples / 48000` (IMPLEMENTATION §6). The hum has very low, soft tones (100, 116, 200 Hz) under broadband fan noise; they are fixed and not transposed.

## 6. Music (Afterglow)
Full rules: `assets/music/music-spec.json` (the engine reads it at runtime as `audio/music/music-spec.json`) and `sources/music/music-spec.md` (the explanation). Code: IMPLEMENTATION §7.

### 6.1 Files (172 Ogg, 17.5 MB)

| Files under assets/ | What | Count | Length | File level |
|---|---|---:|---|---|
| `music/stems/music_bed_{KEY}.ogg` | pad bed, always on in game | 12 | 4 bars = 14.545 s (698 182 samples) + 100 ms padding each side | −20 LUFS |
| `music/stems/music_pluck_{KEY}.ogg` | soft echoing pluck loop, D4–A5 | 12 | 4 bars | −20 |
| `music/stems/music_bass_{KEY}.ogg` | soft pulse / bass | 12 | 4 bars | −20 |
| `music/stems/music_shimmer_{KEY}.ogg` | data-flow shimmer (triplet blips, 16th ticks) | 12 | 4 bars | −20 |
| `music/stems/music_stress_{KEY}.ogg` | overload layer (detuned double, tremolo) | 12 | 4 bars | −20 |
| `music/stems/music_pausebed_{KEY}.ogg` | pause hold bed: darker (2.5 kHz), thinner | 12 | 4 bars | −20 |
| `music/stems/music_menu_F.ogg` | title / menu loop, F Lydian | 1 | 8 bars = 29.091 s (1 396 364 samples) + padding | −20 |
| `music/notes/music_note_pluck_{C3..C6}.ogg` | music event pluck, chromatic | 37 | 1.2 s | −20 |
| `music/notes/music_note_glint_{C5..C7}.ogg` | music event glint, chromatic | 25 | 0.6 s | −20 |
| `music/notes/music_note_low_{C2..C3}.ogg` | low thud tone, chromatic | 13 | 1.8 s | −20 |
| `music/notes/music_levelup_{KEY}.ogg` | key-change chord, new key | 12 | 4.5 s | −19.0 to −21.2 (TP-capped) |
| `music/notes/music_fault_{KEY}.ogg` | crash: low 5th → root + dark swell | 12 | 4.0 s | −18 |

`{KEY}` = `F C G D A E B Fs Cs Gs Ds As`; note tokens `Cs4` = C#4. Every music file is ≤ −1 dBTP; stems decode to exact lengths inside their padding (`sources/music/checks.json`).

### 6.2 Clock and key
66 bpm fixed (grid from the file: beat = 698 182 / 48 000 / 16 s), 4/4, 12 sub-steps per beat. Key per level as §8 (`KEYS[(L − 1) mod 12]`). A level change is queued to the next bar: all keyed layers crossfade (equal power, 1.4 s) to the new key; `music_levelup_{NEW}` plays on that bar at −6 dB under the SFX stinger. Several levels in one tick: one fifth per bar, stingers only on the first. Load / new game / sandbox `setLevel`: key change, no stingers.

### 6.3 States (music-spec §4)

| State | Trigger | Layers |
|---|---|---|
| menu | screens 01/02, 04, 05, 06, 09 from the menu | `music_menu_F` only |
| loading → game | first game frame | crossfade 2 s (next menu bar) to the save's key |
| off | `phase "off"` | bed 0.5 |
| boot | `posting mounting loading booting-os` | bed, pluck 0.5 (+ rising plucks with `bootProgress`) |
| idle | `idle-os halted` | bed, pluck 0.6 |
| running | `running running-os ingesting flashing writing` | bed, pluck, bass |
| data (adds) | `net.state` link-up/saturated, transfers, key ingest | + shimmer (saturated +2 dB, LP 4 kHz) |
| stress (adds) | worst of throttle, temperature, VRM load, power budget | + stress, amount^1.5 |
| error | `phase "error"`, POST failed | pausebed 0.7 only |
| hard failure | VRM burnt, `power.tripped`, `bill.cut` | pausebed 0.7 + `music_fault_{KEY}` |
| debt | `bill.unpaid > 0` | LP 3 kHz on bed + pausebed |
| pause | `speed === 0` | bed → pausebed (1 s), pluck LP 850 Hz −5 dB, others 0; tempo unchanged |

Layer entries on the next bar, exits on the next beat.

### 6.4 Speed
Density and brightness only, 0.5 s ramps: speed 1 bass off, shimmer −6 dB; 2 bass −3, shimmer −3; 4 (= "1x") as designed; 8 shimmer +2, event density ×2; 12 / 16 / 64 shimmer +3, bass +1, density ×3.

### 6.5 Music events
The music adds quiet in-key notes to the same events (music-spec §7): install pluck on the root, payout glint fan, cable rising/falling pair, drop/expire low tones, ecc glint on the #4, fault stinger, and so on. They are part of the music bus (−8 dB, ducked by the SFX cue they accompany), capped at 8 voices. The SFX cues in §3 stay the primary feedback.

## 7. Mix and levels
### 7.1 File targets (max momentary loudness, LUFS; every file ≤ −1.2 dBTP measured on the Ogg)

| Class | Target | Cues |
|---|---:|---|
| ui.tick | −42 | `ui_type_tick` |
| ui.micro | −38 | `ui_hover`, `ui_focus_move`, `ui_slider_tick` |
| ui.action | −32 | click, back, toggles, value, tab, panels, pickup, notify |
| ui.transition | −30 | transitions |
| ui.important | −28 | confirm, error, warn |
| sfx.minor | −26 | ecc, key plug/eject/refused, decline, bill, contract, swap cancelled, boot ready, speed |
| sfx.standard | −23 | install, swap, cable, net, purchase, sell, drop, expire, power off, POST, soft fault, pause, resume, late payout |
| sfx.key | −20 | job fulfilled, payout, power on, crash, hard fault, new clients |
| sfx.stinger | −18 | level-up |
| ambience | −40 / −38 integrated | room / hum |

### 7.2 Buses (defaults; sliders multiply)
`master` 0 dB → `music` −8 dB, `sfx` 0 dB, `ui` −3 dB, `ambience` 0 dB. Resulting relative levels: UI 6–20 dB under gameplay key cues; standard gameplay cues ~+1 dB and key cues ~+4 dB over the music (all layers measured −16.1 to −15.9 LUFS at 0 dB → ~−24 LUFS on the −8 dB bus; pause −18.3, menu −17.2 before the bus); ambience 14–16 dB under the music. Music worst-case true peak at 0 dB is −1.0 dBTP, so the −8 dB bus leaves ~7 dB headroom.
### 7.3 Voices and rate limits
Global 24 voices, `sfx` 12, `ui` 6; steal lowest priority then oldest. Per cue `minIntervalMs` / `maxVoices` / `collapseMs` (table §3.3). `collapseMs` merges bursts (several "came unplugged" notes in one tick → one cue). Notes that arrive in the same snapshot are played in log order, 40 ms apart (no flam pile-up).
### 7.4 Pause, hidden tab, sliders, unlock
See §1.3 and `mix-tokens.json` (`pause`, `hiddenTab`, `sliders`, `unlock`). Pause never suspends the AudioContext; UI and gameplay cues keep playing while paused (the sim steps of the Trace panel make cues too, rate-limited).

## 8. Transposition
- Key pitch class for level `L` (campaign `snapshot.level.level`; sandbox the same field): `key = (5 + 7 × (L − 1)) mod 12`.
- Pitched cues (`transpose: "nearestRootRate"`): render roots F (5), Gs (8), B (11), D (2), a minor third apart. Signed distance `d = ((key − root + 6) mod 12) − 6`; pick the root with the smallest |d| (always ≤ 1); play its file at `playbackRate = 2^(d/12)` (0.944, 1, or 1.059; the length changes by the same ±6 %). Example: level 2 = C → B file at 2^(1/12). Level 13 wraps to F.

| Key (file token) | F | C | G | D | A | E | B | Fs | Cs | Gs | Ds | As |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Level | 1, 13 | 2, 14 | 3, 15 | 4, 16 | 5, 17 | 6, 18 | 7 | 8 | 9 | 10 | 11 | 12 |
| File root · d | F · 0 | B · +1 | Gs · -1 | D · 0 | Gs · +1 | F · -1 | B · 0 | F · +1 | D · -1 | Gs · 0 | D · +1 | B · -1 |

- Each file root is rendered in its own register band (Gs +3, B −6, D −3 semitones from F), so cues stay in their family register in every key.
- Level-up (`perKeyFile`): play `level_up__{KEY}.ogg` of the **new** key at rate 1 on the music's next bar line (no music running: at once), with `music_levelup_{KEY}` at −6 dB.
- Music: rendered in all 12 keys (`music_*_{KEY}`), never rate-shifted; notes are chromatic.
- Fixed cues (`fixed`): all UI, `pause`, `resume`, `speed_up`, `speed_down`, `key_eject`, ambience. Never transposed.
- Build my PC studio and the main menu use level 1 (F) unless a save is loaded (then its level).

## 9. Formats and paths
- Ogg Vorbis q6, 48 kHz, stereo, one file per cue / root / variant; 24-bit WAV masters in `sources/masters/` (not shipped).
- Music stems carry 4 800 samples (100 ms) of wrap-around padding each side; loop on `[4800, 4800 + loopSamples)` after `stitchLoop()` (IMPLEMENTATION §7.3).
- One-shots end with 10 ms of silence (some decoders trim up to 128 samples at the end; ffmpeg's decoder differs from the file's granule length by −128 to +1013 samples, libsndfile matches exactly; see KNOWN-ISSUES §3).
- Repo paths: `public/audio/{sfx,ui,ambience,music}/<file>.ogg`, loaded with `` `${import.meta.env.BASE_URL}audio/...` `` (the repo's pattern for `stills/`, `models/`, `bake/`; `vite.config.ts` has `base: './'`). Full list: `assets/manifest.json` (`repoPath`; 353 files incl. music). `python3 sources/check_refs.py` proves every file named here exists and every asset is named here (ACCEPTANCE §1.4).
