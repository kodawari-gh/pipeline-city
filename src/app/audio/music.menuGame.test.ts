// Ticket #61: menu music and running-game music (Afterglow), seen through the director (director.ts) with a fake backend.
// The music seam is not built yet. This file states the contract the coder builds to. The fake sink takes these
// music calls (all optional on the sink, as the ambience calls are):
//   startMusic(id, fadeInMs, quantise)     id: 'music_menu_F' or a keyed stem 'music_bed_C', 'music_pluck_C', 'music_bass_C'
//   stopMusic(id, fadeOutMs, quantise)
//   setMusicGain(id, gainDb, fadeMs, quantise)
//   preloadMusic(id)                       a loop decode started before it is needed
//   decodeKey(key) / releaseKey(key)       the keyed stems of one key ('F', 'C', ...) decoded or freed
// quantise: 'bar' (next bar line), 'beat' (next beat), 'now' (at once).
// Layer gain: the state target times the token dB (MIX.music.layerGainDb), e.g. pluck target 0.5 -> 0.5 * -2 dB = -1 dB.
// Values come from MIX, the music spec token or the key rules; the menu's 2 s and the 1.5 s return fade are the ticket's numbers.
import { describe, expect, it } from 'vitest';
import { createDirector, type DirectorSnap, type Scene, type UiInput } from './director';
import { keyName, keyPcForLevel } from './keys';
import { MIX } from './mixTokens';

type Quant = 'bar' | 'beat' | 'now';
type Layer = 'bed' | 'pluck' | 'bass';

type Call =
  | { kind: 'start'; id: string; fadeInMs: number; quantise: Quant }
  | { kind: 'stop'; id: string; fadeOutMs: number; quantise: Quant }
  | { kind: 'gain'; id: string; gainDb: number; fadeMs: number; quantise: Quant }
  | { kind: 'preload'; id: string }
  | { kind: 'decode'; key: string }
  | { kind: 'release'; key: string };

const MENU = 'music_menu_F';
const MENU_FADE_IN_MS = 2000;
const GAME_OUT_MS = 1500;
const ENTRY_FADE_MS = 2000;

function fakeBackend() {
  const calls: Call[] = [];
  const sink = {
    playCue() {},
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
  return {
    sink,
    calls,
    starts: () => calls.filter((c): c is Extract<Call, { kind: 'start' }> => c.kind === 'start'),
    stops: () => calls.filter((c): c is Extract<Call, { kind: 'stop' }> => c.kind === 'stop'),
    gains: (id: string) => calls.filter((c): c is Extract<Call, { kind: 'gain' }> => c.kind === 'gain' && c.id === id),
    /** The keys decoded now: decoded and not released since. */
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

const snap = (level: number, phase: string = 'idle-os'): DirectorSnap => ({
  log: [],
  level: { level },
  phase: phase as DirectorSnap['phase'],
});

const UI_RUNNING: UiInput = { speed: 1, hold: null, crashed: false };

const keyOf = (level: number) => keyName(keyPcForLevel(level));
const keyed = (layer: Layer, level: number) => `music_${layer}_${keyOf(level)}`;
/** The layer's token dB (MIX.music.layerGainDb), read from the token, not typed here. */
const tokenDb = (layer: Layer) => MIX.music.layerGainDb[layer];

function setup() {
  const b = fakeBackend();
  const d = createDirector(b.sink);
  return { b, d };
}

/** A director in the game at `level`, unlocked, with the first game frame played (the game stems are up). */
function inGame(level = 1, phase = 'running') {
  const { b, d } = setup();
  d.onUnlock();
  d.onScene('game');
  d.onSnapshot(snap(level, phase));
  return { b, d };
}

describe('menu music: the menu loop', () => {
  it('before the unlock gesture: the menu plays no music', () => {
    const { b, d } = setup();
    d.onScene('menu');
    expect(b.starts()).toEqual([]);
  });

  it('after the unlock: the menu loop starts on the menu screen with a 2 s fade in', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('menu');
    expect(b.starts()).toEqual([expect.objectContaining({ kind: 'start', id: MENU, fadeInMs: MENU_FADE_IN_MS })]);
    expect(MENU_FADE_IN_MS).toBe(2000);
  });

  it('the menu always plays the F menu loop, whatever the save level', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot(snap(5, 'off'));
    const from = b.calls.length;
    d.onScene('menu');
    const started = b.calls.slice(from).filter((c): c is Extract<Call, { kind: 'start' }> => c.kind === 'start');
    expect(started.map((c) => c.id)).toEqual([MENU]);
  });

  it('the menu loop preloads after booted, not before', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onSnapshot(snap(1, 'off'));
    d.onSnapshot(snap(1, 'posting'));
    expect(b.calls.filter((c) => c.kind === 'preload' && c.id === MENU)).toEqual([]);
    d.onSnapshot(snap(1, 'booting-os'));
    d.onSnapshot(snap(1, 'idle-os'));
    expect(b.calls.filter((c) => c.kind === 'preload' && c.id === MENU)).toHaveLength(1);
  });
});

