// The Afterglow music director (ticket #61): the menu loop, and the game stems (bed, pluck, bass) by phase.
// Pure TS (no Web Audio): the director owns one and the engine is its sink (`engine.ts`), so tests drive it with a fake.
// Numbers come from MIX (mix tokens). The phase table is music-spec.json `states`; the fade times are the ticket's.
import { MIX } from './mixTokens';
import { keyName } from './keys';
import { dB } from './volume';
import type { Scene } from './director';

export type Quant = 'bar' | 'beat' | 'now';
export type Layer = 'bed' | 'pluck' | 'bass' | 'pausebed';

/** The sink the director drives (`engine.ts` is the real one). Ids: `music_menu_F`, `music_<layer>_<KEY>` or `music_fault_<KEY>`. */
export interface MusicSink {
  startMusic(id: string, fadeInMs: number, quantise: Quant): void;
  stopMusic(id: string, fadeOutMs: number, quantise: Quant): void;
  /** `gainDb` is the layer's target times its token dB (MIX.music.layerGainDb), plus any pause dip. */
  setMusicGain(id: string, gainDb: number, fadeMs: number, quantise: Quant): void;
  /** A keyed voice's low-pass corner (Hz). Optional: a sink without it plays the pluck unfiltered. */
  setMusicLowpass?(id: string, hz: number, fadeMs: number, quantise: Quant): void;
  /** A one-shot stem (the fault stinger). Optional: a sink without it plays no stinger. */
  playStinger?(id: string, quantise: Quant): void;
  /** A loop decode started before it is needed. */
  preloadMusic(id: string): void;
  /** The keyed stems of one key ('F', 'C', ...) decoded, or freed. */
  decodeKey(key: string): void;
  releaseKey(key: string): void;
}

