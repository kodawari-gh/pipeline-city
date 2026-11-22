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

Loading decodes with an `OfflineAudioContext`, so it needs no gesture. A cue whose file is not decoded is skipped, and its file loads for next time.

## Status
Tracer bullet (ticket #51): log notes play their cues. Not yet built: state rules, ambience, music, sliders, UI sounds in components. The plan is in the package's `IMPLEMENTATION.md`.
