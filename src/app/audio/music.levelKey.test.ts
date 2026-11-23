// Ticket #64: the level-key change in the music, seen through the music (music.ts) and the director (director.ts) with fake sinks.
// Contract (ticket #64 acceptance criteria; music-spec.md §4-§6, §8): a level change crossfades every keyed layer to the new key over
// TIMING.keyChangeMs (1.4 s), on the next beat; the new key is decoded before its stems start; the level-up chord (`music_levelup_<KEY>`)
// plays on the same beat as the SFX stinger, at MIX.music.levelupWithSfxDb (-6 dB); several levels in one tick give one chord, on the first
// step, and one fifth per step; load, new game and sandbox change the key with no chord and no stinger; after three level-ups only two
// level keys stay decoded. The equal-power curve and the dB values of the engine are not visible to a fake sink, so they are not tested here.
import { describe, expect, it } from 'vitest';
import { createDirector, type DirectorSnap } from './director';
import { keyName, keyPcForLevel } from './keys';
import { MIX } from './mixTokens';
import { createMusic, keysInMemory, LAYERS, TIMING, type Music, type MusicFeed, type MusicSink } from './music';

/** A sink that records every call by name and arguments, whatever the name (the same shape as the other director and music tests). */
interface Rec {
  name: string;
  args: unknown[];
}

/** `notReady`: the keys the sink reports as not decoded yet (`keyReady` is false for them). Default: every key is ready. */
function recorder(notReady: Set<string> = new Set()) {
  const calls: Rec[] = [];
  const sink = new Proxy({} as Record<string, (...a: unknown[]) => void>, {
    get: (_t, name) => {
      if (name === 'keyReady') return (key: string) => !notReady.has(key);
      return typeof name === 'string' ? (...args: unknown[]) => void calls.push({ name, args }) : undefined;
    },
    has: () => true,
  });
  return {
    sink,
    calls,
    named: (name: string) => calls.filter((c) => c.name === name),
    /** The index of the first call with this name and first argument, or -1. */
    indexOf: (name: string, first: unknown) => calls.findIndex((c) => c.name === name && c.args[0] === first),
    /** The keys decoded now: decoded and not released since. */
    decodedNow: (): Set<string> => {
      const set = new Set<string>();
      for (const c of calls) {
        if (c.name === 'decodeKey') set.add(c.args[0] as string);
        if (c.name === 'releaseKey') set.delete(c.args[0] as string);
      }
      return set;
    },
  };
}

/** The keyed stem id of one layer in the key of a pitch class: `music_bed_Fs`. */
const stemId = (layer: string, pc: number) => `music_${layer}_${keyName(pc)}`;
/** The layers that play on every key change: the bed, the pluck and the bass (the always-on keyed stems). */
const PLAYING_LAYERS = ['bed', 'pluck', 'bass'] as const;

const idleFeed: MusicFeed = { flowing: false, saturated: false, stress: 0, debt: false };

/** A music in the running game at level 1, with the first key set and its calls cleared. */
function musicInGame(notReady: Set<string> = new Set()) {
  const rec = recorder(notReady);
  const m = createMusic(rec.sink as unknown as MusicSink);
  m.onUnlock();
  m.onScene('game');
  m.onPhase('running');
  m.onFeed(idleFeed);
  m.onKey(keyPcForLevel(1));
  rec.calls.length = 0;
  return { m, rec };
}

