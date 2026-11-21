# Pipeline City audio: implementation

How to build the audio into the repo (TS, Vite, Preact signals, PixiJS, three.js, sim in a Web Worker). All audio runs on the **main thread** in `src/app/audio/`; the worker stays DOM- and audio-free (`src/architecture.test.ts`). Numbers come from `mix-tokens.ts` and `public/audio/music/music-spec.json`; never hard-code them. Code below is a sketch to adapt, not a drop-in: it compiles in shape but has not been run (KNOWN-ISSUES §2).

## 1. Files to add
```
public/audio/sfx/*.ogg  ui/*.ogg  ambience/*.ogg        <- assets/sfx, assets/ui, assets/ambience
public/audio/music/stems/*.ogg  notes/*.ogg  music-spec.json   <- assets/music
public/audio/manifest.json                                 <- assets/manifest.json (optional; only loop sample counts are needed at runtime)
src/app/audio/mixTokens.ts     <- mix-tokens.ts (generated, do not edit)
src/app/audio/engine.ts        context, buses, ducking, loader, playCue, voices      (§2–§4)
src/app/audio/keys.ts          level -> key, file choice and playbackRate            (§4.2)
src/app/audio/events.ts        snapshot diff -> cue ids (log rules + state rules)    (§5)
src/app/audio/ambience.ts      room + hum loops, fan follow                          (§6)
src/app/audio/music.ts         Afterglow director: clock, stems, states, key change  (§7)
src/app/audio/settings.ts      sliders, mute, localStorage                           (§8)
src/app/audio/index.ts         initAudio(): unlock, visibility, effects              (§9)
src/app/audio/*.test.ts        log-rule and key tests                                (ACCEPTANCE §3)
```
Wire `initAudio()` once from `src/app/main.tsx` after the store exists. UI components call `uiSound('ui_click')` (§10).

## 2. Graph
```
 cue voices ─► sfx bus ─┐
 ui voices  ─► ui bus  ─┤
 music layers ─► musicDuck ─► music bus ─┼─► master (slider × hidden-tab fade × mute) ─► ctx.destination
 room, hum  ─► ambDuck   ─► ambience bus┘
```
- Every bus is a `GainNode`; gain = `dB(bus.defaultDb) × slider²`. `musicDuck` and `ambDuck` are separate `GainNode`s so ducking never fights the sliders.
- No compressor or limiter on master: files are ≤ −1.2 dBTP and buses sit under 0 dB. Add a `DynamicsCompressorNode` (threshold −6, ratio 4, knee 6) only if clipping is heard with many voices.
- One `AudioContext({ latencyHint: 'interactive' })`; files are 48 kHz. Do not set `sampleRate` (Safari resamples).

```ts
// engine.ts
import { MIX, type CueId, type BusId } from './mixTokens';
export const dB = (d: number) => Math.pow(10, d / 20);
const BASE = `${import.meta.env.BASE_URL}audio/`;

export const ctx = new AudioContext({ latencyHint: 'interactive' });
export const hiddenFade = ctx.createGain(); hiddenFade.connect(ctx.destination);   // §9
export const userMaster = ctx.createGain(); userMaster.connect(hiddenFade);        // master slider × mute, §8
const master = ctx.createGain(); master.gain.value = dB(MIX.buses.master.defaultDb); master.connect(userMaster);
export const bus = {} as Record<BusId, GainNode>;
for (const id of Object.keys(MIX.buses) as BusId[]) {
  if (id === 'master') { bus.master = master; continue; }
  bus[id] = ctx.createGain(); bus[id].gain.value = dB(MIX.buses[id].defaultDb); bus[id].connect(master);
}
export const musicDuck = ctx.createGain(); musicDuck.connect(bus.music);      // music.ts connects its layers here
export const ambDuck = ctx.createGain(); ambDuck.connect(bus.ambience);       // ambience.ts connects its loops here
```

## 3. Loading and unlock
- Fetch with `fetch(BASE + path)` → `arrayBuffer()` → `ctx.decodeAudioData()`. Cache `Promise<AudioBuffer>` per path so parallel calls share one fetch.
- Preload at boot (after `booted`): all UI (26 files, ~0.4 MB), the F root of every pitched cue, fixed SFX, both ambience loops, `music_menu_F`. Load the other roots and the 12 `level_up__*` lazily: on a level change load the new key's root files and `level_up__<next key>`.
- A cue whose buffer is not decoded yet is **skipped**, not delayed (a late sound is worse than none).
- Browsers start the context suspended. Resume on the first `pointerdown` / `keydown` / `touchend` (`MIX.unlock.events`), then remove the listeners. Before unlock, `playCue` does nothing.

