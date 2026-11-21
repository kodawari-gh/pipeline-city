# pipeline-city music lane (Afterglow)
Start with `music-spec.md` (the rules + file list) and `music-spec.json` (same rules as data, plus a manifest). Measurements in `checks.json`, plots in `sources/checks/`.

Re-render everything (deterministic, ~4 min, needs ffmpeg with libvorbis and the venv at /workspace/audio/.venv):
```
cd sources
python gen_stems.py      # 73 loop stems -> ../stems, masters -> masters/stems
python gen_notes.py      # 99 notes + stingers -> ../notes
python mixcalc.py        # mix tokens check -> mixcalc.json
python build_spec.py     # ../music-spec.json
python gen_preview.py    # ../previews/music_reactive_preview.ogg + cue list
python build_spec.py     # refresh the manifest
python check.py          # ../checks.json + checks/*.png
```
