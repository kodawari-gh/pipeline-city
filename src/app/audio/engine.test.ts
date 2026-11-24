// Ticket #51: the audio engine (engine.ts). No DOM and no real sound: a fake AudioContext, fetch and event target
// stand in for the browser. The tests read what the engine asked them to do: which files it fetched, which buffers
// its sources played, what it logged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIX } from './mixTokens';
import { pickFile } from './keys';
import { BAR_S, BEAT_S, MENU_ID } from './music';

/** Engine paths are relative to `audio/` (the basePath), e.g. `sfx/payout__F.ogg`. */
const rel = (p: string): string => p.replace(/^\/?audio\//, '');
const filesOf = (id: string): string[] => (MIX.cues.find((c) => c.id === id)?.files ?? []).map(rel);
const ALL_FILES = [...new Set(MIX.cues.flatMap((c) => c.files.map(rel)))];

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
  disconnect(): void {}
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
  buffer: { path: string; length: number } | null = null;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  loop = false;
  loopStart = -1;
  loopEnd = -1;
  /** The context time the engine asked this source to start at. */
  when = -1;
  start(when = 0): void {
    this.started = true;
    this.when = when;
  }
  stop(): void {
    this.stopped = true;
  }
}
/** A stand-in AudioContext. Every node it makes is kept, so a test can read the calls. */
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
  decodeAudioData(data: { path: string; length: number }): Promise<{ path: string; length: number }> {
    return Promise.resolve(data);
  }
}

// Network: each fetch records its path. A test can hold one file (a gate), or make one fail.
const fetched: string[] = [];
const failing = new Set<string>();
const gates = new Map<string, Promise<void>>();
/** A file's decoded length (samples) when a test sets one: a decoder that trims a loop. Default: the manifest's count. */
const decodedLength = new Map<string, number>();
const manifestSamples = new Map<string, number>(
  Object.entries(MIX.ambience).map(([id, t]) => [`ambience/${id}.ogg`, t.samples]),
);
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
  const length = decodedLength.get(path) ?? manifestSamples.get(path) ?? 0;
  return { ok: true, status: 200, arrayBuffer: async () => ({ path, length }) };
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
const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};
const ctx = (): FakeCtx => FakeCtx.last!;
/** Every source the context made so far. None exist before the first gesture (no context yet). */
const sourcesOf = (): Source[] => FakeCtx.last?.sources ?? [];
/** Files of the sources that were started, in order. */
const playedFiles = (): (string | undefined)[] =>
  sourcesOf()
    .filter((s) => s.started)
    .map((s) => s.buffer?.path);
const aliveCount = (): number => sourcesOf().filter((s) => s.started && !s.stopped).length;

let warn: any;
let error: any;

