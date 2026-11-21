> **Merged copy (2026-11-21).** The music lane's own notes, kept for reference. In this package the JSON is at `assets/music/music-spec.json`, the stems and notes at `assets/music/`, the preview at `previews/`. §11 is resolved in the package SPEC §1 (decisions 4–8); where this file and SPEC / `mix-tokens.json` differ, those win.

# Pipeline City music: Afterglow reactive score (music lane)

Version 1.0, 2026-11-21. Direction **B, Afterglow** (Khalil, 2026-11-21). The same rules as data: [`music-spec.json`](music-spec.json) (the engine should read that file; this page explains it). Measurements: [`checks.json`](checks.json). All audio is original synthesis (`LICENSES.md`). **(J)** = my judgement.

Repo facts used (read-only clone `/workspace/repos/pipeline-city-sound` @ `da577448`): pause is `speed === 0` (`src/app/store.ts` `togglePause`, `setSpeed`, `lastRunSpeed`); `Speed = 0|1|2|4|8|12|16|64`, `DEFAULT_SPEED = 4` (= "1x"); `Phase`, `KeyStage`, `LinkState` in `src/worker/game/types.ts`; log notes `install power cable key job payout drop expire level fault ecc net bill contract purchase`; `levelUp` signal and `popupPause` in `src/core/ui/state.ts`.

## 1. What is here
| Path | What | Count | Length | Loudness (file) | Ogg size |
|---|---|---:|---|---|---:|
| `stems/music_bed_{KEY}.ogg` | pad bed, always on in game | 12 | 4 bars = 14.545 s | −20.0 LUFS, TP ≤ −8.0 | 1.69 MB |
| `stems/music_pluck_{KEY}.ogg` | soft echoing pluck loop, D4–A5 | 12 | 4 bars | −20.0, TP ≤ −2.6 | 3.43 MB |
| `stems/music_bass_{KEY}.ogg` | soft pulse/bass, E1–D#2 + harmonics | 12 | 4 bars | −20.0, TP ≤ −5.4 | 0.67 MB |
| `stems/music_shimmer_{KEY}.ogg` | data-flow shimmer: triplet blips C6–C7 + 16th ticks | 12 | 4 bars | −20.0, TP ≤ −4.7 | 4.11 MB |
| `stems/music_stress_{KEY}.ogg` | overload: +28 ct double, 16th tremolo, sharp off-beat plucks | 12 | 4 bars | −20.0, TP ≤ −7.8 | 2.98 MB |
| `stems/music_pausebed_{KEY}.ogg` | pause/hold bed: darker (2.5 kHz), slower | 12 | 4 bars | −20.0, TP ≤ −8.7 | 1.62 MB |
| `stems/music_menu_F.ogg` | title/menu loop, F Lydian | 1 | 8 bars = 29.091 s | −20.0, TP −9.3 | 0.43 MB |
| `notes/music_note_pluck_{C3..C6}.ogg` | cue pluck, chromatic | 37 | 1.2 s | −20.0, TP ≤ −3.1 | 0.37 MB |
| `notes/music_note_glint_{C5..C7}.ogg` | glint, chromatic | 25 | 0.6 s | −20.0, TP ≤ −7.4 | 0.16 MB |
| `notes/music_note_low_{C2..C3}.ogg` | low thud tone, chromatic | 13 | 1.8 s | −20.0, TP ≤ −7.0 | 0.12 MB |
| `notes/music_levelup_{KEY}.ogg` | key-change transition chord, NEW key | 12 | 4.5 s | −19.0 to −21.2 (TP-capped), TP ≤ −1.1 | 0.78 MB |
| `notes/music_fault_{KEY}.ogg` | crash: low 5th → root + dark swell | 12 | 4.0 s | −18.0, TP ≤ −4.6 | 0.35 MB |
| `previews/music_reactive_preview.ogg` | demo: level-up + pause | 1 | 40.0 s | **−16.0 LUFS, −1.3 dBTP** | 0.75 MB |

