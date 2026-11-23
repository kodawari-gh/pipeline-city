// Ticket #66: the two studios (Build my PC, Gallery) seen through the director (director.ts) with a fake backend.
// Covers: the menu loop keeps playing in a studio, and no game stems play there; the room loop stays silent in a studio and
// returns on leaving it; going back to the game restores the game music; the studio key is F whatever the save's level.
// Values come from MIX and keys.ts, never typed in here. Acceptance criteria only: no coder API is assumed beyond the director.
import { describe, expect, it } from 'vitest';
import { createDirector, type DirectorSnap, type Scene } from './director';
import { keyName, keyPcForLevel } from './keys';
import { MIX } from './mixTokens';

type Quant = 'bar' | 'beat' | 'now';
type LoopId = 'amb_room_city_loop' | 'amb_machine_hum_loop';

type Call =
  | { kind: 'start'; id: string; fadeInMs: number; quantise: Quant }
  | { kind: 'stop'; id: string; fadeOutMs: number; quantise: Quant }
  | { kind: 'key'; pc: number }
  | { kind: 'decode'; key: string }
  | { kind: 'release'; key: string }
  | { kind: 'loop'; id: LoopId; op: 'start' | 'stop' };

const MENU = 'music_menu_F';
const ROOM = 'amb_room_city_loop' as const;
/** A keyed game stem (bed, pluck, bass, shimmer or stress), not the menu loop and not a stinger. */
const KEYED = /^music_(bed|pluck|bass|shimmer|stress)_/;
const KEY_F = keyPcForLevel(1);

function fakeBackend() {
  const calls: Call[] = [];
  const sink = {
    playCue(_id: string) {},
    setKeyPc(pc: number) {
      calls.push({ kind: 'key', pc });
    },
    startMusic(id: string, fadeInMs: number, quantise: Quant) {
      calls.push({ kind: 'start', id, fadeInMs, quantise });
    },
    stopMusic(id: string, fadeOutMs: number, quantise: Quant) {
      calls.push({ kind: 'stop', id, fadeOutMs, quantise });
    },
    setMusicGain() {},
    preloadMusic() {},
    decodeKey(key: string) {
      calls.push({ kind: 'decode', key });
    },
    releaseKey(key: string) {
      calls.push({ kind: 'release', key });
    },
    startLoop(id: LoopId) {
      calls.push({ kind: 'loop', id, op: 'start' });
    },
    stopLoop(id: LoopId) {
      calls.push({ kind: 'loop', id, op: 'stop' });
    },
    setHum() {},
    duckHum() {},
  };
  return {
    sink,
    calls,
    /** The ids playing now: started and not stopped since (the order of the calls counts). */
    active(): Set<string> {
      const on = new Set<string>();
      for (const c of calls) {
        if (c.kind === 'start') on.add(c.id);
        if (c.kind === 'stop') on.delete(c.id);
      }
      return on;
    },
    stopsOf: (id: string) => calls.filter((c) => c.kind === 'stop' && c.id === id),
    keyPcs: () => calls.filter((c): c is Extract<Call, { kind: 'key' }> => c.kind === 'key').map((c) => c.pc),
    roomStarts: () => calls.filter((c) => c.kind === 'loop' && c.id === ROOM && c.op === 'start'),
    roomStops: () => calls.filter((c) => c.kind === 'loop' && c.id === ROOM && c.op === 'stop'),
  };
}

const snap = (level: number, phase: string = 'running'): DirectorSnap => ({
  log: [],
  level: { level },
  phase: phase as DirectorSnap['phase'],
});

const keyedOf = (on: Set<string>): string[] => [...on].filter((id) => KEYED.test(id));

function setup() {
  const b = fakeBackend();
  const d = createDirector(b.sink);
  return { b, d };
}

/** Enter a scene, after the unlock: the screen, then a snapshot shows the game is running. */
function play(d: ReturnType<typeof createDirector>, scene: Scene, level = 1) {
  d.onScene(scene);
  d.onSnapshot(snap(level, 'running'));
}