export interface Music {
  onScene(scene: Scene): void;
  /** The save's level key, as a pitch class (0 = C). */
  onKey(pc: number): void;
  /** The game's phase (`Phase`), or undefined when there is no game. */
  onPhase(phase: string | undefined): void;
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
export const MENU_ID = MIX.music.menu.file.replace(/^.*\//, '').replace(/\.ogg$/, '');
export const LAYERS: readonly Layer[] = ['bed', 'pluck', 'bass', 'pausebed'];

/** Fades, in ms. The menu's 2 s and the 1.5 s return are the ticket's numbers; the rest follow music-spec.json (states, key_change, pause). */
export const TIMING = {
  menuInMs: 2000,
  stateFadeMs: 2000,
  gameOutMs: 1500,
  keyChangeMs: 1400,
  exitFadeMs: 1000,
  /** The pause crossfade (bed to pausebed) and the resume: MIX.pause.fadeMs. */
  pauseFadeMs: MIX.pause.fadeMs,
} as const;

/** The low-pass corner that leaves the pluck open: the Nyquist frequency of the file's rate. */
const OPEN_HZ = MIX.sampleRate / 2;

/** Phases before the machine has booted: the menu loop is preloaded from the first phase after these. */
const PRE_BOOT: ReadonlySet<string> = new Set(['off', 'posting', 'mounting', 'loading']);

/** The game state of each phase (music-spec.json `states`). Phases not listed (error, and any other) play no keyed layer. */
type State = 'off' | 'boot' | 'idle' | 'running';
const PHASE_STATE: Readonly<Record<string, State>> = {
  off: 'off',
  posting: 'boot', mounting: 'boot', loading: 'boot', 'booting-os': 'boot',
  'idle-os': 'idle', halted: 'idle', 'waiting-for-key': 'idle', 'done-remove-key': 'idle',
  running: 'running', 'running-os': 'running', ingesting: 'running', flashing: 'running', writing: 'running',
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
export function layerTargets(phase: string | undefined, stopped = false): Readonly<Record<Layer, number>> {
  if (phase === 'error') return ERROR_TARGETS;
  const s = phase === undefined ? undefined : PHASE_STATE[phase];
  if (s === undefined) return SILENT;
  const t = STATE_TARGETS[s];
  if (!stopped) return t;
  return { bed: 0, pluck: t.pluck, bass: 0, pausebed: 1 };
}

/** The keys a game needs decoded: the current key and the next one (a fifth up, +7 semitones). */
export function keysInMemory(pc: number): string[] {
  return [keyName(pc), keyName((pc + MIX.transpose.stepSemitones) % 12)];
}

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
  /** Each playing id, with the gain (dB) last sent for it (null: started, no gain sent yet). */
  const active = new Map<string, number | null>();
  /** The clock is stopped (speed 0: Pause or Hold). */
  let stopped = false;
  /** The tab is hidden: state changes are recorded, no sound is sent (`onHidden`). */
  let hidden = false;
  /** The calls queued at the hide were dropped (the engine): the return sends every layer call again. */
  let lost = false;
  /** Set for one instant pass on return: every call runs at once with no fade (`fx`, `fq`). */
  let instant = false;
  /** The low-pass corner last sent per pluck voice (Hz). */
  const toneSent = new Map<string, number>();

  /** A fade time for a sink call: none on the instant pass. */
  const fx = (ms: number): number => (instant ? 0 : ms);
  /** A quantise for a sink call: at once on the instant pass. */
  const fq = (q: Quant): Quant => (instant ? 'now' : q);

  /** The set that should play: nothing before the gesture or the boot screen; the game's key on the game screen once known; else the menu. */
  const wanted = (): string | null => {
    if (!unlocked || scene === null || scene === 'boot') return null;
    return scene === 'game' && key !== null ? key : 'menu';
  };

  const stopAll = (fadeMs: number) => {
    for (const id of active.keys()) sink.stopMusic(id, fx(fadeMs), fq('bar'));
    active.clear();
    toneSent.clear();
  };

  /**
   * The keyed layers follow the phase and the clock: entries start on `q`, exits stop on the beat. Gains are target times token dB,
   * the pluck is dimmed by `pause.musicHold.pluckDb` and low-passed while the clock is stopped.
   */
  const setLayers = (fadeMs: number, q: Quant, force = false) => {
    if (set === null || set === 'menu') return;
    const targets = layerTargets(phase, stopped);
    for (const l of LAYERS) {
      const id = `music_${l}_${set}`;
      const to = targets[l];
      // `force`: the record is not trusted (the engine dropped calls), so the call goes out again. The engine keeps a stem that plays.
      if (force) {
        active.delete(id);
        toneSent.delete(id);
      }
      const on = active.has(id);
      if (to === 0) {
        if (on || force) {
          sink.stopMusic(id, fx(TIMING.exitFadeMs), fq('beat'));
          active.delete(id);
          toneSent.delete(id);
        }
        continue;
      }
      if (!on) {
        sink.startMusic(id, fx(fadeMs), fq(q));
        active.set(id, null);
      }
      if (l === 'pluck') {
        const hz = stopped ? MIX.pause.musicHold.lowpassHz : OPEN_HZ;
        if (toneSent.get(id) !== hz) {
          sink.setMusicLowpass?.(id, hz, fx(TIMING.pauseFadeMs), fq(q));
          toneSent.set(id, hz);
        }
      }
      const dip = l === 'pluck' && stopped ? MIX.pause.musicHold.pluckDb : 0;
      const db = to * MIX.music.layerGainDb[l] + dip;
      if (active.get(id) !== db) {
        sink.setMusicGain(id, db, fx(fadeMs), fq(q));
        active.set(id, db);
      }
    }
  };

  const sync = () => {
    const want = wanted();
    if (want === null || want === set) return;
    const from = set;
    set = want;
    if (from === null) {
      // The first set: the menu comes in at once; a game set (key known first) starts on the bar.
      if (want === 'menu') {
        sink.startMusic(MENU_ID, fx(TIMING.menuInMs), 'now');
        active.set(MENU_ID, null);
      } else {
        setLayers(TIMING.stateFadeMs, 'bar');
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
      setLayers(TIMING.stateFadeMs, 'bar');
    } else {
      stopAll(TIMING.keyChangeMs);
      setLayers(TIMING.keyChangeMs, 'bar');
    }
  };

  /** The same set, its layers and their gains at target, at once (the return from a hidden tab). Stems already playing keep playing. */
  const resync = (dropped: boolean) => {
    instant = true;
    try {
      const old = set;
      sync();
      if (!dropped) {
        setLayers(0, 'bar');
        return;
      }
      // The engine dropped the calls queued at the hide: those layers never ran, and the stems of the old set may still play.
      // Every call of the set goes out again (a no-op in the engine where a stem already plays), and the old set stops.
      if (old !== null && old !== set) {
        const oldIds = old === 'menu' ? [MENU_ID] : LAYERS.map((l) => `music_${l}_${old}`);
        for (const id of oldIds) sink.stopMusic(id, 0, 'now');
      }
      if (set === 'menu') sink.startMusic(MENU_ID, 0, 'now');
      else setLayers(0, 'bar', true);
    } finally {
      instant = false;
    }
  };

  return {
    onScene(s) {
      scene = s;
      if (!hidden) sync();
    },
    onKey(pc) {
      const k = keyName(pc);
      if (k === key) return;
      key = k;
      // Decoding is loading, not sound: the keys follow the level even while hidden.
      const want = new Set(keysInMemory(pc));
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
      if (!hidden) sync();
    },
    onPhase(p) {
      phase = p;
      if (!preloaded && p !== undefined && !PRE_BOOT.has(p)) {
        preloaded = true;
        sink.preloadMusic(MENU_ID);
      }
      if (!hidden) setLayers(TIMING.stateFadeMs, 'bar');
    },
    onStopped(s) {
      if (s === stopped) return;
      stopped = s;
      // Pause and resume: the bed and pausebed crossfade over 1 s, on the next beat (the tempo does not change).
      if (!hidden) setLayers(TIMING.pauseFadeMs, 'beat');
    },
    onFault() {
      // The fault stinger in the key that plays now, on the next beat. Nothing with no keyed set (the menu, no game).
      if (hidden || set === null || set === 'menu') return;
      sink.playStinger?.(`music_fault_${set}`, 'beat');
    },
    onHidden(h, dropped = false) {
      if (h === hidden) return;
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
      if (!hidden) sync();
    },
  };
}

/** Grid: one beat is the stem's length over 16 (4 beats a bar, 4 bars a loop). Derived from the file, so the tempo never drifts. */
export const LOOP_S = MIX.music.loopSamples / MIX.sampleRate;
export const BAR_S = LOOP_S / 4;
export const BEAT_S = LOOP_S / 16;

/** The first grid point `step` apart from `t0` at or after `t`. */
export function nextOnGrid(t: number, t0: number, step: number): number {
  return t0 + Math.ceil((t - t0) / step - 1e-9) * step;
}

/** Stems carry this many samples of wrap-around padding before and after the loop (music-spec.json loop_padding). */
export const PAD = MIX.music.loopPadSamples;

/** The loop region of a stem with `loopSamples` of loop: [start, end) in samples inside the decoded buffer. */
export const loopRegion = (loopSamples: number): { start: number; end: number } => ({ start: PAD, end: PAD + loopSamples });

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