beforeEach(() => {
  stubBrowser();
  FakeCtx.last = null;
  fetched.length = 0;
  failing.clear();
  gates.clear();
  decodedLength.clear();
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
    gates.set(
      files[0]!,
      new Promise<void>((r) => {
        release = r;
      }),
    );
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
    gates.set(
      'sfx/payout__F.ogg',
      new Promise<void>((r) => {
        release = r;
      }),
    );
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

// Ticket #55: the level-up stinger in the engine. A level change loads the new key's stinger at once; a stinger not
// decoded yet is skipped; the stinger plays at rate 1 and ducks music by the milestone depth.
describe('level-up stinger: engine', () => {
  const LEVEL_UP_F = 'sfx/level_up__F.ogg';
  const LEVEL_UP_C = 'sfx/level_up__C.ogg'; // level 2 is key C (pitch class 0)

  it('a level change loads the new key stinger; the old key stinger is not fetched again', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    eng.startLoading();
    await flush();
    expect(fetched).toContain(LEVEL_UP_F);
    expect(fetched).not.toContain(LEVEL_UP_C);
    eng.setKeyPc(0);
    await flush();
    expect(fetched).toContain(LEVEL_UP_C);
  });

  it('a stinger whose new key file is not decoded yet is skipped, not played late', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    eng.startLoading();
    await flush();
    let release!: () => void;
    gates.set(
      LEVEL_UP_C,
      new Promise<void>((r) => {
        release = r;
      }),
    );
    eng.setKeyPc(0);
    await flush();
    eng.playCue('level_up');
    expect(playedFiles()).not.toContain(LEVEL_UP_C);
    release();
    await flush();
    expect(playedFiles()).not.toContain(LEVEL_UP_C); // not delayed until the file arrives
    eng.playCue('level_up');
    expect(playedFiles()).toContain(LEVEL_UP_C);
  });

  it('the stinger plays its new key file at rate 1', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    eng.setKeyPc(0);
    await eng.preload([LEVEL_UP_C]);
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    eng.playCue('level_up');
    const src = sourcesOf().find((s) => s.started && s.buffer?.path === LEVEL_UP_C);
    expect(src).toBeTruthy();
    expect(src!.playbackRate.value).toBe(1);
  });

  it('the stinger ducks music by the milestone depth', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    eng.setKeyPc(0);
    await eng.preload([LEVEL_UP_C]);
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    eng.playCue('level_up');
    const deep = Math.pow(10, MIX.ducking.cueDuckDb.milestone / 20);
    const writes = (eng.musicDuck as unknown as Gain).gain.log;
    expect(Math.min(...writes)).toBeCloseTo(deep, 3);
  });

  it('the stinger ducks the ambience by the milestone depth too, not only the music', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    eng.setKeyPc(0);
    await eng.preload([LEVEL_UP_C]);
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    eng.playCue('level_up');
    const deep = Math.pow(10, MIX.ducking.cueDuckDb.milestone / 20);
    // Every gain node that dipped to the milestone depth: the music duck and the ambience duck.
    const dipped = ctx().gains.filter((g) => g.gain.log.some((x) => Math.abs(x - deep) < 1e-3));
    expect(dipped.length).toBeGreaterThanOrEqual(2);
  });

  it('a level change loads the pitched root files of the new key, and none of them at boot', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    eng.startLoading();
    await flush();
    const pitched = MIX.cues.filter((c) => c.transpose === 'nearestRootRate');
    const newKeyFiles = pitched.map((c) => rel(pickFile(c, 0, new Map()).path)); // key C (pitch class 0)
    expect(newKeyFiles.length).toBeGreaterThan(0);
    for (const f of newKeyFiles) expect(fetched).not.toContain(f);
    eng.setKeyPc(0);
    await flush();
    for (const f of newKeyFiles) expect(fetched).toContain(f);
  });
});

// Ticket #59: the hidden tab. The master fades out (the fade node, the first gain the context makes), queued cues are dropped,
// the context suspends after `hiddenTab.suspendAfterMs`, and a visible tab resumes it and fades back in.
describe('hidden tab', () => {
  const FADE = (): Gain => ctx().gains[0]!; // openGraph makes the fade node first
  const lastTarget = (g: Gain): number | undefined => g.gain.log[g.gain.log.length - 1];

  it('a cue asked for while hidden is refused', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload(filesOf('payout'));
    eng.setHidden(true);
    eng.playCue('payout');
    expect(playedFiles()).toEqual([]);
  });

  it('a queued cue (not yet started) is dropped when the tab hides, and a playing one is not cut', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload(filesOf('payout'));
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 1000)); // past the cue's rate limit
    eng.playCue('payout'); // starts now
    eng.playCue('payout', { delayS: 5 }); // queued
    const [now, queued] = sourcesOf();
    eng.setHidden(true);
    expect(queued!.stopped).toBe(true);
    expect(now!.stopped).toBe(false);
  });

  it('hiding fades the master out over fadeOutMs and visible fades it back in over fadeInMs', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload(filesOf('payout'));
    eng.playCue('payout');
    eng.setHidden(true);
    expect(lastTarget(FADE())).toBe(0);
    eng.setHidden(false);
    expect(lastTarget(FADE())).toBe(1);
  });

  it('the context suspends suspendAfterMs after hiding, and a visible tab resumes it', async () => {
    vi.useFakeTimers();
    try {
      const eng = await import('./engine');
      eng.unlockOnGesture();
      gesture('keydown');
      expect(ctx().state).toBe('running');
      eng.setHidden(true);
      vi.advanceTimersByTime(MIX.hiddenTab.suspendAfterMs - 1);
      expect(ctx().state).toBe('running');
      vi.advanceTimersByTime(1);
      expect(ctx().state).toBe('suspended');
      eng.setHidden(false);
      expect(ctx().state).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tab that comes back before the suspend keeps the context running', async () => {
    vi.useFakeTimers();
    try {
      const eng = await import('./engine');
      eng.unlockOnGesture();
      gesture('keydown');
      eng.setHidden(true);
      vi.advanceTimersByTime(MIX.hiddenTab.suspendAfterMs / 2);
      eng.setHidden(false);
      vi.advanceTimersByTime(MIX.hiddenTab.suspendAfterMs * 2);
      expect(ctx().state).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a cue plays again once the tab is visible', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload(filesOf('payout'));
    eng.setHidden(true);
    eng.setHidden(false);
    eng.playCue('payout');
    expect(playedFiles()).toEqual(['sfx/payout__F.ogg']);
  });
});