```ts
const cache = new Map<string, Promise<AudioBuffer | null>>();
export function load(path: string): Promise<AudioBuffer | null> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(BASE + path).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((a) => ctx.decodeAudioData(a)).catch((e) => { console.warn('audio load', path, e); return null; });
    cache.set(path, p);
  }
  return p;
}
const ready = new Map<string, AudioBuffer>();   // filled when a load resolves; playCue reads only this
export async function preload(paths: string[]) { for (const p of paths) { const b = await load(p); if (b) ready.set(p, b); } }

export function unlockOnGesture() {
  const go = () => { void ctx.resume(); for (const e of MIX.unlock.events) removeEventListener(e, go, true); };
  for (const e of MIX.unlock.events) addEventListener(e, go, true);
}
```

## 4. Cue API
### 4.1 `playCue(id, opts)`
```ts
type Cue = (typeof MIX.cues)[number];
const CUE = new Map<CueId, Cue>(MIX.cues.map((c) => [c.id, c]));
interface Voice { src: AudioBufferSourceNode; gain: GainNode; cue: CueId; bus: BusId; prio: number; t: number }
const voices: Voice[] = [];
const last = new Map<CueId, number>();          // last start, ms (performance.now)
const rr = new Map<CueId, number>();            // round-robin index
let keyPc = 5;                                  // set by keys.ts from snapshot.level.level
export const setKeyPc = (pc: number) => { keyPc = pc; };

export function playCue(id: CueId, opts: { when?: number; gainDb?: number } = {}) {
  if (ctx.state !== 'running') return;
  const c = CUE.get(id); if (!c) return;
  const now = performance.now(), prev = last.get(id) ?? -1e9;
  if (now - prev < Math.max(c.minIntervalMs, c.collapseMs)) return;           // rate limit + burst collapse
  const pick = pickFile(c, keyPc, rr);                                        // keys.ts, §4.2
  const buf = ready.get(pick.path); if (!buf) { void preload([pick.path]); return; }
  const same = voices.filter((v) => v.cue === id);
  if (same.length >= c.maxVoices) stop(same[0]);                              // oldest copy of this cue
  const onBus = voices.filter((v) => v.bus === c.bus);
  const cap = c.bus === 'ui' ? MIX.voices.ui : MIX.voices.sfx;
  if (onBus.length >= cap || voices.length >= MIX.voices.global) {
    const victim = [...voices].sort((a, b) => a.prio - b.prio || a.t - b.t)[0]; // lowest priority, then oldest
    if (victim.prio > c.priority) return;                                     // everything playing matters more
    stop(victim);
  }
  last.set(id, now);
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = pick.rate;
  const g = ctx.createGain(); g.gain.value = dB(opts.gainDb ?? 0);
  src.connect(g).connect(bus[c.bus]);
  const when = Math.max(ctx.currentTime, opts.when ?? 0);
  src.start(when);
  const v: Voice = { src, gain: g, cue: id, bus: c.bus as BusId, prio: c.priority, t: now };
  voices.push(v); src.onended = () => { voices.splice(voices.indexOf(v) >>> 0, 1); g.disconnect(); };
  if (c.duckClass) duck(MIX.ducking.cueDuckDb[c.duckClass], when);
}
function stop(v: Voice) {                                                     // 15 ms fade, no click
  const t = ctx.currentTime; v.gain.gain.setTargetAtTime(0, t, 0.005); v.src.stop(t + 0.03);
}
```

