// The director: each new snapshot becomes cues. It sets the key from the level and plays one cue per new log note that has one.
// It also plays the state rules (a change between two snapshots, SPEC §3.2) and, through `onUi`, the clock and holds.
// It also drives the ambience (ambience.ts): the room loop (`onScene`, `onUnlock`), the hum (each snapshot) and the pause dip (`onUi`).
// It talks to the sound only through `CueSink` and the ambience calls, so a test drives it with a fake (engine.ts is the real sink).
import { MIX, type CueId } from './mixTokens';
import { keyPcForLevel } from './keys';
import { cueForNote, createNoteTracker } from './events';
import { createAmbience, type AmbienceSink, type FanDevice } from './ambience';
import { createMusic, type Music, type MusicSink } from './music';
import type { GameEvent, KeyActivity, LinkState, Phase } from '../../worker/game/types';

export interface CueSink {
  playCue(id: CueId, opts?: { delayS?: number; quantise?: 'beat' }): void;
  setKeyPc(pc: number): void;
}

/** The screens the room loop cares about: the room scene is the main menu and the game (not the studios). `boot`: the boot screen covers the page (no room loop). */
export type Scene = 'boot' | 'menu' | 'game' | 'build' | 'gallery';

/** What holds the clock while it is stopped by a popup or the menu. A Hold plays no pause or resume cue. */
export type Hold = 'levelUp' | 'tutorial' | 'menu';

/** What the UI tells the director: the clock's speed (0 = stopped), the hold on it, and whether the sim crashed. */
export interface UiInput {
  speed: number;
  hold: Hold | null;
  crashed: boolean;
  /** The level of the open level-up popup, or null. A new value plays the stinger (once per level). */
  levelUp?: number | null;
}

export interface DirectorSnap {
  log: GameEvent[];
  level: { level: number };
  /** Sandbox games move the key but play no level-up stinger. */
  sandbox?: boolean;
  /** Queued swaps (a snapshot always has it; optional so a fixture may omit it). */
  pendingSwaps?: readonly unknown[];
  /** The fields below feed the state rules. A fixture may omit them: then no state rule plays. */
  baseTick?: number;
  phase?: Phase;
  net?: { state: LinkState };
  power?: { tripped: boolean };
  plugged?: unknown | null;
  keyActivity?: KeyActivity;
  /** The machine's power and devices: the hum (a fixture may omit them: then no hum plays). */
  powered?: boolean;
  devices?: readonly FanDevice[];
}

export interface Director {
  onSnapshot(s: DirectorSnap): void;
  /** The clock, the hold and the crash, each time one of them may have changed. */
  onUi(u: UiInput): void;
  /** No game (snapshot null), load or new game: the next snapshot starts fresh and plays nothing. */
  reset(): void;
}

/** The room loop's two inputs: the screen, and the first gesture (nothing plays before it). */
export interface RoomInput {
  onScene(scene: Scene): void;
  onUnlock(): void;
}

/** The state a state rule compares with the one before. */
interface SeenState {
  baseTick?: number;
  phase?: Phase;
  net?: LinkState;
  tripped?: boolean;
  plugged: boolean;
  keyActivity?: KeyActivity;
  /** POST ran and the machine has not reached `running` or `idle-os` yet: the next `running` is this boot's `boot_ready`. */
  posted: boolean;
}

const LINK_DOWN: readonly LinkState[] = ['down', 'no-cable', 'no-os', 'no-device'];

/**
 * The state rules (SPEC §3.2) between the last snapshot and this one. A rule is skipped when a note of its family
 * already played a cue in this snapshot (`families`: the note kinds that played), so one fault gives one cue.
 */