// Ticket #55: the music's beat clock (setBeatClock, the hook the music tickets use). A cue with `quantise: 'beat'`
// starts on the clock's next beat; with no clock (no music running) it starts at once. A cue without the option ignores the clock.
describe('level-up stinger: the music beat', () => {
  const LEVEL_UP_F = 'sfx/level_up__F.ogg';

  /** A clock that answers `secs` for every time, and keeps the times it was asked about. */
  const clockAt = (secs: number) => {
    const asked: number[] = [];
    return {
      asked,
      clock: {
        secondsToNextBeat(nowS: number) {
          asked.push(nowS);
          return secs;
        },
      },
    };
  };
  /** The start time of the first started source that played `path`. */
  const startedAt = (path: string): number | undefined =>
    sourcesOf().find((s) => s.started && s.buffer?.path === path)?.when;

  it('with no music running the stinger starts at once', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([LEVEL_UP_F]);
    ctx().currentTime = 12;
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    eng.setBeatClock(null);
    eng.playCue('level_up', { quantise: 'beat' });
    expect(startedAt(LEVEL_UP_F)).toBe(12);
  });

  it('when the music stops (its clock is cleared) the stinger starts at once', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([LEVEL_UP_F]);
    ctx().currentTime = 12;
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    eng.setBeatClock(clockAt(0.75).clock);
    eng.setBeatClock(null);
    eng.playCue('level_up', { quantise: 'beat' });
    expect(startedAt(LEVEL_UP_F)).toBe(12);
  });

  it('with a music clock the stinger starts on the next beat the clock gives', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([LEVEL_UP_F]);
    ctx().currentTime = 12;
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    const { asked, clock } = clockAt(0.75);
    eng.setBeatClock(clock);
    eng.playCue('level_up', { quantise: 'beat' });
    expect(asked).toEqual([12]); // the clock is asked from the context's own time
    expect(startedAt(LEVEL_UP_F)).toBeCloseTo(12.75, 9);
  });

  it('a clock that says the beat is now starts the stinger at once', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([LEVEL_UP_F]);
    ctx().currentTime = 12;
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    eng.setBeatClock(clockAt(0).clock);
    eng.playCue('level_up', { quantise: 'beat' });
    expect(startedAt(LEVEL_UP_F)).toBe(12);
  });

  it('a cue without the quantise option ignores the clock and starts at once', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([LEVEL_UP_F]);
    ctx().currentTime = 12;
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    const { asked, clock } = clockAt(0.75);
    eng.setBeatClock(clock);
    eng.playCue('level_up');
    expect(asked).toEqual([]);
    expect(startedAt(LEVEL_UP_F)).toBe(12);
  });

  it('a stinger and another beat-quantised cue in one bar start on the same beat (the music hook)', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([LEVEL_UP_F, 'sfx/payout__F.ogg']);
    ctx().currentTime = 12;
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    eng.setBeatClock(clockAt(0.5).clock);
    eng.playCue('payout', { quantise: 'beat' });
    eng.playCue('level_up', { quantise: 'beat' });
    expect(startedAt('sfx/payout__F.ogg')).toBeCloseTo(12.5, 9);
    expect(startedAt(LEVEL_UP_F)).toBe(startedAt('sfx/payout__F.ogg'));
  });
});

