// Ticket #63: the music under Pause and Hold, the failure phases, and the hidden tab (director.ts with a fake backend).
// The clock is the UI input (`onUi`, speed 0 = stopped), the screen and phase are snapshots, and the tab is `onHidden`.
// No timers run: the fake records each call with its fade and quantise (the grid is the engine's job). The fake
// records the cues too, so a test can see that no level-up stinger played on return.
import { describe, expect, it } from 'vitest';
import { createDirector, type DirectorSnap, type UiInput } from './director';
import { keyName, keyPcForLevel } from './keys';
import { MIX } from './mixTokens';
import type { GameEvent } from '../../worker/game/types';

type Quant = 'bar' | 'beat' | 'now';
type Layer = 'bed' | 'pluck' | 'bass' | 'pausebed';

type Call =
  | { kind: 'start'; id: string; fadeInMs: number; quantise: Quant }
  | { kind: 'stop'; id: string; fadeOutMs: number; quantise: Quant }
  | { kind: 'gain'; id: string; gainDb: number; fadeMs: number; quantise: Quant }
  | { kind: 'tone'; id: string; hz: number; fadeMs: number; quantise: Quant }
  | { kind: 'stinger'; id: string; quantise: Quant }
  | { kind: 'preload'; id: string }
  | { kind: 'decode'; key: string }
  | { kind: 'release'; key: string };

/** The calls that make sound (decode, release and preload only load). */
const SOUND: ReadonlySet<Call['kind']> = new Set(['start', 'stop', 'gain', 'tone', 'stinger']);

function fakeBackend() {
  const calls: Call[] = [];
  const cues: string[] = [];
  const sink = {
    playCue(id: string) {
      cues.push(id);
    },
    setKeyPc() {},
    startMusic(id: string, fadeInMs: number, quantise: Quant) {
      calls.push({ kind: 'start', id, fadeInMs, quantise });
    },
    stopMusic(id: string, fadeOutMs: number, quantise: Quant) {
      calls.push({ kind: 'stop', id, fadeOutMs, quantise });
    },
    setMusicGain(id: string, gainDb: number, fadeMs: number, quantise: Quant) {
      calls.push({ kind: 'gain', id, gainDb, fadeMs, quantise });
    },
    setMusicLowpass(id: string, hz: number, fadeMs: number, quantise: Quant) {
      calls.push({ kind: 'tone', id, hz, fadeMs, quantise });
    },
    playStinger(id: string, quantise: Quant) {
      calls.push({ kind: 'stinger', id, quantise });
    },
    preloadMusic(id: string) {
      calls.push({ kind: 'preload', id });
    },
    decodeKey(key: string) {
      calls.push({ kind: 'decode', key });
    },
    releaseKey(key: string) {
      calls.push({ kind: 'release', key });
    },
  };
  type Of<K extends Call['kind']> = Extract<Call, { kind: K }>;
  return {
    sink,
    calls,
    cues,
    /** Calls from index `from` on that make sound. */
    sound: (from = 0) => calls.slice(from).filter((c) => SOUND.has(c.kind)),
    starts: (from = 0) => calls.slice(from).filter((c): c is Of<'start'> => c.kind === 'start'),
    stops: (from = 0) => calls.slice(from).filter((c): c is Of<'stop'> => c.kind === 'stop'),
    stingers: () => calls.filter((c): c is Of<'stinger'> => c.kind === 'stinger'),
    gains: (id: string) => calls.filter((c): c is Of<'gain'> => c.kind === 'gain' && c.id === id),
    tones: (id: string) => calls.filter((c): c is Of<'tone'> => c.kind === 'tone' && c.id === id),
    decoded(): Set<string> {
      const set = new Set<string>();
      for (const c of calls) {
        if (c.kind === 'decode') set.add(c.key);
        if (c.kind === 'release') set.delete(c.key);
      }
      return set;
    },
  };
}

const snap = (level: number, phase: string = 'idle-os', extra: Partial<DirectorSnap> = {}): DirectorSnap => ({
  log: [],
  level: { level },
  phase: phase as DirectorSnap['phase'],
  ...extra,
});

const RUNNING: UiInput = { speed: 4, hold: null, crashed: false };
const PAUSED: UiInput = { speed: 0, hold: null, crashed: false };
const HELD: UiInput = { speed: 0, hold: 'levelUp', crashed: false };

const keyOf = (level: number) => keyName(keyPcForLevel(level));
const keyed = (layer: Layer, level: number) => `music_${layer}_${keyOf(level)}`;
const tokenDb = (layer: Layer) => MIX.music.layerGainDb[layer];
const PAUSE_FADE_MS = MIX.pause.fadeMs;
const PLUCK_DIP_DB = MIX.pause.musicHold.pluckDb;
const LOW_HZ = MIX.pause.musicHold.lowpassHz;
const OPEN_HZ = MIX.sampleRate / 2;
const ERROR_FADE_MS = 2000;

