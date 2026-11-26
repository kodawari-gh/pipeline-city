// The director: each new snapshot becomes cues. It sets the key from the level and plays one cue per new log note that has one.
// It also plays the state rules (a change between two snapshots, SPEC §3.2) and, through `onUi`, the clock and holds.
// It also drives the ambience (ambience.ts): the room loop (`onScene`, `onUnlock`), the hum (each snapshot) and the pause dip (`onUi`).
// It talks to the sound only through `CueSink` and the ambience calls, so a test drives it with a fake (engine.ts is the real sink).
import * as tokens from './mixTokens';
import { keyName, keyPcForLevel } from './keys';
import { cueForNote, createNoteTracker } from './events';
import * as ambienceLoops from './ambience';
import * as musicTrack from './music';
import * as musicNotes from './musicNotes';
import * as stressModel from './stress';
import type { StudioMachine } from './studio';
import type { GameEvent, KeyActivity, LinkState, Phase } from '../../worker/game/types';

export interface CueSink {
  /** `perBeat`: a note cue; at most that many start in one beat of the music grid (the speed's event density), the rest merge. */
  playCue(id: tokens.CueId, opts?: { delayS?: number; quantise?: 'beat'; perBeat?: number }): void;
  setKeyPc(pc: number): void;
}

/** The screens the room loop cares about: the room scene is the main menu and the game (not the studios). `boot`: the boot screen covers the page (no room loop). */
export type Scene = 'boot' | 'menu' | 'game' | 'build' | 'gallery';

/** What holds the clock while it is stopped by a popup or the menu. A Hold plays no pause or resume cue. */
type Hold = 'levelUp' | 'tutorial' | 'menu';

/** What the UI tells the director: the clock's speed (0 = stopped), the hold on it, and whether the sim crashed. */
export interface UiInput {
  speed: number;
  hold: Hold | null;
  crashed: boolean;
  /** The level of the open level-up popup, or null. A new value plays the stinger (once per level). */
  levelUp?: number | null | undefined;
}

export interface DirectorSnap {
  log: GameEvent[];
  level: { level: number };
  /** Sandbox games move the key but play no level-up stinger. */
  sandbox?: boolean | undefined;
  /** Queued swaps (a snapshot always has it; optional so a fixture may omit it). */
  pendingSwaps?: readonly unknown[] | undefined;
  /** The fields below feed the state rules. A fixture may omit them: then no state rule plays. */
  baseTick?: number | undefined;
  phase?: Phase | undefined;
  net?: { state: LinkState; transfers?: readonly unknown[] };
  power?: { tripped: boolean; totalW?: number; budgetW?: number };
  /** The last power-on ended in a POST error (phase 'error', a soft failure: no stinger). */
  postFailed?: boolean | undefined;
  plugged?: unknown | null | undefined;
  keyActivity?: KeyActivity | undefined;
  /** The machine's power and devices: the hum (a fixture may omit them: then no hum plays). */
  powered?: boolean | undefined;
  devices?: readonly ambienceLoops.FanDevice[] | undefined;
  /** The board's VRM (the stress and its cue-board terms; `board.vrm` is read when `vrm` is absent) and the power bill (the bed's low-pass while unpaid). */
  vrm?: stressModel.StressSnap['vrm'] | undefined;
  board?: stressModel.StressSnap['board'] | undefined;
  /** `cut`: the wall is cut for an unpaid bill (a hard failure, SPEC §6.3). */
  bill?: { unpaid?: number; cut?: boolean } | null;
}

export interface Director {
  onSnapshot(s: DirectorSnap): void;
  /** The clock, the hold and the crash, each time one of them may have changed. */
  onUi(u: UiInput): void;
  /**
   * The tab hid (true) or came back (false). The music ignores state while hidden and sets it at once on return (ticket #63).
   * `droppedMusic` (on hide): the engine dropped queued music calls, so the music sends its calls again on return.
   */
  onHidden(hidden: boolean, droppedMusic?: boolean): void;
  /** No game (snapshot null), load or new game: the next snapshot starts fresh and plays nothing. */
  reset(): void;
}

