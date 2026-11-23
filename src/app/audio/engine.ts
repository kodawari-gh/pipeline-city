// The Web Audio engine: buses, ducking, the file loader, and playCue. Main thread only.
// The AudioContext opens on the first pointer, key or touch event (no sound and no console error before it).
// Files decode with an OfflineAudioContext, so loading needs no gesture. A cue whose file is not decoded yet is skipped, never delayed.
import { MIX, type BusId, type CueId } from './mixTokens';
import { keyPcForLevel, pickFile, rootFPath, type Cue } from './keys';
import { VoicePool, type VoiceRec } from './voices';
import { audioMix } from './mix';
import { busGains, dB, type Volumes } from './volume';
import { LOOP_IDS, type LoopId } from './ambience';
import { BAR_S, BEAT_S, LAYERS, MENU_ID, OPEN_HZ, PAD, nextOnGrid, stitchStem, type Quant } from './music';
import { NOTE_ECHO, type NoteOpts } from './musicNotes';

/** Set each bus to its default dB times the player's mix (busGains). A live change ramps (no clicks); a new graph sets it at once. */
function applyBuses(g: Graph, m: Volumes, ramp: boolean): void {
  const gains = busGains(m);
  const t = g.ctx.currentTime;
  for (const id of Object.keys(MIX.buses) as BusId[]) {
    const target = gains[id];
    if (ramp) g.bus[id].gain.setTargetAtTime(target, t, 0.02);
    else g.bus[id].gain.value = target;
  }
}

/** The player's mix changed: the buses follow. Before the context opens, `openGraph` reads the mix. */
export function applyMix(m: Volumes): void {
  if (graph) applyBuses(graph, m, true);
}

interface Graph {
  ctx: AudioContext;
  bus: Record<BusId, GainNode>;
  /** The hidden-tab fade (between master and the output). The mix never touches it. */
  fade: GainNode;
  /** Queued cues: the voices that start later, with their start time (ctx seconds). Dropped when the tab hides. */
  queued: Map<VoiceRec, number>;
  /** Music and ambience dip through these (ducking never fights the sliders). */
  duckNodes: GainNode[];
  musicDuck: GainNode;
  ambDuck: GainNode;
  /** The music notes' bus (ticket #65): not behind the music duck. */
  noteBus: GainNode;
}

let graph: Graph | null = null;
/** The music duck node (null until the context opens). Exported for the ducking tests. */
export let musicDuck: GainNode | null = null;
let decoder: OfflineAudioContext | null = null;
const ready = new Map<string, AudioBuffer>();
const cache = new Map<string, Promise<AudioBuffer | null>>();
let queue: Promise<unknown> = Promise.resolve();
let loadingOn = false;
let keyPc = keyPcForLevel(1);
/** The tab is hidden (set by `setHidden`). Read at once by `openGraph`, so a context opened while hidden starts silent. */
let hiddenNow = false;
let suspendTimer: ReturnType<typeof setTimeout> | null = null;

const CUE = new Map<string, Cue>(MIX.cues.map((c): [string, Cue] => [c.id, c]));
const rr = new Map<string, number>();
const pool = new VoicePool();

/** One playing copy of a loop: its own fade (a fade-out and a new start can overlap), then the loop's level. */
interface Voice {
  src: AudioBufferSourceNode;
  fade: GainNode;
}
/** A room or hum loop. `want` is the director's wish; nothing plays before the graph opens (the gesture). */
interface Loop {
  want: boolean;
  /** The fade times (ms) of the director's last start and stop. A start that waits for the gesture or a load uses them. */
  fadeInMs: number;
  fadeOutMs: number;
  /** The level (dB) and rate `setHum` last asked for; applied when the graph opens. */
  gainDb: number;
  rate: number;
  /** The pause dip (dB) `duckHum` last asked for; applied when the graph opens. */
  dipDb: number;
  /** Level, then dip, then the ambience duck. */
  level: GainNode | null;
  dip: GainNode | null;
  voice: Voice | null;
}
const HUM: LoopId = 'amb_machine_hum_loop';
const loops = new Map<LoopId, Loop>(LOOP_IDS.map((id): [LoopId, Loop] => [
  id,
  { want: false, fadeInMs: 0, fadeOutMs: 0, gainDb: 0, rate: 1, dipDb: 0, level: null, dip: null, voice: null },
]));
const loopPath = (id: LoopId): string => `ambience/${id}.ogg`;
/** Loops whose decoded length differs from the manifest count: one warning each. */
const warnedLength = new Set<string>();