/** A director in the game at `level`, unlocked, the first game frame played, and the clock running. */
function inGame(level = 1, phase = 'running') {
  const b = fakeBackend();
  const d = createDirector(b.sink);
  d.onUnlock();
  d.onScene('game');
  d.onUi(RUNNING);
  d.onSnapshot(snap(level, phase));
  return { b, d };
}

const note = (tick: number, kind: string, text: string): GameEvent => ({ tick, kind, text });

describe('music under pause and hold: the clock stopped', () => {
  it('Pause: the bed crossfades to the pausebed over 1 s, on the next beat', () => {
    const { b, d } = inGame(1, 'running');
    const from = b.calls.length;
    d.onUi(PAUSED);
    expect(PAUSE_FADE_MS).toBe(1000);
    expect(b.stops(from)).toContainEqual({ kind: 'stop', id: keyed('bed', 1), fadeOutMs: PAUSE_FADE_MS, quantise: 'beat' });
    expect(b.starts(from)).toContainEqual({ kind: 'start', id: keyed('pausebed', 1), fadeInMs: PAUSE_FADE_MS, quantise: 'beat' });
    expect(b.gains(keyed('pausebed', 1)).at(-1)).toEqual(
      expect.objectContaining({ gainDb: 1 * tokenDb('pausebed'), fadeMs: PAUSE_FADE_MS, quantise: 'beat' }),
    );
  });

  it('Pause: the pluck goes through the 850 Hz low-pass and drops 5 dB', () => {
    const { b, d } = inGame(1, 'running');
    d.onUi(PAUSED);
    expect(LOW_HZ).toBe(850);
    expect(PLUCK_DIP_DB).toBe(-5);
    expect(b.tones(keyed('pluck', 1)).at(-1)).toEqual({
      kind: 'tone',
      id: keyed('pluck', 1),
      hz: 850,
      fadeMs: PAUSE_FADE_MS,
      quantise: 'beat',
    });
    expect(b.gains(keyed('pluck', 1)).at(-1)!.gainDb).toBeCloseTo(1 * tokenDb('pluck') + PLUCK_DIP_DB, 9);
  });

  it('Pause: bass goes quiet and is not started', () => {
    const { b, d } = inGame(1, 'running');
    const from = b.calls.length;
    d.onUi(PAUSED);
    expect(b.stops(from)).toContainEqual({ kind: 'stop', id: keyed('bass', 1), fadeOutMs: expect.any(Number), quantise: 'beat' });
    expect(b.starts(from).some((c) => c.id === keyed('bass', 1))).toBe(false);
    expect(b.gains(keyed('bass', 1))).toEqual([expect.objectContaining({ gainDb: 1 * tokenDb('bass') })]);
  });

  it('Pause: tempo does not change, so every pause call is on the beat grid, never at a bar or at once', () => {
    const { b, d } = inGame(1, 'running');
    const from = b.calls.length;
    d.onUi(PAUSED);
    const layerCalls = b.calls.slice(from).filter((c) => SOUND.has(c.kind));
    expect(layerCalls.length).toBeGreaterThan(0);
    for (const c of layerCalls) expect((c as { quantise: Quant }).quantise).toBe('beat');
  });

  it('Hold stops the clock the same way: the mix darkens, and no pause cue plays (the director, ticket #54)', () => {
    const { b, d } = inGame(1, 'running');
    const from = b.calls.length;
    d.onUi(HELD);
    expect(b.starts(from)).toContainEqual(expect.objectContaining({ id: keyed('pausebed', 1), quantise: 'beat' }));
    expect(b.tones(keyed('pluck', 1)).at(-1)!.hz).toBe(LOW_HZ);
  });

  it('resume on the next beat over 1 s: the bed returns, the pausebed goes, the pluck opens', () => {
    const { b, d } = inGame(1, 'running');
    d.onUi(PAUSED);
    const from = b.calls.length;
    d.onUi(RUNNING);
    expect(b.stops(from)).toContainEqual({ kind: 'stop', id: keyed('pausebed', 1), fadeOutMs: PAUSE_FADE_MS, quantise: 'beat' });
    expect(b.starts(from)).toContainEqual({ kind: 'start', id: keyed('bed', 1), fadeInMs: PAUSE_FADE_MS, quantise: 'beat' });
    expect(b.tones(keyed('pluck', 1)).at(-1)).toEqual(expect.objectContaining({ hz: OPEN_HZ, fadeMs: PAUSE_FADE_MS, quantise: 'beat' }));
    expect(b.gains(keyed('pluck', 1)).at(-1)!.gainDb).toBeCloseTo(1 * tokenDb('pluck'), 9);
  });

  it('a Hold lifting plays the same resume on the next beat', () => {
    const { b, d } = inGame(1, 'running');
    d.onUi(HELD);
    const from = b.calls.length;
    d.onUi(RUNNING);
    expect(b.starts(from)).toContainEqual(expect.objectContaining({ id: keyed('bed', 1), quantise: 'beat' }));
  });
});