// Ticket #61: music calls on the grid run through a look-ahead timer. A call runs once its grid time is within 100 ms of the
// audio clock (the timer ticks every 25 ms), so a bar line seconds away plays nothing until the window reaches it.
describe('ticket #61: music look-ahead', () => {
  afterEach(() => vi.useRealTimers());

  it('a call with no grid time (now) starts at once', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([`music/stems/${MENU_ID}.ogg`]);
    ctx().currentTime = 10;
    eng.engineSink.startMusic(MENU_ID, 2000, 'now');
    expect(sourcesOf().find((s) => s.started)?.when).toBe(10);
  });

  it('a bar call is not started until the look-ahead window reaches its bar line', async () => {
    vi.useFakeTimers();
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([`music/stems/${MENU_ID}.ogg`, 'music/stems/music_bed_F.ogg']);
    ctx().currentTime = 10;
    eng.engineSink.startMusic(MENU_ID, 2000, 'now'); // sets the grid: t0 = 10
    const bar = 10 + BAR_S;
    eng.engineSink.startMusic('music_bed_F', 2000, 'bar');
    const bedStarted = () => sourcesOf().find((s) => s.started && s.buffer?.path === 'music/stems/music_bed_F.ogg');
    expect(bedStarted()).toBeUndefined();

    ctx().currentTime = bar - 0.2; // 200 ms ahead: outside the 100 ms window
    vi.advanceTimersByTime(25);
    expect(bedStarted()).toBeUndefined();

    ctx().currentTime = bar - 0.05; // inside the window: the next tick starts it on its bar line
    vi.advanceTimersByTime(25);
    expect(bedStarted()?.when).toBeCloseTo(bar, 9);
  });

  it('a music call still queued when the tab hides is dropped: it never starts, and the hide reports it', async () => {
    vi.useFakeTimers();
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([`music/stems/${MENU_ID}.ogg`, 'music/stems/music_bed_F.ogg']);
    ctx().currentTime = 10;
    eng.engineSink.startMusic(MENU_ID, 2000, 'now');
    eng.engineSink.startMusic('music_bed_F', 2000, 'bar'); // queued for the bar line, not yet in the window
    expect(eng.setHidden(true)).toBe(true);
    ctx().currentTime = 10 + BAR_S + 0.05; // past the bar line, while hidden
    vi.advanceTimersByTime(100);
    expect(sourcesOf().some((s) => s.started && s.buffer?.path === 'music/stems/music_bed_F.ogg')).toBe(false);
  });

  it('a hide with no music call queued reports nothing dropped', async () => {
    vi.useFakeTimers();
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([`music/stems/${MENU_ID}.ogg`]);
    ctx().currentTime = 10;
    eng.engineSink.startMusic(MENU_ID, 2000, 'now');
    expect(eng.setHidden(true)).toBe(false);
  });
});

