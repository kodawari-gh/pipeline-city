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
| `cueBoard.ts` | `?debug` board: one button per cue |
| `volume.ts` | The player's mix rules (pure): slider gain, snap, `busGains` (bus dB times slider gain), per-device read and write |
| `mix.ts` | The live mix: signal `audioMix`, `setSlider`, `setMuted` (wraps `volume.ts` with localStorage) |

### Settings mix
- The Sound block sits in the Settings modal (`src/core/ui/panels/MainMenu.tsx`, `SoundRows`).
- Gain is `(v / 100)^2` on top of each bus default. Each slider drives its buses only. Mute sets every bus to 0.
- `index.ts` follows `audioMix` and calls `engine.applyMix`. A live change ramps (20 ms); a new graph sets it at once.
- Stored per device in localStorage (`MIX.sliders.storageKey`), wrapped in try/catch. Not in the save.
- Releasing the Sounds slider plays one `ui_click` at the new level.

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

## Status
Tracer bullet (ticket #51): log notes play their cues. Ticket #53: every log note has its cue, and the swap-done rule. Ticket #54: state rules, clock and holds. Ticket #55: level-up stinger and the beat hook. Not yet built: ambience, music, UI sounds in components. The plan is in the package's `IMPLEMENTATION.md`.