### 4.2 Keys and file choice (`keys.ts`)
```ts
import { MIX } from './mixTokens';
export const keyPcForLevel = (L: number) => (((MIX.transpose.levelOneKeyPc + MIX.transpose.stepSemitones * (L - 1)) % 12) + 12) % 12;
export const keyName = (pc: number) => MIX.transpose.keyNames[pc];          // 'F', 'C', ..., 'Fs' (= music lane tokens)

export function pickFile(c: Cue, keyPc: number, rr: Map<string, number>): { path: string; rate: number } {
  if (c.transpose === 'perKeyFile') return { path: `sfx/${c.id}__${keyName(keyPc)}.ogg`, rate: 1 };          // level_up
  if (c.transpose === 'nearestRootRate') {
    let best = { root: 'F', d: 99 };
    for (const [root, pc] of Object.entries(MIX.transpose.renderRoots)) {
      const d = ((((keyPc - pc + 6) % 12) + 12) % 12) - 6;                   // -6..5
      if (Math.abs(d) < Math.abs(best.d)) best = { root, d };
    }
    return { path: `sfx/${c.id}__${best.root}.ogg`, rate: Math.pow(2, best.d / 12) };
  }
  const i = rr.get(c.id) ?? 0; rr.set(c.id, i + 1);                           // fixed: round-robin variants
  return { path: c.files[i % c.files.length].replace(/^audio\//, ''), rate: 1 };
}
```
`c.files` in the tokens lists every file of a cue (`audio/sfx/payout__F.ogg`, …). Fixed cues with one file always get index 0.

### 4.3 Ducking
The deepest active duck wins; a later, shallower duck never raises the gain.
```ts
const duckNodes = [musicDuck, ambDuck];      // the GainNodes between music/ambience and their buses
let duckDepth = 0, duckEnd = 0;               // current depth (dB, <= 0) and when the hold ends (ctx time)
export function duck(db: number, when = ctx.currentTime) {
  const { attackMs, holdMs, releaseMs } = MIX.ducking;
  const end = when + (attackMs + holdMs) / 1000;
  const active = when < duckEnd;
  if (active && db >= duckDepth) { if (end <= duckEnd) return; }           // shallower: only extend the hold
  else duckDepth = db;                                                       // deeper (or none active): go deeper
  duckEnd = Math.max(duckEnd, end);
  for (const n of duckNodes) {
    const p = n.gain; p.cancelScheduledValues(when);
    p.setTargetAtTime(dB(duckDepth), when, attackMs / 3000);
    p.setTargetAtTime(1, duckEnd, releaseMs / 3000);
  }
  setTimeout(() => { if (ctx.currentTime >= duckEnd) duckDepth = 0; }, (duckEnd - ctx.currentTime) * 1000 + 5);
}
```

### 4.4 Level-up (both sounds kept)
On a level change the SFX stinger `level_up__<NEW key>` and the music's `music_levelup_<NEW key>` play on the **same bar line**. The music stinger then plays at `MIX.music.levelupWithSfxDb` (−6 dB):
```ts
export function onLevelUp(newPc: number) {
  const when = music.nextBarTime();                                         // ctx time of the next bar; ctx.currentTime if no music
  setKeyPc(newPc);
  playCue('level_up', { when });                                            // milestone duck −4 dB
  music.changeKey(newPc, { when, stinger: true, stingerGainDb: MIX.music.levelupWithSfxDb });
}
```
Several levels in one tick: one fifth per bar (music-spec §6.4), the SFX stinger only on the first step. Load, new game, sandbox `setLevel`: key change without either stinger.

## 5. Events (`events.ts`)
One `effect()` on `snapshot` (from `src/app/store.ts`) diffs the previous and the new snapshot, plus effects on `speed`, `crash`, `levelUp`, `popupPause`.

### 5.1 New log notes
`snapshot.log` holds the last 16 notes, oldest first (`Game.note` pushes, `LOG_CAP` shifts). Track the last tick seen and how many notes of that tick were played:
```ts
let seenTick = -1, seenAtTick = 0, first = true;
export function newNotes(log: GameEvent[]): GameEvent[] {
  if (first) { first = false; mark(log); return []; }                      // load / new game: no burst of old notes
  const out: GameEvent[] = []; let n = 0;
  for (const e of log) {
    if (e.tick < seenTick) continue;
    if (e.tick === seenTick && n++ < seenAtTick) continue;
    out.push(e);
  }
  mark(log); return out;
}
function mark(log: GameEvent[]) {
  seenTick = log.length ? log[log.length - 1].tick : -1;
  seenAtTick = log.filter((e) => e.tick === seenTick).length;
}
export const resetNotes = () => { first = true; };                        // call on load / new game / Main menu
```
If `log[last].tick` goes backwards (a save was loaded), call `resetNotes()`.