// Test probe (ticket #67, `tools/audio-check.mjs`): read-only counts. Filled only when the page set `window.__audioProbe` before
// this module ran (the check's init script does). A normal game sets nothing here.
const probe = (globalThis as { __audioProbe?: Record<string, () => number> }).__audioProbe;
if (probe) {
  probe.voices = () => pool.list.length;
  probe.stemKeys = () => new Set([...ready.keys()]
    .filter((p) => p.includes('/music/stems/') && !p.includes(MENU_ID))
    .map((p) => p.replace(/\.ogg$/, '').split('_').pop() ?? '')).size;
}

function openGraph(): Graph | null {
  if (typeof AudioContext === 'undefined') return null;
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const bus = {} as Record<BusId, GainNode>;
  const fade = ctx.createGain();
  fade.gain.value = hiddenNow ? 0 : 1;
  fade.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(fade);
  bus.master = master;
  for (const id of Object.keys(MIX.buses) as BusId[]) {
    if (id === 'master') continue;
    bus[id] = ctx.createGain();
    bus[id].connect(master);
  }
  const md = ctx.createGain();
  md.connect(bus.music);
  musicDuck = md;
  const ambDuck = ctx.createGain();
  ambDuck.connect(bus.ambience);
  for (const l of loops.values()) {
    l.level = ctx.createGain();
    l.level.gain.value = dB(l.gainDb);
    l.dip = ctx.createGain();
    l.dip.gain.value = dB(l.dipDb);
    l.level.connect(l.dip);
    l.dip.connect(ambDuck);
  }
  const g: Graph = { ctx, bus, fade, queued: new Map(), duckNodes: [md, ambDuck], musicDuck: md, ambDuck, noteBus: openNoteBus(ctx, bus.music) };
  applyBuses(g, audioMix.peek(), false);
  return g;
}

/** Open the context on the first gesture. Until then nothing plays. `onOpen` (the director's unlock) runs after the loops follow. */
export function unlockOnGesture(onOpen?: () => void): void {
  const go = () => {
    for (const e of MIX.unlock.events) window.removeEventListener(e, go, true);
    graph ??= openGraph();
    if (!hiddenNow) void graph?.ctx.resume().catch(() => {});
    for (const id of LOOP_IDS) syncLoop(id);
    onOpen?.();
  };
  for (const e of MIX.unlock.events) window.addEventListener(e, go, true);
}

/** Ramp the hidden-tab fade to `target` over `ms`, from its value now. */
function fadeTo(g: Graph, target: number, ms: number): void {
  const p = g.fade.gain;
  const t = g.ctx.currentTime;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(target, t + ms / 1000);
}

/**
 * The tab hid or came back (index.ts, on `visibilitychange`). Hidden: queued cues, queued music calls and stingers are dropped,
 * new cues are refused, master fades out (`hiddenTab.fadeOutMs`) and the context suspends after `suspendAfterMs`. Visible: the
 * context resumes and the fade comes back (`fadeInMs`). Only the tab does this; the game clock, a Pause and a Hold never reach here.
 * Returns true when queued music calls were dropped (the music sends its layer calls again on return).
 */
export function setHidden(hidden: boolean): boolean {
  hiddenNow = hidden;
  const g = graph;
  if (!g) return false;
  let droppedMusic = false;
  if (hidden) {
    const now = g.ctx.currentTime;
    for (const [v, when] of g.queued) if (when > now) v.stop();
    g.queued.clear();
    for (const s of stingers) {
      if (s.at > now) s.src.stop();
    }
    stingers.clear();
    for (const [token, r] of notesInFlight) {
      if (r.at > now) {
        r.src.stop();
        notesInFlight.delete(token);
      }
    }
    droppedMusic = dropMusicQueue();
    fadeTo(g, 0, MIX.hiddenTab.fadeOutMs);
    suspendTimer ??= setTimeout(() => {
      suspendTimer = null;
      void g.ctx.suspend().catch(() => {});
    }, MIX.hiddenTab.suspendAfterMs);
  } else {
    if (suspendTimer !== null) clearTimeout(suspendTimer);
    suspendTimer = null;
    void g.ctx.resume().catch(() => {});
    fadeTo(g, 1, MIX.hiddenTab.fadeInMs);
  }
  return droppedMusic;
}