describe('music: a level change crossfades every keyed layer to the new key', () => {
  it('the new key bed, pluck and bass fade in over the 1.4 s key change, on the next beat', () => {
    const { m, rec } = musicInGame();
    m.onKey(keyPcForLevel(2));
    expect(TIMING.keyChangeMs).toBe(1400);
    for (const layer of PLAYING_LAYERS) {
      const starts = rec.calls.filter((c) => c.name === 'startMusic' && c.args[0] === stemId(layer, keyPcForLevel(2)));
      expect(starts.length).toBeGreaterThan(0);
      for (const s of starts) {
        expect(s.args[1]).toBe(TIMING.keyChangeMs);
        expect(s.args[2]).toBe('beat');
      }
    }
  });

  it('the old key bed, pluck and bass fade out over the same 1.4 s, on the same beat', () => {
    const { m, rec } = musicInGame();
    m.onKey(keyPcForLevel(2));
    for (const layer of PLAYING_LAYERS) {
      const stops = rec.calls.filter((c) => c.name === 'stopMusic' && c.args[0] === stemId(layer, keyPcForLevel(1)));
      expect(stops.length).toBeGreaterThan(0);
      for (const s of stops) {
        expect(s.args[1]).toBe(TIMING.keyChangeMs);
        expect(s.args[2]).toBe('beat');
      }
    }
  });

  it('the new key is decoded before any of its stems start (the key is decoded ahead of the change)', () => {
    const rec = recorder();
    const m = createMusic(rec.sink as unknown as MusicSink);
    m.onUnlock();
    m.onScene('game');
    m.onPhase('running');
    m.onFeed(idleFeed);
    m.onKey(keyPcForLevel(1));
    m.onKey(keyPcForLevel(2));
    const decodeAt = rec.indexOf('decodeKey', keyName(keyPcForLevel(2)));
    const startAt = rec.indexOf('startMusic', stemId('bed', keyPcForLevel(2)));
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(decodeAt).toBeGreaterThanOrEqual(0);
    expect(decodeAt).toBeLessThan(startAt);
  });

  it('the new key is already decoded when the level changes: the next key is kept decoded ahead', () => {
    const rec = recorder();
    const m = createMusic(rec.sink as unknown as MusicSink);
    m.onUnlock();
    m.onScene('game');
    m.onPhase('running');
    m.onFeed(idleFeed);
    m.onKey(keyPcForLevel(1));
    expect(rec.decodedNow().has(keyName(keyPcForLevel(2)))).toBe(true);
    expect(keysInMemory(keyPcForLevel(1))).toContain(keyName(keyPcForLevel(2)));
  });
});

describe('music: only two level keys stay decoded', () => {
  it('after three level-ups the decoded keys are the current key and the next one, and nothing else', () => {
    const { m, rec } = musicInGame();
    m.onKey(keyPcForLevel(2));
    m.onKey(keyPcForLevel(3));
    m.onKey(keyPcForLevel(4));
    const decoded = rec.decodedNow();
    expect(decoded.size).toBe(2);
    expect(decoded).toEqual(new Set(keysInMemory(keyPcForLevel(4))));
  });
});

describe('director: the level-up chord with the SFX stinger', () => {
  /** A director in the running game at level 1, with the first snapshot played and the calls cleared. */
  function gameAtLevelOne() {
    const rec = recorder();
    const d = createDirector(rec.sink as unknown as Parameters<typeof createDirector>[0]);
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot(snapOf(1));
    rec.calls.length = 0;
    return { d, rec };
  }

  it('the music chord of the new key plays on the same beat as the SFX stinger, 6 dB lower', () => {
    const { d, rec } = gameAtLevelOne();
    d.onSnapshot(snapOf(2, [note(4, 'level', 'Level 2: Desk')]));
    const chord = rec.named('playStinger').filter((c) => c.args[0] === `music_levelup_${keyName(keyPcForLevel(2))}`);
    const sfx = rec.named('playCue').filter((c) => c.args[0] === 'level_up');
    expect(chord.length).toBe(1);
    expect(sfx.length).toBe(1);
    expect(chord[0]!.args[1]).toBe('beat');
    expect((sfx[0]!.args[1] as { quantise?: string }).quantise).toBe('beat');
    expect(MIX.music.levelupWithSfxDb).toBe(-6);
  });

  it('the level change moves every keyed layer to the new key over 1.4 s, on the beat', () => {
    const { d, rec } = gameAtLevelOne();
    d.onSnapshot(snapOf(2, [note(4, 'level', 'Level 2: Desk')]));
    for (const layer of PLAYING_LAYERS) {
      const start = rec.calls.find((c) => c.name === 'startMusic' && c.args[0] === stemId(layer, keyPcForLevel(2)));
      expect(start, `${layer} of the new key starts`).toBeDefined();
      expect(start!.args[1]).toBe(TIMING.keyChangeMs);
      expect(start!.args[2]).toBe('beat');
    }
  });

  it('two levels in two ticks play two chords, one for each new key', () => {
    const { d, rec } = gameAtLevelOne();
    d.onSnapshot(snapOf(2, [note(4, 'level', 'Level 2: Desk')]));
    d.onSnapshot(snapOf(3, [note(4, 'level', 'Level 2: Desk'), note(9, 'level', 'Level 3: Shop')]));
    const chords = rec.named('playStinger').map((c) => c.args[0]);
    expect(chords).toEqual([`music_levelup_${keyName(keyPcForLevel(2))}`, `music_levelup_${keyName(keyPcForLevel(3))}`]);
  });
});

