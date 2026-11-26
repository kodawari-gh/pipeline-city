// The Afterglow music director (ticket #61): the menu loop, and the game stems (bed, pluck, bass) by phase.
// Pure TS (no Web Audio): the director owns one and the engine is its sink (`engine.ts`), so tests drive it with a fake.
// Numbers come from MIX (mix tokens). The phase table is music-spec.json `states`; the fade times are the ticket's.
import { MIX } from './mixTokens';
import { keyName } from './keys';
import type { Scene } from './director';

/** The stress amount lives in stress.ts; re-exported here with the music that plays it. */
export { stressAmount } from './stress';

export type Quant = 'bar' | 'beat' | 'now';
export type Layer = 'bed' | 'pluck' | 'bass' | 'pausebed';
/** The data layers (ticket #62): shimmer while data flows, stress under load. Each decodes on its first use. */
type DataLayer = 'shimmer' | 'stress';

/** The sink the director drives (`engine.ts` is the real one). Ids: `music_menu_F`, `music_<layer>_<KEY>` or `music_fault_<KEY>`. */
export interface MusicSink {
  /** `beats`: the call takes effect this many beats after its quantise point (a key change steps one fifth per beat). */
  startMusic(id: string, fadeInMs: number, quantise: Quant, beats?: number): void;
  stopMusic(id: string, fadeOutMs: number, quantise: Quant, beats?: number): void;
  /** `gainDb` is the layer's token dB (MIX.music.layerGainDb) plus 20 log10 of its linear target, plus the speed, saturation and pause-dip offsets. */
  setMusicGain(id: string, gainDb: number, fadeMs: number, quantise: Quant): void;
  /** A low-pass on one voice, `hz` (OPEN_HZ: none). Optional: a sink without it plays without the filters. */
  setMusicLowpass?(id: string, hz: number, fadeMs: number, quantise: Quant): void;
  /** A one-shot stem (the fault stinger). Optional: a sink without it plays no stinger. */
  playStinger?(id: string, quantise: Quant, gainDb?: number): void;
  /** A loop decode started before it is needed. */
  preloadMusic(id: string): void;
  /** The keyed stems of one key ('F', 'C', ...) decoded, or freed. */
  decodeKey(key: string): void;
  releaseKey(key: string): void;
  /** Whether a key's layer stems are all decoded. Optional: a sink without it is always ready. A key change holds until it is. */
  keyReady?(key: string): boolean;
}

/** What the snapshot says about the data and the machine (director.ts feeds it each snapshot). */
export interface MusicFeed {
  /** The link is up or saturated, a transfer runs or a job key ingests. */
  flowing: boolean;
  saturated: boolean;
  /** The stress amount, 0..1 (stress.ts `stressAmount`). */
  stress: number;
  /** A power bill is unpaid: the bed is muffled. */
  debt: boolean;
}

export interface Music {
  onScene(scene: Scene): void;
  /**
   * The save's level key, as a pitch class (0 = C). `stepped`: the level rose by one or more level-up notes, so the key walks
   * one fifth per beat to the target. Otherwise (a load, a new game, a sandbox level) it is one crossfade on the next beat.
   */
  onKey(pc: number, stepped?: boolean): void;
  /** The game's phase (`Phase`), or undefined when there is no game. */
  onPhase(phase: string | undefined): void;
  /** The data and stress inputs, each snapshot. */
  onFeed(feed: MusicFeed): void;
  /** The game speed (0 = stopped). Changes density and brightness only (`speedMix`). */
  onSpeed(speed: number): void;
  /** The clock is stopped (Pause or Hold): speed 0. */
  onStopped(stopped: boolean): void;
  /** A hard failure (burnt VRM, PSU trip, power cut): the fault stinger on the next beat. */
  onFault(): void;
  /**
   * The tab hid or came back. Hidden: state changes are ignored and no sound is sent. Shown: the state is set at once.
   * `dropped` (on hide): the engine dropped the calls queued at the hide, so the return sends the layer calls again.
   */
  onHidden(hidden: boolean, dropped?: boolean): void;
  /** The first gesture: music may play from now on. */
  onUnlock(): void;
}