/** A file path as the engine keys it: `audio/sfx/x.ogg` (keys.ts). `sfx/x.ogg` (relative to the audio folder) is the same file. */
const audioPath = (path: string): string => (path.startsWith(MIX.basePath) ? path : `${MIX.basePath}${path}`);

/** One file at a time: fetch, then decode. A failed file logs one warning and is never tried again. */
export function load(file: string): Promise<AudioBuffer | null> {
  const path = audioPath(file);
  let p = cache.get(path);
  if (!p) {
    const next = queue.then(async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}${path}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        decoder ??= new OfflineAudioContext(1, 1, MIX.sampleRate);
        const buf = await decoder.decodeAudioData(await r.arrayBuffer());
        // A music stem is stitched once, here: each decode makes a new buffer, and the cache keeps it (music.ts `stitchStem`).
        if (path.includes('/music/stems/')) {
          const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
          stitchStem(channels, path.includes(`/${MENU_ID}.`) ? MIX.music.menuLoopSamples : MIX.music.loopSamples);
        }
        ready.set(path, buf);
        return buf;
      } catch (e) {
        console.warn('audio load failed', path, e);
        return null;
      }
    });
    queue = next;
    p = next;
    cache.set(path, p);
  }
  return p;
}

/** Load these files in order, one at a time. Resolves once each has loaded or failed. */
export async function preload(files: readonly string[]): Promise<void> {
  for (const f of files) await load(f);
}

/**
 * At boot (after `booted`): the UI files, the F root of each pitched cue, the fixed SFX and the music notes (fixed files, so each
 * note is decoded before its first hit). Then the current key.
 */
export function startLoading(): void {
  if (loadingOn) return;
  loadingOn = true;
  for (const id of LOOP_IDS) void load(loopPath(id));
  const cues = [...MIX.cues].sort((a, b) => (a.bus === 'ui' ? 0 : 1) - (b.bus === 'ui' ? 0 : 1));
  for (const c of cues) {
    if (c.transpose === 'nearestRootRate') void load(rootFPath(c));
    else if (c.transpose !== 'perKeyFile') for (const f of c.files) void load(f);
  }
  preloadKey(keyPc);
}

/** The files a key needs for its pitched and level-up cues (the nearest root of each, and the level-up of that key). */
function preloadKey(pc: number): void {
  for (const c of MIX.cues) {
    if (c.transpose === 'fixed') continue;
    void load(pickFile(c, pc, new Map()).path);
  }
}

/** Load every file of every cue (the ?debug cue board). */
export function loadAll(): void {
  for (const c of MIX.cues) for (const f of c.files) void load(f);
}

/**
 * The level's key changed: the new key's files load, the sound follows at once. The next level's stinger loads too, so the
 * level-up after this one finds it decoded. The first snapshot of a game sets the level 1 key, so the level 2 stinger loads then.
 */
export function setKeyPc(pc: number): void {
  keyPc = pc;
  if (!loadingOn) return;
  preloadKey(pc);
  const stinger = CUE.get('level_up');
  if (stinger) void load(pickFile(stinger, (pc + MIX.transpose.stepSemitones) % 12, new Map()).path);
}

export interface PlayOpts {
  /** Seconds from now. */
  delayS?: number;
  gainDb?: number;
  /** `beat`: start on the music clock's next beat (at once with no beat clock). */
  quantise?: 'beat';
  /** Event notes: at most this many start in one beat of the music grid. The rest are merged (not played). No grid, no limit. */
  perBeat?: number;
}

/** The music's beat clock (the music tickets set it). The level-up stinger and the key change share it. */
export interface BeatClock {
  /** Seconds from AudioContext time `nowS` to the next beat (0 or more). */
  secondsToNextBeat(nowS: number): number;
}

