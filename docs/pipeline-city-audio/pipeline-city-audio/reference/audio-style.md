# Pipeline City: audio style guide (v3, direction chosen, first-pass assets made)

**Status:** v3, 2026-11-21. Direction B approved by Khalil 2026-11-21 (decisions relayed by Dev Lead, 10:17 UTC+1). First-pass SFX, UI, ambience and music are made and packaged for Khalil to implement: `handoff/pipeline-city-audio/` (§6.1, §0.6). Nothing is in the repo yet.
**Base:** read-only clone `/workspace/repos/pipeline-city-sound` at `da577448` (main). Code names below are real names from that tree.
**Samples:** `samples/` next to this file (3 clips, generator scripts, event logs, check plots). **(J)** = my judgement, not a fact from a source.

## 0. Decisions (Khalil, 2026-11-21)
### 0.1 Chosen direction: B, Afterglow
**Approved by Khalil 2026-11-21.** Warm detuned pad as the lead voice, plucked synth with dotted-eighth echoes, **Lydian**, **66 bpm**. Reference clip: `samples/b_afterglow.ogg` (sketch quality, not a final asset).
- Clock for B: 66 bpm in real time, 12 sub-steps per beat, **bar = 4 beats (3.64 s at run speed, 4.85 s while paused at 75 %)**. This replaces the 80 bpm in §3.1, which was written for A; the speed map in §3.1 still applies as a multiplier.
- Everything else in §3 (layers, event map, pause hold, mix) applies to B. Where the table names a "bell" or "mallet", read "pluck".
- Directions A and C (§5) are **not chosen**. They stay in this guide and in `samples/` for reference only.