describe('music on failure', () => {
  it('the error phase plays the pausebed alone', () => {
    const { b, d } = inGame(1, 'running');
    const from = b.calls.length;
    d.onSnapshot(snap(1, 'error'));
    expect(b.starts(from)).toEqual([
      { kind: 'start', id: keyed('pausebed', 1), fadeInMs: ERROR_FADE_MS, quantise: 'bar' },
    ]);
    expect(b.stops(from).map((c) => c.id).sort()).toEqual([keyed('bass', 1), keyed('bed', 1), keyed('pluck', 1)].sort());
    expect(b.gains(keyed('pausebed', 1)).at(-1)!.gainDb).toBeCloseTo(1 * tokenDb('pausebed'), 9);
  });

  it('a burnt VRM (hard failure) plays the fault stinger in the level key, on the next beat', () => {
    const { b, d } = inGame(1, 'running');
    d.onSnapshot({ ...snap(1, 'error'), log: [note(3, 'fault', 'the VRM burnt out')] });
    expect(b.stingers()).toEqual([{ kind: 'stinger', id: 'music_fault_F', quantise: 'beat' }]);
  });

  it('a PSU trip (hard failure) plays the stinger in the level key of the level now', () => {
    const { b, d } = inGame(2, 'running');
    d.onSnapshot(snap(2, 'running', { power: { tripped: true } }));
    expect(b.stingers()).toEqual([{ kind: 'stinger', id: `music_fault_${keyOf(2)}`, quantise: 'beat' }]);
  });

  it('a power cut (the wall cut for the bill, a hard failure) plays the stinger in the level key', () => {
    const { b, d } = inGame(2, 'running');
    d.onSnapshot({
      ...snap(2, 'off', { bill: { cut: true } }),
      log: [note(3, 'fault', 'the power company cut the wall: the $40 bill is unpaid')],
    });
    expect(b.stingers()).toEqual([{ kind: 'stinger', id: `music_fault_${keyOf(2)}`, quantise: 'beat' }]);
  });

  it('a power cut plays the stinger once: the cut stays on in later snapshots', () => {
    const { b, d } = inGame(1, 'running');
    d.onSnapshot(snap(1, 'off', { bill: { cut: true } }));
    d.onSnapshot(snap(1, 'off', { bill: { cut: true } }));
    expect(b.stingers()).toHaveLength(1);
  });

  it('a soft fault (POST failed) plays the pausebed only, and no stinger', () => {
    const { b, d } = inGame(1, 'running');
    const from = b.calls.length;
    d.onSnapshot({ ...snap(1, 'error', { postFailed: true }), log: [note(3, 'fault', 'POST failed: no RAM')] });
    expect(b.stingers()).toEqual([]);
    expect(b.starts(from)).toEqual([expect.objectContaining({ id: keyed('pausebed', 1) })]);
  });

  it('the stinger plays once per failure: staying in the error phase plays none', () => {
    const { b, d } = inGame(1, 'running');
    d.onSnapshot(snap(1, 'error'));
    d.onSnapshot(snap(1, 'error'));
    expect(b.stingers()).toHaveLength(1);
  });

  it('no stinger without a keyed set (the main menu)', () => {
    const b = fakeBackend();
    const d = createDirector(b.sink);
    d.onUnlock();
    d.onScene('menu');
    d.onSnapshot(snap(1, 'running'));
    d.onSnapshot(snap(1, 'error'));
    expect(b.stingers()).toEqual([]);
  });
});