describe('director: several levels in one tick', () => {
  it('two levels in one tick play one chord, on the first step', () => {
    const rec = recorder();
    const d = createDirector(rec.sink as unknown as Parameters<typeof createDirector>[0]);
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot(snapOf(1));
    rec.calls.length = 0;
    d.onSnapshot(snapOf(3, [note(4, 'level', 'Level 2: Desk'), note(4, 'level', 'Level 3: Shop')]));
    const chords = rec.named('playStinger').map((c) => c.args[0]);
    expect(chords).toEqual([`music_levelup_${keyName(keyPcForLevel(2))}`]);
  });

  it('the keys step one fifth at a time, each step on the beat: the first key, then the target', () => {
    const rec = recorder();
    const d = createDirector(rec.sink as unknown as Parameters<typeof createDirector>[0]);
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot(snapOf(1));
    rec.calls.length = 0;
    d.onSnapshot(snapOf(3, [note(4, 'level', 'Level 2: Desk'), note(4, 'level', 'Level 3: Shop')]));
    const stepStarts = rec.named('startMusic').filter((c) => c.args[0] === stemId('bed', keyPcForLevel(2)) || c.args[0] === stemId('bed', keyPcForLevel(3)));
    expect(stepStarts.map((c) => c.args[0])).toEqual([stemId('bed', keyPcForLevel(2)), stemId('bed', keyPcForLevel(3))]);
    for (const s of stepStarts) expect(s.args[2]).toBe('beat');
    expect(keyPcForLevel(3)).toBe((keyPcForLevel(2) + MIX.transpose.stepSemitones) % 12);
  });

  it('the chord is not repeated for the popup of the newest of those levels', () => {
    const rec = recorder();
    const d = createDirector(rec.sink as unknown as Parameters<typeof createDirector>[0]);
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot(snapOf(1));
    d.onSnapshot(snapOf(3, [note(4, 'level', 'Level 2: Desk'), note(4, 'level', 'Level 3: Shop')]));
    rec.calls.length = 0;
    d.onUi({ speed: 0, hold: 'levelUp', crashed: false, levelUp: 3 } as unknown as Parameters<typeof d.onUi>[0]);
    expect(rec.named('playStinger').filter((c) => String(c.args[0]).startsWith('music_levelup_'))).toEqual([]);
  });
});

describe('director: silent level changes (load, new game, sandbox)', () => {
  it('a load or a new game moves the key with no chord and no stinger', () => {
    const rec = recorder();
    const d = createDirector(rec.sink as unknown as Parameters<typeof createDirector>[0]);
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot(snapOf(1));
    rec.calls.length = 0;
    d.reset();
    d.onSnapshot(snapOf(5, [note(40, 'level', 'Level 5: Lab')]));
    expect(rec.named('playStinger').filter((c) => String(c.args[0]).startsWith('music_levelup_'))).toEqual([]);
    expect(rec.named('playCue').filter((c) => c.args[0] === 'level_up')).toEqual([]);
    const start = rec.calls.find((c) => c.name === 'startMusic' && c.args[0] === stemId('bed', keyPcForLevel(5)));
    expect(start).toBeDefined();
    expect(start!.args[1]).toBe(TIMING.keyChangeMs);
  });

  it('a sandbox level change moves the key with no chord and no stinger', () => {
    const rec = recorder();
    const d = createDirector(rec.sink as unknown as Parameters<typeof createDirector>[0]);
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot(snapOf(1));
    rec.calls.length = 0;
    d.onSnapshot({ ...snapOf(3, [note(4, 'level', 'Level 3: Shop')]), sandbox: true } as unknown as DirectorSnap);
    expect(rec.named('playStinger').filter((c) => String(c.args[0]).startsWith('music_levelup_'))).toEqual([]);
    expect(rec.named('playCue').filter((c) => c.args[0] === 'level_up')).toEqual([]);
    expect(rec.indexOf('startMusic', stemId('bed', keyPcForLevel(3)))).toBeGreaterThanOrEqual(0);
  });
});