let beatClock: BeatClock | null = null;

/** Set or clear the music's beat clock. Null (no music running): a quantised cue plays at once. */
export function setBeatClock(c: BeatClock | null): void {
  beatClock = c;
}

/** Play one cue now (or after `delayS`). Returns nothing: a refused, skipped or unloaded cue is silent. */
export function playCue(id: CueId, opts: PlayOpts = {}): void {
  const g = graph;
  if (!g || hiddenNow || g.ctx.state !== 'running') return;
  const c = CUE.get(id);
  if (!c) return;
  const pick = pickFile(c, keyPc, rr);
  const buf = ready.get(audioPath(pick.path));
  if (!buf) {
    void load(pick.path);
    return;
  }
  const { ctx } = g;
  const wait = opts.quantise === 'beat' && beatClock ? Math.max(0, beatClock.secondsToNextBeat(ctx.currentTime)) : 0;
  const when = ctx.currentTime + Math.max(0, opts.delayS ?? 0) + wait;
  if (opts.perBeat !== undefined && !beatAllows(when, opts.perBeat)) return;
  const now = performance.now();
  const adm = pool.admit(c, now);
  if (!adm.ok) return;
  for (const v of adm.evict) v.stop();

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = pick.rate;
  const gain = ctx.createGain();
  gain.gain.value = dB(opts.gainDb ?? 0);
  src.connect(gain).connect(g.bus[c.bus as BusId]);

  const v: VoiceRec = {
    cue: id,
    bus: c.bus as BusId,
    prio: c.priority,
    t: now,
    stop: () => {
      pool.remove(v);
      g.queued.delete(v);
      const t = ctx.currentTime;
      gain.gain.setTargetAtTime(0, t, 0.005);
      src.stop(t + 0.03);
    },
  };
  src.onended = () => {
    pool.remove(v);
    g.queued.delete(v);
    gain.disconnect();
  };
  pool.add(v);
  if (when > ctx.currentTime) g.queued.set(v, when);
  src.start(when);
  if (c.duckClass) duck(MIX.ducking.cueDuckDb[c.duckClass as keyof typeof MIX.ducking.cueDuckDb], when);
}

// Ducking: the deepest active duck wins; a shallower one only extends the hold.
let duckDepth = 0;
let duckEnd = 0;

/** Dip music and ambience by `db` (<= 0) from `when` (ctx time), then release after the hold. */
export function duck(db: number, when: number): void {
  const g = graph;
  if (!g) return;
  const { attackMs, holdMs, releaseMs } = MIX.ducking;
  const end = when + (attackMs + holdMs) / 1000;
  const active = when < duckEnd;
  const deeper = !active || db < duckDepth;
  if (deeper) duckDepth = db;
  const newEnd = Math.max(active ? duckEnd : 0, end);
  if (!deeper && newEnd <= duckEnd) return;
  duckEnd = newEnd;
  for (const n of g.duckNodes) {
    const p = n.gain;
    p.cancelScheduledValues(when);
    p.setTargetAtTime(dB(duckDepth), when, attackMs / 3000);
    p.setTargetAtTime(1, duckEnd, releaseMs / 3000);
  }
}

// Music (ticket #61): one looping stem per voice: src -> fade (the start and stop ramps) -> level (the layer gain)
// -> low-pass (the filters of ticket #62, open by default) -> music duck.
// The grid runs from `musicT0`, the first start: a bar is 4 beats, a loop 4 bars (music.ts). A quantised call waits for its grid point.
interface MusicVoice {
  src: AudioBufferSourceNode;
  fade: GainNode;
  level: GainNode;
  lp: BiquadFilterNode;
}
const musicVoices = new Map<string, MusicVoice>();
/** A start whose file is not decoded yet (decode on first use): id -> its fade-in. It begins on the next bar once the file is in. */
const waitingStart = new Map<string, number>();
/** The last layer gain (dB) and low-pass (Hz) sent per id: a voice that starts late takes them at once. Cleared when it stops. */
const musicDb = new Map<string, number>();
const musicHz = new Map<string, number>();
let musicT0: number | null = null;
/** The event starts counted in the current beat (`perBeat`): the beat index and how many started in it. */
let beatTally = { beat: -1, n: 0 };

