// Ticket #51: the director (index.ts initAudio). The sim is a fake: the test sets the store's snapshot and reads
// what the audio asked the fake browser to do. Covers: nothing loads before `booted`; no sound and no console
// error before the first gesture; the first snapshot plays nothing; a fresh payout note plays one payout cue in
// the current level's key. With ?debug, the cue board's files also wait for `booted`. Ticket #58: the room loop
// waits for the boot screen to go (sceneOf, the readScene of main.tsx).
import { assert, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIX } from './mixTokens';

class Param {
  log: number[] = [];
  private v = 1;
  get value(): number {
    return this.v;
  }
  set value(x: number) {
    this.v = x;
    this.log.push(x);
  }
  setTargetAtTime(x: number): this {
    this.log.push(x);
    return this;
  }
  setValueAtTime(x: number): this {
    this.log.push(x);
    return this;
  }
  linearRampToValueAtTime(x: number): this {
    this.log.push(x);
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}
class Node {
  connect<T>(n: T): T {
    return n;
  }
  disconnect(): void {
    /* no-op */
  }
}
class Gain extends Node {
  gain = new Param();
}
/** A lowpass filter stand-in: engine.ts sets its type and cutoff per music voice. */
class Filter extends Node {
  type = '';
  frequency = new Param();
}
class Source extends Node {
  buffer: { path: string } | null = null;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}
class FakeCtx {
  static last: FakeCtx | null = null;
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = new Node();
  gains: Gain[] = [];
  sources: Source[] = [];
  constructor() {
    FakeCtx.last = this;
  }
  createGain(): Gain {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createDelay() {
    return Object.assign(new Gain(), { delayTime: new Param() });
  }
  createBufferSource(): Source {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  createBiquadFilter(): Filter {
    return new Filter();
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
}
/** A stand-in OfflineAudioContext: engine.ts decodes each fetched file with it. The decoded "buffer" keeps the path. */
class FakeOffline {
  decodeAudioData(data: { path: string }): Promise<{ path: string }> {
    return Promise.resolve(data);
  }
}

const fetched: string[] = [];
let inFlight = 0;
let maxInFlight = 0;
async function fakeFetch(url: string) {
  const path = url.slice(url.indexOf('audio/') + 'audio/'.length);
  fetched.push(path);
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await Promise.resolve();
  inFlight--;
  return { ok: true, status: 200, arrayBuffer: async () => ({ path }) };
}

let target: EventTarget;
const gesture = (type: string): boolean => target.dispatchEvent(new Event(type));
const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => {
      setTimeout(r, 0);
    });
  }
};
/** The sources started so far. None exist before the first gesture (no context yet). */
const started = (): Source[] => FakeCtx.last?.sources.filter((s) => s.started) ?? [];
const playedFiles = (): (string | undefined)[] => started().map((s) => s.buffer?.path);
/** The sfx sources started so far. A payout also starts its glint notes (music bus), which these tests do not check. */
const sfxSources = (): Source[] => started().filter((s) => s.buffer?.path?.startsWith('sfx/'));

/** A log note as the sim writes it: `Game.note(kind, text)` at a tick. */
const note = (tick: number, text: string, kind = 'payout') => ({ tick, kind, text });
/** A snapshot with only the fields the audio reads. */
const snap = (level: number, tick: number, log: ReturnType<typeof note>[] = []): any => ({
  tick,
  level: { level, name: `Level ${level}`, clientBase: 0, floor: 0, next: null, progress: 0 },
  log,
});

let warn: any;
let error: any;

beforeEach(() => {
  target = new EventTarget();
  vi.stubGlobal('window', target);
  vi.stubGlobal('addEventListener', (t: string, f: any, o?: any) => {
    target.addEventListener(t, f, o);
  });
  vi.stubGlobal('removeEventListener', (t: string, f: any, o?: any) => {
    target.removeEventListener(t, f, o);
  });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('OfflineAudioContext', FakeOffline);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  FakeCtx.last = null;
  fetched.length = 0;
  inFlight = 0;
  maxInFlight = 0;
  vi.resetModules();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {
    /* no-op */
  });
  error = vi.spyOn(console, 'error').mockImplementation(() => {
    /* no-op */
  });
});
afterEach(async () => {
  await flush(); // a gesture or a snapshot can start loads that the test does not wait for: they finish while fetch is still the fake
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loading starts at booted', () => {
  it('fetches nothing before booted, then one file at a time, starting with the F roots', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    idx.initAudio();
    gesture('pointerdown');
    await flush();
    expect(fetched).toStrictEqual([]);
    boot.booted.value = true;
    await flush();
    expect(fetched).toContain('sfx/payout__F.ogg');
    expect(fetched).not.toContain('sfx/payout__B.ogg'); // other roots load lazily, on a key change
    expect(maxInFlight).toBe(1);
  });
});