/** The room loop's two inputs: the screen, and the first gesture (nothing plays before it). */
export interface RoomInput {
  onScene(scene: Scene): void;
  onUnlock(): void;
  /** The studio's machine (ticket #66): null when no studio machine shows. Only Build my PC has one. */
  onStudio(m: StudioMachine | null): void;
}

/** The key a studio plays in (level 1, F), whatever game is loaded (ticket #66). */
const STUDIO_KEY_PC = keyPcForLevel(1);
/** A studio with no machine on show: the hum stays off. */
const NO_MACHINE: StudioMachine = { powered: false, devices: [] };

/** The state a state rule compares with the one before. */
interface SeenState {
  baseTick?: number | undefined;
  phase?: Phase | undefined;
  net?: LinkState | undefined;
  tripped?: boolean | undefined;
  /** The wall is cut for the bill now. */
  cut: boolean;
  postFailed: boolean;
  plugged: boolean;
  keyActivity?: KeyActivity | undefined;
  /** POST ran and the machine has not reached `running` or `idle-os` yet: the next `running` is this boot's `boot_ready`. */
  posted: boolean;
}

const LINK_DOWN: readonly LinkState[] = ['down', 'no-cable', 'no-os', 'no-device'];

/**
 * A hard failure (burnt VRM, PSU trip, power cut): the error phase starts for a part that burnt (not a POST error, which is
 * soft), the PSU trips, or the wall is cut for the bill.
 */
const hardFault = (before: SeenState, now: SeenState): boolean =>
  (now.phase === 'error' && before.phase !== 'error' && !now.postFailed) ||
  (now.tripped === true && before.tripped !== true) ||
  (now.cut && !before.cut);

/**
 * The state rules (SPEC §3.2) between the last snapshot and this one. A rule is skipped when a note of its family
 * already played a cue in this snapshot (`families`: the note kinds that played), so one fault gives one cue.
 */
function stateCues(before: SeenState, now: SeenState, families: ReadonlySet<string>): tokens.CueId[] {
  const out: tokens.CueId[] = [];
  if (now.net !== before.net) {
    const from = before.net;
    if (now.net === 'link-up' && from !== 'saturated') {
      out.push('net_link_up');
    }
    if (now.net === 'saturated') {
      out.push('net_saturated');
    }
    if ((from === 'link-up' || from === 'saturated') && LINK_DOWN.includes(now.net!)) {
      out.push('net_down');
    }
  }
  if (now.phase !== before.phase) {
    if (now.phase === 'posting') {
      out.push('post_boot');
    }
    // Booted: POST ran, then the OS idles or the no-OS flow runs. Once per boot: a later job's phases play nothing (`posted` is spent).
    if ((now.phase === 'idle-os' || now.phase === 'running') && before.posted) {
      out.push('boot_ready');
    }
  }
  if (!families.has('fault') && hardFault(before, now)) {
    out.push('fault_hard');
  }
  if (!families.has('key')) {
    const unplugged = before.plugged && !now.plugged;
    const done = before.keyActivity === 'done' && now.keyActivity === 'none';
    if (unplugged || done) {
      out.push('key_eject');
    }
  }
  return out;
}

/**
 * The music's data and stress inputs from one snapshot (ticket #62). Flowing: the link is up or saturated, a transfer runs or
 * a job key ingests (`keyActivity` 'ingesting', or the plugged key's stage). A down link with a transfer or an ingest still flows.
 */
function musicFeed(s: DirectorSnap): musicTrack.MusicFeed {
  const link = s.net?.state;
  const up = link === 'link-up' || link === 'saturated';
  const transfers = (s.net?.transfers?.length ?? 0) > 0;
  const { plugged } = s;
  const ingest =
    s.keyActivity === 'ingesting' ||
    (typeof plugged === 'object' && plugged !== null && (plugged as { stage?: unknown }).stage === 'ingesting');
  return {
    flowing: up || transfers || ingest,
    saturated: link === 'saturated',
    stress: stressModel.stressAmount(s),
    debt: (s.bill?.unpaid ?? 0) > 0,
  };
}