/**
 * True when a cue at ctx time `at` may start: fewer than `perBeat` event cues start in its beat of the grid. It counts the start.
 * No grid yet (no music started): always true.
 */
function beatAllows(at: number, perBeat: number): boolean {
  if (musicT0 === null) return true;
  const beat = Math.floor((at - musicT0) / BEAT_S + 1e-6);
  if (beat !== beatTally.beat) beatTally = { beat, n: 0 };
  if (beatTally.n >= perBeat) return false;
  beatTally.n++;
  return true;
}
const stemFile = (id: string): string => `music/stems/${id}.ogg`;
/** The one-shot notes (the fault stinger): `music/notes/music_fault_<KEY>.ogg`. */
const noteFile = (id: string): string => `music/notes/${id}.ogg`;
/** Fault stingers playing or queued: a hidden tab stops the ones not yet started. */
const stingers = new Set<{ src: AudioBufferSourceNode; at: number }>();
const stemLoop = (id: string): number => (id === MENU_ID ? MIX.music.menuLoopSamples : MIX.music.loopSamples);

/** The time a call takes effect: now, or the next beat or bar line on the grid. */
function quantTime(g: Graph, q: Quant, beats = 0): number {
  const now = g.ctx.currentTime;
  if (q === 'now' || musicT0 === null) return now;
  return nextOnGrid(now + 0.05, musicT0, q === 'bar' ? BAR_S : BEAT_S) + beats * BEAT_S;
}

// Look-ahead (ticket #61): a music call is queued with its grid time. A timer (every TICK_MS) runs each queued call once its time
// is within LOOK_AHEAD_S of the audio clock, in time order. Calls on one voice keep their issue order (see `queueMusic`).
interface Due {
  at: number;
  id: string;
  run: () => void;
}
const LOOK_AHEAD_S = 0.1;
const TICK_MS = 25;
const due: Due[] = [];
/** The last grid time queued per voice id. A later call on that id is never earlier, so a start, gain and stop stay in order. */
const lastAt = new Map<string, number>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