describe('no sound before the first gesture', () => {
  it.each(MIX.unlock.events)('before %s: no sound and no console error; after it: the payout sounds', async (type) => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const store = await import('../store');
    idx.initAudio();
    boot.booted.value = true;
    await flush();
    store.snapshot.value = snap(1, 1, []);
    store.snapshot.value = snap(1, 2, [note(2, 'key 1 (F): $120')]);
    expect(playedFiles()).toStrictEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    gesture(type);
    store.snapshot.value = snap(1, 3, [note(2, 'key 1 (F): $120'), note(3, 'key 2 (F): $140')]);
    expect(sfxSources().map((s) => s.buffer?.path)).toStrictEqual(['sfx/payout__F.ogg']);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('payout note plays its cue in the current level key', () => {
  it('the first snapshot plays nothing; a fresh payout note plays one payout cue at rate 1 in F', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const store = await import('../store');
    idx.initAudio();
    gesture('pointerdown');
    boot.booted.value = true;
    await flush();
    store.snapshot.value = snap(1, 1, [note(1, 'key 1 (F): $120')]);
    expect(playedFiles()).toStrictEqual([]);
    store.snapshot.value = snap(1, 2, [note(1, 'key 1 (F): $120'), note(2, 'key 2 (F): $140')]);
    expect(sfxSources().map((s) => s.buffer?.path)).toStrictEqual(['sfx/payout__F.ogg']);
    const [firstSfxSource] = sfxSources();
    assert.exists(firstSfxSource);
    expect(firstSfxSource.playbackRate.value).toBeCloseTo(1, 6);
  });

  it('level 2 is key C: the payout plays payout__B, one semitone up', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const store = await import('../store');
    idx.initAudio();
    gesture('pointerdown');
    boot.booted.value = true;
    await flush();
    store.snapshot.value = snap(1, 1, []);
    store.snapshot.value = snap(2, 2, []);
    await flush(); // the new key's roots load on the level change
    store.snapshot.value = snap(2, 3, [note(3, 'key 1 (C): $200')]);
    expect(sfxSources().map((s) => s.buffer?.path)).toStrictEqual(['sfx/payout__B.ogg']);
    const [firstSfxSource2] = sfxSources();
    assert.exists(firstSfxSource2);
    expect(firstSfxSource2.playbackRate.value).toBeCloseTo(2 ** (1 / 12), 6);
  });

  it('level 13 wraps to key F: the payout plays payout__F at rate 1', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const store = await import('../store');
    idx.initAudio();
    gesture('pointerdown');
    boot.booted.value = true;
    await flush();
    store.snapshot.value = snap(1, 1, []);
    store.snapshot.value = snap(13, 2, []);
    await flush();
    store.snapshot.value = snap(13, 3, [note(3, 'key 1 (F): $300')]);
    expect(sfxSources().map((s) => s.buffer?.path)).toStrictEqual(['sfx/payout__F.ogg']);
    const [firstSfxSource3] = sfxSources();
    assert.exists(firstSfxSource3);
    expect(firstSfxSource3.playbackRate.value).toBeCloseTo(1, 6);
  });
});

describe('?debug cue board: files wait for booted', () => {
  // The board is plain DOM. Give it the few calls it makes (createElement, body.append); no layout is needed.
  const fakeEl = (): any =>
    Object.assign(new EventTarget(), {
      id: '',
      type: '',
      textContent: '',
      style: {},
      setAttribute() {
        /* no-op */
      },
      append() {
        /* empty */
      },
    });

  it('fetches no cue file before booted; after booted the board files load', async () => {
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), {
        visibilityState: 'visible',
        createElement: fakeEl,
        body: {
          append() {
            /* no-op */
          },
        },
      }),
    );
    const idx = await import('./index');
    const boot = await import('../boot');
    await import('./cueBoard'); // loaded now, so the board's dynamic import resolves within the flushes below
    idx.initAudio('?debug');
    await flush();
    expect(fetched).toStrictEqual([]);
    boot.booted.value = true;
    await flush();
    expect(fetched).toContain('sfx/payout__F.ogg');
    expect(fetched).toContain('sfx/payout__B.ogg'); // the board plays every cue, so each cue's files load
    expect(maxInFlight).toBe(1);
  });
});

