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

## Status
Tracer bullet (ticket #51): log notes play their cues. Ticket #53: every log note has its cue, and the swap-done rule. Not yet built: state rules, ambience, music, sliders, UI sounds in components. The plan is in the package's `IMPLEMENTATION.md`.