describe('music while the tab is hidden', () => {
  it('hidden: state changes (phase, key, clock) send no sound', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true);
    const from = b.calls.length;
    d.onSnapshot(snap(1, 'idle-os'));
    d.onUi(PAUSED);
    d.onScene('menu');
    d.onScene('game');
    expect(b.sound(from)).toEqual([]);
  });

  it('hidden: a key change still loads the new stems, but plays nothing', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true);
    const from = b.calls.length;
    d.onSnapshot(snap(2, 'running'));
    expect(b.sound(from)).toEqual([]);
    expect([...b.decoded()].sort()).toEqual([keyOf(2), keyName((keyPcForLevel(2) + 7) % 12)].sort());
  });

  it('hidden: a hard failure plays no fault stinger, and none plays on return', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true);
    d.onSnapshot(snap(1, 'error'));
    expect(b.stingers()).toEqual([]);
    d.onHidden(false);
    expect(b.stingers()).toEqual([]);
  });

  it('on return: the layer gains go straight to target, with no fade', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true);
    d.onSnapshot(snap(1, 'idle-os'));
    const from = b.calls.length;
    d.onHidden(false);
    expect(b.gains(keyed('pluck', 1)).at(-1)).toEqual(
      expect.objectContaining({ gainDb: Math.round((tokenDb('pluck') + 20 * Math.log10(0.6)) * 10) / 10, fadeMs: 0, quantise: 'now' }),
    );
    expect(b.stops(from)).toContainEqual({ kind: 'stop', id: keyed('bass', 1), fadeOutMs: 0, quantise: 'now' });
  });

  it('on return: a level change sets the key directly, with no fade and no stinger', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true);
    d.onSnapshot(snap(2, 'running'));
    const from = b.calls.length;
    const cuesBefore = b.cues.length;
    d.onHidden(false);
    expect(b.stops(from)).toContainEqual({ kind: 'stop', id: keyed('bed', 1), fadeOutMs: 0, quantise: 'now' });
    expect(b.starts(from)).toContainEqual({ kind: 'start', id: keyed('bed', 2), fadeInMs: 0, quantise: 'now' });
    expect(b.stingers()).toEqual([]);
    expect(b.cues.slice(cuesBefore)).not.toContain('level_up');
  });

  it('on return: a same-key change with the stems already at target sends nothing, so the stems keep their phase', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true);
    d.onSnapshot(snap(1, 'running-os'));
    const from = b.calls.length;
    d.onHidden(false);
    expect(b.sound(from)).toEqual([]);
  });

  it('on return: a stem that stays on keeps playing (no restart, no stop); a new layer enters at once on the grid', () => {
    const { b, d } = inGame(1, 'idle-os');
    d.onHidden(true);
    d.onSnapshot(snap(1, 'running'));
    const from = b.calls.length;
    d.onHidden(false);
    expect(b.starts(from).map((c) => c.id)).toEqual([keyed('bass', 1)]);
    expect(b.starts(from)[0]).toEqual(expect.objectContaining({ fadeInMs: 0, quantise: 'now' }));
    expect(b.stops(from)).toEqual([]);
    expect(b.gains(keyed('pluck', 1)).at(-1)!.gainDb).toBeCloseTo(1 * tokenDb('pluck'), 9);
  });

  it('a clock stop while hidden is set on return: the pausebed in at once, the pluck low-passed', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true);
    d.onUi(PAUSED);
    const from = b.calls.length;
    d.onHidden(false);
    expect(b.starts(from)).toContainEqual({ kind: 'start', id: keyed('pausebed', 1), fadeInMs: 0, quantise: 'now' });
    expect(b.tones(keyed('pluck', 1)).at(-1)).toEqual(expect.objectContaining({ hz: LOW_HZ, fadeMs: 0, quantise: 'now' }));
  });

  it('a screen change while hidden is applied on return: the menu loop starts at once', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true);
    d.onScene('menu');
    const from = b.calls.length;
    d.onHidden(false);
    expect(b.starts(from)).toContainEqual({ kind: 'start', id: 'music_menu_F', fadeInMs: 0, quantise: 'now' });
  });

  it('on return after the engine dropped queued calls: every layer call goes out again, and a stem that should be off is stopped', () => {
    const { b, d } = inGame(1, 'idle-os');
    d.onHidden(true, true);
    const from = b.calls.length;
    d.onHidden(false);
    expect(b.starts(from).map((c) => c.id).sort()).toEqual([keyed('bed', 1), keyed('pluck', 1)].sort());
    expect(b.starts(from).every((c) => c.fadeInMs === 0 && c.quantise === 'now')).toBe(true);
    expect(b.stops(from)).toContainEqual({ kind: 'stop', id: keyed('bass', 1), fadeOutMs: 0, quantise: 'now' });
  });

  it('on return without dropped calls the same state sends no stop: nothing was lost', () => {
    const { b, d } = inGame(1, 'idle-os');
    d.onHidden(true, false);
    const from = b.calls.length;
    d.onHidden(false);
    expect(b.stops(from)).toEqual([]);
  });

  it('on return after dropped calls: the old key stops on every layer, and the new key starts at once', () => {
    const { b, d } = inGame(1, 'running');
    d.onHidden(true, true);
    d.onSnapshot(snap(2, 'running'));
    const from = b.calls.length;
    d.onHidden(false);
    for (const l of ['bed', 'pluck', 'bass'] as const) {
      expect(b.stops(from)).toContainEqual({ kind: 'stop', id: keyed(l, 1), fadeOutMs: 0, quantise: 'now' });
      expect(b.starts(from)).toContainEqual(expect.objectContaining({ id: keyed(l, 2), fadeInMs: 0, quantise: 'now' }));
    }
  });
});