/** Run every queued call due within the look-ahead window. The timer stops when the queue is empty. */
function runDue(g: Graph): void {
  const horizon = g.ctx.currentTime + LOOK_AHEAD_S;
  while (due.length > 0 && due[0]!.at <= horizon) due.shift()!.run();
  if (due.length === 0 && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/**
 * The tab hides: the calls not yet run are dropped (they would start or fade voices on a hidden tab). `lastAt` goes too, so the
 * return is not held back by a dropped call's grid time. True when any call was dropped.
 */
function dropMusicQueue(): boolean {
  const any = due.length > 0;
  due.length = 0;
  lastAt.clear();
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  return any;
}

/** Queue a music call for grid time `at` (ordered after the voice's earlier calls, and by time), then run what is already due. */
function queueMusic(g: Graph, id: string, at: number, run: () => void): void {
  const t = Math.max(at, lastAt.get(id) ?? -Infinity);
  lastAt.set(id, t);
  let i = due.length;
  while (i > 0 && due[i - 1]!.at > t) i--;
  due.splice(i, 0, { at: t, id, run });
  tickTimer ??= setInterval(() => {
    if (graph) runDue(graph);
  }, TICK_MS);
  runDue(g);
}

function startMusic(id: string, fadeInMs: number, q: Quant, beats = 0): void {
  const g = graph;
  if (!g) return;
  const at = quantTime(g, q, beats);
  queueMusic(g, id, at, () => beginVoice(g, id, fadeInMs, at));
}

/**
 * Start the voice at grid time `t` (a due call). A file not decoded yet is asked for, and the start waits for it: it then
 * begins on the next bar (decode on first use). A file that fails to load is dropped (`load` warns once).
 */
function beginVoice(g: Graph, id: string, fadeInMs: number, t: number): void {
  if (musicVoices.has(id)) return;
  const path = audioPath(stemFile(id));
  const buf = ready.get(path);
  if (!buf) {
    waitingStart.set(id, fadeInMs);
    void load(stemFile(id)).then(() => {
      if (!waitingStart.has(id)) return; // stopped while it loaded
      waitingStart.delete(id);
      if (!ready.has(path)) return;
      const at = quantTime(g, 'bar');
      queueMusic(g, id, at, () => beginVoice(g, id, fadeInMs, at));
    });
    return;
  }
  const { ctx } = g;
  musicT0 ??= t;
  const loop = stemLoop(id);
  const loopSec = loop / MIX.sampleRate;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = PAD / MIX.sampleRate;
  src.loopEnd = (PAD + loop) / MIX.sampleRate;
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(0, t);
  fade.gain.linearRampToValueAtTime(1, t + fadeInMs / 1000);
  const level = ctx.createGain();
  level.gain.value = 0;
  // A voice that starts late (it waited for its file) takes the gain and cutoff the controller last sent it.
  const db = musicDb.get(id);
  if (db !== undefined) {
    level.gain.setValueAtTime(0, t);
    level.gain.linearRampToValueAtTime(dB(db), t + fadeInMs / 1000);
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = musicHz.get(id) ?? OPEN_HZ;
  src.connect(fade).connect(level).connect(lp).connect(g.musicDuck);
  // The phase: where the file's grid stands at `t`, so every stem stays on the one bar line.
  const phase = (((t - musicT0) % loopSec) + loopSec) % loopSec;
  src.start(t, PAD / MIX.sampleRate + phase);
  musicVoices.set(id, { src, fade, level, lp });
}

/**
 * A one-shot stem (the fault stinger) on the grid: `quantTime` gives its start. Refused while hidden, and not started
 * before the tab hides again (`setHidden`). Not decoded yet: skipped, and its file loads for next time.
 */
function playStinger(id: string, q: Quant, gainDb = MIX.music.cueGainDb.fault): void {
  const g = graph;
  if (!g || hiddenNow || g.ctx.state !== 'running') return;
  const path = audioPath(noteFile(id));
  const buf = ready.get(path);
  if (!buf) {
    void load(noteFile(id));
    return;
  }
  const { ctx } = g;
  const at = quantTime(g, q);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = dB(gainDb);
  src.connect(gain).connect(g.musicDuck);
  const rec = { src, at };
  stingers.add(rec);
  src.onended = () => {
    stingers.delete(rec);
    gain.disconnect();
  };
  src.start(Math.max(at, ctx.currentTime));
}

function stopMusic(id: string, fadeOutMs: number, q: Quant, beats = 0): void {
  const g = graph;
  if (!g) return;
  const at = quantTime(g, q, beats);
  queueMusic(g, id, at, () => endVoice(id, fadeOutMs, at));
}

/** Fade the voice out from grid time `t`, then stop it (a due call). A start still waiting for its file is dropped. */
function endVoice(id: string, fadeOutMs: number, t: number): void {
  waitingStart.delete(id);
  musicDb.delete(id);
  musicHz.delete(id);
  const v = musicVoices.get(id);
  if (!v) return;
  musicVoices.delete(id);
  const end = t + fadeOutMs / 1000;
  v.fade.gain.cancelScheduledValues(t);
  v.fade.gain.setValueAtTime(1, t);
  v.fade.gain.linearRampToValueAtTime(0, end);
  v.src.stop(end + 0.05);
}

function setMusicGain(id: string, gainDb: number, fadeMs: number, q: Quant): void {
  const g = graph;
  if (!g) return;
  const at = quantTime(g, q);
  queueMusic(g, id, at, () => setVoiceGain(id, gainDb, fadeMs, at));
}

/** Ramp the voice's layer level from grid time `t` (a due call). The dB is kept, for a start that waits for its file. */
function setVoiceGain(id: string, gainDb: number, fadeMs: number, t: number): void {
  musicDb.set(id, gainDb);
  const v = musicVoices.get(id);
  if (!v) return;
  const p = v.level.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(dB(gainDb), t + fadeMs / 1000);
}

// Music notes (ticket #65): one-shot notes (`music_note_<family>_<NOTE>`), chromatic and never rate-shifted. Each goes through the
// note bus: dry to the music bus, and through the echo send (NOTE_ECHO: 0.75 beat delay, -12 dB, feedback 0.3).

/** The note bus of a graph: dry into the music bus, and an echo send with its feedback. The music duck does not reach it. */
function openNoteBus(ctx: AudioContext, music: GainNode): GainNode {
  const notes = ctx.createGain();
  notes.connect(music);
  const send = ctx.createGain();
  send.gain.value = dB(NOTE_ECHO.levelDb);
  const delay = ctx.createDelay(2);
  delay.delayTime.value = NOTE_ECHO.delayBeats * BEAT_S;
  const feedback = ctx.createGain();
  feedback.gain.value = NOTE_ECHO.feedback;
  notes.connect(send).connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(music);
  return notes;
}

/** The notes started or queued and not yet ended, by token. A stop or the end takes one off. */
const notesInFlight = new Map<number, { src: AudioBufferSourceNode; gain: GainNode; at: number }>();

/** Play one note now (or after `delayS`), then duck the music bus by its class. Refused while hidden; not decoded yet: skipped and loaded. */
function playMusicNote(id: string, o: NoteOpts): void {
  const g = graph;
  if (!g || hiddenNow || g.ctx.state !== 'running') return;
  const buf = ready.get(audioPath(noteFile(id)));
  if (!buf) {
    void load(noteFile(id));
    return;
  }
  const { ctx } = g;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = dB(o.gainDb);
  src.connect(gain).connect(g.noteBus);
  const at = ctx.currentTime + Math.max(0, o.delayS);
  notesInFlight.set(o.token, { src, gain, at });
  src.onended = () => {
    notesInFlight.delete(o.token);
    gain.disconnect();
  };
  src.start(at);
  duck(MIX.ducking.cueDuckDb[o.duckClass], at);
}

/** Fade a note out and stop it (a stolen note). A note not started yet stays silent. Unknown or ended tokens do nothing. */
function stopMusicNote(token: number): void {
  const g = graph;
  const r = notesInFlight.get(token);
  if (!g || !r) return;
  notesInFlight.delete(token);
  const t = g.ctx.currentTime;
  r.gain.gain.setTargetAtTime(0, t, 0.005);
  r.src.stop(t + 0.03);
}

/** Ramp the voice's low-pass cutoff from grid time `t` (a due call). The Hz is kept, like the gain. */
function setVoiceLowpass(id: string, hz: number, fadeMs: number, t: number): void {
  musicHz.set(id, hz);
  const v = musicVoices.get(id);
  if (!v) return;
  const p = v.lp.frequency;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(hz, t + fadeMs / 1000);
}

function unloadPath(path: string): void {
  ready.delete(path);
  cache.delete(path);
}

/** Decode a key's stems, its fault stinger and its level-up chord (the controller keeps the current and the next key). */
function decodeKey(key: string): void {
  for (const l of LAYERS) void load(stemFile(`music_${l}_${key}`));
  void load(noteFile(`music_fault_${key}`));
  void load(noteFile(`music_levelup_${key}`));
}

/** Free a key's stems: the map entries go, and a voice still playing keeps its own buffer. */
function releaseKey(key: string): void {
  for (const l of LAYERS) unloadPath(audioPath(stemFile(`music_${l}_${key}`)));
  unloadPath(audioPath(noteFile(`music_fault_${key}`)));
  unloadPath(audioPath(noteFile(`music_levelup_${key}`)));
}

/** True when all the key's layer stems are decoded: a key change waits for this (the old key holds until then). */
function keyReady(key: string): boolean {
  return LAYERS.every((l) => ready.has(audioPath(stemFile(`music_${l}_${key}`))));
}

function setMusicLowpass(id: string, hz: number, fadeMs: number, q: Quant): void {
  const g = graph;
  if (!g) return;
  const at = quantTime(g, q);
  queueMusic(g, id, at, () => setVoiceLowpass(id, hz, fadeMs, at));
}

const musicSink = {
  startMusic,
  stopMusic,
  setMusicGain,
  setMusicLowpass,
  playStinger,
  preloadMusic: (id: string) => void load(stemFile(id)),
  decodeKey,
  releaseKey,
  keyReady,
};

/** What the director drives (director.ts `CueSink`, the ambience calls of `AmbienceSink`, the music calls of `MusicSink`). */
export const engineSink = {
  playCue,
  setKeyPc,
  startLoop,
  stopLoop,
  setHum,
  duckHum,
  ...musicSink,
  playNote: playMusicNote,
  stopNote: stopMusicNote,
};

/** Start or fade out a loop now that its wish (or the graph) changed. */
function syncLoop(id: LoopId): void {
  const l = loops.get(id);
  if (!l) return;
  if (l.want) startVoice(id);
  else stopVoice(id);
}

/** Start one copy of a loop: it fades in over its token time, and ends on the manifest sample count. Waits for the file. */
function startVoice(id: LoopId): void {
  const l = loops.get(id);
  const g = graph;
  if (!l || !g || !l.want || l.voice || !l.level) return;
  const path = audioPath(loopPath(id));
  const buf = ready.get(path);
  if (!buf) {
    void load(loopPath(id)).then(() => {
      if (l.want && !l.voice) startVoice(id);
    });
    return;
  }
  // The loop ends on the manifest's sample count (not the decoded length, which a decoder may trim).
  const tok = MIX.ambience[id];
  if (buf.length !== tok.samples && !warnedLength.has(path)) {
    warnedLength.add(path);
    console.warn('ambience loop length differs from the manifest', path, buf.length, 'expected', tok.samples);
  }
  const { ctx } = g;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = 0;
  src.loopEnd = tok.samples / MIX.sampleRate;
  src.playbackRate.value = l.rate;
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(0, now);
  fade.gain.linearRampToValueAtTime(1, now + l.fadeInMs / 1000);
  src.connect(fade).connect(l.level);
  src.onended = () => {
    src.disconnect();
    fade.disconnect();
  };
  src.start(now);
  l.voice = { src, fade };
}

/** Fade the loop's copy out over its token time, then stop it. A new start while it fades makes a new copy. */
function stopVoice(id: LoopId): void {
  const l = loops.get(id);
  const v = l?.voice;
  if (!l || !v) return;
  l.voice = null;
  const g = graph;
  if (!g) return;
  const now = g.ctx.currentTime;
  const fadeS = l.fadeOutMs / 1000;
  v.fade.gain.cancelScheduledValues(now);
  v.fade.gain.setValueAtTime(v.fade.gain.value, now);
  v.fade.gain.linearRampToValueAtTime(0, now + fadeS);
  v.src.stop(now + fadeS + 0.05);
}

/** The director's wish for a loop: play it, fading in over `fadeInMs`. Before the gesture it waits; the graph's open starts it. */
export function startLoop(id: LoopId, fadeInMs: number): void {
  const l = loops.get(id);
  if (!l) return;
  l.fadeInMs = fadeInMs;
  if (l.want) return;
  l.want = true;
  syncLoop(id);
}

/** Fade a loop out over `fadeOutMs`, then stop it. */
export function stopLoop(id: LoopId, fadeOutMs: number): void {
  const l = loops.get(id);
  if (!l) return;
  l.fadeOutMs = fadeOutMs;
  if (!l.want) return;
  l.want = false;
  syncLoop(id);
}

/** The hum's level and rate, each ramped over `smoothMs` (a time constant of smoothMs / 3). */
export function setHum(gainDb: number, rate: number, smoothMs: number): void {
  const l = loops.get(HUM);
  if (!l) return;
  l.gainDb = gainDb;
  l.rate = rate;
  const g = graph;
  if (!g || !l.level) return;
  const t = g.ctx.currentTime;
  const tau = smoothMs / 3000;
  l.level.gain.setTargetAtTime(dB(gainDb), t, tau);
  if (l.voice) l.voice.src.playbackRate.setTargetAtTime(rate, t, tau);
}

/** The hum's pause dip: `gainDb` (0 or less) over `fadeMs` (a time constant of fadeMs / 3). */
export function duckHum(gainDb: number, fadeMs: number): void {
  const l = loops.get(HUM);
  if (!l) return;
  l.dipDb = gainDb;
  const g = graph;
  if (!g || !l.dip) return;
  l.dip.gain.setTargetAtTime(dB(gainDb), g.ctx.currentTime, fadeMs / 3000);
}