/** Seconds between the cues of one snapshot: the notes of one tick play in log order, 40 ms apart. */
export const NOTE_GAP_S = 0.04;

/** A sink without the ambience calls (a cue-only fixture) is never asked for them: the ambience stays silent. */
const silentAmbience: ambienceLoops.AmbienceSink = { startLoop() {}, stopLoop() {}, setHum() {}, duckHum() {} };
const hasAmbience = (s: object): s is ambienceLoops.AmbienceSink =>
  ['startLoop', 'stopLoop', 'setHum', 'duckHum'].every((k) => k in s);

/** A sink without the music calls (a cue-only fixture) is never asked for them: the music stays silent. */
const silentMusic: musicTrack.MusicSink = {
  startMusic() {},
  stopMusic() {},
  setMusicGain() {},
  preloadMusic() {},
  decodeKey() {},
  releaseKey() {},
};
const hasMusic = (s: object): s is musicTrack.MusicSink =>
  ['startMusic', 'stopMusic', 'setMusicGain', 'preloadMusic', 'decodeKey', 'releaseKey'].every((k) => k in s);

/** A sink without the note calls (a cue-only fixture) gets no music notes. */
const hasNotes = (s: object): s is musicNotes.MusicNoteSink => ['playNote', 'stopNote'].every((k) => k in s);

/**
 * `clock` (seconds) times the note voices for the cap. The engine's sink does not need it; a test passes a fake.
 */