describe('director: a level change whose new key is not decoded yet', () => {
  it('the new key stems start only after its decode is sent, never before', () => {
    const rec = recorder();
    const d = createDirector(rec.sink as unknown as Parameters<typeof createDirector>[0]);
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot(snapOf(1));
    d.onSnapshot(snapOf(2, [note(4, 'level', 'Level 2: Desk')]));
    const decodeAt = rec.indexOf('decodeKey', keyName(keyPcForLevel(2)));
    const startAt = rec.indexOf('startMusic', stemId('bed', keyPcForLevel(2)));
    expect(decodeAt).toBeGreaterThanOrEqual(0);
    expect(decodeAt).toBeLessThan(startAt);
  });
});

describe('music: a level change whose new key is not decoded yet (ticket #64, AC5)', () => {
  const newKey = keyName(keyPcForLevel(2));
  /** The next snapshot (the feed) is the tick that re-checks the key (`onFeed` runs the sync again). */
  const nextSnapshot = (m: Music) => m.onFeed(idleFeed);

  it('while the new key is not ready, the old key holds: no new stem starts and no old stem stops', () => {
    const { m, rec } = musicInGame(new Set([newKey]));
    m.onKey(keyPcForLevel(2));
    nextSnapshot(m);
    for (const layer of PLAYING_LAYERS) {
      const newStarts = rec.calls.filter((c) => c.name === 'startMusic' && c.args[0] === stemId(layer, keyPcForLevel(2)));
      const oldStops = rec.calls.filter((c) => c.name === 'stopMusic' && c.args[0] === stemId(layer, keyPcForLevel(1)));
      expect(newStarts, `${layer} of the new key does not start yet`).toEqual([]);
      expect(oldStops, `${layer} of the old key keeps playing`).toEqual([]);
    }
  });

  it('while the new key is not ready, no crossfade starts on any later snapshot', () => {
    const { m, rec } = musicInGame(new Set([newKey]));
    m.onKey(keyPcForLevel(2));
    for (let i = 0; i < 3; i++) nextSnapshot(m);
    const crossfades = rec.calls.filter(
      (c) => (c.name === 'startMusic' || c.name === 'stopMusic' || c.name === 'setMusicGain') && String(c.args[0]).includes(newKey),
    );
    expect(crossfades).toEqual([]);
  });

  it('once the new key reports ready, the crossfade starts: the new stems fade in and the old ones out over 1.4 s, on the beat', () => {
    const notReady = new Set([newKey]);
    const { m, rec } = musicInGame(notReady);
    m.onKey(keyPcForLevel(2));
    nextSnapshot(m);
    expect(rec.named('startMusic').some((c) => String(c.args[0]).includes(newKey))).toBe(false);
    notReady.delete(newKey);
    nextSnapshot(m);
    for (const layer of PLAYING_LAYERS) {
      const start = rec.calls.find((c) => c.name === 'startMusic' && c.args[0] === stemId(layer, keyPcForLevel(2)));
      expect(start, `${layer} of the new key starts once ready`).toBeDefined();
      expect(start!.args[1]).toBe(TIMING.keyChangeMs);
      expect(start!.args[2]).toBe('beat');
      const stop = rec.calls.find((c) => c.name === 'stopMusic' && c.args[0] === stemId(layer, keyPcForLevel(1)));
      expect(stop, `${layer} of the old key fades out once ready`).toBeDefined();
      expect(stop!.args[1]).toBe(TIMING.keyChangeMs);
      expect(stop!.args[2]).toBe('beat');
    }
  });
});

// --- snapshot helpers (the fields the director reads; healthy machine) ---

const note = (tick: number, kind: string, text: string) => ({ tick, kind, text });

function snapOf(level: number, log: ReturnType<typeof note>[] = []): DirectorSnap {
  return {
    log,
    level: { level },
    phase: 'running',
    net: { state: 'down', transfers: [] },
    devices: [],
    vrm: { loadRatio: 0.5 },
    power: { totalW: 10, budgetW: 100, tripped: false },
    bill: { unpaid: 0 },
  } as unknown as DirectorSnap;
}
