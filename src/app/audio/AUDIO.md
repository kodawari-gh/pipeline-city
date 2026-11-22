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

## Status
Assets are in the repo. The engine (`engine.ts`, loader, cue API) is not yet written. The plan is in the package's `IMPLEMENTATION.md`.
