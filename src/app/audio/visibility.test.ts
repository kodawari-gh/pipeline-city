// Ticket #59: the hidden tab (index.ts initAudio, engine.ts). On `visibilitychange` to hidden, the master bus fades to 0
// over MIX.hiddenTab.fadeOutMs; the AudioContext suspends MIX.hiddenTab.suspendAfterMs later. On visible, it resumes and
// the master fades back to its mix level over fadeInMs. Cues asked for while hidden are dropped. A Pause or a Hold never
// suspends the context (only a hidden tab does). The tests use a fake AudioContext with a timeline for each gain param,
// a fake document, and fake timers. The clock is stepped 1 ms at a time, so each ramp is sampled at its own time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { MIX } from './mixTokens';
import { busGains, defaultVolumes } from './volume';

const rel = (p: string): string => p.replace(/^\/?audio\//, '');
const filesOf = (id: string): string[] => (MIX.cues.find((c) => c.id === id)?.files ?? []).map(rel);

/** Fake time in seconds. The fake context and the fake timers both read it. */
const clock = { t: 0 };

/** One scheduled automation event on a gain param. */
type Ev = { kind: 'set' | 'linear' | 'target'; t: number; v: number; tc?: number };

/**
 * The value of a param at time `T`, from its events (the first `n` of them). `linear` ramps from the previous event's
 * time to its own time. `target` decays exponentially from its own time.
 */
function gainAt(evs: Ev[], T: number, n = evs.length): number {
  let k = n;
  for (let i = 0; i < n; i++)
    if (evs[i]!.t > T) {
      k = i;
      break;
    }
  if (k < n && evs[k]!.kind === 'linear') {
    const e = evs[k]!;
    const startT = k > 0 ? evs[k - 1]!.t : 0;
    const start = k > 0 ? gainAt(evs, startT, k) : 1;
    return start + (e.v - start) * ((T - startT) / (e.t - startT));
  }
  const idx = k - 1;
  if (idx < 0) return 1;
  const e = evs[idx]!;
  if (e.kind === 'target') {
    const start = gainAt(evs, e.t, idx);
    return e.v + (start - e.v) * Math.exp(-(T - e.t) / e.tc!);
  }
  return e.v;
}

class Param {
  evs: Ev[] = [];
  private add(ev: Ev): this {
    this.evs.push(ev);
    return this;
  }
  /** Reading `value` gives the value now. Writing it sets the value now (a set event). */
  get value(): number {
    return gainAt(this.evs, clock.t);
  }
  set value(x: number) {
    this.add({ kind: 'set', t: clock.t, v: x });
  }
  setValueAtTime(x: number, t: number): this {
    return this.add({ kind: 'set', t, v: x });
  }
  linearRampToValueAtTime(x: number, t: number): this {
    return this.add({ kind: 'linear', t, v: x });
  }
  setTargetAtTime(x: number, t: number, tc: number): this {
    return this.add({ kind: 'target', t, v: x, tc });
  }
  cancelScheduledValues(t: number): this {
    this.evs = this.evs.filter((e) => e.t < t);
    return this;
  }
}
class Node {
  connect<T>(n: T): T {
    return n;
  }
  disconnect(): void {}
}
class Gain extends Node {
  gain = new Param();
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
/** A stand-in AudioContext. Its clock is the fake clock. Suspend and resume set `state` at once, as the browser does. */
class FakeCtx {
  static last: FakeCtx | null = null;
  state: 'suspended' | 'running' = 'suspended';
  destination = new Node();
  gains: Gain[] = [];
  sources: Source[] = [];
  constructor() {
    FakeCtx.last = this;
  }
  get currentTime(): number {
    return clock.t;
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
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
}
class FakeOffline {
  decodeAudioData(data: { path: string }): Promise<{ path: string }> {
    return Promise.resolve(data);
  }
}

async function fakeFetch(url: string) {
  const path = url.slice(url.indexOf('audio/') + 'audio/'.length);
  return { ok: true, status: 200, arrayBuffer: async () => ({ path }) };
}

let target: EventTarget;
let doc: EventTarget & { visibilityState: string };
const gesture = (type: string): boolean => target.dispatchEvent(new Event(type));
/** Microtasks only (fake timers stop setTimeout). Enough for the fake fetch and decode to settle. */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
/** Step the fake clock and the fake timers together, 1 ms at a time. */
function advance(ms: number): void {
  for (let i = 0; i < ms; i++) {
    clock.t += 0.001;
    vi.advanceTimersByTime(1);
  }
}
const hide = (): void => {
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
};
const show = (): void => {
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
};
const ctx = (): FakeCtx => FakeCtx.last!;
/** The master bus is the first gain node the engine makes (openGraph creates it before the other buses). */
const master = (): Gain => ctx().gains[0]!;
/** The master level at the player's default mix, from the mix tokens (busGains reads the bus defaults). */
const masterLevel = (): number => busGains(defaultVolumes()).master;
const playedFiles = (): (string | undefined)[] =>
  ctx()
    .sources.filter((s) => s.started)
    .map((s) => s.buffer?.path);

beforeEach(() => {
  clock.t = 0;
  vi.useFakeTimers();
  target = new EventTarget();
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', target);
  vi.stubGlobal('addEventListener', (t: string, f: any, o?: any) => target.addEventListener(t, f, o));
  vi.stubGlobal('removeEventListener', (t: string, f: any, o?: any) => target.removeEventListener(t, f, o));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('OfflineAudioContext', FakeOffline);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  FakeCtx.last = null;
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Open the context on a gesture, and load the payout and stinger files so cues can play. */
async function openAudio(readUi?: () => any): Promise<void> {
  const idx = await import('./index');
  const eng = await import('./engine');
  idx.initAudio('', readUi);
  gesture('pointerdown');
  for (const id of ['payout', 'level_up']) await eng.preload(filesOf(id));
  await flushMicrotasks();
}

describe('hidden tab: master fades out over 500 ms', () => {
  it('hiding ramps the master from its mix level to 0 by 500 ms, not at once', async () => {
    await openAudio();
    expect(master().gain.value).toBeCloseTo(masterLevel(), 6);
    hide();
    advance(250);
    const mid = master().gain.value;
    expect(mid).toBeGreaterThan(masterLevel() * 0.05);
    expect(mid).toBeLessThan(masterLevel() * 0.95);
    advance(250);
    expect(master().gain.value).toBeCloseTo(0, 3);
  });
});

describe('hidden tab: the context suspends 2 s after hiding', () => {
  it('stays running for 2 s, then suspends', async () => {
    await openAudio();
    const suspend = vi.spyOn(ctx(), 'suspend');
    hide();
    advance(1999);
    expect(ctx().state).toBe('running');
    expect(suspend).not.toHaveBeenCalled();
    advance(1);
    expect(ctx().state).toBe('suspended');
    expect(suspend).toHaveBeenCalledTimes(1);
  });
});

describe('visible again: resume and fade in over 800 ms', () => {
  it('after a suspend, showing resumes the context and fades the master to its mix level by 800 ms', async () => {
    await openAudio();
    hide();
    advance(2000);
    expect(ctx().state).toBe('suspended');
    show();
    await flushMicrotasks();
    expect(ctx().state).toBe('running');
    advance(400);
    const mid = master().gain.value;
    expect(mid).toBeGreaterThan(masterLevel() * 0.05);
    expect(mid).toBeLessThan(masterLevel() * 0.95);
    advance(400);
    expect(master().gain.value).toBeCloseTo(masterLevel(), 3);
  });

  it('showing before the 2 s mark cancels the suspend and keeps the context running', async () => {
    await openAudio();
    const suspend = vi.spyOn(ctx(), 'suspend');
    hide();
    advance(500);
    expect(master().gain.value).toBeCloseTo(0, 3); // the fade-out is done before the show
    advance(500);
    show();
    await flushMicrotasks();
    advance(800);
    expect(suspend).not.toHaveBeenCalled();
    expect(ctx().state).toBe('running');
    expect(master().gain.value).toBeCloseTo(masterLevel(), 3);
  });
});

describe('cues queued while hidden are dropped', () => {
  it('a cue, a delayed cue and a level-up stinger asked for while hidden never sound, even after show', async () => {
    const eng = await import('./engine');
    await openAudio();
    eng.playCue('payout');
    const before = playedFiles().length;
    expect(before).toBe(1); // control: the same cue sounds while visible

    hide();
    advance(500); // still inside the 2 s before the suspend: the context is running
    expect(ctx().state).toBe('running');
    eng.playCue('payout');
    eng.playCue('payout', { delayS: 0.5 });
    eng.playCue('level_up', { quantise: 'beat' });

    show();
    await flushMicrotasks();
    advance(2000);
    expect(playedFiles().length).toBe(before);
  });
});

describe('a Pause or a Hold never suspends the context', () => {
  it('speed 0 and a menu hold leave the context and master alone; only a hidden tab suspends', async () => {
    const ui = signal({ speed: 4, hold: null as 'menu' | null, crashed: false });
    await openAudio(() => ui.value);
    const suspend = vi.spyOn(ctx(), 'suspend');
    const level = master().gain.value;

    ui.value = { speed: 0, hold: null, crashed: false };
    advance(5000);
    ui.value = { speed: 0, hold: 'menu', crashed: false };
    advance(5000);

    expect(suspend).not.toHaveBeenCalled();
    expect(ctx().state).toBe('running');
    expect(master().gain.value).toBeCloseTo(level, 6);
    expect(ui.value).toEqual({ speed: 0, hold: 'menu', crashed: false }); // the audio does not write the clock

    hide();
    advance(2000);
    expect(suspend).toHaveBeenCalledTimes(1);
  });
});
