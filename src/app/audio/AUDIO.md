# Audio

Sound for Pipeline City. Runs on the main thread. The worker stays audio-free (`src/architecture.test.ts`).

## Where things live
| What | Where |
|---|---|
| Ogg files (SFX, UI, ambience, music stems and notes) | `public/audio/{sfx,ui,ambience,music/stems,music/notes}/` |
| Music rules (runtime) | `public/audio/music/music-spec.json` |
| Mix tokens: bus levels, ducking, fades, rate limits, cue table | `src/app/audio/mixTokens.ts` (read-only, generated) |
| Specs, sources, previews, measurements | `docs/pipeline-city-audio/` (start at its `README.md`) |

The game serves `public/audio/` at `audio/` (the `basePath` in the tokens). Load a file with `` `${import.meta.env.BASE_URL}audio/...` ``.

## Rules
- Do not edit `mixTokens.ts`. Change `mix-tokens.json` in the docs package, or its generator (`sources/build_manifest.py`), then re-run the generator.
- Do not hard-code levels, timings or file lists. Read them from `MIX` and the music spec.
- Check the package: `PYTHONUTF8=1 python3 docs/pipeline-city-audio/pipeline-city-audio/sources/check_refs.py` must print `OK`.

## Code
| File | Role |
|---|---|
| `index.ts` | `initAudio()`, wired from `main.tsx`: unlock, load after `booted`, follow each snapshot; `?debug` adds the cue board |
| `engine.ts` | The real sink: AudioContext (opened on the first gesture), buses, ducking, one-file-at-a-time loader, `playCue` |
| `voices.ts` | Pure voice policy: rate limit, burst collapse, per-cue, per-bus and global caps, stealing |
| `keys.ts` | Level to key, file and rate per cue (pure) |
| `events.ts` | Log note to cue (`logRules`), and the new-notes tracker (no sound on a first snapshot) |
| `director.ts` | Snapshot to key change and cues. Driven through a `CueSink`, so tests use a fake |
| `cueBoard.ts` | `?debug` board: one button per cue, and the stress readout (each term) |
| `stress.ts` | Stress amount (pure): worst throttle, VRM temperature and load ratio, power ratio; the largest term. Feeds the music stress layer and the cue board |
| `uiCues.ts` | UI sound mapping (pure): `data-cue` value and event to cue id; the click's transition step |
| `uiListener.ts` | The one document-level UI listener (hover, keyboard focus, click, checkbox change, arrows, Esc). Installed by `initAudio` |
| `volume.ts` | The player's mix rules (pure): slider gain, snap, `busGains` (bus dB times slider gain), per-device read and write |
| `mix.ts` | The live mix: signal `audioMix`, `setSlider`, `setMuted` (wraps `volume.ts` with localStorage) |
| `ambience.ts` | Ambience controller (pure): room loop on/off, hum on while powered, hum level and rate from fan speed, pause dip. Driven by the director through an `AmbienceSink` (`startLoop`, `stopLoop`, `setHum`, `duckHum`), so tests use a fake |
| `music.ts` | Music controller (pure): the menu loop, the game stems (bed, pluck, bass, shimmer, stress) by phase, key, data feed and speed, crossfades. Driven by the director through a `MusicSink`, so tests use a fake |

### Settings mix
- The Sound block sits in the Settings modal (`src/core/ui/panels/MainMenu.tsx`, `SoundRows`).
- Gain is `(v / 100)^2` on top of each bus default. Each slider drives its buses only. Mute sets every bus to 0.
- `index.ts` follows `audioMix` and calls `engine.applyMix`. A live change ramps (20 ms); a new graph sets it at once.
- Stored per device in localStorage (`MIX.sliders.storageKey`), wrapped in try/catch. Not in the save.
- Each slider plays `ui_value_change` on its arrow keys and on release (its click), at the new level.

Loading decodes with an `OfflineAudioContext`, so it needs no gesture. A cue whose file is not decoded is skipped, and its file loads for next time.

