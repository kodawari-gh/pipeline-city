// Ticket #51: the director (index.ts initAudio). The sim is a fake: the test sets the store's snapshot and reads
// what the audio asked the fake browser to do. Covers: nothing loads before `booted`; no sound and no console
// error before the first gesture; the first snapshot plays nothing; a fresh payout note plays one payout cue in
// the current level's key. With ?debug, the cue board's files also wait for `booted`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIX } from './mixTokens';

const rel = (p: string): string => p.replace(/^\/?audio\//, '');

class Param {
  log: number[] = [];
  private v = 1;
  get value(): number { return this.v; }
  set value(x: number) { this.v = x; this.log.push(x); }
  setTargetAtTime(x: number): this { this.log.push(x); return this; }
  setValueAtTime(x: number): this { this.log.push(x); return this; }
  linearRampToValueAtTime(x: number): this { this.log.push(x); return this; }
  cancelScheduledValues(): this { return this; }
}
class Node {
  connect<T>(n: T): T { return n; }
  disconnect(): void {}
}
class Gain extends Node { gain = new Param(); }
class Source extends Node {
  buffer: { path: string } | null = null;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
}
class FakeCtx {
  static last: FakeCtx | null = null;
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = new Node();
  gains: Gain[] = [];
  sources: Source[] = [];
  constructor() { FakeCtx.last = this; }
  createGain(): Gain { const g = new Gain(); this.gains.push(g); return g; }
  createBufferSource(): Source { const s = new Source(); this.sources.push(s); return s; }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
}
/** A stand-in OfflineAudioContext: engine.ts decodes each fetched file with it. The decoded "buffer" keeps the path. */
class FakeOffline {
  decodeAudioData(data: { path: string }): Promise<{ path: string }> { return Promise.resolve(data); }
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
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };
/** The sources started so far. None exist before the first gesture (no context yet). */
const started = (): Source[] => FakeCtx.last?.sources.filter((s) => s.started) ?? [];
const playedFiles = (): (string | undefined)[] => started().map((s) => s.buffer?.path);

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
  vi.stubGlobal('addEventListener', (t: string, f: any, o?: any) => target.addEventListener(t, f, o));
  vi.stubGlobal('removeEventListener', (t: string, f: any, o?: any) => target.removeEventListener(t, f, o));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('OfflineAudioContext', FakeOffline);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  FakeCtx.last = null;
  fetched.length = 0;
  inFlight = 0;
  maxInFlight = 0;
  vi.resetModules();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
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
    expect(fetched).toEqual([]);
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
    expect(playedFiles()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    gesture(type);
    store.snapshot.value = snap(1, 3, [note(2, 'key 1 (F): $120'), note(3, 'key 2 (F): $140')]);
    expect(playedFiles()).toEqual(['sfx/payout__F.ogg']);
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
    expect(playedFiles()).toEqual([]);
    store.snapshot.value = snap(1, 2, [note(1, 'key 1 (F): $120'), note(2, 'key 2 (F): $140')]);
    expect(playedFiles()).toEqual(['sfx/payout__F.ogg']);
    expect(started()[0]!.playbackRate.value).toBeCloseTo(1, 6);
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
    expect(playedFiles()).toEqual(['sfx/payout__B.ogg']);
    expect(started()[0]!.playbackRate.value).toBeCloseTo(Math.pow(2, 1 / 12), 6);
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
    expect(playedFiles()).toEqual(['sfx/payout__F.ogg']);
    expect(started()[0]!.playbackRate.value).toBeCloseTo(1, 6);
  });
});

describe('?debug cue board: files wait for booted', () => {
  // The board is plain DOM. Give it the few calls it makes (createElement, body.append); no layout is needed.
  const fakeEl = (): any =>
    Object.assign(new EventTarget(), { id: '', type: '', textContent: '', style: {}, setAttribute() {}, append() {} });

  it('fetches no cue file before booted; after booted the board files load', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible', createElement: fakeEl, body: { append() {} } }));
    const idx = await import('./index');
    const boot = await import('../boot');
    await import('./cueBoard'); // loaded now, so the board's dynamic import resolves within the flushes below
    idx.initAudio('?debug');
    await flush();
    expect(fetched).toEqual([]);
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
    const ctx = FakeCtx.last!;
    expect(ctx.state).toBe('running');
    const suspend = vi.spyOn(ctx, 'suspend');

    ui.value = { speed: 0, hold: null, crashed: false };
    expect(playedFiles()).toEqual(['sfx/pause.ogg']);

    ui.value = { speed: 0, hold: 'menu', crashed: false };
    expect(playedFiles()).toEqual(['sfx/pause.ogg', 'ui/ui_panel_open.ogg']);

    expect(suspend).not.toHaveBeenCalled();
    expect(ctx.state).toBe('running');
    expect(ctx.sources.some((s) => s.stopped)).toBe(false);
  });

  it('a sim crash plays the error cue through the engine', async () => {
    const idx = await import('./index');
    const boot = await import('../boot');
    const { signal } = await import('@preact/signals');
    const ui = signal({ speed: 4, hold: null as null, crashed: false });
    idx.initAudio(undefined, () => ui.value);
    gesture('pointerdown');
    boot.booted.value = true;
    await flush();
    ui.value = { speed: 0, hold: null, crashed: true };
    expect(playedFiles()).toContain('ui/ui_error.ogg');
  });
});