describe('studio: the menu loop keeps playing in both studios', () => {
  it('from the main menu, the build studio keeps the menu loop and starts no stem', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('menu');
    d.onSnapshot(snap(1, 'idle-os'));
    expect(b.active().has(MENU)).toBe(true);
    d.onScene('build');
    expect(b.stopsOf(MENU)).toEqual([]);
    expect(b.active().has(MENU)).toBe(true);
    expect(keyedOf(b.active())).toEqual([]);
  });

  it('from the main menu, the gallery keeps the menu loop and starts no stem', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('menu');
    d.onSnapshot(snap(1, 'idle-os'));
    d.onScene('gallery');
    expect(b.stopsOf(MENU)).toEqual([]);
    expect(b.active().has(MENU)).toBe(true);
    expect(keyedOf(b.active())).toEqual([]);
  });

  it('from the game, entering a studio stops the game stems and plays the menu loop', () => {
    const { b, d } = setup();
    d.onUnlock();
    play(d, 'game', 1);
    expect(keyedOf(b.active()).length).toBeGreaterThan(0);
    d.onScene('build');
    expect(keyedOf(b.active())).toEqual([]);
    expect(b.active().has(MENU)).toBe(true);
  });

  it('from the game, the gallery plays the menu loop and no game stem', () => {
    const { b, d } = setup();
    d.onUnlock();
    play(d, 'game', 1);
    d.onScene('gallery');
    expect(keyedOf(b.active())).toEqual([]);
    expect(b.active().has(MENU)).toBe(true);
  });
});

describe('studio: leaving a studio returns to the right music', () => {
  it('build studio, then the game: the game stems play again and the menu loop stops', () => {
    const { b, d } = setup();
    d.onUnlock();
    play(d, 'game', 1);
    d.onScene('build');
    d.onScene('game');
    expect(keyedOf(b.active()).length).toBeGreaterThan(0);
    expect(b.active().has(MENU)).toBe(false);
  });

  it('gallery, then the game: the game stems play again and the menu loop stops', () => {
    const { b, d } = setup();
    d.onUnlock();
    play(d, 'game', 1);
    d.onScene('gallery');
    d.onScene('game');
    expect(keyedOf(b.active()).length).toBeGreaterThan(0);
    expect(b.active().has(MENU)).toBe(false);
  });

  it('build studio, then the main menu: the menu loop plays and no game stem does', () => {
    const { b, d } = setup();
    d.onUnlock();
    play(d, 'game', 1);
    d.onScene('build');
    d.onScene('menu');
    expect(b.active().has(MENU)).toBe(true);
    expect(keyedOf(b.active())).toEqual([]);
  });
});

describe('studio: the room ambience follows the screen', () => {
  it('a studio plays no room loop; leaving it to the main menu starts the room loop again', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('menu');
    expect(b.roomStarts()).toHaveLength(1);
    d.onScene('build');
    expect(b.roomStops()).toHaveLength(1);
    d.onScene('menu');
    expect(b.roomStarts()).toHaveLength(2);
  });

  it('leaving a studio to the game starts the room loop again (one start per return)', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('game');
    d.onScene('gallery');
    d.onScene('game');
    expect(b.roomStarts()).toHaveLength(2);
    expect(b.roomStops()).toHaveLength(1);
  });
});

describe('studio: the level key is F', () => {
  it('a level 3 save does not move the build studio off F', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('build');
    d.onSnapshot(snap(3, 'running'));
    expect(b.keyPcs().every((pc) => pc === KEY_F)).toBe(true);
    expect(keyName(KEY_F)).toBe('F');
  });

  it('after a level 3 game, entering the gallery sets the key back to F', () => {
    const { b, d } = setup();
    d.onUnlock();
    play(d, 'game', 3);
    d.onScene('gallery');
    d.onSnapshot(snap(3, 'running'));
    const pcs = b.keyPcs();
    expect(pcs.at(-1)).toBe(KEY_F);
  });

  it('the studio starts no keyed stem of another key', () => {
    const { b, d } = setup();
    d.onUnlock();
    d.onScene('build');
    d.onSnapshot(snap(3, 'running'));
    const otherKeyed = [...b.active()].filter((id) => KEYED.test(id) && !id.endsWith(`_${keyName(KEY_F)}`));
    expect(otherKeyed).toEqual([]);
  });
});
