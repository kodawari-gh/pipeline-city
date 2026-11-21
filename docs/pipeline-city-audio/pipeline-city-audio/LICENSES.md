# Licenses

All audio in this package is original synthesis made for Pipeline City on 2026-11-21: numpy/scipy oscillators, noise, filters and envelopes, rendered by the scripts in `sources/` (SFX, UI, ambience, previews) and `sources/music/` (music). No samples, recordings, sound libraries, presets or AI audio generators were used. Encoding: ffmpeg's libvorbis.

| Part | Scripts | Notes |
|---|---|---|
| SFX (153 files) | `sources/sfxlib.py`, `sources/gen_sfx.py` | original synthesis |
| UI (26 files) | `sources/gen_ui.py` | original synthesis |
| Ambience (2 loops) | `sources/gen_ambience.py` | original synthesis (periodic noise and tones) |
| Music (172 files) | `sources/music/mlib.py`, `gen_stems.py`, `gen_notes.py` | original synthesis; see `sources/music/LICENSES.md` |
| Previews | `sources/gen_previews.py`, `sources/music/gen_preview.py` | mixed from the shipped files |

The game's owner (Khalil) may use, change and ship all of it without attribution. Tools: Python 3, numpy (BSD), scipy (BSD), matplotlib (PSF-style), soundfile/libsndfile (BSD/LGPL; used only offline), ffmpeg/libvorbis (LGPL/BSD; offline). None of them ship with the game.