describe('game music: the first game frame crossfades from the menu', () => {
  it('the game stems wait for the first game frame; then the menu fades out on the next bar', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('menu');
    d.onScene('game');
    expect(b.starts().filter((c) => c.id.startsWith('music_bed_'))).toEqual([]);
    d.onSnapshot(snap(2, 'idle-os'));
    expect(b.stops()).toContainEqual({ kind: 'stop', id: MENU, fadeOutMs: ENTRY_FADE_MS, quantise: 'bar' });
    expect(b.starts()).toContainEqual({ kind: 'start', id: keyed('bed', 2), fadeInMs: ENTRY_FADE_MS, quantise: 'bar' });
    expect(ENTRY_FADE_MS).toBe(2000);
  });

  it('the save key is the game key: level 1 plays the F stems and never the C stems', () => {
    const { b } = inGame(1, 'idle-os');
    expect(b.starts().some((c) => c.id === keyed('bed', 1))).toBe(true);
    expect(b.starts().some((c) => c.id.endsWith('_C'))).toBe(false);
  });
});

describe('game music: leaving the game for the main menu', () => {
  it('Main menu from the game fades the game stems over 1.5 s and returns the menu loop', () => {
    const { b, d } = inGame(2, 'running');
    d.onScene('menu');
    expect(GAME_OUT_MS).toBe(1500);
    expect(b.stops()).toContainEqual(expect.objectContaining({ id: keyed('bed', 2), fadeOutMs: GAME_OUT_MS }));
    expect(b.starts().filter((c) => c.id === MENU).at(-1)).toEqual(expect.objectContaining({ id: MENU }));
  });

  it('going back to the game stops the menu loop on the next bar; leaving again stops the game stems', () => {
    const { b, d } = inGame(1, 'running');
    d.onScene('menu');
    d.onScene('game');
    d.onSnapshot(snap(1, 'running'));
    expect(b.stops()).toContainEqual({ kind: 'stop', id: MENU, fadeOutMs: ENTRY_FADE_MS, quantise: 'bar' });
    const from = b.calls.length;
    d.onScene('menu');
    const after = b.calls.slice(from);
    expect(after).toContainEqual(expect.objectContaining({ kind: 'stop', id: keyed('bed', 1), fadeOutMs: GAME_OUT_MS }));
  });
});

describe('game music: phase table (bed, pluck, bass)', () => {
  it('off: the bed sits at its 0.5 target over 2 s; pluck and bass exit on the next beat', () => {
    const { b, d } = inGame(1, 'running');
    d.onSnapshot(snap(1, 'off'));
    const bed = b.gains(keyed('bed', 1)).at(-1)!;
    expect(bed).toEqual(expect.objectContaining({ id: keyed('bed', 1), gainDb: 0.5 * tokenDb('bed'), fadeMs: ENTRY_FADE_MS }));
    expect(b.stops()).toEqual(
      expect.arrayContaining([
        { kind: 'stop', id: keyed('pluck', 1), fadeOutMs: expect.any(Number), quantise: 'beat' },
        { kind: 'stop', id: keyed('bass', 1), fadeOutMs: expect.any(Number), quantise: 'beat' },
      ]),
    );
  });

  it('boot: the bed at 1 and the pluck at 0.5 (target times the token dB)', () => {
    const { b, d } = inGame(1, 'off');
    d.onSnapshot(snap(1, 'posting'));
    expect(b.gains(keyed('bed', 1)).at(-1)!.gainDb).toBeCloseTo(1 * tokenDb('bed'), 9);
    expect(b.gains(keyed('pluck', 1)).at(-1)!.gainDb).toBeCloseTo(0.5 * tokenDb('pluck'), 9);
  });

  it('idle: the pluck at 0.6 and no bass', () => {
    const { b, d } = inGame(1, 'posting');
    d.onSnapshot(snap(1, 'idle-os'));
    expect(b.gains(keyed('pluck', 1)).at(-1)!.gainDb).toBeCloseTo(0.6 * tokenDb('pluck'), 9);
    expect(b.starts().some((c) => c.id === keyed('bass', 1))).toBe(false);
  });

  it('running: bed, pluck and bass at 1; the bass enters on the next bar', () => {
    const { b, d } = inGame(1, 'idle-os');
    d.onSnapshot(snap(1, 'running'));
    expect(b.starts()).toContainEqual({ kind: 'start', id: keyed('bass', 1), fadeInMs: expect.any(Number), quantise: 'bar' });
    expect(b.gains(keyed('bass', 1)).at(-1)!.gainDb).toBeCloseTo(1 * tokenDb('bass'), 9);
    expect(b.gains(keyed('pluck', 1)).at(-1)!.gainDb).toBeCloseTo(1 * tokenDb('pluck'), 9);
  });

  it('running to idle: the bass exits on the next beat', () => {
    const { b, d } = inGame(1, 'running');
    d.onSnapshot(snap(1, 'idle-os'));
    expect(b.stops()).toContainEqual({ kind: 'stop', id: keyed('bass', 1), fadeOutMs: expect.any(Number), quantise: 'beat' });
  });

  it('a phase inside the same state (running to running-os) changes no layer', () => {
    const { b, d } = inGame(1, 'running');
    const before = b.calls.length;
    d.onSnapshot(snap(1, 'running-os'));
    expect(b.calls.length).toBe(before);
  });
});

describe('game music: keys in memory', () => {
  it('only the current and next key stay decoded across level ups', () => {
    const { b, d } = inGame(1, 'running');
    for (const level of [1, 2, 3, 4]) {
      d.onSnapshot(snap(level, 'running'));
      const current = keyOf(level);
      const next = keyName((keyPcForLevel(level) + 7) % 12);
      expect([...b.decoded()].sort()).toEqual([current, next].sort());
    }
  });
});