function stateCues(before: SeenState, now: SeenState, families: ReadonlySet<string>): CueId[] {
  const out: CueId[] = [];
  if (now.net !== before.net) {
    const from = before.net;
    if (now.net === 'link-up' && from !== 'saturated') out.push('net_link_up');
    if (now.net === 'saturated') out.push('net_saturated');
    if ((from === 'link-up' || from === 'saturated') && LINK_DOWN.includes(now.net!)) out.push('net_down');
  }
  if (now.phase !== before.phase) {
    if (now.phase === 'posting') out.push('post_boot');
    // Booted: POST ran, then the OS idles or the no-OS flow runs. Once per boot: a later job's phases play nothing (`posted` is spent).
    if ((now.phase === 'idle-os' || now.phase === 'running') && before.posted) out.push('boot_ready');
  }
  if (!families.has('fault')) {
    const error = now.phase === 'error' && before.phase !== 'error';
    const psu = now.tripped === true && before.tripped !== true;
    if (error || psu) out.push('fault_hard');
  }
  if (!families.has('key')) {
    const unplugged = before.plugged && !now.plugged;
    const done = before.keyActivity === 'done' && now.keyActivity === 'none';
    if (unplugged || done) out.push('key_eject');
  }
  return out;
}

/** Seconds between the cues of one snapshot: the notes of one tick play in log order, 40 ms apart. */
export const NOTE_GAP_S = 0.04;

/** A sink without the ambience calls (a cue-only fixture) is never asked for them: the ambience stays silent. */
const silentAmbience: AmbienceSink = { startLoop() {}, stopLoop() {}, setHum() {}, duckHum() {} };
const hasAmbience = (s: object): s is AmbienceSink =>
  ['startLoop', 'stopLoop', 'setHum', 'duckHum'].every((k) => k in s);

/** A sink without the music calls (a cue-only fixture) is never asked for them: the music stays silent. */
const silentMusic: MusicSink = {
  startMusic() {}, stopMusic() {}, setMusicGain() {}, preloadMusic() {}, decodeKey() {}, releaseKey() {},
};
const hasMusic = (s: object): s is MusicSink =>
  ['startMusic', 'stopMusic', 'setMusicGain', 'preloadMusic', 'decodeKey', 'releaseKey'].every((k) => k in s);