`{KEY}` tokens: `F C G D A E B Fs Cs Gs Ds As` (s = sharp). Note tokens: `Cs4` = C#4, MIDI 60 = C4. Total shipped: **172 Ogg files, 17.5 MB** (stems 14.9 MB, 1.24 MB per key). Masters: 24-bit WAV in `sources/masters/` (not shipped). Contact sheets: `sources/checks/*.png`.

## 2. Transposition: 12 rendered keys (decision)
All keyed stems are **rendered in all 12 keys**; nothing is transposed with `playbackRate`.
- `playbackRate` changes pitch **and length**: a shift of up to ±6 semitones makes a 4-bar loop 29 % shorter or 41 % longer, so layers fall out of bar sync with each other and with the beat grid. Browsers have no time-stretch node. That rules it out for loops.
- 12 keys keep every stem exactly 4 bars at 66 bpm with no shift artefacts. Cost: 1.24 MB of Ogg per key (6 layers), 14.9 MB for all keys. Only the **current and next key** are fetched/decoded at any time (§7), so the download per session start is ~2.5 MB plus the menu loop.
- One-shot notes are **chromatic** (every semitone in their register), so they are never shifted either; level-up and fault stingers are one file per key.
- Memory cost (J): a decoded key is ~34 MB of float PCM (6 × 14.5 s × 48 kHz × 2 ch × 4 B); current + next ≈ 67 MB. See KNOWN ISSUES.

## 3. Clock
- 66 bpm, 4/4, 12 sub-steps per beat. Every stem is **698 182 samples** = 4 bars (exact 4 bars would be 698 181.8). **Derive the grid from the file**: `beat = 698182 / 48000 / 16 = 0.9090911 s`, `bar = 3.6363646 s`. Then the scheduler never drifts from the audio.
- One loop clock `t0` (AudioContext time when music started). Bar `n` starts at `t0 + n × bar`. Every stem is started so its loop phase is `(when − t0) mod loopSeconds`.
- **Tempo never changes**: not with game speed, not with stress, not in pause (§5, §6). This replaces the 75 % pause clock and the speed→tempo map in audio-style §3.1 and handoff SPEC §6 (stems are fixed-tempo audio; changing tempo would detune them).

## 4. Layers and states (who plays when)
Target gains are linear multipliers on top of the mix tokens (§8). Layer changes are quantized: **entries on the next bar, exits on the next beat** (unless stated).

| State | Trigger (repo) | bed | pluck | bass | shimmer | stress | pausebed | fade |
|---|---|---|---|---|---|---|---|---|
| menu | main menu 01/02, new game 04, load confirm 05, settings 06, controls 09 from menu | – | – | – | – | – | – | `menu` stem = 1, 2 s |
| loading | screen 03 | menu continues; on first frame (11) crossfade to the game's key on the next menu bar, 2 s | | | | | | 2 s |
| off | `Phase "off"` | 0.5 | 0 | 0 | 0 | 0 | 0 | 2 s |
| boot | `posting mounting loading booting-os` | 1 | 0.5 | 0 | – | – | 0 | 1 bar; + rising pluck per 1/6 of `bootProgress` |
| idle | `idle-os halted` (+ legacy `waiting-for-key done-remove-key`) | 1 | 0.6 | 0 | – | – | 0 | bar |
| running | `running running-os ingesting flashing writing` | 1 | 1 | 1 | – | – | 0 | bar |
| data (adds) | any `LinkState` `link-up`/`saturated`, a `TransferSnap`, or `KeyStage` `ingesting downloading uploading` | | | | 1 (saturated: +2 dB, low-pass 4 kHz) | | | in on bar, out over 1 bar (`down no-cable no-os no-device`) |
| stress (adds) | amount 0..1 = worst of `1 − throttle`, temperature, `VrmSnap.loadRatio − 1`, `power.totalW / budgetW − 0.9` | | | | | amount^1.5 | | 1 bar in / out; never > +2 LU |
| error | `Phase "error"`, fault "POST failed" | 0 | 0 | 0 | 0 | 0 | 0.7 | 1 s |
| hard failure | fault "VRM burnt out", `DeviceSnap.burnt`, `power.tripped`, `bill.cut` | 0 | 0 | 0 | 0 | 0 | 0.7 | 0.3 s, + `music_fault_{KEY}` |
| debt (modifier) | `bill.unpaid > 0` | low-pass 3 kHz on bed + pausebed until paid | | | | | | 1 s |
| **pause** | `speed === 0` | → 0 | 850 Hz low-pass, −5 dB | 0 | 0 | 0 | → 1 | 1 s, §5 |