### Log note cues (ticket #53)
- `logRules` (32 rules, first match wins) live in `docs/pipeline-city-audio/pipeline-city-audio/sources/build_manifest.py`. The `level` rule has no cue: level-up waits for its own ticket.
- `director.ts`: when `pendingSwaps` shrinks in a snapshot, the first `install` cue of that snapshot plays `swap_done` instead. The other `install` cues of that snapshot play nothing.
- Notes of one snapshot play in log order, 40 ms apart. The tracker resets on load, new game, leaving a game and a tick that moves back (ADR-0002).
- Every `note(kind, text)` call site in `src/features` and `src/worker` maps to a cue through these rules. Call sites with another signature are not audio: `npu/sim/port.ts` (`note(index, op, ...)`), `tpm/sim/tpm.ts` (`note(ticks, cmd)`), `cpu/sim/engines/common.ts` (`note(kind: number, ...)`), and the UI helpers `board/ui/builddrag.ts` and `board/render/three/buildmode3d.ts`. The note `download #NN failed` (`network/sim/network.ts`) has the generic `ui_notify` cue.

### State rules and the clock (ticket #54)
- `director.ts` `onSnapshot` plays the state rules of SPEC §3.2 from the diff with the last snapshot: link up, saturated, link down, POST, booted, error, PSU trip, key out.
- Boot: `post_boot` on `posting`. `boot_ready` on `idle-os`, or on the first `running` after POST (the no-OS flow). The director keeps a `posted` flag per boot, so a later job's `loading` -> `running` plays nothing.
- A rule is skipped when a note of its family played a cue in the same snapshot: error and PSU trip skip on a `fault` note, key out on a `key` note.
- No state rule plays on the first snapshot, after a reset, or on the snapshot where a loaded save's tick goes back.
- `onUi(UiInput)` plays the clock cues: `pause` on stop, `resume` on start, `speed_up` / `speed_down` between non-zero speeds, `ui_error` on a sim crash (the stop plays `pause` too).
- Holds: `levelUp`, `tutorial` (popup) and `menu`. A stop under a hold plays no `pause`; lifting the hold plays no `resume`. Opening the menu plays `ui_panel_open`. `index.ts` derives the hold from the signals.
- The clock never suspends the AudioContext. Cues play while the clock is stopped. Only a hidden tab suspends it (ticket #59).

### Hidden tab (ticket #59)
- `index.ts` listens to `visibilitychange` and calls `engine.setHidden(hidden)`. Nothing else calls it: Pause and Hold never suspend.
- Hidden: queued cues (voices not yet started) stop, new cues are refused, and the master fades out over `hiddenTab.fadeOutMs` (500 ms). The context suspends `hiddenTab.suspendAfterMs` (2000 ms) after hiding. A tab that returns first cancels the suspend.
- Visible: the context resumes and the master fades in over `hiddenTab.fadeInMs` (800 ms).
- The fade is its own node between master and the output, so the Settings mix does not fight it.
- The game clock and the sim are not touched. The tokens are in `mix-tokens.json` (`hiddenTab`).

### Level-up stinger and key change (ticket #55)
- A `level` log note, or the level-up popup opening, plays `level_up` of the NEW key once. Several levels in one tick give one stinger. The popup and the note of one level play it once between them.
- Timing: `level_up` has `quantise: 'beat'`: it starts on the music clock's next beat. This replaces the SPEC's next-bar rule (owner choice). Token: `levelUp.quantise` in `mix-tokens.json` (generator `build_manifest.py`). With no beat clock (no music running) it plays at once.
- The music sets the clock with `setBeatClock({ secondsToNextBeat(nowS) })` (`engine.ts`). The key change and chord use the same clock (music tickets).
- Sandbox games, load, new game and any level change with no note move the key and play no stinger.
- Files: a level change loads the new key's stinger (`setKeyPc` -> `preloadKey`) and the next level's stinger, so the level-up after this one finds it decoded. The first snapshot of a game sets the level 1 key, which loads the level 2 stinger. A jump of several levels in one tick can skip the stinger of the level it lands on (its file loads at that change). A cue whose file is not decoded when it plays is skipped, never delayed. The stinger ducks other sound by the `milestone` depth.
- The popup can open before the snapshot of its level. The stinger then sets its own level's key first (`director.ts`, `stinger`), so its file is the new key's.

### Ambience: room and hum (ticket #58)
- `director.ts` owns `createAmbience` (`ambience.ts`). It takes each snapshot (`powered`, `devices`), each clock input (`speed`), the scene (`onScene`, from `main.tsx`: `menu` and `game` are the room scene; `build` and `gallery` are the studios) and the first gesture (`onUnlock`, from `unlockOnGesture`). A sink without the ambience calls (a cue-only test) gets none.
- Room loop `amb_room_city_loop`: on while the room scene shows and after the first gesture. Fades in 2000 ms (`startLoop`), out 1500 ms (`stopLoop`). Clock stops do not change it.
- Hum `amb_machine_hum_loop`: on while `snapshot.powered`. Fades in 1200 ms, out 900 ms.
- Hum level: `humGainDb(x)` (-6 dB at x = 0, 0 dB at 1) and rate `humRate(x)` (0.92 to 1.12), sent by `setHum` and ramped over `fanFollow.smoothMs` (800 ms). `x` is `fanSpeed`: the mean `DeviceSnap.fan` of the devices that have a fan (kind `gpu` or `npu`, or any device whose fan turns), or 0.5 when none does.
- Clock stopped (speed 0: Pause or Hold): `duckHum` dips the hum by `pause.ambienceGainDb` (-4 dB) over `pause.fadeMs`. The room does not dip.
- Engine: each loop is level, then pause dip, then the ambience duck. A start or fade gets its own fade node, so a fade-out and a new start can overlap. A loop wished before the AudioContext opens starts at the gesture. A loop not yet decoded starts when it loads.
- Loop ends: `loopStart = 0`, `loopEnd = MIX.ambience[id].samples / sampleRate`. The counts come from the manifest (`build_manifest.py` writes `samples` into the ambience tokens). A decoded length that differs logs one warning per file.

### UI sounds (ticket #56)
- A DOM attribute names the cue. `data-cue="<cue id>"` plays that cue on click (a native button or link by its own click; Enter and Space on a non-native element, such as a `role="radio"` div, by the key listener). It also turns on hover and focus sounds for the element.
- `data-cue="ui_toggle"` (a checkbox) plays `ui_toggle_on` or `ui_toggle_off` on its change event.
- `data-cue="ui_tab_switch"` on a tab plays on click. Arrow keys between tabs play the focus cue.
- `data-cue="ui_value_change"` on a range input plays on click and on the Left and Right arrow keys. Value branches (New game choices) use it too.
- `data-cue="silent"` plays no click sound; hover and focus still play. Use it where the clock or the menu already plays the cue (speed, pause, menu button).
- A label that wraps a hidden file input carries `data-cue="ui_click"`; the input gets `data-cue="silent"`. The click the label forwards to the input then plays nothing, so one activation plays one click.
- `data-cue-next="<cue id>"` plays a second cue 70 ms after the click (the sub-screen transition). Put it on a click that opens a dialog (`ui_click` then `ui_transition_in`). A chip that opens and closes a panel plays no transition.
- Hover: `ui_hover` on `pointerover` from outside the element, on `(hover: hover)` devices only. Focus: `ui_focus_move` on `focusin` after a key press. Esc: `ui_back` while a `[role=dialog]`, `[role=alertdialog]` or `[role=menu]` is open. Arrows: `ui_value_change` on an element with `data-cue="ui_value_change"`, for Left and Right (Up and Down play nothing).
- Nothing plays before the unlock gesture (`playCue` is silent until the context runs).
- Covered: the main menu (buttons, Settings sliders, Graphics entry), New game, the in-game menu (items, UI size slider), the HUD chips, speed rail, level bar, power bill, stats dock, the HUD InventoryBar (8 buttons), the sandbox HUD (SANDBOX and LEVEL chips), the tutorial card buttons, the Controls Done and Confirm buttons (Back), the OS window (tabs, close) and the Graphics sheet (tab bar, slider). Not yet: other panels (Log, Shop, Build my PC, OS pages, Trace), the rest of the Graphics sheet, and the tutorial typing.

### UI sounds: toasts, panels, drag, typing, sliders (ticket #57)
- Hint toast (`Toasts.tsx`) plays `ui_warn` when it shows. The refused-action notice plays `ui_error`. The notify cue (`ui_notify`) stays on the network and sandbox log notes only.
- Panels: each panel root carries `data-cue="ui_panel_open"` as a marker. `panelCues.ts` plays `ui_panel_open` when the inventory, Shop, Almanac, Log, OS or Build flag turns on. The director plays it when the in-game menu holds the clock. The marker itself plays nothing on click, hover or focus. Each close button carries `data-cue="ui_panel_close"`.
- Part drag: `drag3d.ts` plays `ui_pickup` when a part drag starts (from the shelf or from the board).
- Tutorial typing: `TutorialCard.tsx` plays `ui_type_tick` on every third typed character. A skip to the end plays none. Reduced motion plays none.
- Sliders: every range input (`input[type=range]`) plays `ui_slider_tick` once per 5 % step (`sliderStep` in `uiCues.ts`). The listener compares the step on each input event. A click on a slider plays no extra tick.
- The Build flyout (`BuildMode.tsx`): `panelCues.ts` plays `ui_panel_open` when `buildOpen` turns on (the Build my PC button plays `ui_click` only). Its X carries `ui_panel_close`. The machine list (`BuildMachine.tsx`) carries the open marker and has no close button of its own.

### Music: menu and game (ticket #61)
- `music.ts` (`createMusic`) gets the scene, the save's key, the phase and the unlock from `director.ts`. `engine.ts` is its sink (`startMusic`, `stopMusic`, `setMusicGain`, `preloadMusic`, `decodeKey`, `releaseKey`).
- Tempo: 66 bpm, fixed by the file. A loop is 4 bars of 4 beats (`BAR_S`, `BEAT_S`, from `MIX.music.loopSamples`). Each stem loops on its inner region (`loopStart` = PAD, `loopEnd` = PAD + loop) and is stitched once per decode (`stitchStem`).
- Scheduling: a grid call (`bar`, `beat`) is queued with its grid time. A 25 ms timer starts it once that time is within 100 ms of `ctx.currentTime`. Calls on one voice keep their issue order. A `now` call runs at once.
- Menu: `music_menu_F` always, whatever the save's level. After the unlock it starts at once with a 2 s fade in. It preloads at the first phase after `booted` (`off`, `posting`, `mounting` and `loading` do not preload it).
- First game frame: the menu fades out over 2 s on the next bar, and the game stems fade in on that bar.
- Key change in the game: the stems cross over 1.4 s.
- Main menu from the game: the game stems fade over 1.5 s, and the menu loop starts on the next bar. Going back to the game stops the menu on the next bar (2 s).
- Phase table (state targets). Gains are linear: a layer gain is `MIX.music.layerGainDb` + 20 log10(target) dB (music-spec.md §4 and §8). The off bed (0.5) is -6 dB:

| State | Phases | Bed | Pluck | Bass |
|---|---|---|---|---|
| off | `off` | 0.5 | 0 | 0 |
| boot | `posting`, `mounting`, `loading`, `booting-os` | 1 | 0.5 | 0 |
| idle | `idle-os`, `halted`, `waiting-for-key`, `done-remove-key` | 1 | 0.6 | 0 |
| running | `running`, `running-os`, `ingesting`, `flashing`, `writing` | 1 | 1 | 1 |

- Other phases (any not listed) play no keyed layer. Entries start on the bar. Exits stop on the beat, with a 1 s fade. A state change fades the gains over 2 s.
- Keys: the save's level key (`keyName(keyPcForLevel(level))`). Memory holds the current key and the key a fifth up (+7 semitones). A key change decodes the new pair and releases the rest.

### Music: data, stress and speed (ticket #62)
- `director.ts` `musicFeed(s)` gives the music a `MusicFeed` each snapshot: `flowing` (link up or saturated, or a transfer, or a job key ingesting; a down link with a transfer or an ingest still flows), `saturated`, `stress` (0..1; `vrm` or `board.vrm`) and `debt` (`bill.unpaid > 0`). The stress layer's gain is the token dB plus 20 log10(stress^1.5). `onUi` passes the clock speed to `music.onSpeed`.
- Shimmer `music_shimmer_<KEY>`: on while `flowing`. Fades with the data gain (`layerGainDb.shimmer`, -7 dB). Saturated adds +2 dB and a 4000 Hz low-pass. Otherwise the low-pass is open (the Nyquist frequency, 24000 Hz). Fades in and out on the bar (BAR_MS).
- Stress `music_stress_<KEY>`: on while `stress > 0`. Gain is the token dB plus 20 log10(stress^1.5), as above (-6 dB at most), ramped on the bar.
- Debt: the bed low-pass goes to 3000 Hz while `debt` is set, over 1 s (`TIMING.debtFadeMs`), and opens again over 1 s when it clears.
- Speed: `speedMix(speed)` changes density and brightness only, never tempo (stems stay 66 bpm). Speed 1 cuts the bass and dims the shimmer 6 dB. Speed 2 lowers bass and shimmer 3 dB. Speed 4 is neutral. Speed 8 is brighter (+2 dB shimmer) and denser. Speed 12, 16 and 64 are brightest (+1 dB bass, +3 dB shimmer). Each change ramps over `TIMING.speedFadeMs` (500 ms). Density caps the event notes: each note cue carries `perBeat` = `EVENT_NOTES_PER_BEAT` (4, a judgement: the spec gives only the multipliers) x density. At most that many notes start in one beat of the grid (`engine.ts` `beatAllows`); the rest merge and are not played. Speed 1, 2, 4: 4 per beat. Speed 8: 8. Speed 12, 16, 64: 12. The stateCues (state rules) are not capped.
- Stress amount (`stress.ts`): each term is 0 at its threshold and reaches 1 at `STRESS_SCALE` (0.2) past it. Throttle: 1 minus the worst device throttle. Temperature: VRM temperature between throttle and damage temperature. VRM: load ratio minus 1. Power: totalW / budgetW minus 0.9. The amount is the largest term. The cue board shows each term.
- Decode on first use: a shimmer or stress start whose file is not decoded yet waits. It starts on the next bar after the load. A stop of a waiting start drops it.
- Pause (speed 0): shimmer and stress go silent (spec: 0). They stop over the 1 s pause fade, on the next beat. Bass is off while stopped (see #63). The speed mix itself stays neutral while stopped.

### Music under pause, failure and hidden tab (ticket #63)
- Clock stopped (`onUi` speed 0: Pause or Hold; `director.ts` passes `onStopped`). The bed gives way to `pausebed` over 1 s, on the next beat. The pluck drops `pause.musicHold.pluckDb` (-5 dB) and goes through a low-pass at `pause.musicHold.lowpassHz` (850 Hz), also over `pause.fadeMs`. Bass is quiet. Tempo does not change: all pause calls are on the beat grid. Resume: the same layers come back on the next beat over 1 s, and the pluck opens. The data layers (shimmer, stress) are off while stopped (spec: shimmer 0, stress 0 on pause). They stop over 1 s on the next beat (the pause fade) and start again on the bar after resume, if the feed still asks for them (the spec says the next beat; kept on the bar).
- Error phase: `pausebed` alone (bar entry, 2 s), no other keyed layer.
- Hard failure (`director.ts` `hardFault`): a part burnt (the error phase starts without a POST error), the PSU trips, or the wall is cut for the bill (`bill.cut`). It plays one fault stinger `music_fault_<KEY>` (`notes/`), in the current key, on the next beat. A POST error is soft: the error phase plays the pausebed alone, and no stinger. The stinger is its own sound: a note of the same fault does not skip it.
- Hidden tab (`director.ts` `onHidden`, from `index.ts` with `setHidden`): the music records state and sends nothing. `engine.ts` `setHidden` drops the queued cues, the queued stingers and the queued music calls (the look-ahead), and returns whether a music call was dropped. Keys still load. On return one instant pass sets every call to 0 ms, quantise `now`: layer gains go straight to target, a key change swaps the stems at once (no fade, no stinger), and stems that stay on keep playing. Stems keep their phase: a stem starts at its place on the grid (`beginVoice`). If a music call was dropped, the return sends every layer call of the set again (the engine starts a missing stem, stops a stem that should be off, and stops the old set's stems); the engine keeps a stem that already plays.
- Engine: every voice has a low-pass node (`lp`, ticket #62); the pluck uses it for the pause. `setMusicLowpass` and `playStinger` are optional on `MusicSink`, so a fake without them is still valid.

## Status
Tracer bullet (ticket #51): log notes play their cues. Ticket #53: every log note has its cue, and the swap-done rule. Ticket #54: state rules, clock and holds. Ticket #55: level-up stinger and the beat hook. Ticket #56: UI sounds on the menus and HUD (see "UI sounds"). Ticket #58: room loop and machine hum. Ticket #61: menu and game music, with the look-ahead scheduler (see "Music"). Ticket #62: data, stress and speed layers in the music (see "Music: data, stress and speed"). Ticket #63: music under pause, failure and hidden tab. Not yet built: UI sounds on the remaining panels. The plan is in the package's `IMPLEMENTATION.md`.