/** The menu loop's id: the file's name without `.ogg` (`music_menu_F`). */
export const MENU_ID = MIX.music.menu.file.replace(/^.*\//u, '').replace(/\.ogg$/u, '');
export const LAYERS: readonly Layer[] = ['bed', 'pluck', 'bass', 'pausebed'];
const DATA_LAYERS: readonly DataLayer[] = ['shimmer', 'stress'];

/** Fades, in ms. The menu's 2 s and the 1.5 s return are the ticket's numbers; the rest follow music-spec.json (states, key_change, pause, speed). */
export const TIMING = {
  menuInMs: 2000,
  stateFadeMs: 2000,
  gameOutMs: 1500,
  keyChangeMs: 1400,
  exitFadeMs: 1000,
  /** A game speed change: the ramp of its gains (music-spec.json `speed.fade_s`). */
  speedFadeMs: 500,
  /** The bill's low-pass on the bed (music-spec.json `debt`: 1 s). */
  debtFadeMs: 1000,
  /** The pause crossfade (bed to pausebed) and the resume: MIX.pause.fadeMs. */
  pauseFadeMs: MIX.pause.fadeMs,
} as const;

/** Event notes per beat at speed 4, before merging (judgement: music-spec.json gives only the multiplier `density`). */
export const EVENT_NOTES_PER_BEAT = 4;

/** A cutoff with no filter (Hz): the Nyquist frequency of the file rate. */
export const OPEN_HZ = MIX.sampleRate / 2;
/** The low-pass cutoffs: the bed while a bill is unpaid, the shimmer while saturated (ticket #62). */
const FILTER = { debt: 3000, saturated: 4000 } as const;
/** The shimmer's extra gain while the link is saturated (dB). */
const SATURATED_DB = 2;

/** The game speed's mix (music-spec.json `speed.map`): bass on or off, bass and shimmer offsets (dB), and the event density. */
export interface SpeedMix {
  bass: boolean;
  bassDb: number;
  shimmerDb: number;
  /** Multiplier of the event-note cap: notes per beat before merging = density * EVENT_NOTES_PER_BEAT. The director reads it (not the music). */
  density: number;
}

/** The mix with no speed known (before the first `onSpeed`), at 0 (stopped), or at a speed the map does not list. */
export const NEUTRAL_SPEED: SpeedMix = { bass: true, bassDb: 0, shimmerDb: 0, density: 1 };

/** Speed changes density and brightness, never tempo (the stems are fixed 66 bpm). 1: no bass, dim shimmer; 2: bass and shimmer down 3 dB; 8 and up: brighter, denser. */
export function speedMix(speed: number | undefined): SpeedMix {
  switch (speed) {
    case 1: {
      return { bass: false, bassDb: 0, shimmerDb: -6, density: 1 };
    }
    case 2: {
      return { bass: true, bassDb: -3, shimmerDb: -3, density: 1 };
    }
    case 4: {
      return NEUTRAL_SPEED;
    }
    case 8: {
      return { bass: true, bassDb: 0, shimmerDb: 2, density: 2 };
    }
    case 12:
    case 16:
    case 64: {
      return { bass: true, bassDb: 1, shimmerDb: 3, density: 3 };
    }
    default: {
      return NEUTRAL_SPEED;
    }
  }
}

/** Phases before the machine has booted: the menu loop is preloaded from the first phase after these. */
const PRE_BOOT: ReadonlySet<string> = new Set(['off', 'posting', 'mounting', 'loading']);

/** The game state of each phase (music-spec.json `states`). Phases not listed (error, and any other) play no keyed layer. */
type State = 'off' | 'boot' | 'idle' | 'running';
const PHASE_STATE: Readonly<Record<string, State>> = {
  off: 'off',
  posting: 'boot',
  mounting: 'boot',
  loading: 'boot',
  'booting-os': 'boot',
  'idle-os': 'idle',
  halted: 'idle',
  'waiting-for-key': 'idle',
  'done-remove-key': 'idle',
  running: 'running',
  'running-os': 'running',
  ingesting: 'running',
  flashing: 'running',
  writing: 'running',
};
const STATE_TARGETS: Readonly<Record<State, Readonly<Record<Layer, number>>>> = {
  off: { bed: 0.5, pluck: 0, bass: 0, pausebed: 0 },
  boot: { bed: 1, pluck: 0.5, bass: 0, pausebed: 0 },
  idle: { bed: 1, pluck: 0.6, bass: 0, pausebed: 0 },
  running: { bed: 1, pluck: 1, bass: 1, pausebed: 0 },
};
const SILENT: Readonly<Record<Layer, number>> = { bed: 0, pluck: 0, bass: 0, pausebed: 0 };
/** The error phase: the pausebed alone (no keyed layer of the state). */
const ERROR_TARGETS: Readonly<Record<Layer, number>> = { bed: 0, pluck: 0, bass: 0, pausebed: 1 };

/**
 * The layer targets of a phase. While the clock is stopped (`stopped`: Pause or Hold) the bed gives way to the pausebed,
 * and bass stays quiet; the pluck keeps its state target (it is dimmed in the mix, see `setLayers`).
 */
function layerTargets(phase: string | undefined, stopped = false): Readonly<Record<Layer, number>> {
  if (phase === 'error') {
    return ERROR_TARGETS;
  }
  const s = phase === undefined ? undefined : PHASE_STATE[phase];
  if (s === undefined) {
    return SILENT;
  }
  const t = STATE_TARGETS[s];
  if (!stopped) {
    return t;
  }
  return { bed: 0, pluck: t.pluck, bass: 0, pausebed: 1 };
}

/** The keys a game needs decoded: the current key and the next one (a fifth up, +7 semitones). */
export function keysInMemory(pc: number): string[] {
  return [keyName(pc), keyName((pc + MIX.transpose.stepSemitones) % 12)];
}

/** The number of fifths up (+7 semitones each) from one key to another, 0..11: the steps a level change walks. */
const fifthsBetween = (from: number, to: number): number => ((((to - from) * 7) % 12) + 12) % 12;

export function createMusic(sink: MusicSink): Music {
  let unlocked = false;
  let scene: Scene | null = null;
  /** The save's key token; null before the first snapshot. */
  let key: string | null = null;
  let phase: string | undefined;
  let preloaded = false;
  /** The keys decoded now. */
  const decoded = new Set<string>();
  /** What plays now: 'menu', a key token, or null (nothing yet). */
  let set: string | null = null;
  /** The pitch class of the key that plays now (null: the menu or nothing), and of the key the save wants. */
  let setPc: number | null = null;
  let targetPc: number | null = null;
  /** The last key change came from a level-up note: it walks the fifths. */
  let stepped = false;
  /** Each playing id, with the gain (dB) last sent for it (null: started, no gain sent yet). */
  const active = new Map<string, number | null>();
  /** The last low-pass cutoff sent per playing id (absent: open). Reset when the voice starts. */
  const hzOf = new Map<string, number>();
  /** The data layers whose file was asked for (decode on first use, once per id). */
  const requested = new Set<string>();
  let feed: MusicFeed = { flowing: false, saturated: false, stress: 0, debt: false };
  let speed: SpeedMix = NEUTRAL_SPEED;
  /** The clock is stopped (speed 0: Pause or Hold). */
  let stopped = false;
  /** The tab is hidden: state changes are recorded, no sound is sent (`onHidden`). */
  let hidden = false;
  /** The calls queued at the hide were dropped (the engine): the return sends every layer call again. */
  let lost = false;
  /** Set for one instant pass on return: every call runs at once with no fade (`fx`, `fq`). */
  let instant = false;

  /** A fade time for a sink call: none on the instant pass. */
  const fx = (ms: number): number => (instant ? 0 : ms);
  /** A quantise for a sink call: at once on the instant pass. */
  const fq = (q: Quant): Quant => (instant ? 'now' : q);

  /** The set that should play: nothing before the gesture or the boot screen; the game's key on the game screen once known; else the menu. */
  const wanted = (): string | null => {
    if (!unlocked || scene === null || scene === 'boot') {
      return null;
    }
    return scene === 'game' && key !== null ? key : 'menu';
  };

  /** A beat offset for a sink call: none on the instant pass. */
  const fb = (beats: number): number => (instant ? 0 : beats);

  const stopAll = (fadeMs: number, q: Quant = 'bar', beats = 0) => {
    for (const id of active.keys()) {
      sink.stopMusic(id, fx(fadeMs), fq(q), fb(beats));
    }
    active.clear();
    hzOf.clear();
  };

  /** A low-pass on a playing voice. Sent only when the cutoff changes (`force`: sent again, the record is not trusted). */
  const setLowpass = (id: string, hz: number, fadeMs: number, q: Quant = 'bar', force = false) => {
    if (!active.has(id) || (!force && (hzOf.get(id) ?? OPEN_HZ) === hz)) {
      return;
    }
    hzOf.set(id, hz);
    sink.setMusicLowpass?.(id, hz, fx(fadeMs), fq(q));
  };

  /**
   * The keyed layers follow the phase, the clock and (bass) the speed: entries start on `q`, exits stop on the beat or within fadeMs.
   * The target is a linear multiplier on the token (music-spec.md §4 and §8): dB = token + 20 log10(target), plus the speed's bass
   * offset. The bed is muffled while a bill is unpaid, over `TIMING.debtFadeMs`. While the clock is stopped the pluck is dimmed by
   * `pause.musicHold.pluckDb` and low-passed.
   */
  const setLayers = (fadeMs: number, q: Quant, force = false, beats = 0) => {
    if (set === null || set === 'menu') {
      return;
    }
    const targets = { ...layerTargets(phase, stopped) };
    if (!speed.bass) {
      targets.bass = 0;
    }
    for (const l of LAYERS) {
      const id = `music_${l}_${set}`;
      const to = targets[l];
      // `force`: the record is not trusted (the engine dropped calls), so the call goes out again. The engine keeps a stem that plays.
      if (force) {
        active.delete(id);
        hzOf.delete(id);
      }
      const on = active.has(id);
      if (to === 0) {
        if (on || force) {
          sink.stopMusic(id, fx(Math.min(fadeMs, TIMING.exitFadeMs)), fq('beat'));
          active.delete(id);
          hzOf.delete(id);
        }
        continue;
      }
      if (!on) {
        sink.startMusic(id, fx(fadeMs), fq(q), fb(beats));
        active.set(id, null);
        hzOf.delete(id);
      }
      if (l === 'pluck') {
        setLowpass(id, stopped ? MIX.pause.musicHold.lowpassHz : OPEN_HZ, TIMING.pauseFadeMs, q, force);
      }
      const dip = l === 'pluck' && stopped ? MIX.pause.musicHold.pluckDb : 0;
      const db = round1(MIX.music.layerGainDb[l] + linearDb(to) + (l === 'bass' ? speed.bassDb : 0) + dip);
      if (active.get(id) !== db) {
        sink.setMusicGain(id, db, fx(fadeMs), fq(q));
        active.set(id, db);
      }
    }
    setLowpass(`music_bed_${set}`, feed.debt ? FILTER.debt : OPEN_HZ, TIMING.debtFadeMs, q, force);
  };

  /**
   * One data layer: on starts it on the bar (asking for its file first, so it decodes on first use); off stops it over a bar (over 1 s on the beat while paused).
   * `db` is its gain, `hz` its low-pass; a gain change ramps over `fadeMs`.
   */
  const setData = (id: string, on: boolean, db: number, hz: number, fadeMs: number, force: boolean) => {
    if (force) {
      active.delete(id);
      hzOf.delete(id);
    }
    if (!on) {
      if (active.has(id) || force) {
        // A pause stops it over the pause fade (1 s) on the next beat; a feed that stops asking stops it over a bar.
        if (stopped) {
          sink.stopMusic(id, fx(TIMING.pauseFadeMs), fq('beat'));
        } else {
          sink.stopMusic(id, fx(BAR_MS), fq('bar'));
        }
        active.delete(id);
        hzOf.delete(id);
      }
      return;
    }
    if (!requested.has(id)) {
      requested.add(id);
      sink.preloadMusic(id);
    }
    if (!active.has(id)) {
      sink.startMusic(id, fx(BAR_MS), fq('bar'));
      active.set(id, null);
      hzOf.delete(id);
    }
    if (active.get(id) !== db) {
      sink.setMusicGain(id, db, fx(fadeMs), fq('bar'));
      active.set(id, db);
    }
    setLowpass(id, hz, fadeMs, 'bar', force);
  };

  /** The shimmer (on while data flows, +2 dB and a 4 kHz low-pass when saturated) and the stress (a linear stress^1.5 on its token dB). */
  const setDataLayers = (fadeMs: number, force = false) => {
    if (set === null || set === 'menu') {
      return;
    }
    const sat = feed.saturated;
    const shimmerDb = MIX.music.layerGainDb.shimmer + speed.shimmerDb + (sat ? SATURATED_DB : 0);
    setData(
      `music_shimmer_${set}`,
      feed.flowing && !stopped,
      round1(shimmerDb),
      sat ? FILTER.saturated : OPEN_HZ,
      fadeMs,
      force,
    );
    // The stress target is a linear multiplier on the token (music-spec.json stress.gain): dB = token + 20 log10(stress^1.5).
    const stressDb = feed.stress > 0 ? round1(MIX.music.layerGainDb.stress + linearDb(feed.stress ** 1.5)) : 0;
    setData(`music_stress_${set}`, feed.stress > 0 && !stopped, stressDb, OPEN_HZ, fadeMs, force);
  };

  /** The keyed and the data layers together. */
  const refresh = (fadeMs: number, q: Quant = 'bar', force = false, beats = 0) => {
    setLayers(fadeMs, q, force, beats);
    setDataLayers(fadeMs, force);
  };

  /** Key to key: a level-up note walks one fifth per beat (step i on beat i - 1); any other change is one step on the next beat. */
  const walkKey = (want: string, fromPc: number | null) => {
    const base = fromPc ?? 0;
    const to = targetPc ?? base;
    const steps = stepped && fromPc !== null ? Math.max(1, fifthsBetween(base, to)) : 1;
    for (let i = 1; i <= steps; i++) {
      const last = i === steps;
      const beats = i - 1;
      set = last ? want : keyName((base + 7 * i) % 12);
      stopAll(TIMING.keyChangeMs, 'beat', beats);
      if (last) {
        refresh(TIMING.keyChangeMs, 'beat', false, beats);
      } else {
        setLayers(TIMING.keyChangeMs, 'beat', false, beats);
      }
    }
  };

  const sync = () => {
    const want = wanted();
    if (want === null || want === set) {
      return;
    }
    // A new key holds the old one until it is decoded: the next snapshot calls sync again (onFeed).
    if (want !== 'menu' && sink.keyReady?.(want) === false) {
      return;
    }
    const from = set;
    const fromPc = setPc;
    set = want;
    setPc = want === 'menu' ? null : targetPc;
    if (from === null) {
      // The first set: the menu comes in at once; a game set (key known first) starts on the bar.
      if (want === 'menu') {
        sink.startMusic(MENU_ID, fx(TIMING.menuInMs), 'now');
        active.set(MENU_ID, null);
      } else {
        refresh(TIMING.stateFadeMs);
      }
      return;
    }
    if (want === 'menu') {
      stopAll(TIMING.gameOutMs);
      sink.startMusic(MENU_ID, fx(TIMING.gameOutMs), fq('bar'));
      active.set(MENU_ID, null);
      return;
    }
    // Menu to game: the menu fades out on the bar and the stems fade in. A key change crossfades in 1.4 s.
    if (from === 'menu') {
      stopAll(TIMING.stateFadeMs);
      refresh(TIMING.stateFadeMs);
      return;
    }
    walkKey(want, fromPc);
  };

  /** The same set, its layers and their gains at target, at once (the return from a hidden tab). Stems already playing keep playing. */
  const resync = (dropped: boolean) => {
    instant = true;
    try {
      const old = set;
      sync();
      if (!dropped) {
        refresh(0);
        return;
      }
      // The engine dropped the calls queued at the hide: those layers never ran, and the stems of the old set may still play.
      // Every call of the set goes out again (a no-op in the engine where a stem already plays), and the old set stops.
      if (old !== null && old !== set) {
        const oldIds = old === 'menu' ? [MENU_ID] : [...LAYERS, ...DATA_LAYERS].map((l) => `music_${l}_${old}`);
        for (const id of oldIds) {
          sink.stopMusic(id, 0, 'now');
        }
      }
      if (set === 'menu') {
        sink.startMusic(MENU_ID, 0, 'now');
      } else {
        refresh(0, 'bar', true);
      }
    } finally {
      instant = false;
    }
  };

  return {
    onScene(s) {
      scene = s;
      if (!hidden) {
        sync();
      }
    },
    onKey(pc, stepOn = false) {
      const k = keyName(pc);
      if (k === key) {
        return;
      }
      key = k;
      targetPc = pc;
      stepped = stepOn;
      // Decoding is loading, not sound: the keys follow the level even while hidden.
      const want = new Set(keysInMemory(pc));
      // The keys a walk passes through are decoded too: a step starts its stems on its own beat.
      if (stepOn && setPc !== null) {
        for (let i = 1; i < fifthsBetween(setPc, pc); i++) {
          want.add(keyName((setPc + 7 * i) % 12));
        }
      }
      for (const w of want) {
        if (!decoded.has(w)) {
          sink.decodeKey(w);
          decoded.add(w);
        }
      }
      for (const d of [...decoded]) {
        if (!want.has(d)) {
          sink.releaseKey(d);
          decoded.delete(d);
        }
      }
      if (!hidden) {
        sync();
      }
    },
    onPhase(p) {
      phase = p;
      if (!preloaded && p !== undefined && !PRE_BOOT.has(p)) {
        preloaded = true;
        sink.preloadMusic(MENU_ID);
      }
      if (!hidden) {
        refresh(TIMING.stateFadeMs);
      }
    },
    onFeed(f) {
      feed = f;
      // Each snapshot retries a key change that holds for its decode.
      if (!hidden) {
        sync();
        refresh(BAR_MS);
      }
    },
    onSpeed(s) {
      speed = speedMix(s);
      if (!hidden) {
        refresh(TIMING.speedFadeMs);
      }
    },
    onStopped(s) {
      if (s === stopped) {
        return;
      }
      stopped = s;
      // Pause and resume: the bed and pausebed crossfade over 1 s, on the next beat (the tempo does not change).
      if (!hidden) {
        setLayers(TIMING.pauseFadeMs, 'beat');
        setDataLayers(TIMING.pauseFadeMs);
      }
    },
    onFault() {
      // The fault stinger in the key that plays now, on the next beat. Nothing with no keyed set (the menu, no game).
      if (hidden || set === null || set === 'menu') {
        return;
      }
      sink.playStinger?.(`music_fault_${set}`, 'beat');
    },
    onHidden(h, dropped = false) {
      if (h === hidden) {
        return;
      }
      hidden = h;
      if (h) {
        lost = dropped;
      } else {
        resync(lost);
        lost = false;
      }
    },
    onUnlock() {
      unlocked = true;
      if (!hidden) {
        sync();
      }
    },
  };
}

/** Grid: one beat is the stem's length over 16 (4 beats a bar, 4 bars a loop). Derived from the file, so the tempo never drifts. */
const LOOP_S = MIX.music.loopSamples / MIX.sampleRate;
export const BAR_S = LOOP_S / 4;
export const BEAT_S = LOOP_S / 16;
/** One bar in ms. The data layers start, stop and fade over one bar (ticket #62). */
const BAR_MS = BAR_S * 1000;

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** A linear gain as dB (20 log10). Layer targets are linear multipliers on their token (music-spec.json §8). */
const linearDb = (x: number): number => 20 * Math.log10(x);

/** The first grid point `step` apart from `t0` at or after `t`. */
export function nextOnGrid(t: number, t0: number, step: number): number {
  return t0 + Math.ceil((t - t0) / step - 1e-9) * step;
}

/** Stems carry this many samples of wrap-around padding before and after the loop (music-spec.json loop_padding). */
export const PAD = MIX.music.loopPadSamples;

/**
 * Stitch a decoded stem once, in place (IMPLEMENTATION §7.3): the last `n` samples before loopEnd fade into the pre-roll copy,
 * so the seam is stream-continuous. Stitching twice smears the seam: the engine calls this once per decode.
 */
export function stitchStem(channels: readonly Float32Array[], loopSamples: number, n = 480): void {
  const e0 = PAD + loopSamples - n;
  for (const d of channels) {
    for (let i = 0; i < n; i++) {
      const a = i / n;
      d[e0 + i] = d[e0 + i]! * (1 - a) + d[PAD - n + i]! * a;
    }
  }
}
