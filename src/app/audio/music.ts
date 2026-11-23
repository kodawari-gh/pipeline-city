// The Afterglow music director (ticket #61): the menu loop, and the game stems (bed, pluck, bass) by phase.
// Pure TS (no Web Audio): the director owns one and the engine is its sink (`engine.ts`), so tests drive it with a fake.
// Numbers come from MIX (mix tokens). The phase table is music-spec.json `states`; the fade times are the ticket's.
import { MIX } from './mixTokens';
import { keyName } from './keys';
import { dB } from './volume';
import type { Scene } from './director';

export type Quant = 'bar' | 'beat' | 'now';
export type Layer = 'bed' | 'pluck' | 'bass';

/** The sink the director drives (`engine.ts` is the real one). Ids: `music_menu_F` or `music_<layer>_<KEY>`. */
export interface MusicSink {
  startMusic(id: string, fadeInMs: number, quantise: Quant): void;
  stopMusic(id: string, fadeOutMs: number, quantise: Quant): void;
  /** `gainDb` is the layer's target times its token dB (MIX.music.layerGainDb). */
  setMusicGain(id: string, gainDb: number, fadeMs: number, quantise: Quant): void;
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
  /** The first gesture: music may play from now on. */
  onUnlock(): void;
}

/** The menu loop's id: the file's name without `.ogg` (`music_menu_F`). */
export const MENU_ID = MIX.music.menu.file.replace(/^.*\//, '').replace(/\.ogg$/, '');
export const LAYERS: readonly Layer[] = ['bed', 'pluck', 'bass'];

/** Fades, in ms. The menu's 2 s and the 1.5 s return are the ticket's numbers; the rest follow music-spec.json (states, key_change, pause). */
export const TIMING = {
  menuInMs: 2000,
  stateFadeMs: 2000,
  gameOutMs: 1500,
  keyChangeMs: 1400,
  exitFadeMs: 1000,
} as const;

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
  off: { bed: 0.5, pluck: 0, bass: 0 },
  boot: { bed: 1, pluck: 0.5, bass: 0 },
  idle: { bed: 1, pluck: 0.6, bass: 0 },
  running: { bed: 1, pluck: 1, bass: 1 },
};
const SILENT: Readonly<Record<Layer, number>> = { bed: 0, pluck: 0, bass: 0 };

/** The layer targets of a phase. */
export function layerTargets(phase: string | undefined): Readonly<Record<Layer, number>> {
  const s = phase === undefined ? undefined : PHASE_STATE[phase];
  return s === undefined ? SILENT : STATE_TARGETS[s];
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

  /** The set that should play: nothing before the gesture or the boot screen; the game's key on the game screen once known; else the menu. */
  const wanted = (): string | null => {
    if (!unlocked || scene === null || scene === 'boot') return null;
    return scene === 'game' && key !== null ? key : 'menu';
  };

  const stopAll = (fadeMs: number) => {
    for (const id of active.keys()) sink.stopMusic(id, fadeMs, 'bar');
    active.clear();
  };

  /** The keyed layers follow the phase: entries start on the bar, exits stop on the beat. Gains are target times token dB. */
  const setLayers = (fadeMs: number) => {
    if (set === null || set === 'menu') return;
    const targets = layerTargets(phase);
    for (const l of LAYERS) {
      const id = `music_${l}_${set}`;
      const to = targets[l];
      const on = active.has(id);
      if (to === 0) {
        if (on) {
          sink.stopMusic(id, TIMING.exitFadeMs, 'beat');
          active.delete(id);
        }
        continue;
      }
      if (!on) {
        sink.startMusic(id, fadeMs, 'bar');
        active.set(id, null);
      }
      const db = to * MIX.music.layerGainDb[l];
      if (active.get(id) !== db) {
        sink.setMusicGain(id, db, fadeMs, 'bar');
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
        sink.startMusic(MENU_ID, TIMING.menuInMs, 'now');
        active.set(MENU_ID, null);
      } else {
        setLayers(TIMING.stateFadeMs);
      }
      return;
    }
    if (want === 'menu') {
      stopAll(TIMING.gameOutMs);
      sink.startMusic(MENU_ID, TIMING.gameOutMs, 'bar');
      active.set(MENU_ID, null);
      return;
    }
    // Menu to game: the menu fades out on the bar and the stems fade in. A key change crossfades in 1.4 s.
    if (from === 'menu') {
      stopAll(TIMING.stateFadeMs);
      setLayers(TIMING.stateFadeMs);
    } else {
      stopAll(TIMING.keyChangeMs);
      setLayers(TIMING.keyChangeMs);
    }
  };

  return {
    onScene(s) {
      scene = s;
      sync();
    },
    onKey(pc) {
      const k = keyName(pc);
      if (k === key) return;
      key = k;
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
      sync();
    },
    onPhase(p) {
      phase = p;
      if (!preloaded && p !== undefined && !PRE_BOOT.has(p)) {
        preloaded = true;
        sink.preloadMusic(MENU_ID);
      }
      setLayers(TIMING.stateFadeMs);
    },
    onUnlock() {
      unlocked = true;
      sync();
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
