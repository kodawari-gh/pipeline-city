// The Web Audio engine: buses, ducking, the file loader, and playCue. Main thread only.
// The AudioContext opens on the first pointer, key or touch event (no sound and no console error before it).
// Files decode with an OfflineAudioContext, so loading needs no gesture. A cue whose file is not decoded yet is skipped, never delayed.
import { MIX, type BusId, type CueId } from './mixTokens';
import { keyPcForLevel, pickFile, rootFPath, type Cue } from './keys';
import { VoicePool, type VoiceRec } from './voices';
import { audioMix } from './mix';
import { busGains, dB, type Volumes } from './volume';

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
  /** Music and ambience dip through these (ducking never fights the sliders). */
  duckNodes: GainNode[];
  musicDuck: GainNode;
  ambDuck: GainNode;
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

const CUE = new Map<string, Cue>(MIX.cues.map((c): [string, Cue] => [c.id, c]));
const rr = new Map<string, number>();
const pool = new VoicePool();

function openGraph(): Graph | null {
  if (typeof AudioContext === 'undefined') return null;
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const bus = {} as Record<BusId, GainNode>;
  const master = ctx.createGain();
  master.connect(ctx.destination);
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
  const g: Graph = { ctx, bus, duckNodes: [md, ambDuck], musicDuck: md, ambDuck };
  applyBuses(g, audioMix.peek(), false);
  return g;
}

/** Open the context on the first gesture. Until then nothing plays. */
export function unlockOnGesture(): void {
  const go = () => {
    for (const e of MIX.unlock.events) window.removeEventListener(e, go, true);
    graph ??= openGraph();
    void graph?.ctx.resume().catch(() => {});
  };
  for (const e of MIX.unlock.events) window.addEventListener(e, go, true);
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

/** At boot (after `booted`): the UI files, the F root of each pitched cue, and the fixed SFX. Then the current key. */
export function startLoading(): void {
  if (loadingOn) return;
  loadingOn = true;
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

/** The level's key changed: the new key's files load, the sound follows at once. */
export function setKeyPc(pc: number): void {
  keyPc = pc;
  if (loadingOn) preloadKey(pc);
}

export interface PlayOpts {
  /** Seconds from now. */
  delayS?: number;
  gainDb?: number;
}

/** Play one cue now (or after `delayS`). Returns nothing: a refused, skipped or unloaded cue is silent. */
export function playCue(id: CueId, opts: PlayOpts = {}): void {
  const g = graph;
  if (!g || g.ctx.state !== 'running') return;
  const c = CUE.get(id);
  if (!c) return;
  const pick = pickFile(c, keyPc, rr);
  const buf = ready.get(audioPath(pick.path));
  if (!buf) {
    void load(pick.path);
    return;
  }
  const now = performance.now();
  const adm = pool.admit(c, now);
  if (!adm.ok) return;
  for (const v of adm.evict) v.stop();

  const { ctx } = g;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = pick.rate;
  const gain = ctx.createGain();
  gain.gain.value = dB(opts.gainDb ?? 0);
  src.connect(gain).connect(g.bus[c.bus as BusId]);
  const when = ctx.currentTime + Math.max(0, opts.delayS ?? 0);

  const v: VoiceRec = {
    cue: id,
    bus: c.bus as BusId,
    prio: c.priority,
    t: now,
    stop: () => {
      pool.remove(v);
      const t = ctx.currentTime;
      gain.gain.setTargetAtTime(0, t, 0.005);
      src.stop(t + 0.03);
    },
  };
  src.onended = () => {
    pool.remove(v);
    gain.disconnect();
  };
  pool.add(v);
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

/** What the director drives (director.ts `CueSink`). */
export const engineSink = { playCue, setKeyPc };
