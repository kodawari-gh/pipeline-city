// Ticket #51: the audio engine (engine.ts). No DOM and no real sound: a fake AudioContext, fetch and event target
// stand in for the browser. The tests read what the engine asked them to do: which files it fetched, which buffers
// its sources played, what it logged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIX } from './mixTokens';

/** Engine paths are relative to `audio/` (the basePath), e.g. `sfx/payout__F.ogg`. */
const rel = (p: string): string => p.replace(/^\/?audio\//, '');
const filesOf = (id: string): string[] => (MIX.cues.find((c) => c.id === id)?.files ?? []).map(rel);
const ALL_FILES = [...new Set(MIX.cues.flatMap((c) => c.files.map(rel)))];

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
/** A stand-in AudioContext. Every node it makes is kept, so a test can read the calls. */
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

// Network: each fetch records its path. A test can hold one file (a gate), or make one fail.
const fetched: string[] = [];
const failing = new Set<string>();
const gates = new Map<string, Promise<void>>();
let inFlight = 0;
let maxInFlight = 0;
async function fakeFetch(url: string) {
  const path = url.slice(url.indexOf('audio/') + 'audio/'.length);
  fetched.push(path);
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await (gates.get(path) ?? Promise.resolve());
  inFlight--;
  if (failing.has(path)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, arrayBuffer: async () => ({ path }) };
}

let target: EventTarget;
function stubBrowser(): void {
  target = new EventTarget();
  vi.stubGlobal('window', target);
  vi.stubGlobal('addEventListener', (t: string, f: any, o?: any) => target.addEventListener(t, f, o));
  vi.stubGlobal('removeEventListener', (t: string, f: any, o?: any) => target.removeEventListener(t, f, o));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('OfflineAudioContext', FakeOffline);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
}
const gesture = (type: string): boolean => target.dispatchEvent(new Event(type));
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };
const ctx = (): FakeCtx => FakeCtx.last!;
/** Every source the context made so far. None exist before the first gesture (no context yet). */
const sourcesOf = (): Source[] => FakeCtx.last?.sources ?? [];
/** Files of the sources that were started, in order. */
const playedFiles = (): (string | undefined)[] => sourcesOf().filter((s) => s.started).map((s) => s.buffer?.path);
const aliveCount = (): number => sourcesOf().filter((s) => s.started && !s.stopped).length;

let warn: any;
let error: any;

beforeEach(() => {
  stubBrowser();
  FakeCtx.last = null;
  fetched.length = 0;
  failing.clear();
  gates.clear();
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

describe('before the first gesture', () => {
  it('plays nothing and logs no console error', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    await eng.preload(filesOf('payout'));
    eng.playCue('payout');
    await flush();
    expect(FakeCtx.last).toBeNull(); // no AudioContext exists before the gesture
    expect(playedFiles()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(MIX.unlock.events)('after %s: the context runs and the cue sounds', async (type) => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    await eng.preload(filesOf('payout'));
    gesture(type);
    expect(ctx().state).toBe('running');
    eng.playCue('payout');
    expect(playedFiles()).toEqual(['sfx/payout__F.ogg']);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('loading', () => {
  it('fetches one file at a time', async () => {
    const eng = await import('./engine');
    const files = ['sfx/payout__F.ogg', 'sfx/payout__Gs.ogg', 'sfx/payout__B.ogg'];
    let release!: () => void;
    gates.set(files[0]!, new Promise<void>((r) => { release = r; }));
    const done = eng.preload(files);
    await flush();
    expect(fetched).toEqual([files[0]]);
    expect(maxInFlight).toBe(1);
    release();
    await done;
    expect(fetched).toEqual(files);
    expect(maxInFlight).toBe(1);
  });

  it('skips a cue whose file is not decoded yet, and never plays it late', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('pointerdown');
    let release!: () => void;
    gates.set('sfx/payout__F.ogg', new Promise<void>((r) => { release = r; }));
    const pending = eng.preload(['sfx/payout__F.ogg']);
    await flush();
    eng.playCue('payout');
    expect(playedFiles()).toEqual([]);
    release();
    await pending;
    await flush();
    expect(playedFiles()).toEqual([]); // not delayed until the file arrives
    eng.playCue('payout');
    expect(playedFiles()).toEqual(['sfx/payout__F.ogg']);
  });

  it('logs one warning when a file fails to load, and playCue stays quiet', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('pointerdown');
    failing.add('sfx/payout__F.ogg');
    expect(await eng.load('sfx/payout__F.ogg')).toBeNull();
    expect(await eng.load('sfx/payout__F.ogg')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.join(' '))).toContain('payout__F');
    expect(() => eng.playCue('payout')).not.toThrow();
    expect(playedFiles()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('voices, rate limits and ducking', () => {
  it('a repeat of one cue inside its rate limit plays once', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload(filesOf('ui_click'));
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    eng.playCue('ui_click');
    eng.playCue('ui_click');
    expect(playedFiles()).toHaveLength(1);
  });

  it('the sfx bus holds MIX.voices.sfx voices at most, stealing the oldest low-priority one', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload(ALL_FILES);
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 1000));
    for (const c of MIX.cues.filter((c) => c.bus === 'sfx')) eng.playCue(c.id);
    expect(aliveCount()).toBe(MIX.voices.sfx);
  });

  it('the ui bus holds MIX.voices.ui voices at most', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload(ALL_FILES);
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 1000));
    for (const c of MIX.cues.filter((c) => c.bus === 'ui')) eng.playCue(c.id);
    expect(aliveCount()).toBe(MIX.voices.ui);
  });

  it('ducks music deepest for the key cue when a standard cue follows (deepest duck wins)', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload(ALL_FILES);
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 1000));
    const key = MIX.cues.find((c) => c.duckClass === 'key');
    const standard = MIX.cues.find((c) => c.duckClass === 'standard');
    expect(key && standard).toBeTruthy();
    eng.playCue(key!.id);
    eng.playCue(standard!.id);
    const deep = Math.pow(10, MIX.ducking.cueDuckDb.key / 20);
    const writes = (eng.musicDuck as unknown as Gain).gain.log;
    expect(Math.min(...writes)).toBeCloseTo(deep, 3);
    expect(writes[writes.length - 1]!).toBeCloseTo(1, 6); // the release returns music to unity gain
  });
});