### 5.2 Classifier
```ts
const RULES = MIX.logRules.map((r) => ({ ...r, re: r.match ? new RegExp(r.match) : null }));
export function cueForNote(e: GameEvent): CueId | null {
  for (const r of RULES) if (r.kind === e.kind && (!r.re || r.re.test(e.text))) return r.cue as CueId | null;
  return null;
}
```
Play the notes of one snapshot in log order, 40 ms apart (`when = ctx.currentTime + i × 0.04`). `swap_done` replaces `install` when `pendingSwaps.length` dropped in the same snapshot. `level` notes go to `onLevelUp` (§4.4), not straight to `playCue`.

### 5.3 State rules
Implement SPEC §3.2 literally from `prev` and `next`: `phase`, `net.state`, `power.tripped`, `plugged`/`keyActivity`, `pendingSwaps`. A state rule is skipped when a note in the same snapshot already played a cue of the same family (e.g. a `fault` note plus `phase → "error"` plays one fault).

### 5.4 Speed, pause, crash
```ts
let prevSpeed = speed.peek();
effect(() => {
  const s = speed.value; if (s === prevSpeed) return;
  if (s === 0) { playCue('pause'); music.setPaused(true); amb.setPaused(true); }
  else if (prevSpeed === 0) { playCue('resume'); music.setPaused(false); amb.setPaused(false); }
  else playCue(s > prevSpeed ? 'speed_up' : 'speed_down');
  music.setSpeed(s); prevSpeed = s;
});
effect(() => { if (crash.value) playCue('ui_error'); });
```
Pause (speed 0) **never** suspends the context and never stops sources: UI and gameplay cues keep working (Trace steps, panels). Music handles its own hold (§7.5); the hum drops `MIX.pause.ambienceGainDb.amb_machine_hum_loop` (−4 dB) over `MIX.pause.fadeMs`.

## 6. Ambience (`ambience.ts`)
```ts
export function startLoop(path: string, samples: number, out: AudioNode, fadeMs: number) {
  const buf = ready.get(path)!; const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const n = Math.min(samples, buf.length);                 // manifest sample count; guard decoders that trim
  if (n !== samples) console.warn('loop length', path, buf.length, samples);
  src.loopStart = 0; src.loopEnd = n / buf.sampleRate;
  const g = ctx.createGain(); g.gain.value = 0; src.connect(g).connect(out); src.start();   // out = ambDuck
  g.gain.setTargetAtTime(1, ctx.currentTime, fadeMs / 3000);
  return { src, g };
}
```
- Room: `ambience/amb_room_city_loop.ogg`, 1 152 000 samples, while the room scene shows (main menu and game).
- Hum: `ambience/amb_machine_hum_loop.ogg`, 576 000 samples, while `snapshot.powered`. Fan follow every snapshot: `x` = mean `devices[i].fan` over devices that have fans (else 0.5); gain `dB(-6 + 6x)`, `playbackRate` `0.92 + 0.20x`, both with `setTargetAtTime(…, 0.8/3)` (`MIX.ambience.amb_machine_hum_loop.fanFollow`).
- Ambience loops are not transposed and not stitched (they are exactly periodic and decode sample-exact; no padding).

## 7. Music (`music.ts`): the Afterglow director
Full rules: `public/audio/music/music-spec.json` (fetch once at boot) and `sources/music/music-spec.md`. This section is the code shape.