export function createDirector(sink: CueSink & Partial<AmbienceSink> & Partial<MusicSink>): Director & RoomInput {
  const notes = createNoteTracker();
  const ambience = createAmbience(hasAmbience(sink) ? sink : silentAmbience);
  const music: Music = createMusic(hasMusic(sink) ? sink : silentMusic);
  let keyPc: number | null = null;
  /** Queued swaps in the last snapshot; null before the first one (after a reset). */
  let prevPending: number | null = null;
  /** The last snapshot's state; null before the first one (after a reset): that snapshot plays no state rule. */
  let prevState: SeenState | null = null;
  /** The last UI input. Kept across a reset: the clock does not stop when the game does. */
  let prevUi: UiInput | null = null;
  /** The last speed-0 edge was a hold (not a Pause): lifting the hold plays no resume. */
  let pausedByHold = false;
  /** The level the last snapshot showed; null before the first one (after a reset). */
  let level: number | null = null;
  /** The level whose stinger has played, or was passed over as silent. One level, one stinger (the note or the popup). */
  let stingerLevel: number | null = null;
  let sandbox = false;

  /** Sets the key once per change. The sink picks each cue's file from the key it holds. */
  const setKey = (pc: number) => {
    if (pc === keyPc) return;
    keyPc = pc;
    sink.setKeyPc(pc);
  };

  /**
   * The level-up stinger for `lvl`, on the music's next beat. Sandbox and a level already marked play nothing.
   * The popup can open before the snapshot of its level: the stinger takes its own level's key first.
   */
  const stinger = (lvl: number) => {
    if (lvl === stingerLevel) return;
    stingerLevel = lvl;
    if (sandbox) return;
    setKey(keyPcForLevel(lvl));
    sink.playCue('level_up', { quantise: MIX.levelUp.quantise === 'beat' ? 'beat' : undefined });
  };

  return {
    onSnapshot(s) {
      setKey(keyPcForLevel(s.level.level));
      ambience.onSnapshot({ powered: s.powered === true, devices: s.devices ?? [] });
      // The phase first: a key change on the same snapshot then starts the layers of the new phase.
      music.onPhase(s.phase);
      music.onKey(keyPcForLevel(s.level.level));
      sandbox = s.sandbox === true;
      // A swap finished when the queue shrank. Its `install` notes play one `swap_done` (SPEC §3.2, "Swap done").
      const pending = s.pendingSwaps?.length ?? 0;
      const swapDone = prevPending !== null && pending < prevPending;
      prevPending = pending;
      let i = 0;
      let swapCued = false;
      const fresh = notes.fresh(s.log);
      // The note kinds that played a cue now: a state rule of the same family is skipped (one fault, not two).
      const families = new Set<string>();
      for (const e of fresh) {
        let id = cueForNote(e);
        if (id === 'install' && swapDone) {
          id = swapCued ? null : 'swap_done';
          swapCued = true;
        }
        if (id) {
          families.add(e.kind);
          sink.playCue(id, { delayS: i++ * NOTE_GAP_S });
        }
      }
      // A level note plays the stinger once, for the level now shown (several levels in one tick: one stinger).
      // A level change with no note (a load, a new game, a sandbox level) moves the key and plays nothing.
      const lvl = s.level.level;
      if (fresh.some((e) => e.kind === 'level')) stinger(lvl);
      else stingerLevel = lvl;
      level = lvl;
      // A save loaded (the tick went back) is one snapshot of silence, like the notes.
      const before = prevState;
      const now: SeenState = {
        baseTick: s.baseTick,
        phase: s.phase,
        net: s.net?.state,
        tripped: s.power?.tripped,
        plugged: s.plugged != null,
        keyActivity: s.keyActivity,
        posted: s.phase === 'posting' || (before?.posted === true && s.phase !== 'running' && s.phase !== 'idle-os'),
      };
      prevState = now;
      const loaded = before?.baseTick !== undefined && now.baseTick !== undefined && now.baseTick < before.baseTick;
      if (before && !loaded) {
        for (const id of stateCues(before, now, families)) sink.playCue(id, { delayS: i++ * NOTE_GAP_S });
      }
    },
    onScene(scene) {
      ambience.onRoom(scene === 'menu' || scene === 'game');
      music.onScene(scene);
    },
    onUnlock() {
      ambience.onUnlock();
      music.onUnlock();
    },
    onUi(u) {
      ambience.onSpeed(u.speed);
      const before = prevUi;
      prevUi = u;
      if (!before) return;
      // The level-up popup opens: its stinger, unless a note of that level already played it. Before any snapshot (after a reset) nothing plays.
      if (u.levelUp != null && u.levelUp !== before.levelUp && level !== null) stinger(u.levelUp);
      // A sim crash plays the error cue; the stop it causes plays `pause` through the speed rule below.
      if (u.crashed && !before.crashed) sink.playCue('ui_error');
      // A hold starts: the in-game menu plays its panel cue. The level-up and tutorial popups play nothing.
      if (u.hold === 'menu' && before.hold !== 'menu') sink.playCue('ui_panel_open');
      if (u.speed !== before.speed) {
        if (u.speed === 0) {
          pausedByHold = u.hold !== null;
          if (!pausedByHold) sink.playCue('pause');
        } else if (before.speed === 0) {
          if (!pausedByHold && u.hold === null) sink.playCue('resume');
        } else {
          sink.playCue(u.speed > before.speed ? 'speed_up' : 'speed_down');
        }
      }
    },
    reset() {
      notes.reset();
      ambience.onSnapshot(null);
      keyPc = null;
      prevPending = null;
      prevState = null;
      level = null;
      stingerLevel = null;
    },
  };
}