// Ticket #62: the speed's density caps the event notes per beat of the music grid (`perBeat`); the notes past the cap merge.
describe('ticket #62: event notes per beat', () => {
  const NOTE_F = 'sfx/level_up__F.ogg';
  /** How many sources started on the note's file. */
  const notesPlayed = (): number => sourcesOf().filter((s) => s.started && s.buffer?.path === NOTE_F).length;

  /** Music on the grid (t0 = 10 s). The clock moves 60 s per call, so the pool's rate limit does not hold the notes. */
  async function onGrid() {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    await eng.preload([NOTE_F, `music/stems/${MENU_ID}.ogg`]);
    let t = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 60_000));
    ctx().currentTime = 10;
    eng.engineSink.startMusic(MENU_ID, 2000, 'now'); // sets the grid: t0 = 10
    return eng;
  }

  it('at most perBeat notes start in one beat; the rest merge', async () => {
    const eng = await onGrid();
    for (let i = 0; i < 6; i++) eng.playCue('level_up', { perBeat: 4 });
    expect(notesPlayed()).toBe(4);
  });

  it('the next beat has its own allowance', async () => {
    const eng = await onGrid();
    for (let i = 0; i < 6; i++) eng.playCue('level_up', { perBeat: 4 });
    ctx().currentTime = 10 + BEAT_S + 0.01; // beat 1
    for (let i = 0; i < 6; i++) eng.playCue('level_up', { perBeat: 4 });
    expect(notesPlayed()).toBe(8);
  });

  it('a cue with no perBeat is not capped', async () => {
    const eng = await onGrid();
    for (let i = 0; i < 6; i++) eng.playCue('level_up');
    expect(notesPlayed()).toBe(6);
  });
});

// Ticket #58: a room or hum loop ends on the manifest's sample count, and a decoder that trims the file logs one warning.
describe('ticket #58: loop end and the decoder trim', () => {
  const ROOM_ID = 'amb_room_city_loop' as const;
  const ROOM_FILE = `ambience/${ROOM_ID}.ogg`;
  const ROOM_SAMPLES = MIX.ambience[ROOM_ID].samples;
  const roomSources = (): Source[] => sourcesOf().filter((s) => s.started && s.buffer?.path === ROOM_FILE);

  it('the loop ends on the manifest sample count, with no warning when the decode matches', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('pointerdown');
    eng.startLoop(ROOM_ID, 0);
    await flush();
    const [src] = roomSources();
    expect(src).toBeDefined();
    expect(src!.loop).toBe(true);
    expect(src!.loopStart).toBe(0);
    expect(src!.loopEnd).toBeCloseTo(ROOM_SAMPLES / MIX.sampleRate, 9);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a decoder that trims the loop logs one warning, and the loop still ends on the manifest count', async () => {
    const eng = await import('./engine');
    const trimmed = ROOM_SAMPLES - 1000;
    decodedLength.set(ROOM_FILE, trimmed);
    eng.unlockOnGesture();
    gesture('pointerdown');
    eng.startLoop(ROOM_ID, 0);
    await flush();
    const [src] = roomSources();
    expect(src!.loopEnd).toBeCloseTo(ROOM_SAMPLES / MIX.sampleRate, 9);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'ambience loop length differs from the manifest',
      expect.stringContaining(ROOM_FILE),
      trimmed,
      'expected',
      ROOM_SAMPLES,
    );
  });

  it('a trimmed loop that starts again logs no second warning', async () => {
    const eng = await import('./engine');
    decodedLength.set(ROOM_FILE, ROOM_SAMPLES - 1000);
    eng.unlockOnGesture();
    gesture('pointerdown');
    eng.startLoop(ROOM_ID, 0);
    await flush();
    eng.stopLoop(ROOM_ID, 0);
    eng.startLoop(ROOM_ID, 0);
    await flush();
    expect(roomSources()).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// Ticket #65: a music note is a music-bus cue. Production loads it at boot (`startLoading`, no debug board), so its first hit
// finds the decoded file and plays. A note that waited for its first hit was silent then.
describe('ticket #65: the first hit of a music note plays', () => {
  const NOTE_CUES = MIX.cues.filter((c) => c.id.startsWith('music_note_'));

  it('every note file is decoded at boot, so each note sounds on its first hit', async () => {
    const eng = await import('./engine');
    eng.unlockOnGesture();
    gesture('keydown');
    eng.startLoading();
    await flush();
    expect(NOTE_CUES.length).toBeGreaterThan(0);
    NOTE_CUES.forEach((c, i) =>
      eng.engineSink.playNote(c.id, { token: i + 1, delayS: 0, gainDb: 0, duckClass: 'standard' }),
    );
    expect(playedFiles()).toEqual(NOTE_CUES.map((c) => rel(c.files[0]!)));
    expect(warn).not.toHaveBeenCalled();
  });
});