### 7.1 Files
- `music/stems/music_{bed|pluck|bass|shimmer|stress|pausebed}_{KEY}.ogg`: 72 loops, 4 bars, **698 182 samples** inside 4 800 samples of padding each side.
- `music/stems/music_menu_F.ogg`: 8 bars, 1 396 364 samples, same padding.
- `music/notes/music_note_pluck_{C3..C6}.ogg`, `music/notes/music_note_glint_{C5..C7}.ogg`, `music/notes/music_note_low_{C2..C3}.ogg`: chromatic one-shots (never rate-shifted; `Cs4` = C#4). `music/notes/music_levelup_{KEY}.ogg`, `music_fault_{KEY}.ogg`: one per key.
- `{KEY}` = `F C G D A E B Fs Cs Gs Ds As`, the same tokens as `MIX.transpose.keyNames` and the SFX `level_up__{KEY}` files.

### 7.2 Clock
Tempo is fixed: 66 bpm, never changed by speed, stress or pause (`MIX.music.tempoFollowsSpeed = false`, `MIX.pause.musicHold.tempoScale = 1`). Derive the grid from the file: `loopSec = 698182 / 48000`, `beat = loopSec / 16`, `bar = loopSec / 4`. Keep one `t0` (context time when music started); bar `n` starts at `t0 + n × bar`.
```ts
export function nextBarTime(): number {
  if (t0 === null) return ctx.currentTime;
  const k = Math.ceil((ctx.currentTime + 0.05 - t0) / BAR); return t0 + k * BAR;
}
```
Schedule with a look-ahead timer (25 ms `setInterval`, 100 ms horizon) on `ctx.currentTime`, not `requestAnimationFrame`.

### 7.3 Loop seams: `stitchLoop()` (required)
Run once per stem after decode, then loop the inner region. Without it, bed and bass seams carry 20–45 dB of extra coding error (music lane checks).
```ts
const PAD = 4800;                        // music-spec.json format.loop_padding
export function stitchLoop(buf: AudioBuffer, loopSamples: number, n = 480): void {
  // crossfade the last n samples before loopEnd into the pre-roll copy of the same audio,
  // so the last played sample is stream-continuous with loopStart (mirrors sources/music/mlib.py stitch_loop)
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
Stitch exactly once per decoded buffer (keep a `WeakSet<AudioBuffer>`); stitching twice smears the seam.

### 7.4 Load only the current and the next key
A decoded key (6 stems) is ~34 MB of float PCM; current + next is ~67 MB (+11 MB menu). Keep exactly these keys decoded and drop the rest:
```ts
const LAYERS = ['bed', 'pluck', 'bass', 'shimmer', 'stress', 'pausebed'] as const;
const keyBufs = new Map<string, Promise<Record<string, AudioBuffer>>>();    // key token -> stems
function stemsFor(key: string) {
  let p = keyBufs.get(key);
  if (!p) {
    p = Promise.all(LAYERS.map((l) => load(`music/stems/music_${l}_${key}.ogg`)))
      .then((bs) => Object.fromEntries(bs.map((b, i) => { stitchOnce(b!, LOOP); return [LAYERS[i], b!]; })));
    keyBufs.set(key, p);
  }
  return p;
}
export function keepKeys(curPc: number) {
  const want = new Set([keyName(curPc), keyName((curPc + 7) % 12)]);
  for (const k of [...keyBufs.keys()]) if (!want.has(k)) { keyBufs.delete(k); dropFromLoadCache(k); }   // let GC free them
  for (const k of want) void stemsFor(k);
}
```
`dropFromLoadCache` removes the six `music/stems/*_{key}.ogg` entries from the `load()` cache and `ready`. If the target key is not decoded yet when a key change is due, hold the old key and change on the first bar after decode (music-spec §6.6). On phones consider decoding `stress` and `shimmer` only when their state first turns on.

### 7.5 States, pause, speed
- Keep the current key's 6 stems playing all the time (gain 0 when off); state changes are gain ramps per layer: entries on the next bar, exits on the next beat. Targets per state: music-spec §4 / `states` in the JSON. Each layer gain = state target × `dB(MIX.music.layerGainDb[layer] + MIX.music.trimDb)`.
- **Pause (speed 0):** over 1 s, equal-power crossfade bed → pausebed; pluck through a low-pass to `MIX.pause.musicHold.lowpassHz` (850 Hz) at `pluckDb` (−5 dB); bass, shimmer, stress → 0. Tempo unchanged; the darkening is in the pausebed stem, so no extra pad filter and no extra music gain change. Resume on the next beat, 1 s back.
- **Speed:** changes density and brightness only (`speed.map` in the JSON: speed 1 bass off and shimmer −6 dB … speed ≥ 12 shimmer +3, bass +1, event density ×3; 0.5 s ramps). Note that run speed "1x" is `speed === 4` (`DEFAULT_SPEED`).
- **Menu:** the menu always plays `music_menu_F` (`MIX.music.menu`), whatever the save's level. On the first game frame (screen 11 / first snapshot after Continue/Start), crossfade 2 s on the next menu bar to the save's key stems. "Main menu" from Paused: game stems fade 1.5 s, `music_menu_F` back in.
- **Music event notes** (`music_note_*`) follow music-spec §7 "Event → note map"; they go through the music bus with their own echo send. They are *in addition* to the SFX cues and quieter (music bus −8 dB, ducked by the SFX cue). Cap 8 voices, steal oldest.

### 7.6 Hidden tab (music part)
While hidden, ignore state changes and drop queued notes and stingers. On visible, read the current snapshot, set layer gains straight to target, and set the key directly if the level changed (no stinger). The stems keep their phase because the context is suspended, not stopped.

## 8. Sliders and mute (`settings.ts`)
```ts
type AudioPrefs = { master: number; music: number; sounds: number; ambience: number; mute: boolean };
const KEY = MIX.sliders.storageKey;                                  // 'pipeline-city.audio' (device setting, not in the save)
export const prefs = signal<AudioPrefs>(read());
function read(): AudioPrefs {
  const d = { master: 100, music: 100, sounds: 100, ambience: 100, mute: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return d; }
}
effect(() => {
  const p = prefs.value; localStorage.setItem(KEY, JSON.stringify(p));
  const g = (v: number) => (v / 100) ** 2, t = ctx.currentTime, k = 0.03;
  userMaster.gain.setTargetAtTime(p.mute ? 0 : g(p.master), t, k);   // a GainNode between master and destination
  bus.music.gain.setTargetAtTime(dB(MIX.buses.music.defaultDb) * g(p.music), t, k);
  bus.sfx.gain.setTargetAtTime(dB(MIX.buses.sfx.defaultDb) * g(p.sounds), t, k);
  bus.ui.gain.setTargetAtTime(dB(MIX.buses.ui.defaultDb) * g(p.sounds), t, k);
  bus.ambience.gain.setTargetAtTime(dB(MIX.buses.ambience.defaultDb) * g(p.ambience), t, k);
});
```
UI: four `Slider` rows and one `Mute Off ━ On` branch in Settings → Interface (the AD kit's slider and branch components; proposal, KNOWN-ISSUES §1). Step 5 %; `ui_slider_tick` per step; on releasing "Sounds" play one `ui_click` at the new level.

## 9. Boot, unlock, hidden tab (`index.ts`)
```ts
export function initAudio() {
  unlockOnGesture();
  effect(() => { if (booted.value) void preload(PRELOAD); });          // §3 list
  wireEvents(); wireAmbience(); wireMusic();
  let suspendTimer = 0;
  document.addEventListener('visibilitychange', () => {
    const h = MIX.hiddenTab, t = ctx.currentTime;
    if (document.visibilityState === 'hidden') {
      hiddenFade.gain.setTargetAtTime(0, t, h.fadeOutMs / 3000);
      suspendTimer = window.setTimeout(() => void ctx.suspend(), h.suspendAfterMs);
      music.setHidden(true);
    } else {
      clearTimeout(suspendTimer);
      void ctx.resume().then(() => { music.setHidden(false); hiddenFade.gain.setTargetAtTime(1, ctx.currentTime, h.fadeInMs / 3000); });
    }
  });
}
```
`hiddenFade` is one more `GainNode` after `userMaster`. The game clock is not touched (the sim keeps its own rules when hidden). Suspend only for the hidden tab, never for pause.

## 10. UI sounds in components
Add a thin helper and call it from the kit components so every screen gets it:
```ts
export const uiSound = (id: CueId) => playCue(id);
const hoverable = matchMedia('(hover: hover)');
export const onHover = () => { if (hoverable.matches) uiSound('ui_hover'); };
```
Map per SPEC §4.1: rows and tags `onPointerEnter → onHover`, focus changes from keyboard → `ui_focus_move`, activation → `ui_click`, Back/Esc → `ui_back`, value branches → `ui_value_change`, toggles → `ui_toggle_on/off`, tabs → `ui_tab_switch`, sliders → `ui_slider_tick`, WB commits → `ui_confirm`, toasts by tone. Screen transitions: play `ui_transition_in` 60–80 ms after the click, `ui_transition_out` when the trace retracts. Tutorial typing: every 3rd character, none with `prefers-reduced-motion`.

## 11. PR order (each one is testable alone)
1. Assets + `mixTokens.ts` + engine with buses, loader, unlock, `playCue`, sliders in code (no UI). Test: a dev key plays every cue (ACCEPTANCE §4).
2. Events: log rules, state rules, speed/pause/crash. Unit tests for the classifier and `newNotes`.
3. UI sounds in the kit components and screens (SPEC §4).
4. Ambience + fan follow + hidden-tab fade.
5. Music director (stems, stitch, keys, states, pause, speed, menu, level-up coordination).
6. Settings rows for the sliders (after AD sign-off).