export function createDirector(
  sink: CueSink &
    Partial<ambienceLoops.AmbienceSink> &
    Partial<musicTrack.MusicSink> &
    Partial<musicNotes.MusicNoteSink>,
  clock: () => number = () => performance.now() / 1000,
): Director & RoomInput {
  const notes = createNoteTracker();
  const ambience = ambienceLoops.createAmbience(hasAmbience(sink) ? sink : silentAmbience);
  const music: musicTrack.Music = musicTrack.createMusic(hasMusic(sink) ? sink : silentMusic);
  const noteSink = hasNotes(sink) ? sink : null;
  const noteVoices = musicNotes.createNoteVoices();
  let keyPc: number | null = null;
  /** Queued swaps in the last snapshot; null before the first one (after a reset). */
  let prevPending: number | null = null;
  /** The last snapshot's state; null before the first one (after a reset): that snapshot plays no state rule. */
  let prevState: SeenState | null = null;
  /** The last UI input. Kept across a reset: the clock does not stop when the game does. */
  let prevUi: UiInput | null = null;
  /** The last speed-0 edge was a hold (not a Pause): lifting the hold plays no resume. */
  let pausedByHold = false;
  /** The event notes per beat the speed allows (`perBeat` of each note cue). */
  let eventCap = musicTrack.EVENT_NOTES_PER_BEAT * musicTrack.NEUTRAL_SPEED.density;
  /** The level the last snapshot showed; null before the first one (after a reset). */
  let level: number | null = null;
  /** The screen the director last heard (`onScene`); a studio plays its own key and hum. */
  let scene: Scene = 'boot';
  /** The studio's machine as the studio sets it (Build my PC; null: none on show). */
  let studioMachine: StudioMachine | null = null;
  /** The key the game plays (its level's), kept so leaving a studio gets it back. */
  let gameKeyPc: number | null = null;
  /** The level whose stinger has played, or was passed over as silent. One level, one stinger (the note or the popup). */
  let stingerLevel: number | null = null;
  let sandbox = false;

  /**
   * An event's music notes (ticket #65), each `beat` beats after `at` (seconds). A note that takes a ninth voice steals the oldest.
   * The file is the scale degree's MIDI note in the key `pc` (the level's key); the note is never rate-shifted.
   */
  const playNotes = (spec: musicNotes.NoteSpec, at: number, pc: number) => {
    for (const st of spec.steps) {
      const delayS = at + st.beat * musicTrack.BEAT_S;
      const id = musicNotes.noteId(st.family, musicNotes.noteMidi(pc, st.reg, st.degree));
      // A cue-only sink plays the note as its cue (the engine's VoicePool caps the music bus).
      if (noteSink === null) {
        sink.playCue(id as tokens.CueId, { delayS });
        continue;
      }
      const { token, stolen } = noteVoices.admit(clock(), clock() + delayS, musicNotes.NOTE_DUR_S[st.family]);
      for (const t of stolen) {
        noteSink.stopNote(t);
      }
      noteSink.playNote(id, {
        token,
        delayS,
        gainDb: musicNotes.noteGainDb(st),
        duckClass: spec.duck,
      });
    }
  };

  /** Sets the key once per change. The sink picks each cue's file from the key it holds. */
  const setKey = (pc: number) => {
    if (pc === keyPc) {
      return;
    }
    keyPc = pc;
    sink.setKeyPc(pc);
  };

  /**
   * The level-up stinger for `lvl`, on the music's next beat. Sandbox and a level already marked play nothing.
   * The popup can open before the snapshot of its level: the stinger takes its own level's key first.
   */
  const stinger = (lvl: number) => {
    if (lvl === stingerLevel) {
      return;
    }
    stingerLevel = lvl;
    if (sandbox) {
      return;
    }
    setKey(keyPcForLevel(lvl));
    sink.playCue('level_up', tokens.MIX.levelUp.quantise === 'beat' ? { quantise: 'beat' } : {});
    // The level-up chord (ticket #64) is the first step's key, on the same beat, 6 dB under the SFX. Several levels: one chord.
    const first = Math.min(lvl, (level ?? lvl - 1) + 1);
    sink.playStinger?.(`music_levelup_${keyName(keyPcForLevel(first))}`, 'beat', tokens.MIX.music.levelupWithSfxDb);
  };

  /** The ambience's studio source: the build's machine (off until it is set), the gallery's none (off), else none (the game's). */
  const syncStudio = () => {
    ambience.onStudio(scene === 'gallery' ? NO_MACHINE : scene === 'build' ? (studioMachine ?? NO_MACHINE) : null);
  };

  return {
    onSnapshot(s) {
      const fresh = notes.fresh(s.log);
      gameKeyPc = keyPcForLevel(s.level.level);
      // A studio keeps its own key (F) while it shows; the game's key waits for the menu or the game.
      const key = scene === 'build' || scene === 'gallery' ? STUDIO_KEY_PC : gameKeyPc;
      setKey(key);
      ambience.onSnapshot({ powered: s.powered === true, devices: s.devices ?? [] });
      // The phase first: a key change on the same snapshot then starts the layers of the new phase.
      music.onPhase(s.phase);
      // A level-up note walks the key one fifth per beat; a load, a new game or a sandbox level is one crossfade.
      music.onKey(key, s.sandbox !== true && fresh.some((e) => e.kind === 'level'));
      music.onFeed(musicFeed(s));
      sandbox = s.sandbox === true;
      // A swap finished when the queue shrank. Its `install` notes play one `swap_done` (SPEC §3.2, "Swap done").
      const pending = s.pendingSwaps?.length ?? 0;
      const swapDone = prevPending !== null && pending < prevPending;
      prevPending = pending;
      let i = 0;
      let swapCued = false;
      // The note kinds that played a cue now: a state rule of the same family is skipped (one fault, not two).
      const families = new Set<string>();
      for (const e of fresh) {
        let id = cueForNote(e);
        if (id === 'install' && swapDone) {
          id = swapCued ? null : 'swap_done';
          swapCued = true;
        }
        const at = i * NOTE_GAP_S;
        if (id) {
          families.add(e.kind);
          sink.playCue(id, { delayS: i++ * NOTE_GAP_S, perBeat: eventCap });
        }
        // The event's music note plays with its cue (not in place of it), in the level's key. No key yet: none.
        const spec = musicNotes.noteSpecFor(e);
        if (spec && keyPc !== null) {
          playNotes(spec, at, keyPc);
        }
      }
      // A level note plays the stinger once, for the level now shown (several levels in one tick: one stinger).
      // A level change with no note (a load, a new game, a sandbox level) moves the key and plays nothing.
      const lvl = s.level.level;
      if (fresh.some((e) => e.kind === 'level')) {
        stinger(lvl);
      } else {
        stingerLevel = lvl;
      }
      level = lvl;
      // A save loaded (the tick went back) is one snapshot of silence, like the notes.
      const before = prevState;
      const now: SeenState = {
        baseTick: s.baseTick,
        phase: s.phase,
        net: s.net?.state,
        tripped: s.power?.tripped,
        cut: s.bill?.cut === true,
        postFailed: s.postFailed === true,
        plugged: s.plugged != null,
        keyActivity: s.keyActivity,
        posted: s.phase === 'posting' || (before?.posted === true && s.phase !== 'running' && s.phase !== 'idle-os'),
      };
      prevState = now;
      const loaded = before?.baseTick !== undefined && now.baseTick !== undefined && now.baseTick < before.baseTick;
      if (before && !loaded) {
        for (const id of stateCues(before, now, families)) {
          sink.playCue(id, { delayS: i++ * NOTE_GAP_S });
        }
        // The music's fault stinger is its own sound: a note of the same fault does not skip it.
        if (hardFault(before, now)) {
          music.onFault();
        }
      }
    },
    onScene(next) {
      const wasStudio = scene === 'build' || scene === 'gallery';
      const isStudio = next === 'build' || next === 'gallery';
      scene = next;
      ambience.onRoom(next === 'menu' || next === 'game');
      music.onScene(next);
      syncStudio();
      // Into a studio: its key (F). Out of one: the game's key back (kept from the last snapshot).
      if (isStudio && !wasStudio) {
        setKey(STUDIO_KEY_PC);
        music.onKey(STUDIO_KEY_PC, false);
      } else if (!isStudio && wasStudio && gameKeyPc !== null) {
        setKey(gameKeyPc);
        music.onKey(gameKeyPc, false);
      }
    },
    onStudio(m) {
      studioMachine = m;
      syncStudio();
    },
    onUnlock() {
      ambience.onUnlock();
      music.onUnlock();
    },
    onHidden(h, dropped) {
      music.onHidden(h, dropped === true);
    },
    onUi(u) {
      ambience.onSpeed(u.speed);
      music.onSpeed(u.speed);
      music.onStopped(u.speed === 0);
      eventCap = musicTrack.EVENT_NOTES_PER_BEAT * musicTrack.speedMix(u.speed).density;
      const before = prevUi;
      prevUi = u;
      if (!before) {
        return;
      }
      // The level-up popup opens: its stinger, unless a note of that level already played it. Before any snapshot (after a reset) nothing plays.
      if (u.levelUp != null && u.levelUp !== before.levelUp && level !== null) {
        stinger(u.levelUp);
      }
      // A sim crash plays the error cue; the stop it causes plays `pause` through the speed rule below.
      if (u.crashed && !before.crashed) {
        sink.playCue('ui_error');
      }
      // A hold starts: the in-game menu plays its panel cue. The level-up and tutorial popups play nothing.
      if (u.hold === 'menu' && before.hold !== 'menu') {
        sink.playCue('ui_panel_open');
      }
      if (u.speed !== before.speed) {
        if (u.speed === 0) {
          pausedByHold = u.hold !== null;
          if (!pausedByHold) {
            sink.playCue('pause');
          }
        } else if (before.speed === 0) {
          if (!pausedByHold && u.hold === null) {
            sink.playCue('resume');
          }
        } else {
          sink.playCue(u.speed > before.speed ? 'speed_up' : 'speed_down');
        }
      }
    },
    reset() {
      notes.reset();
      ambience.onSnapshot(null);
      keyPc = null;
      gameKeyPc = null;
      prevPending = null;
      prevState = null;
      level = null;
      stingerLevel = null;
    },
  };
}