### 0.2 Key change on every level-up (decided: yes)
Rule:
1. **Start key:** level 1 = **F Lydian** (F G A B C D E).
2. **On each `level` note** (`this.note("level", ...)` in `src/features/economy/sim/clients.ts`, seen on the main thread as a new `snapshot.log` entry with `kind === "level"`, and as the `levelUp` signal), the root moves **up a perfect fifth** (+7 semitones, mod 12): F → C → G → D → A → E → B → F# → C# → G# → D# → A# → F. Each step keeps 6 of the 7 scale tones; only one note moves up a semitone (e.g. F Lydian → C Lydian: B stays, F becomes F#).
3. **Formula:** key root pitch class = (F + 7 × (level − 1)) mod 12. The cycle closes after 12 steps: levels 1 and 13 are both F Lydian, level 2 and 14 both C Lydian, and so on (`MAX_LEVEL = LEVELS.length` in `src/features/economy/sim/levels.ts`; the sandbox allows levels 1-18).
4. **Quantization:** the change lands on the **next bar line** (next downbeat of the 4-beat bar), never mid-bar. The level-up card pauses the game (`popupPause`), so the change usually lands inside the pause hold: the bed crossfades to the new chord over 1.4 s, and the paused loops take the new notes from their next hit.
5. **Register (no drift):** the bed root is always placed in the octave where it lies between **E2 and D#3** (MIDI 40-51); loops and plucks keep their fixed ranges and take the nearest note of the new scale. So the cycle of fifths does not climb out of range.
6. **Several levels at once** (one tick passes two thresholds): move one fifth per bar until the target key is reached, so every step still shares 6 tones.
7. **No transition:** loading a save, starting a new game, or the sandbox `setLevel` sets the key straight from the level (formula in 3), on the next bar, with no level-up chord.
8. **Level-up chord:** on the same bar line, a pluck chord in open voicing (root, 5th, 9th, 3rd an octave up; the #4 colour stays in the bed) plays once at the cue level (§0.5).

### 0.3 Formats
**Ogg only, 48 kHz.** Safari older than 18.4 is not supported (Dev Lead's call), so there is no `.m4a` fallback. Details in §8.

### 0.4 Timing
**Audio work waits until after the POC** (matches `docs/ARCHITECTURE.md`: "No audio for the POC"). No final assets are made until Dev Lead comes back. The sample clips stay sketches.

### 0.6 Build decisions (2026-11-21, handoff package)
These supersede the older text below where they differ (the package SPEC §1 has the reasons):
- **Codec: Ogg Vorbis q6, 48 kHz** (not Opus).
- **Music tempo is fixed at 66 bpm.** No 75 % pause clock (§0.1, §3.4) and no speed → tempo map (§3.1). Pause = crossfade to a darker `music_pausebed` stem + pluck low-pass 850 Hz at −5 dB; speed changes only density and brightness.
- **Music rendered in all 12 keys**; SFX pitched cues rendered at 4 roots (F, G#, B, D) and shifted ≤ 1 semitone (§6.1).
- **Level-up:** the SFX stinger and the music's level-up chord both play on the bar; the music one at −6 dB.
- **Menu music:** always `music_menu_F`, crossfade to the save's key on the first game frame.
- **Sliders: yes** (Master, Music, Sounds, Ambience; Settings → Interface, pending AD sign-off). **Hidden tab: yes** (fade out 0.5 s, suspend after 2 s, fade in 0.8 s).
- **Cue clarity (§0.5): adopted** as listed, with ducking −2 / −3 / −4 dB (standard / key / failure + milestone), 10 / 150 / 400 ms.
- Key file tokens everywhere: `F C G D A E B Fs Cs Gs Ds As` (s = sharp).

### 0.5 To-do for the real build: make event cues easier to hear in B
B's cues are harder to pick out than A's (the pad leads, and plucks echo into it). The real build must fix this. Proposed measures:
- [ ] **Cue transient:** event plucks get a brighter, shorter voice than the loop plucks: 1-2 ms attack, upper harmonics up about +4 dB, decay ≤ 0.4 s, and **no echo** on the first hit (echo only on the tail at −12 dB). Loop plucks keep the soft, echoing voice.
- [ ] **Duck the pad under cues:** sidechain the bed −3 dB (up to −4 dB for milestone and failure cues), 10 ms attack, 400 ms release, triggered by the cue bus. Data layer ducks −2 dB.
- [ ] **One register per event family**, so the ear learns where to listen:
  - build (install, uninstall, cable, power): C4-C5, mid, centre pan
  - flow and jobs (link, transfers, key, flashing, payout, job): C5-C6, high, panned by direction
  - milestone (level chord): wide chord over C3-C6
  - stress: loop doubles only, no new register
  - failure and lost clients (fault, drop, expire): C2-C3, low, centre
- [ ] **Pan and space:** cues dry-forward (reverb send −6 dB versus loops), loops wider in the stereo field.
- [ ] **Level:** cues sit +3 to +5 dB over a loop pluck of the same pitch; check by measuring short-term loudness on cue bars versus non-cue bars (target ≥ +2 LU).
- [ ] **Thin the loops:** at most 4 loop voices sound in one beat when a cue fires (drop the quietest), so cues are never masked.
- [ ] **Verify:** re-render the B event demo with these rules and compare the spectrogram and short-term loudness per cue against the current `b_afterglow` sketch before making final assets.

## 1. What the game is, for sound
- Pipeline City is an incremental game about building a PC and running client jobs on it: buy parts, install them on a board, connect cables, power on, POST, boot an OS, take jobs from USB keys or the network, get paid, level up. Heat, VRM load, power budget, the power bill and client patience are the stress. Crashes, burnt parts and lost clients are the failures.
- Look: "neon hacker dashboard", near-black navy, information glows, data visibly moves along wires; real hardware lit by neon, not a rave (`docs/art-style.md` §1). Sound follows: dark, clean, glowing, calm; never a club track.
- Today there is **no audio at all**: no audio code, no audio assets, no AudioContext. `docs/ARCHITECTURE.md` "Look and feel": "No audio for the POC."

## 2. References: how Mini Metro and Mini Motorways do it (sourced)
Both scores are by Rich Vreeland (Disasterpeace), who also did the sound design and implementation ([disasterpeace.com/music](https://disasterpeace.com/music)).

**Mini Metro**
- No looping music tracks. Music is made by sequential data ("serialism") from the game plus authored data ([GDC 2018 talk transcript](https://disasterpeace.com/blog/mini-metro.serialism-talk)).
- One clock: 1 in-game hour = 0.8 s = 1 beat at 72 bpm, the "master pulse". Most sounds trigger on fractions of it (same source). Modules use subdivisions of the master pulse; the line loops use 12 by default, which gives duplets and triplets ([mini-metro-audio-toolkit README](https://github.com/richvreeland/mini-metro-audio-toolkit)).
- Each metro line is a `LineLoop`: a pulse with a rhythm and a pitch, constant until gameplay changes it. Each station is one pulse in the sequence; volume, timbre and pan come from game data (talk; toolkit README).
- Editing the least recently changed line replaces the oldest note of the harmony with the next one, and moves its rhythm to the next one in a list. Harmony can change by game week ([Designing Sound interview, 2016](https://designingsound.org/2016/02/18/the-programmed-music-of-mini-metro-interview-with-rich-vreeland-disasterpeace/)).
- Station spawns and mutations trigger bass notes; an `Arpeggio` module fans a group of events (e.g. passengers appearing) over the next pulses; a `GameOver` screen can trigger a chord (toolkit README). Crowded stations sound different from new ones ([Kill Screen](https://www.killscreen.com/music-urban-commute-designing-mini-metros-soundtrack/)).
- **Pause:** pausing does not stop the music. The `TimeScale` drops to `SingleSlow` = 75 % of normal speed (or `DoubleSlow` from fast-forward). The optional `Beat` kick module plays "only when the game is not paused" (toolkit README). So: the music keeps going, slower and without the drum.
- Goal: immersive and calming, so the player is not stressed out and plays longer (Kill Screen). It even syncs some gameplay to the audio, which is uncommon ([Mini Motorways postmortem](https://disasterpeace.com/blog/mini-motorways.postmortem)).

**Mini Motorways** ([postmortem](https://disasterpeace.com/blog/mini-motorways.postmortem); [Game Developer interview](https://www.gamedeveloper.com/design/turning-road-noise-into-music-mini-motorways))
- Hundreds of cars, so the music is decoupled from single cars. A city starts ambient and sparse; as cars drive, pads slowly give way to pulsing tones. The number of active destination "requests" drives this: more requests, less ambient.
- Musical sequences belong to colour groups of cars and buildings; pitch and rhythm are generated, pan and volume come from game data.
- Harmony: the "Common Tone Chord Network" picks the next chord or scale by how many tones it shares with the current one (default `MaxGroups - 1`, about 4).
- Timing: road drawing sounds are quantized to the beat ("chunky"); dragging a motorway plays immediately, so it feels tactile. Horns are on the beat and slightly out of tune: musical but a little wrong, to flag traffic trouble without irritation.
- Low- and high-pass filters soften specific screens (end of week, road editing); global pitch-shift is used briefly for pausing, zoom and menus; night mode shifts many sounds up a Pythagorean major sixth (27/16) and adds echo.
- Shared aim of both games: tone down the stress of the gameplay; the sound should invite and comfort.

## 3. Music system design (applies to the chosen direction B; tempo per §0.1)
### 3.1 Clock and grid
- *(Written for A; B uses 66 bpm and a 4-beat bar, §0.1.)* **Master pulse = 3 base ticks at 1x = 0.75 s = 80 bpm (J).** The game is designed around 4 base ticks a second shown as "1x" (`src/worker/protocol.ts` `Speed`, `DEFAULT_SPEED = 4` in `src/app/store.ts`). This keeps the Mini Metro idea (beat = a unit of game time) but the clock runs in **real time**; game speed only nudges it, because speeds go up to 12 (3x) in a campaign and 64 in the sandbox.
- Speed map: `speed` 1, 2 → 0.9x tempo; 4 → 1.0x; 8 → 1.06x; 12+ → 1.12x, plus more density, not more tempo (J).
- Grid: 12 sub-steps per beat (duplets and triplets, as Mini Metro's `LineLoop_Pulse` default). Sim-driven events snap to the next 1/12 step (max 62 ms late). Player input (drag-drop install, cable plug, buttons) plays at once (Motorways rule).
- Implementation note (J): schedule on the Web Audio clock (`AudioContext.currentTime`, look-ahead scheduler), not on `requestAnimationFrame`; read sim state from the `snapshot` signal (`src/app/store.ts`), and new `snapshot.log` entries (`GameEvent { tick, kind, text }`, `LOG_CAP = 16`) by diffing `tick + kind + text`.

### 3.2 Layers
| Layer | What it is | Driven by |
|---|---|---|
| **Bed** | Pad chord, always on (also while off, in menus, paused) | harmony state; `Phase` |
| **Device loops** | One pulsing voice per installed device kind (Mini Metro's line loop) | `Snapshot.devices` (`DeviceSnap.kind`, `slot`) |
| **Data** | Soft ticks + short blips walking the scale | `NetSnap` link state, `TransferSnap`, `KeyStage`, OS work |
| **Accents** | Quantized one-shots: fans, chords, sighs | `GameEvent.kind` notes |
| **Stress** | Out-of-tune double, tremolo, tempo +, sub pulse | thermal, VRM, power, queue, patience values |
| **Clock pulse (C only)** | Soft sub on the beat; stops when paused (Mini Metro `Beat`) | running phases |

### 3.3 Event and state map (real code names → music)
Scale degrees count from the current root. "Fan" = notes spread over the next steps (Mini Metro `Arpeggio`).
| Code (where) | When | Music |
|---|---|---|
| `Phase "off"`, main menu | machine off | bed only, low and sparse (Motorways' ambient start) |
| `powerButton` / note `"power"` "powered on" | power on | bed opens (filter up, + one chord tone) |
| `Phase "posting"`, `"mounting"`, `"loading"`, `"booting-os"`; `bootProgress` 0..1 | POST and boot | rising arpeggio, one note per ~1/6 of `bootProgress` |
| `Phase "idle-os"` | OS idle | loops at half density |
| `Phase "running"` / `"running-os"`, `isOsActivity` (`src/core/ui/logic.ts`) | job runs | loops at full density, data layer on |
| `Phase "ingesting"` / `"flashing"`, `KeyActivity` | key read / result written | data blips up (ingest) / short high shimmer (flash) |
| note `"install"` (ToSim `install`), `DeviceSnap` added | part placed | immediate soft confirm note; a new loop for that kind enters on the next beat. CPU = root every beat; RAM = 3rd every 2/3 beat; storage = 5th every 1.5 beats; GPU = 2nd high every 1/2 beat; NIC = 6th; NPU/TPM = colour tones (J). More parts of a kind (sticks, drives) = longer note pattern (like stations per line) |
| `uninstall` / `sell` | part removed | loop leaves; harmony steps forward one note (Mini Metro rule) |
| note `"cable"` "connected" (ToSim `connectCable`) | connection | rising interval (root → 5th up), immediate |
| note `"cable"` "disconnected" / "came unplugged" | link broken | falling interval, 20-30 cents flat |
| `LinkState "link-up"`, note `"net"` "link up" | data flows | data layer on: 3 per beat |
| `TransferSnap.dir "down"` / `"up"`, `KeyStage "downloading"`/`"uploading"` | transfers | data density 6 per beat, walking down / up; pan by direction |
| `LinkState "saturated"` | link full | data at 12 per beat, low-pass slightly closed (busy, not bright) |
| `LinkState "down"` / `"no-cable"` | link lost | data layer fades out in 1 bar |
| note `"key"` "plugged in" | job starts | one loop note advances (harmony moves) |
| note `"payout"`, `completed` +1 | job paid | fan of 3-6 chord tones (count by payout size), "(late)" = 2 notes |
| note `"job"` | result ready | single bell |
| note `"level"` "Level N: …", `levelUp` signal (`src/core/ui/state.ts`) | milestone | **key change: up a fifth on the next bar line, rule in §0.2** (6 of 7 tones shared); level-up pluck chord; the level-up card also pauses the game (`popupPause`): the chord rings into the pause hold |
| note `"purchase"` | buy / sell | small two-note UI chime in key |
| note `"contract"` | contract accepted / ended | bed adds / drops a long tone for the contract's life |
| `DeviceSnap.throttle` < 1, `tempC` high, `unstable`; `VrmSnap.loadRatio` > 1, `unstable`, `errProb`; `power.totalW` near `budgetW` | stress / overload | stress amount 0..1 from the worst of these: tempo up to +8 %, the CPU loop gets a 25-30 cents sharp double (Motorways horn idea), pad tremolo, more density. Never louder than +2 LU |
| `queueLength` near `queueCap`, `patience` / `deadlineTick` near | clients waiting | a soft tick per waiting key on the off-beats (J) |
| `bill.unpaid` > 0 | debt | bed loses its top tone until paid |
| note `"drop"` (tray / offer list full: a client gave up) | lost client | one bell, falling, bent a quarter-tone flat |
| note `"expire"` (a client took back job N) | lost job | lower falling "sigh" |
| note `"ecc"` | ECC fixed a bit | tiny high glint |
| note `"fault"`: "thermal error / VRM voltage droop: the machine crashed and rebooted" (`src/features/board/sim/game/machine.ts`), `errors` +1 | crash + reboot | loops cut, low-pass dives (~250 Hz), low falling two-note; then POST arpeggio and loops re-enter one per beat |
| note `"fault"` "POST failed", `postFailed`, `Phase "error"` + `phaseReason` | won't boot | held low minor chord; no loops until fixed |
| note `"fault"` "VRM burnt out", `DeviceSnap.burnt`, `power.tripped`, `bill.cut` | hard failure | like Mini Metro's `GameOver` chord: one soft thud, a held chord, everything else stops. No alarm |
| `crash` signal (`CrashReport`, the sim threw and paused itself) | sim crash | treat as pause (below); no special sound (it is a bug, not gameplay) |

### 3.4 Pause (must hold, never cut)
Pause in the repo = `speed === 0`: Space (`togglePause` in `src/app/store.ts`), the HUD button, `popupPause` (level-up card, tutorial popups), and `crash`. The root element gets the `.paused` class (`src/core/ui/state.ts`). While paused the player can still step the machine (`step`, `stepTick`).
- Keep the AudioContext running. Never `suspend()` on pause.
- Over ~1 s: clock to **75 %** (Mini Metro `SingleSlow`); loops play every 2nd hit at about -5 dB; loop-bus low-pass to ~850 Hz; data layer and clock pulse stop (Mini Metro `Beat` rule); the bed holds its chord and comes up about +2 dB, top end at ~2.5 kHz.
- UI sounds still play while paused (menus, inventory, shop) through the same low-pass, quieter.
- Each `step`/`stepTick` while paused may play one single quiet loop note (J).
- Resume (`setSpeed(lastRunSpeed)`): filter opens over ~1 s; layers come back on the next beat.
- Tab hidden: the repo has no `visibilitychange` handling today; suggest fading master to -inf over 0.5 s and suspending after 2 s (J).

### 3.5 Mix behaviour
- Bus layout: master → music (bed, loops, data, stress) and sfx (accents, UI). Player volume sliders for music and sfx (J).
- Voice limit: 6 loop voices + 8 data voices at once; over that, drop the quietest (Mini Metro uses `VoiceLimit` and `Flam_Limit`).
- Stress raises density and tempo, not level. Failure lowers level and brightness.

## 4. Music style
- Tempo: 66-92 bpm by direction; default 80 (`3.1`). Swing none (A), light (B), none (C).
- Key and mode: pentatonic or modal only, so any overlap of loops is consonant. Harmony moves by common tones (≥4 shared) at milestones.
- Register: bed 40-400 Hz fundamentals, loops D4-A5, accents up to A6, sub 40-80 Hz (C only).
- Timbre: soft attacks (2-5 ms), no hard transients above 6 kHz, short tails on loops (≤1.5 s), long reverb (3-4 s) at low send.

## 5. Directions (B chosen; A and C kept for reference only)
- *Not chosen (reference only).* **A, Transit Mallets** (closest to Mini Metro): soft marimba/felt mallets, D major pentatonic moving to A pentatonic at level-up, 80 bpm, a warm sine-like pad. Calm, friendly, very readable; least "neon".
- **CHOSEN (Khalil, 2026-11-21).** **B, Afterglow**: warm detuned pad as the main voice, plucked synth with dotted-eighth echoes, F Lydian → C Lydian (the first step of the §0.2 rule), 66 bpm. Most ambient and dreamy, Motorways-at-night feel (echo); events are softer, so less readable: see the to-do in §0.5.
- *Not chosen (reference only).* **C, Bus Clock** (fits the neon dashboard best): glassy FM bells over a soft sub pulse, A Dorian, 92 bpm, loops in 3:4:5 polymeter on a 16th grid like data on a clocked bus. Most "hacker dashboard", a little cooler and busier.

## 6. SFX palette
- Mostly synthetic (sines, FM, filtered noise) to match neon light; a few organic touches for real hardware: plastic click on install, latch on the RAM, cable plug "thock" (J). All tuned to the current key when they are pitched (Motorways horns change key with the music).
- Brightness: mid-dark; low-pass most SFX at 8-10 kHz; nothing harsh or alarm-like, even for failure.
- Length: UI 30-150 ms; actions (install, cable, key) 150-500 ms; accents (payout fan, level chord, failure chord) 1-3 s.

### 6.1 SFX first pass (2026-11-21)
Made and measured; full map in `handoff/pipeline-city-audio/SPEC.md` §3–§4, files and checks in the package. All original synthesis (`sfx/LICENSES.md`). Not yet heard by a person.
- **Palette:** event cues = bright plucks (1.5 ms attack, upper partials decaying 3× faster than the fundamental), sine glints, soft FM bells; physical acts get a band-passed noise click or a low "thock" under the pluck (install, cable, key, power). Echo only on the tail (dotted eighth at 66 bpm, −12 dB). Failure cues are low, dark, bent down, never alarms. UI = short filtered ticks and taps, low-passed 6–11 kHz, no pitch content tied to the key.
- **Per cue (gameplay, pitched unless marked):**

| Family / register | Cues | Sound | Length |
|---|---|---|---|
| Build, C4–C5 | install, uninstall, swap_queued, swap_done, swap_cancelled, cable_connect, cable_disconnect, cable_unplugged, power_on, power_off, post_boot, boot_ready, purchase, sell | click/thock + 1–3 plucks; rising = connect / on / install, falling = removal; POST = quick rising run through the #4; boot_ready = soft 5th | 0.3–1.1 s |
| Flow and jobs, C5–C6 | job_fulfilled, payout, payout_late, key_plug, key_refused, new_clients, net_link_up, net_saturated, net_down, ecc, contract_accepted, contract_ended, bill_paid | pluck pairs and chord-tone fans, glint on top; payout = 4-note rising fan + 3 glints; late = 2 falling notes; ecc = two tiny glints (7th, then 3rd) | 0.5–1.4 s |
| Failure, C2–C4 | fault_crash, fault_hard, fault_soft, client_drop, job_expired, job_declined, bill_issued | low thud + falling filtered noise + falling plucks, dark; crash = thud, noise sweep down, 5th → root in C3 | 0.5–1.45 s |
| Milestone, C3–C6 | level_up (12 keys) | open chord in the NEW key (root, 5th, 9th, 3rd +8va) strummed, glints, echo | 2.9 s |
| Time (fixed) | pause, resume, speed_up, speed_down, key_eject | pause = noise sweep down + falling tone + click; resume = the reverse; speed = two quick ticks (rising / falling); key_eject = two clicks | 0.1–0.6 s |
| UI (fixed) | hover, focus_move, click, back, toggle on/off, value_change, tab_switch, slider_tick, confirm, error, warn, notify, transition in/out, panel open/close, pickup, type_tick | ticks, taps, soft swooshes; 1–3 round-robin variants | 14–400 ms (22 of 26 < 150 ms) |
| Ambience (fixed) | amb_room_city_loop, amb_machine_hum_loop | room tone + distant city wash (24 s); PC fan noise + soft 100/116/200 Hz hum (12 s), follows fan speed | loops |

- **Pitch and transposition:** pitched cues are rendered at four roots a minor third apart, **F, G#, B, D**, each in its family register. For level L the key is `(5 + 7(L−1)) mod 12`; the game plays the nearest root's file at `playbackRate 2^(d/12)` with |d| ≤ 1 semitone (±6 % length, inaudible as a tempo change on a one-shot). The level-up stinger has one file per key (`level_up__{KEY}`, rate 1, next bar). **Fixed (never transposed):** all UI, pause, resume, speed_up, speed_down, key_eject, ambience.
- **Levels (max momentary loudness per file; peaks ≤ −1.2 dBTP):** UI tick −42, UI micro (hover, focus, slider) −38, UI action −32, UI transition −30, UI important (confirm, error, warn) −28; SFX minor −26, standard −23, key (job, payout, power on, faults) −20, level-up −18; ambience −40 (room) and −38 (hum) LUFS integrated. Buses: music −8, sfx 0, ui −3, ambience 0 dB. Measured: every SFX ≤ −6.1 dBTP, every UI ≤ −8.2 dBTP.
- **Formats:** Ogg Vorbis q6, 48 kHz stereo, 10 ms of silence at the end of every one-shot; ambience loops sample-exact; 24-bit WAV masters kept in `handoff/pipeline-city-audio/sources/masters/`. Repo path `public/audio/{sfx,ui,ambience,music}/`.
- **Preview:** `sfx/preview/sfx_preview.ogg` (30 s game moment, −16.3 LUFS, −1.4 dBTP; cue list next to it); menus: `handoff/pipeline-city-audio/previews/ui_preview.ogg`.

## 7. Loudness and levels
- Music: **-16 LUFS integrated** per stem mix / clip, true peak ≤ -1 dBTP (samples are at -16.0 LUFS, -1.9 to -2.8 dBTP).
- SFX: peaks ≤ -1 dBTP; UI clicks about -24 to -20 LUFS short-term; action SFX about -18; milestone/failure accents about -16 (J).
- Relative: music bed sits about 6 dB under action SFX in the moment; pause lowers the overall music by ~1-2 LU, not more.
- Measure with `ffmpeg -af ebur128=peak=true` (`samples/check.py` does this).

## 8. Formats and sample rate
- The engine is a browser game (Vite, Preact, PixiJS, three.js, sim in a Web Worker). It has no audio pipeline, so the "engine format" is what browsers decode with Web Audio `decodeAudioData`. Static files belong under `public/` like the textures and stills (e.g. `public/audio/`) (J).
- Masters: 48 kHz, 24-bit WAV (kept off the shipped build; samples here are 48 kHz/16-bit WAV + Ogg).
- **Ship: Ogg only, 48 kHz** (decided 2026-11-21): Ogg Vorbis (q 5-6) or Ogg Opus (96-128 kbit/s); pick one codec for the whole set when the build starts. Chrome, Firefox and Edge play both. Safari plays Ogg Opus and Ogg Vorbis from Safari 18.4 (macOS 15.4, iOS 18.4) ([caniuse PR #7284](https://github.com/Fyrd/caniuse/pull/7284), [caniuse Opus](https://caniuse.com/opus)).
- **Safari older than 18.4 is not supported** (Dev Lead's call). **No `.m4a`/AAC fallback.** If `decodeAudioData` fails, the game runs silent; it must not break (J).
- 48 kHz because most devices run the AudioContext at 48 kHz; the browser resamples other rates (J).
- Encoders pad the start of Vorbis/Opus files, so a looped compressed file can click; one-shots avoid this. Loop pads from decoded buffers with `AudioBufferSourceNode.loopStart/loopEnd` (J).

## 9. Assets a reactive system needs (not one fixed track)
A reactive score is assembled at runtime, so it needs note samples and stems, not a song. For the chosen direction B (made only after the POC, §0.4): items 1-4, 6, 7 below with **plucks** as the loop instrument plus a separate brighter **cue pluck** set (§0.5); item 2 must cover **all 12 pitch classes**, because the §0.2 rule visits every key; item 5 is not needed (C only).
1. **Loop instrument multisamples:** every scale tone over 2.5 octaves (about D3-A5), or every minor third with pitch-shift by `playbackRate` (±1.5 semitones max); 2-3 velocity layers; 2 round-robins. About 24-60 files, 1-2 s each.
2. **Bed / pad:** one sustained, loopable note per pitch class (12 × 8-12 s), or chord stems per harmony state (about 8-10 × 12 s). Plus a "paused" variant only if the live low-pass is not good enough (J).
3. **Data layer:** 6-8 tick variants, plus the blip from item 1 at a high register.
4. **Stress:** reuse the loop samples detuned at runtime; one tremolo pad stem if live tremolo is too costly.
5. **Clock pulse (C):** 2-3 sub one-shots.
6. **Accent one-shots:** level-up chord per key (or built from notes), failure thud, POST arpeggio (from notes), drop / expire sighs (from notes, pitch-bent live).
7. **SFX one-shots:** install, uninstall, cable connect, cable disconnect, key plug, key eject, power on, power off, purchase, sell, UI hover, UI click, panel open/close, decline, bill paid. 2-3 variants each.
8. A runtime-synthesized version (Web Audio oscillators, no files) is possible for A and C, like the sample scripts (J); samples sound better.

## 10. Open questions
Resolved 2026-11-21:
- ~~Direction A, B or C~~ → **B, Afterglow** (§0.1).
- ~~Key change per level?~~ → **yes, every level-up, up a fifth on the next bar** (§0.2).
- ~~Safari floor / AAC fallback~~ → **Ogg only; Safari < 18.4 unsupported; no fallback** (§0.3).
- ~~Audio before or after the POC~~ → **after the POC**; no final assets until Dev Lead comes back (§0.4).

- ~~Vorbis or Opus~~ → **Ogg Vorbis q6** (§0.6).
- ~~Cue-clarity measures~~ → **adopted** in the first-pass assets (§0.6); confirm by ear.
- ~~Volume sliders and tab-hidden behaviour~~ → **both yes** (§0.6).

Still open:
1. Where the volume sliders live in Settings (proposal: Interface tab; needs Art Director sign-off).
2. Listening pass on all first-pass assets; first browser test (Chrome, Firefox, Safari 18.4+).

## Sources
- Disasterpeace, "Serialism & Sonification in Mini Metro" (GDC 2018 talk, transcript): https://disasterpeace.com/blog/mini-metro.serialism-talk ; video: https://www.youtube.com/watch?v=FgV4hSfsl00
- Rich Vreeland, mini-metro-audio-toolkit README: https://github.com/richvreeland/mini-metro-audio-toolkit
- Designing Sound, "The Programmed Music of Mini Metro" (2016): https://designingsound.org/2016/02/18/the-programmed-music-of-mini-metro-interview-with-rich-vreeland-disasterpeace/
- Kill Screen, "Music of the Urban Commute": https://www.killscreen.com/music-urban-commute-designing-mini-metros-soundtrack/
- Disasterpeace, "Postmortem: Mini Motorways" (2025): https://disasterpeace.com/blog/mini-motorways.postmortem
- Game Developer, "Turning road noise into music in Mini Motorways": https://www.gamedeveloper.com/design/turning-road-noise-into-music-mini-motorways
- Disasterpeace credits: https://disasterpeace.com/music
- caniuse Opus and PR #7284 (Safari 18.4 Ogg): https://caniuse.com/opus , https://github.com/Fyrd/caniuse/pull/7284
