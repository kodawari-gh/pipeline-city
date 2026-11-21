# Acceptance

Each check names how to run it and what passes. §1–§2 can be run now on the package; §3–§5 apply to the implementation in the repo.

## 1. Package (offline, already passing on 2026-11-21)
| # | Check | How | Pass |
|---|---|---|---|
| 1.1 | SFX / UI / ambience files | `cd sources && ../.venv/bin/python check_all.py previews` → `reference/checks/checks.json` | `184 files checked; 0 with issues` (181 assets + 3 previews): true peak ≤ −1 dBTP (assets ≤ −6.1), no clipped samples, DC < 5e-4, lead silence ≤ 5 ms, one-shot tail ≤ −45 dB rel. peak with no click > −80 dB, loops sample-exact with an inaudible seam |
| 1.2 | Music files | `sources/music/checks.json` (from the music lane's `check.py`) | `summary`: 173 files, `all_tp_le_minus1`, no clipping, all seams OK (WAV and Ogg after `stitchLoop`), Ogg lengths match |
| 1.3 | Levels | `checks.json` `max_momentary` vs `mix-tokens.json` `fileTargets`; ambience `integrated` | every file within ±1 LU of its class target (TP-capped files may be lower); room −40.3, hum −38.2 LUFS |
| 1.4 | **References and coverage** | `python3 sources/check_refs.py` (stdlib only) | prints `OK`: every file named in SPEC.md, IMPLEMENTATION.md, mix-tokens.json and music-spec.json exists in `assets/`; SPEC covers all 353 assets; tokens == sfx/ui/ambience on disk; manifest == disk; every `logRules` cue exists |
| 1.5 | Lengths | `assets/manifest.json` | UI ≤ 0.40 s (all but `ui_transition_in/out`, `ui_confirm`, `ui_error` < 150 ms); gameplay ≤ 1.45 s; `level_up__*` ≈ 2.9 s |
| 1.6 | Previews | `previews/*_cues.md` | sfx reel 30 s −16.3 LUFS −1.4 dBTP; ui reel 21 s −19.5 / −1.4; music preview 40 s −16.0 / −1.3 |
| 1.7 | Tokens type-check | copy `mix-tokens.ts`, `tsc --strict --noEmit` on a file importing `MIX`, `CueId`, `KeyName` | compiles (checked with TypeScript 5) |

## 2. Listening (not done yet)
| # | Check | Pass |
|---|---|---|
| 2.1 | Play both reels and the music preview on headphones and laptop speakers | every cue in the cue list is audible and identifiable over the bed; nothing harsh; UI is clearly quieter than gameplay cues |
| 2.2 | 10 minutes of normal play at 1x and 8x | no cue is tiring; rate limits stop machine-gunning (payout fans, cable bursts) |
| 2.3 | Level 1 → 4 | each pitched cue sounds in key after each key change; the level-up pair (SFX + music −6 dB) is not too heavy |

## 3. Unit tests in the repo (vitest, PR 2)
- **Classifier:** for every `this.note(kind, text)` in `src/worker` (grep), a representative text maps to the intended cue in SPEC §3.1. Include `"... will be swapped in as soon as the job is done"` → `swap_queued`, `"... came unplugged"` → `cable_unplugged`, `"...: the machine crashed and rebooted"` → `fault_crash`, `"... (late)"` → `payout_late`, `"sold ... for $N"` → `sell`.
- **newNotes:** first snapshot returns `[]`; a log of 16 with 3 new notes at one tick returns those 3 in order; a loaded save (tick goes back) returns `[]`.
- **Keys:** `keyPcForLevel(1) = 5` (F), `(2) = 0` (C), `(13) = 5`; `pickFile` for every level 1–12 returns a root with |d| ≤ 1 and the table in SPEC §8; `keyName` returns the music tokens (`Fs`, never `F#`).
- **Paths:** every `cue.files` entry and every `music_*_{KEY}` name built by the code exists under `public/audio/` (read the folder in the test).

## 4. In the browser (PR 1–5; none done yet)
| # | Check | Pass |
|---|---|---|
| 4.1 | Dev cue board (`?debug`): one button per cue id | every cue plays in Chrome, Firefox and Safari 18.4+ |
| 4.2 | Unlock | no sound and no console error before the first gesture; sound after it (iOS Safari included) |
| 4.3 | Decoded lengths | log `buffer.length` vs `manifest.samples` for loops and stems: ambience exact, stems ≥ 4800 + loopSamples + 4800 − 128 |
| 4.4 | Loop seams | room and hum 2 min each, every music stem 3 loops: no click or gap at the loop point |
| 4.5 | Pause | Space: `pause` cue, music to pausebed over 1 s at the same tempo, hum −4 dB; Space again: `resume`, back on the next beat |
| 4.6 | Hidden tab | switch tabs: fade out ~0.5 s, `ctx.state === 'suspended'` after 2 s; back: fade in ~0.8 s, music in phase |
| 4.7 | Sliders | each slider changes only its buses; 0 % silent; values survive a reload (`localStorage["pipeline-city.audio"]`); Mute silences all |
| 4.8 | Voice cap | spam installs and cables at 64x: ≤ 24 voices (log `voices.length`), no clipping on master (meter or `AnalyserNode` peak < 1.0) |
| 4.9 | Level-up | on a level-up the SFX stinger and `music_levelup_<new>` start on the same bar; the music stinger is 6 dB down; stems crossfade to the new key |
| 4.10 | Menu music | the menu always plays `music_menu_F`; Continue on a level-5 save crossfades to A stems on the first frame |
| 4.11 | Memory | Chrome task manager after 3 level-ups: music buffers ≈ 2 keys (~67 MB), not growing |

## 5. Performance
- Cue scheduling ≤ 0.2 ms per snapshot on the main thread (Performance panel).
- No audio work in the worker; `src/architecture.test.ts` still passes.