describe('the clock and holds reach the director (readUi), with the real engine', () => {
  // Ticket #54: index.ts passes readUi to the director as `onUi`. A signal stands in for the store; the test
  // sets it and reads what the engine started. The context must never suspend while the clock is stopped.
  it('a Pause plays pause, a menu hold plays its panel cue, and the context stays running', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const { signal } = await import('@preact/signals');
    const ui = signal({ speed: 4, hold: null as 'menu' | null, crashed: false });
    idx.initAudio(undefined, () => ui.value);
    gesture('pointerdown');
    boot.booted.value = true;
    await flush();
    const ctx = FakeCtx.last;
    assert.exists(ctx);
    expect(ctx.state).toBe('running');
    const suspend = vi.spyOn(ctx, 'suspend');

    ui.value = { speed: 0, hold: null, crashed: false };
    expect(playedFiles()).toStrictEqual(['sfx/pause.ogg']);

    ui.value = { speed: 0, hold: 'menu', crashed: false };
    expect(playedFiles()).toStrictEqual(['sfx/pause.ogg', 'ui/ui_panel_open.ogg']);

    expect(suspend).not.toHaveBeenCalled();
    expect(ctx.state).toBe('running');
    expect(ctx.sources.some((s) => s.stopped)).toBe(false);
  });

  it('a sim crash plays the error cue through the engine', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const { signal } = await import('@preact/signals');
    const ui = signal({ speed: 4, hold: null, crashed: false });
    idx.initAudio(undefined, () => ui.value);
    gesture('pointerdown');
    boot.booted.value = true;
    await flush();
    ui.value = { speed: 0, hold: null, crashed: true };
    expect(playedFiles()).toContain('ui/ui_error.ogg');
  });
});

describe('ticket #58: the room loop waits for the boot screen', () => {
  // main.tsx passes `sceneOf` the boot screen's state: the room loop may not start while the boot screen shows,
  // even after the first gesture.
  const roomStarted = (): boolean => started().some((s) => s.buffer?.path?.includes('amb_room_city_loop'));

  it('sceneOf: the boot screen is its own scene until booted, then the room scenes follow', async () => {
    const idx = await import('./index');
    const base = { booted: false, build: false, gallery: false, game: false };
    expect(idx.sceneOf(base)).toBe('boot');
    expect(idx.sceneOf({ ...base, booted: true })).toBe('menu');
    expect(idx.sceneOf({ ...base, booted: true, game: true })).toBe('game');
    expect(idx.sceneOf({ ...base, booted: true, build: true, game: true })).toBe('build');
    expect(idx.sceneOf({ ...base, booted: true, gallery: true })).toBe('gallery');
  });

  it('a gesture before booted does not start the room loop; booted then starts it', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    idx.initAudio(undefined, undefined, () =>
      idx.sceneOf({ booted: boot.booted.value, build: false, gallery: false, game: false }),
    );
    gesture('pointerdown');
    await flush();
    expect(roomStarted()).toBe(false);
    boot.booted.value = true;
    await flush();
    expect(roomStarted()).toBe(true);
  });
});

// Ticket #55: the level-up stinger through the real director and engine. The sim writes the `level` note in the same
// tick as the level change, so the note arrives in the snapshot that changes the key.
describe('level-up stinger: the real director and engine', () => {
  it('the level change asks for the new key stinger file', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const store = await import('../store');
    idx.initAudio();
    gesture('pointerdown');
    boot.booted.value = true;
    await flush();
    store.snapshot.value = snap(1, 1, []);
    store.snapshot.value = snap(2, 2, [note(2, 'Level 2: Desk', 'level')]);
    await flush();
    expect(fetched).toContain('sfx/level_up__C.ogg'); // level 2 is key C
  });

  it('a level note plays level_up of the new key, in the same snapshot as the level change', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const store = await import('../store');
    idx.initAudio();
    gesture('pointerdown');
    boot.booted.value = true;
    await flush();
    store.snapshot.value = snap(1, 1, []);
    await flush(); // the stinger decodes before the level changes
    store.snapshot.value = snap(2, 2, [note(2, 'Level 2: Desk', 'level')]);
    // The SFX stinger and the music's level-up chord (ticket #64), both in the new key.
    expect(playedFiles()).toStrictEqual(['sfx/level_up__C.ogg', 'music/notes/music_levelup_C.ogg']);
  });
});