"–" = not changed by that state. If no part is installed the pluck layer stays off (it enters on the bar after the first `install`).

## 5. Pause, resume, speed
**Pause (speed 0: Space/`togglePause`, HUD, `popupPause`, `crash`; the Paused menu 10 too). It never cuts.**
- Over 1.0 s: equal-power crossfade bed → pausebed; pluck through a low-pass to 850 Hz at −5 dB; bass, shimmer, stress fade to 0. Measured: the pause mix sits at **−18.3 LUFS** vs **−16.5** running (1.8 LU lower, inside the guide's 1–2 LU), spectral centroid drops from ~1.7 kHz to ~0.85 kHz (`checks.json` → `preview_reaction`).
- Tempo stays 66; the stems keep running. Never `AudioContext.suspend()`, never stop the stems.
- A `step`/`stepTick` while paused plays one pluck note at −8 dB through 1.5 kHz on the next beat.
- A key change can land inside the pause (the level-up card): pausebed(old key) crossfades to pausebed(new key).
- **Resume** (speed 0 → > 0): on the next beat, 1.0 s back to the current state's targets.

**Speed (decided: tempo does not follow).** Speed changes density and brightness, like Mini Motorways. Per `speed`: `1` bass off, shimmer −6 dB · `2` bass −3, shimmer −3 · `4` (1x) as designed · `8` shimmer +2 dB, event density ×2 · `12`, `16`, `64` shimmer +3, bass +1, density ×3. 0.5 s ramps. "Event density" = max event notes per beat before merging (payout fans merge, repeated install/cable notes collapse to one per 1/12 beat).

## 6. Key change sequencing
1. Key for level L: `KEYS[(L − 1) mod 12]`, `KEYS = F C G D A E B F# C# G# D# A#` (pc = (5 + 7(L−1)) mod 12; level 13 = F). Bed root sits in E2–D#3 (`bed_root_midi` in the JSON).
2. On a new `snapshot.log` entry `kind === "level"` (or the `levelUp` signal): queue the change for the **next bar line**.
3. At that bar: start all 6 stems of the new key at the bar's loop phase and **equal-power crossfade all keyed layers at once over 1.4 s**; stop the old sources after the fade. Same bar: `music_levelup_{NEW}` once (ducks music −4 dB).
4. Several levels in one tick: one fifth per bar until the target; the stinger only on the first step.
5. No transition (load save, new game, sandbox `setLevel`): set the key on the next bar with the 1.4 s crossfade and **no** stinger.
6. Preload: always keep the current and next key (+7) decoded. If the target key is not decoded yet, hold the old key and change on the first bar after decode.
7. Event notes always take the nearest tone of the current scale in their register (`registers` in the JSON).

## 7. Implementation notes (TS / Web Audio)
Loop stems carry **100 ms (4800 samples) of wrap-around audio before and after the loop** (lossy codecs smear file edges; this keeps the seam mid-stream). After `decodeAudioData`, stitch once, then loop on the inner region:
```ts
const PAD = 4800;                        // music-spec.json format.loop_padding
export function stitchLoop(buf: AudioBuffer, loopSamples: number, n = 480): void {
  // crossfade the last n samples before loopEnd into the pre-roll copy of the same audio,
  // so the last played sample is stream-continuous with loopStart (mirrors sources/mlib.py stitch_loop)
  const e0 = PAD + loopSamples - n;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) { const a = i / n; d[e0 + i] = d[e0 + i] * (1 - a) + d[PAD - n + i] * a; }
  }
}
export function startStem(ctx: AudioContext, buf: AudioBuffer, out: AudioNode, when: number, t0: number, loopSamples: number) {
  const sr = buf.sampleRate, loopSec = loopSamples / sr;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  src.loopStart = PAD / sr; src.loopEnd = (PAD + loopSamples) / sr;
  const phase = (((when - t0) % loopSec) + loopSec) % loopSec;
  src.connect(out); src.start(when, PAD / sr + phase);
  return src;
}
```
- Graph (J): each layer → its own `GainNode` (state target × token gain) → `music` bus; pluck layer also through a `BiquadFilterNode` (lowpass, 20 kHz → 850 Hz in pause); bed and pausebed → a debt low-pass; music-note one-shots → a `musicCues` gain → a 0.682 s `DelayNode` send at −12 dB (feedback 0.3, first hit dry) + the shared reverb send 0.18 → `music`. The docs lane's ducking acts on the `music` bus.
- Keep the current key's 6 stems always playing (gain 0 when off): layer entries are then just gain ramps on the bar, with no restart. ~7 sources steady, ~14 during a key crossfade.
- Schedule with a look-ahead scheduler on `ctx.currentTime` (25 ms timer, 100 ms horizon), not on `requestAnimationFrame`.
- Event notes: `music_note_{pluck|glint|low}_{NOTE}`. Player input (drag-drop install, cable plug, power, key plug) plays at once; sim-driven notes snap to the next 1/12 beat. Rate limits and voice cap (8 cue voices, steal oldest) are in `voices` in the JSON.

### Event → note map (degrees from the current root; 0 = root, 7 = octave)
| kind | music |
|---|---|
| `install` | pluck deg 0, build register (C4–C5); pluck layer enters next bar if off |
| uninstall / sell | pluck 4 → 0, half a beat apart, −20 cents |
| `power` | on: pluck 0, 4, 7 a third of a beat apart; off: bed to 0.5 over 2 s |
| `cable` | connected: pluck 0 → 4 rising; disconnected / came unplugged: 4 → 0 falling, −25 cents, + low root |
| `key` | pluck deg 2, flow register (C5–C6) |
| `job` | pluck deg 0, flow register |
| `payout` | glint fan of chord tones 0 2 4 6 7 9, count 3 + min(3, ⌊log10 amount⌋), 1/3 beat apart; "(late)" = 2 notes; payouts within 1 beat merge |
| `drop` | low deg 4 −50 cents + falling glint deg 3 |
| `expire` | low 2 → 0 |
| `level` | §6 |
| `fault` | crash: `music_fault_{KEY}` next beat; pluck/bass/shimmer/stress out over 0.15 s; music low-pass to 250 Hz over 0.5 s, back over 2 s when the Phase recovers; layers re-enter one per beat. POST failed = error state; burnt/tripped = hard failure |
| `ecc` | glint deg 3 (the Lydian #4), −4 dB, max 1 per beat |
| `net` | link up: glint 4 → 7 + data state; link down: shimmer out over 1 bar |
| `bill` | paid: glint 4 → 0; unpaid: debt state |
| `contract` | accepted: pluck 4 → 8; ended: 8 → 4 |
| `purchase` | none (SFX lane) |

### Hidden tab (music's part; the docs lane owns the master fade + suspend)
While hidden, ignore state changes and drop queued notes and stingers. On visible: read the current snapshot, set layer gains straight to target (the master fade-in covers it), and if the level changed set the key directly (no stinger). Stems keep their phase because the context is suspended, not stopped; recompute the next bar from `ctx.currentTime`.

## 8. Mix tokens (for the docs lane's mix-tokens file)
Every stem and note file is at −20 LUFS (stingers −18). Gains below are applied on the music bus input; `music_trim_db` is added to all of them.

| token | dB |
|---|---:|
| `music_trim_db` | +0.3 |
| layer `bed` / `pluck` / `bass` / `shimmer` / `stress` | 0.0 / −2.0 / −5.0 / −7.0 / −6.0 |
| layer `pausebed` | +1.0 |
| layer `menu` | +2.5 |
| cue `pluck` / `glint` / `low` (music notes) | +2.0 / 0.0 / +1.0 |
| stinger `levelup` / `fault` | 0.0 / 0.0 |
| cue echo | 0.75 beat, −12 dB, feedback 0.3, first hit dry; reverb send 0.18 |

Measured on the decoded Ogg (`sources/mixcalc.json`): **all layers on: −16.1 to −15.9 LUFS over the 12 keys, true peak ≤ −1.0 dBTP (worst key; no margin left, see KNOWN ISSUES)**; running without stress −16.5; pause −18.3; menu −17.2. In the game the docs lane's `music` bus default (−8 dB) then puts the music at ~−24 LUFS under the cues. Ducking: the docs lane's values (−2 standard, −3 key, −4 failure/milestone; 10/150/400 ms).

## 9. Preview
`previews/music_reactive_preview.ogg`: 40.0 s, **−16.0 LUFS, −1.3 dBTP** (Ogg). Built only from the shipped stems and notes with these rules (`sources/gen_preview.py`). Cue list: `previews/music_reactive_preview_cues.md` (+ `.json`), plot with cue markers: `sources/checks/preview.png`.

## 10. Checks (`checks.json`, `sources/check.py`)
173 files: all ≤ −1 dBTP (WAV and Ogg), no clipped samples, max DC 1.9e-6, no leading silence on stems (0 ms) and ≤ 0.15 ms on notes. Every decoded Ogg stem is exactly 698 182 (menu 1 396 364) samples inside the padding. **Seams:** WAV masters are periodic by construction (snapped oscillator frequencies, periodic envelopes, tails and reverb folded modulo the loop); seam jump ≤ 0.020 vs in-file steps p99.9 (all pass). Ogg after `stitchLoop`: seam jump ≤ 0.022 (all below their p99.9 step), and the coding error above 5 kHz at the seam is within +3 dB of the same window on the loop's other bar lines (all 73 pass; without the stitch the bed/bass seams show 20–45 dB extra HF error, still under −80 dBFS, so the stitch matters).

## 11. Coordination with the docs / SFX lane (needs the merger)
1. **Level-up doubles up.** The SFX lane's `level_up__{KEY}` and my `music_levelup_{KEY}` both play on the same bar in the new key. Measured pitch content of both (C): C, D, E, G, so no harmonic clash, but two chords at once is heavy. Suggest: keep both, play `music_levelup_{KEY}` at −6 dB when the SFX stinger plays (or keep only one). Token: `levelup_with_sfx_db = −6`.
2. **Handoff SPEC §6 and mix-tokens `pause.musicHold.tempoScale 0.75` and "clock nudged by game speed"** conflict with §3/§5 here: tempo is fixed at 66. Set `tempoScale` to 1.0 and drop the speed→tempo nudge; the pause darkening is the pausebed stem + the 850 Hz pluck filter. `padLowpassHz 2600` is baked into the pausebed (2.5 kHz), and `musicGainDb −1.5` is already covered by the measured −1.8 LU.
3. **Menu music:** SPEC §6 says the pad bed at level 1 or the autosave's level. I deliver a dedicated `music_menu_F` (title loop). Suggest the menu always uses it, and the game crossfades into the save's key on the first frame.
4. SPEC §6 slot list ("pad per pitch class, loop pluck multisamples, data blips") is superseded by §1 here: per-key stems + chromatic notes.

## 12. Known issues
- **Not heard by a person.** Everything is checked by measurement only; the timbres are synthesized sketches of the Afterglow sound, good enough to build and tune against.
- **All-layers-on true peak is −1.0 dBTP on the worst key** (Ogg q6): on the limit. The game's `music` bus default (−8 dB) gives plenty of room; if the music is ever played at 0 dB with all layers on, take the `pluck` token to −2.5 dB.
- **Decoded memory** ~34 MB per key (≈ 67 MB for current + next, + 11 MB menu). On phones consider decoding `stress` and `shimmer` only when their state first turns on.
- `music_levelup_{KEY}` files are true-peak capped, so their integrated loudness is −19.0 to −21.2 LUFS instead of −18.
- The seam stitch (`stitchLoop`) must run after decode; without it the bed/bass seams carry 20–45 dB of extra HF coding error (still below −80 dBFS).
- Safari ≥ 18.4 Vorbis pre-skip trimming was not tested in a browser here; the 100 ms padding means an error of a few samples only shifts the loop phase, it cannot click.
